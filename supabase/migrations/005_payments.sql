-- =============================================================================
-- MegaBot · 005_payments.sql
--
-- Financial core: payment accounts, real payment events, customer payment
-- proofs, payment matches and DETERMINISTIC reconciliation that moves an
-- order to PAID.
--
--   what the customer claims  → payment_proofs   (evidence, never authority)
--   what really reached us    → payment_events   (immutable facts)
--   the decision linking them → payment_matches  (immutable decision records)
--
-- Rules, not AI: a payment is confirmed only when a real event matches the
-- order on provider, transaction ID (when claimed), receiving account,
-- currency, EXACT amount, compatible sender and time window. AI-extracted
-- data (payment_proofs.extracted_data) is stored but never consulted.
--
-- • Requires 001–004. Changes no object of 001–004 (adds one trigger on
--   public.orders so that API roles cannot set PAID without a confirmed match).
-- • Additive only: pre-flight check aborts (changing nothing) on conflicts.
-- • Runs in a single transaction: all or nothing.
-- • Apply in Supabase → SQL Editor (runs as the `postgres` role).
--
-- Access model
--   read   : members of the tenant (owner / admin / operator), via RLS
--   write  : ONLY through commands (no INSERT/UPDATE/DELETE grants):
--              create_payment_account, update_payment_account,
--              record_payment_event, confirm_payment_manually,
--              reject_payment_proof            → owner / admin
--              submit_payment_proof,
--              reconcile_payment_proof         → any member
--            always for an ACTIVE tenant; the tenant is derived from the
--            account / order / proof, never trusted from the client
--   anon   : nothing. Platform admins get no access to tenant finances here.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Pre-flight: 001–004 must be applied and nothing from 005 may exist.
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing   text;
  v_conflicts text;
begin
  select string_agg(x.name, ', ')
    into v_missing
    from (values
            ('public.tenants', pg_catalog.to_regclass('public.tenants')::oid),
            ('public.tenant_settings', pg_catalog.to_regclass('public.tenant_settings')::oid),
            ('public.orders', pg_catalog.to_regclass('public.orders')::oid),
            ('public.audit_logs', pg_catalog.to_regclass('public.audit_logs')::oid),
            ('private.set_updated_at()', pg_catalog.to_regprocedure('private.set_updated_at()')::oid),
            ('private.user_tenant_ids()', pg_catalog.to_regprocedure('private.user_tenant_ids()')::oid),
            ('private.has_tenant_role(uuid, text[])', pg_catalog.to_regprocedure('private.has_tenant_role(uuid, text[])')::oid),
            ('private.tenant_is_active(uuid)', pg_catalog.to_regprocedure('private.tenant_is_active(uuid)')::oid),
            ('private.audit_metadata_is_safe(jsonb)', pg_catalog.to_regprocedure('private.audit_metadata_is_safe(jsonb)')::oid),
            ('private.write_audit_log(...)', pg_catalog.to_regprocedure('private.write_audit_log(uuid, uuid, text, text, text, jsonb)')::oid),
            ('private.normalize_phone(text)', pg_catalog.to_regprocedure('private.normalize_phone(text)')::oid),
            ('private.order_status_transition_allowed(text, text)', pg_catalog.to_regprocedure('private.order_status_transition_allowed(text, text)')::oid)
         ) as x(name, found)
   where x.found is null;
  if v_missing is not null then
    raise exception 'Migration 005 abortada: falta % — aplique primeiro a 001, 002, 003 e 004. Nada foi alterado.', v_missing;
  end if;

  select string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    into v_conflicts
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('payment_accounts', 'payment_events', 'payment_proofs', 'payment_matches');
  if v_conflicts is not null then
    raise exception 'Migration 005 abortada: já existe %. Nada foi alterado — reveja o schema antes de continuar.', v_conflicts;
  end if;

  select string_agg(format('%I.%I()', n.nspname, p.proname), ', ')
    into v_conflicts
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where (n.nspname in ('public', 'private') and p.proname in (
            'create_payment_account', 'update_payment_account', 'record_payment_event', 'submit_payment_proof',
            'reconcile_payment_proof', 'reject_payment_proof', 'confirm_payment_manually'))
      or (n.nspname = 'private' and p.proname in (
            'payment_metadata_is_safe', 'payment_matches_before_insert', 'normalize_transaction_id', 'normalize_account_identifier', 'sender_digits', 'sender_identifiers_compatible',
            'payment_match_window', 'payment_accounts_before_write', 'payment_events_before_insert',
            'payment_proofs_before_write', 'prevent_financial_record_changes', 'orders_require_payment_confirmation',
            'evaluate_payment_match', 'apply_payment_decision', 'set_proof_status', 'sync_order_verification', 'reconcile_proof', 'reconcile_event',
            'audit_payment_account_changes'));
  if v_conflicts is not null then
    raise exception 'Migration 005 abortada: já existe a função %. Nada foi alterado.', v_conflicts;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Normalization and matching helpers (pure)
-- -----------------------------------------------------------------------------

-- Stricter than the audit guard (002): payment data never carries a PIN, OTP,
-- passcode or key, whatever the key is called.
create function private.payment_metadata_is_safe(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.audit_metadata_is_safe(p_metadata)
     and not exists (
       select 1
         from pg_catalog.jsonb_path_query(p_metadata, 'strict $.** ? (@.type() == "object")') as node(value)
        cross join lateral pg_catalog.jsonb_object_keys(node.value) as k(key)
        where pg_catalog.lower(k.key) ~ '(^|[^a-z])(m?pin|otp|passcode|cvv|private|signing)([^a-z]|$)'
           or pg_catalog.regexp_replace(pg_catalog.lower(k.key), '[^a-z0-9]', '', 'g')
              ~ '(pincode|mpin|passcode|accesskey|clientsecret|signingkey|privkey|privatekey)'
     );
$$;

-- Transaction IDs are compared case-insensitively and without spaces:
-- "pp261001.2114.h77120" → "PP261001.2114.H77120". NULL when not plausible.
create function private.normalize_transaction_id(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_value, ''), '[[:space:]]', '', 'g'));
begin
  if v !~ '^[A-Z0-9][A-Z0-9._-]{3,63}$' then
    return null;
  end if;
  return v;
end;
$$;

-- Receiving account / recipient identifiers: a phone (→ E.164), a till /
-- merchant code or any provider identifier (→ uppercase alphanumerics).
-- Not every provider uses phone numbers.
create function private.normalize_account_identifier(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v     text := pg_catalog.regexp_replace(coalesce(p_value, ''), '[[:space:]().-]', '', 'g');
  phone text;
begin
  if v = '' then
    return null;
  end if;
  phone := private.normalize_phone(v);
  if phone is not null then
    return phone;
  end if;
  v := pg_catalog.upper(v);
  if v !~ '^\+?[A-Z0-9]{3,64}$' then
    return null;
  end if;
  return v;
end;
$$;

-- Sender identifiers as providers show them: full ("+258 84 123 4567"),
-- masked ("84****567", "25884xxxx567") or partial. Keeps digits, turns mask
-- characters into "?", drops the international prefix (00 / +258).
create function private.sender_digits(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := pg_catalog.translate(pg_catalog.upper(coalesce(p_value, '')), '*X•#', '????');
begin
  v := pg_catalog.regexp_replace(v, '[^0-9?]', '', 'g');
  if v like '00%' then
    v := pg_catalog.substr(v, 3);
  end if;
  if v like '258%' and pg_catalog.length(v) >= 12 then
    v := pg_catalog.substr(v, 4);
  end if;
  return nullif(v, '');
end;
$$;

-- TRUE: compatible (≥ 3 visible digits compared, right-aligned, none differ).
-- FALSE: a visible digit differs. NULL: not enough evidence to say either.
-- Masked formats that hide a variable number of digits may compare as FALSE —
-- the safe side: that sends the payment to human review, never confirms it.
create function private.sender_identifiers_compatible(p_a text, p_b text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  a          text := private.sender_digits(p_a);
  b          text := private.sender_digits(p_b);
  n          integer;
  ca         text;
  cb         text;
  comparable integer := 0;
begin
  if a is null or b is null then
    return null;
  end if;
  n := least(pg_catalog.length(a), pg_catalog.length(b));
  for i in 1..n loop
    ca := pg_catalog.substr(a, pg_catalog.length(a) - i + 1, 1);
    cb := pg_catalog.substr(b, pg_catalog.length(b) - i + 1, 1);
    if ca <> '?' and cb <> '?' then
      if ca <> cb then
        return false;
      end if;
      comparable := comparable + 1;
    end if;
  end loop;
  if comparable < 3 then
    return null;
  end if;
  return true;
end;
$$;

-- Time window per tenant and provider (minutes before / after the order was
-- created), configurable in tenant_settings.payments:
--   { "match_window": { "MPESA": { "before_minutes": 60, "after_minutes": 2880 } } }
-- Defaults per provider; values outside 0..10080 (7 days) are ignored.
create function private.payment_match_window(
  p_tenant_id uuid,
  p_provider  text,
  out before_minutes integer,
  out after_minutes  integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_config jsonb;
begin
  before_minutes := case p_provider when 'MPESA' then 60 when 'EMOLA' then 60 else 30 end;
  after_minutes  := case p_provider when 'MPESA' then 2880 when 'EMOLA' then 2880 else 1440 end;

  select s.payments -> 'match_window' -> p_provider into v_config
    from public.tenant_settings s where s.tenant_id = p_tenant_id;
  if pg_catalog.jsonb_typeof(v_config) = 'object' then
    if pg_catalog.jsonb_typeof(v_config -> 'before_minutes') = 'number'
       and (v_config ->> 'before_minutes')::numeric between 0 and 10080 then
      before_minutes := pg_catalog.floor((v_config ->> 'before_minutes')::numeric)::integer;
    end if;
    if pg_catalog.jsonb_typeof(v_config -> 'after_minutes') = 'number'
       and (v_config ->> 'after_minutes')::numeric between 0 and 10080 then
      after_minutes := pg_catalog.floor((v_config ->> 'after_minutes')::numeric)::integer;
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. payment_accounts — where a tenant receives money
-- -----------------------------------------------------------------------------
create table public.payment_accounts (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references public.tenants (id) on delete cascade,
  -- Explicit provider; never inferred from transaction ID formats.
  provider            text        not null,
  account_name        text        not null,
  -- Phone, account number, till / merchant code… (normalized, see helper).
  account_identifier  text        not null,
  status              text        not null default 'ACTIVE',
  -- No credentials here (PIN, API keys, tokens): enforced by the metadata guard.
  metadata            jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint payment_accounts_provider_valid    check (provider in ('MPESA', 'EMOLA')),
  constraint payment_accounts_name_length       check (char_length(btrim(account_name)) between 2 and 120),
  constraint payment_accounts_identifier_format check (account_identifier ~ '^\+?[A-Z0-9]{3,64}$'),
  constraint payment_accounts_status_valid      check (status in ('ACTIVE', 'INACTIVE')),
  constraint payment_accounts_metadata_safe     check (private.payment_metadata_is_safe(metadata)),
  constraint payment_accounts_tenant_identifier_key unique (tenant_id, provider, account_identifier)
);
comment on table public.payment_accounts is
  'Receiving accounts of a tenant (M-Pesa, e-Mola…). Never stores credentials. Written only through create/update_payment_account.';

create index payment_accounts_tenant_idx on public.payment_accounts (tenant_id, provider, status);

-- Normalizes input; provider, identifier and tenant are fixed once created
-- (events reference them — use a new account instead of rewriting one).
create function private.payment_accounts_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.account_name := pg_catalog.btrim(new.account_name);
  if tg_op = 'INSERT' then
    new.account_identifier := private.normalize_account_identifier(new.account_identifier);
    if new.account_identifier is null then
      raise exception 'Identificador de conta inválido.' using errcode = '22023', hint = 'INVALID_ACCOUNT_IDENTIFIER';
    end if;
    return new;
  end if;
  if (new.tenant_id, new.provider, new.account_identifier, new.created_at)
     is distinct from (old.tenant_id, old.provider, old.account_identifier, old.created_at) then
    raise exception 'O fornecedor e o identificador de uma conta não podem ser alterados — crie uma nova conta.'
      using errcode = '55000', hint = 'IMMUTABLE_ACCOUNT';
  end if;
  return new;
end;
$$;

create trigger payment_accounts_before_write
  before insert or update on public.payment_accounts
  for each row execute function private.payment_accounts_before_write();
create trigger payment_accounts_set_updated_at
  before update on public.payment_accounts
  for each row execute function private.set_updated_at();

-- Changes to receiving accounts are sensitive (they decide where money is
-- accepted): every change goes to audit_logs.
create function private.audit_payment_account_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'payment_account.created';
  elsif new.status is distinct from old.status then
    v_action := case new.status when 'ACTIVE' then 'payment_account.activated' else 'payment_account.deactivated' end;
  elsif new.account_name is distinct from old.account_name or new.metadata is distinct from old.metadata then
    v_action := 'payment_account.updated';
  else
    return null;
  end if;
  perform private.write_audit_log((select auth.uid()), new.tenant_id, v_action, 'payment_account', new.id::text,
    pg_catalog.jsonb_build_object('provider', new.provider, 'status', new.status));
  return null;
end;
$$;

create trigger payment_accounts_audit
  after insert or update on public.payment_accounts
  for each row execute function private.audit_payment_account_changes();

-- -----------------------------------------------------------------------------
-- 3. payment_events — what REALLY reached a receiving account (immutable)
-- -----------------------------------------------------------------------------
create table public.payment_events (
  id                    uuid           primary key default gen_random_uuid(),
  tenant_id             uuid           not null references public.tenants (id) on delete cascade,
  payment_account_id    uuid           not null references public.payment_accounts (id) on delete restrict,
  provider              text           not null,
  transaction_id        text           not null,
  amount                numeric(12, 2) not null,
  currency              text           not null,
  -- As the provider shows it (may be masked / partial).
  sender_identifier     text,
  recipient_identifier  text,
  occurred_at           timestamptz    not null,
  received_at           timestamptz    not null default now(),
  -- Original provider message, only what is needed (no credentials, ≤ 2000 chars).
  raw_message           text,
  -- MANUAL (recorded in the app) | SMS (device reader) | PROVIDER_API (webhook/API) — later phases.
  source                text           not null default 'MANUAL',
  recorded_by           uuid,
  metadata              jsonb          not null default '{}'::jsonb,
  created_at            timestamptz    not null default now(),
  constraint payment_events_provider_valid    check (provider in ('MPESA', 'EMOLA')),
  constraint payment_events_transaction_format check (transaction_id ~ '^[A-Z0-9][A-Z0-9._-]{3,63}$'),
  constraint payment_events_amount_positive   check (amount > 0),
  constraint payment_events_currency_format   check (currency ~ '^[A-Z]{3}$'),
  constraint payment_events_sender_length     check (sender_identifier is null or char_length(sender_identifier) between 1 and 64),
  constraint payment_events_recipient_length  check (recipient_identifier is null or char_length(recipient_identifier) between 1 and 64),
  constraint payment_events_raw_length        check (raw_message is null or char_length(raw_message) between 1 and 2000),
  constraint payment_events_source_valid      check (source in ('MANUAL', 'SMS', 'PROVIDER_API')),
  constraint payment_events_not_future        check (occurred_at <= received_at + interval '10 minutes'),
  constraint payment_events_metadata_safe     check (private.payment_metadata_is_safe(metadata)),
  -- Idempotency: one event per provider + receiving account + transaction ID.
  -- (Transaction IDs are not assumed unique across providers.)
  constraint payment_events_provider_account_tx_key unique (provider, payment_account_id, transaction_id)
);
comment on table public.payment_events is
  'Real provider events on a receiving account. Immutable financial facts: corrections are new events, never edits.';

create index payment_events_tenant_occurred_idx on public.payment_events (tenant_id, occurred_at desc);
create index payment_events_tenant_tx_idx       on public.payment_events (tenant_id, provider, transaction_id);
create index payment_events_account_idx         on public.payment_events (payment_account_id, occurred_at desc);

-- Tenant and provider always come from the account; IDs are normalized.
create function private.payment_events_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account public.payment_accounts;
begin
  select a.* into v_account from public.payment_accounts a where a.id = new.payment_account_id;
  if not found or (new.tenant_id is not null and new.tenant_id <> v_account.tenant_id) then
    raise exception 'Conta de pagamento não encontrada.' using errcode = 'P0002', hint = 'ACCOUNT_NOT_FOUND';
  end if;
  if new.provider is not null and new.provider <> v_account.provider then
    raise exception 'O fornecedor do movimento não corresponde ao da conta.' using errcode = '22023', hint = 'PROVIDER_MISMATCH';
  end if;
  new.tenant_id := v_account.tenant_id;
  new.provider := v_account.provider;
  new.transaction_id := private.normalize_transaction_id(new.transaction_id);
  if new.transaction_id is null then
    raise exception 'ID de transação inválido.' using errcode = '22023', hint = 'INVALID_TRANSACTION_ID';
  end if;
  new.sender_identifier := nullif(pg_catalog.btrim(new.sender_identifier), '');
  new.recipient_identifier := nullif(pg_catalog.btrim(new.recipient_identifier), '');
  new.raw_message := nullif(pg_catalog.btrim(new.raw_message), '');
  new.received_at := coalesce(new.received_at, pg_catalog.now());
  return new;
end;
$$;

create trigger payment_events_before_insert
  before insert on public.payment_events
  for each row execute function private.payment_events_before_insert();

-- -----------------------------------------------------------------------------
-- 4. payment_proofs — what the CUSTOMER says (evidence, never authority)
-- -----------------------------------------------------------------------------
create table public.payment_proofs (
  id                    uuid           primary key default gen_random_uuid(),
  tenant_id             uuid           not null references public.tenants (id) on delete cascade,
  order_id              uuid           references public.orders (id) on delete restrict,
  provider              text,
  transaction_id        text,
  amount                numeric(12, 2),
  currency              text,
  sender_identifier     text,
  recipient_identifier  text,
  raw_message           text,
  -- MANUAL (entered in the app) | WHATSAPP (later phase)
  source                text           not null default 'MANUAL',
  -- Fields extracted by AI / parsers. Stored for reference ONLY: reconciliation never reads it.
  extracted_data        jsonb          not null default '{}'::jsonb,
  status                text           not null default 'UNMATCHED',
  -- Machine-readable reason of the current status (NO_EVENT_YET, UNDERPAID…).
  status_reason         text,
  -- Human note when rejected.
  review_note           text,
  submitted_by          uuid,
  created_at            timestamptz    not null default now(),
  updated_at            timestamptz    not null default now(),
  constraint payment_proofs_provider_valid    check (provider is null or provider in ('MPESA', 'EMOLA')),
  constraint payment_proofs_transaction_format check (transaction_id is null or transaction_id ~ '^[A-Z0-9][A-Z0-9._-]{3,63}$'),
  constraint payment_proofs_amount_positive   check (amount is null or amount > 0),
  constraint payment_proofs_currency_format   check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint payment_proofs_sender_length     check (sender_identifier is null or char_length(sender_identifier) between 1 and 64),
  constraint payment_proofs_recipient_length  check (recipient_identifier is null or char_length(recipient_identifier) between 1 and 64),
  constraint payment_proofs_raw_length        check (raw_message is null or char_length(raw_message) between 1 and 2000),
  constraint payment_proofs_has_evidence      check (transaction_id is not null or raw_message is not null),
  constraint payment_proofs_source_valid      check (source in ('MANUAL', 'WHATSAPP')),
  constraint payment_proofs_status_valid      check (status in (
    'UNMATCHED', 'PENDING_REVIEW', 'MATCHED', 'CONFIRMED', 'REJECTED', 'DUPLICATE', 'EXPIRED')),
  constraint payment_proofs_reason_format     check (status_reason is null or status_reason ~ '^[A-Z_]{3,40}$'),
  constraint payment_proofs_note_length       check (review_note is null or char_length(review_note) between 1 and 500),
  constraint payment_proofs_extracted_safe    check (private.payment_metadata_is_safe(extracted_data))
);
comment on table public.payment_proofs is
  'Customer-provided payment evidence. Never confirms a payment by itself; only a matching payment_event can.';
comment on column public.payment_proofs.extracted_data is
  'AI / parser output. No authority: deterministic reconciliation never reads it.';

create index payment_proofs_tenant_created_idx on public.payment_proofs (tenant_id, created_at desc);
create index payment_proofs_tenant_tx_idx      on public.payment_proofs (tenant_id, provider, transaction_id);
create index payment_proofs_order_idx          on public.payment_proofs (order_id);

-- -----------------------------------------------------------------------------
-- 5. payment_matches — reconciliation decisions (immutable records)
-- -----------------------------------------------------------------------------
create table public.payment_matches (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         uuid        not null references public.tenants (id) on delete cascade,
  order_id          uuid        not null references public.orders (id) on delete restrict,
  payment_proof_id  uuid        references public.payment_proofs (id) on delete restrict,
  payment_event_id  uuid        references public.payment_events (id) on delete restrict,
  match_status      text        not null,
  -- Deterministic criteria that held (TRANSACTION_ID, AMOUNT, ACCOUNT, SENDER,
  -- TIME_WINDOW, ORDER_CONTEXT, MANUAL). Not an AI confidence.
  match_methods     text[]      not null default array[]::text[],
  reason            text,
  -- Result of every check (PASS / FAIL / SKIPPED) and the amounts compared.
  details           jsonb       not null default '{}'::jsonb,
  matched_at        timestamptz not null default now(),
  -- NULL = automatic decision; otherwise the member who decided / triggered it.
  matched_by        uuid,
  metadata          jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  constraint payment_matches_status_valid check (match_status in (
    'UNMATCHED', 'PENDING_REVIEW', 'MATCHED', 'CONFIRMED', 'REJECTED', 'DUPLICATE', 'EXPIRED')),
  constraint payment_matches_methods_valid check (match_methods <@ array[
    'TRANSACTION_ID', 'AMOUNT', 'ACCOUNT', 'SENDER', 'TIME_WINDOW', 'ORDER_CONTEXT', 'MANUAL']),
  constraint payment_matches_confirmed_needs_event check (match_status <> 'CONFIRMED' or payment_event_id is not null),
  constraint payment_matches_reason_format check (reason is null or reason ~ '^[A-Z_]{3,40}$'),
  constraint payment_matches_details_safe  check (private.audit_metadata_is_safe(details)),
  constraint payment_matches_metadata_safe check (private.audit_metadata_is_safe(metadata))
);
comment on table public.payment_matches is
  'Reconciliation decisions between orders, proofs and events. Append-only. At most one CONFIRMED per event, per order and per proof.';

-- No double payment: one confirmed event pays one order, once (also under concurrency).
create unique index payment_matches_confirmed_event_key on public.payment_matches (payment_event_id) where match_status = 'CONFIRMED';
create unique index payment_matches_confirmed_order_key on public.payment_matches (order_id) where match_status = 'CONFIRMED';
create unique index payment_matches_confirmed_proof_key on public.payment_matches (payment_proof_id) where match_status = 'CONFIRMED';
create index payment_matches_tenant_created_idx on public.payment_matches (tenant_id, created_at desc);
create index payment_matches_order_idx          on public.payment_matches (order_id);
create index payment_matches_event_idx          on public.payment_matches (payment_event_id);
create index payment_matches_proof_idx          on public.payment_matches (payment_proof_id);

-- -----------------------------------------------------------------------------
-- 6. Integrity triggers (apply to every role, service_role included)
-- -----------------------------------------------------------------------------

-- Financial history is never edited: no UPDATE, no direct DELETE / TRUNCATE
-- (only the cascade when the database owner removes a whole tenant).
create function private.prevent_financial_record_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% é imutável: % não é permitido.', tg_table_name, tg_op using errcode = '42501';
end;
$$;

create trigger payment_events_immutable
  before update or delete on public.payment_events
  for each row execute function private.prevent_financial_record_changes();
create trigger payment_events_no_truncate
  before truncate on public.payment_events
  for each statement execute function private.prevent_financial_record_changes();
-- A decision only links rows of one tenant (defense in depth: the commands
-- already derive everything from the same tenant).
create function private.payment_matches_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.orders o where o.id = new.order_id and o.tenant_id = new.tenant_id)
     or (new.payment_event_id is not null and not exists (
           select 1 from public.payment_events e where e.id = new.payment_event_id and e.tenant_id = new.tenant_id))
     or (new.payment_proof_id is not null and not exists (
           select 1 from public.payment_proofs p where p.id = new.payment_proof_id and p.tenant_id = new.tenant_id)) then
    raise exception 'Correspondência entre registos de empresas diferentes.' using errcode = '42501', hint = 'TENANT_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger payment_matches_before_insert
  before insert on public.payment_matches
  for each row execute function private.payment_matches_before_insert();
create trigger payment_matches_immutable
  before update or delete on public.payment_matches
  for each row execute function private.prevent_financial_record_changes();
create trigger payment_matches_no_truncate
  before truncate on public.payment_matches
  for each statement execute function private.prevent_financial_record_changes();

-- Proofs: the evidence is fixed; only the reconciliation status moves, and a
-- final status (CONFIRMED / REJECTED / DUPLICATE / EXPIRED) never changes.
-- CONFIRMED requires a CONFIRMED match for the proof.
create function private.payment_proofs_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.order_id is not null and not exists (
      select 1 from public.orders o where o.id = new.order_id and o.tenant_id = new.tenant_id) then
      raise exception 'Pedido não encontrado.' using errcode = 'P0002', hint = 'ORDER_NOT_FOUND';
    end if;
    if new.transaction_id is not null then
      new.transaction_id := private.normalize_transaction_id(new.transaction_id);
      if new.transaction_id is null then
        raise exception 'ID de transação inválido.' using errcode = '22023', hint = 'INVALID_TRANSACTION_ID';
      end if;
    end if;
    new.sender_identifier := nullif(pg_catalog.btrim(new.sender_identifier), '');
    new.recipient_identifier := nullif(pg_catalog.btrim(new.recipient_identifier), '');
    new.raw_message := nullif(pg_catalog.btrim(new.raw_message), '');
    new.status := 'UNMATCHED';
    new.status_reason := null;
    new.review_note := null;
    return new;
  end if;

  if (new.tenant_id, new.order_id, new.provider, new.transaction_id, new.amount, new.currency,
      new.sender_identifier, new.recipient_identifier, new.raw_message, new.source, new.extracted_data,
      new.submitted_by, new.created_at)
     is distinct from
     (old.tenant_id, old.order_id, old.provider, old.transaction_id, old.amount, old.currency,
      old.sender_identifier, old.recipient_identifier, old.raw_message, old.source, old.extracted_data,
      old.submitted_by, old.created_at) then
    raise exception 'O comprovativo não pode ser alterado depois de registado.' using errcode = '55000', hint = 'IMMUTABLE_PROOF';
  end if;
  if old.status in ('CONFIRMED', 'REJECTED', 'DUPLICATE', 'EXPIRED') and new.status is distinct from old.status then
    raise exception 'Comprovativo já decidido (%).', old.status using errcode = '55000', hint = 'PROOF_FINAL';
  end if;
  if new.status = 'CONFIRMED' and old.status <> 'CONFIRMED' and not exists (
    select 1 from public.payment_matches m where m.payment_proof_id = new.id and m.match_status = 'CONFIRMED') then
    raise exception 'Confirmação sem correspondência determinística.' using errcode = '42501', hint = 'PAYMENT_NOT_CONFIRMED';
  end if;
  return new;
end;
$$;

create trigger payment_proofs_before_write
  before insert or update on public.payment_proofs
  for each row execute function private.payment_proofs_before_write();
create trigger payment_proofs_set_updated_at
  before update on public.payment_proofs
  for each row execute function private.set_updated_at();

-- Orders (004) gain one more guard: API roles — including service_role, i.e.
-- future workers — can only set PAID when a CONFIRMED payment match exists.
-- (The database owner, which runs the reconciliation functions below, keeps
-- full control for maintenance; it always records the match first.)
create function private.orders_require_payment_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'PAID' and old.status is distinct from 'PAID'
     and current_user in ('anon', 'authenticated', 'service_role')
     and not exists (select 1 from public.payment_matches m where m.order_id = new.id and m.match_status = 'CONFIRMED') then
    raise exception 'Pagamento não confirmado: o pedido só passa a PAID com uma correspondência determinística confirmada.'
      using errcode = '42501', hint = 'PAYMENT_NOT_CONFIRMED';
  end if;
  return new;
end;
$$;

create trigger orders_require_payment_confirmation
  before update of status on public.orders
  for each row execute function private.orders_require_payment_confirmation();

-- -----------------------------------------------------------------------------
-- 7. Deterministic reconciliation
-- -----------------------------------------------------------------------------

-- Pure evaluation (no writes) of an order ↔ event (↔ proof) pairing. Returns
--   { decision: CONFIRMED | PENDING_REVIEW | DUPLICATE | REJECTED,
--     reason, failures[], methods[], checks{}, order_amount, event_amount, currency }
-- Failure codes: EVENT_ALREADY_USED, ORDER_ALREADY_PAID, ORDER_NOT_PAYABLE,
-- PROVIDER_MISMATCH, TRANSACTION_ID_MISMATCH, ACCOUNT_INACTIVE, ACCOUNT_MISMATCH,
-- CURRENCY_MISMATCH, UNDERPAID, OVERPAID, PROOF_AMOUNT_MISMATCH, SENDER_MISMATCH,
-- OUTSIDE_TIME_WINDOW. Over- and underpayment are never accepted automatically.
create function private.evaluate_payment_match(
  p_order  public.orders,
  p_event  public.payment_events,
  p_proof  public.payment_proofs
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_account  public.payment_accounts;
  v_failures text[] := array[]::text[];
  v_methods  text[] := array[]::text[];
  v_checks   jsonb := '{}'::jsonb;
  v_window   record;
  v_sender   boolean;
  v_result   jsonb;
begin
  v_result := pg_catalog.jsonb_build_object(
    'order_amount', p_order.product_price_snapshot, 'event_amount', p_event.amount, 'currency', p_event.currency);

  if p_event.tenant_id <> p_order.tenant_id or (p_proof.id is not null and p_proof.tenant_id <> p_order.tenant_id) then
    return v_result || pg_catalog.jsonb_build_object('decision', 'REJECTED', 'reason', 'TENANT_MISMATCH',
      'failures', pg_catalog.jsonb_build_array('TENANT_MISMATCH'), 'methods', '[]'::jsonb, 'checks', '{}'::jsonb);
  end if;

  if exists (select 1 from public.payment_matches m
              where m.payment_event_id = p_event.id and m.match_status = 'CONFIRMED') then
    return v_result || pg_catalog.jsonb_build_object('decision', 'DUPLICATE', 'reason', 'EVENT_ALREADY_USED',
      'failures', pg_catalog.jsonb_build_array('EVENT_ALREADY_USED'), 'methods', '[]'::jsonb,
      'checks', pg_catalog.jsonb_build_object('duplicate', 'FAIL'));
  end if;

  -- Order
  if exists (select 1 from public.payment_matches m where m.order_id = p_order.id and m.match_status = 'CONFIRMED') then
    v_failures := v_failures || 'ORDER_ALREADY_PAID'::text;
    v_checks := v_checks || '{"order": "FAIL"}';
  elsif p_order.status not in ('PENDING', 'AWAITING_PAYMENT', 'VERIFYING') then
    v_failures := v_failures || 'ORDER_NOT_PAYABLE'::text;
    v_checks := v_checks || '{"order": "FAIL"}';
  else
    v_checks := v_checks || '{"order": "PASS"}';
    v_methods := v_methods || 'ORDER_CONTEXT'::text;
  end if;

  -- Provider and transaction ID (only when the customer claimed them)
  if p_proof.id is not null then
    if p_proof.provider is distinct from p_event.provider then
      v_failures := v_failures || 'PROVIDER_MISMATCH'::text;
      v_checks := v_checks || '{"provider": "FAIL"}';
    else
      v_checks := v_checks || '{"provider": "PASS"}';
    end if;
    if p_proof.transaction_id is distinct from p_event.transaction_id then
      v_failures := v_failures || 'TRANSACTION_ID_MISMATCH'::text;
      v_checks := v_checks || '{"transaction_id": "FAIL"}';
    else
      v_checks := v_checks || '{"transaction_id": "PASS"}';
      v_methods := v_methods || 'TRANSACTION_ID'::text;
    end if;
  end if;

  -- Receiving account: the event's account, active, and the one the customer named
  select a.* into v_account from public.payment_accounts a where a.id = p_event.payment_account_id;
  if v_account.status is distinct from 'ACTIVE' then
    v_failures := v_failures || 'ACCOUNT_INACTIVE'::text;
    v_checks := v_checks || '{"account": "FAIL"}';
  elsif (p_proof.recipient_identifier is not null
         and private.normalize_account_identifier(p_proof.recipient_identifier) is distinct from v_account.account_identifier)
     or (p_event.recipient_identifier is not null
         and private.normalize_account_identifier(p_event.recipient_identifier) is distinct from v_account.account_identifier) then
    v_failures := v_failures || 'ACCOUNT_MISMATCH'::text;
    v_checks := v_checks || '{"account": "FAIL"}';
  else
    v_checks := v_checks || '{"account": "PASS"}';
    v_methods := v_methods || 'ACCOUNT'::text;
  end if;

  -- Currency and EXACT amount
  if p_event.currency <> p_order.currency_snapshot then
    v_failures := v_failures || 'CURRENCY_MISMATCH'::text;
    v_checks := v_checks || '{"currency": "FAIL", "amount": "FAIL"}';
  elsif p_event.amount < p_order.product_price_snapshot then
    v_failures := v_failures || 'UNDERPAID'::text;
    v_checks := v_checks || '{"currency": "PASS", "amount": "FAIL"}';
  elsif p_event.amount > p_order.product_price_snapshot then
    v_failures := v_failures || 'OVERPAID'::text;
    v_checks := v_checks || '{"currency": "PASS", "amount": "FAIL"}';
  else
    v_checks := v_checks || '{"currency": "PASS", "amount": "PASS"}';
    v_methods := v_methods || 'AMOUNT'::text;
  end if;
  if (p_proof.amount is not null and p_proof.amount <> p_event.amount)
     or (p_proof.currency is not null and p_proof.currency <> p_event.currency) then
    v_failures := v_failures || 'PROOF_AMOUNT_MISMATCH'::text;
    v_checks := v_checks || '{"proof_amount": "FAIL"}';
  end if;

  -- Sender (provider-aware: masked numbers compare on visible digits)
  v_sender := private.sender_identifiers_compatible(p_proof.sender_identifier, p_event.sender_identifier);
  if v_sender is false then
    v_failures := v_failures || 'SENDER_MISMATCH'::text;
    v_checks := v_checks || '{"sender": "FAIL"}';
  elsif v_sender then
    v_checks := v_checks || '{"sender": "PASS"}';
    v_methods := v_methods || 'SENDER'::text;
  else
    v_checks := v_checks || '{"sender": "SKIPPED"}';
  end if;

  -- Time window (per tenant / provider)
  select * into v_window from private.payment_match_window(p_order.tenant_id, p_event.provider);
  if p_event.occurred_at < p_order.created_at - pg_catalog.make_interval(mins => v_window.before_minutes)
     or p_event.occurred_at > p_order.created_at + pg_catalog.make_interval(mins => v_window.after_minutes) then
    v_failures := v_failures || 'OUTSIDE_TIME_WINDOW'::text;
    v_checks := v_checks || '{"time_window": "FAIL"}';
  else
    v_checks := v_checks || '{"time_window": "PASS"}';
    v_methods := v_methods || 'TIME_WINDOW'::text;
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'decision', case when pg_catalog.cardinality(v_failures) = 0 then 'CONFIRMED' else 'PENDING_REVIEW' end,
    'reason', v_failures[1],
    'failures', pg_catalog.to_jsonb(v_failures),
    'methods', pg_catalog.to_jsonb(v_methods),
    'checks', v_checks);
end;
$$;

-- Proof status helper (never touches final statuses).
create function private.set_proof_status(p_proof_id uuid, p_status text, p_reason text)
returns public.payment_proofs
language plpgsql
set search_path = ''
as $$
declare
  v_proof public.payment_proofs;
begin
  update public.payment_proofs p
     set status = p_status, status_reason = p_reason
   where p.id = p_proof_id
     and p.status not in ('CONFIRMED', 'REJECTED', 'DUPLICATE', 'EXPIRED')
     and (p.status is distinct from p_status or p.status_reason is distinct from p_reason);
  select p.* into v_proof from public.payment_proofs p where p.id = p_proof_id;
  return v_proof;
end;
$$;

-- Records a decision and applies it: CONFIRMED moves the order to PAID through
-- the order state machine (PENDING → AWAITING_PAYMENT → PAID). A concurrent
-- confirmation of the same event / order loses on the unique indexes and is
-- recorded as DUPLICATE.
create function private.apply_payment_decision(
  p_order_id   uuid,
  p_event_id   uuid,
  p_proof_id   uuid,
  p_evaluation jsonb,
  p_actor      uuid
)
returns public.payment_matches
language plpgsql
set search_path = ''
as $$
declare
  v_decision text := p_evaluation ->> 'decision';
  v_reason   text := p_evaluation ->> 'reason';
  v_methods  text[];
  v_details  jsonb := p_evaluation - 'decision' - 'reason' - 'methods';
  v_match    public.payment_matches;
  v_lost_on  text;
begin
  select coalesce(pg_catalog.array_agg(x.value), array[]::text[]) into v_methods
    from pg_catalog.jsonb_array_elements_text(coalesce(p_evaluation -> 'methods', '[]'::jsonb)) as x(value);

  -- Re-running an unchanged review does not pile up identical rows.
  if v_decision <> 'CONFIRMED' then
    select m.* into v_match from public.payment_matches m
     where m.order_id = p_order_id
       and m.payment_event_id is not distinct from p_event_id
       and m.payment_proof_id is not distinct from p_proof_id
       and m.match_status = v_decision
       and m.reason is not distinct from v_reason
     order by m.created_at desc
     limit 1;
  end if;

  if v_match.id is null then
    begin
      insert into public.payment_matches (tenant_id, order_id, payment_proof_id, payment_event_id, match_status,
                                          match_methods, reason, details, matched_by)
      select o.tenant_id, p_order_id, p_proof_id, p_event_id, v_decision, v_methods, v_reason, v_details, p_actor
        from public.orders o where o.id = p_order_id
      returning * into v_match;
    exception when unique_violation then
      -- Lost a race: the event (→ DUPLICATE) or the order (→ review: money
      -- arrived for an order already paid) was confirmed concurrently.
      get stacked diagnostics v_lost_on = constraint_name;
      if v_lost_on = 'payment_matches_confirmed_order_key' then
        v_decision := 'PENDING_REVIEW';
        v_reason := 'ORDER_ALREADY_PAID';
      else
        v_decision := 'DUPLICATE';
        v_reason := 'EVENT_ALREADY_USED';
      end if;
      insert into public.payment_matches (tenant_id, order_id, payment_proof_id, payment_event_id, match_status,
                                          match_methods, reason, details, matched_by)
      select o.tenant_id, p_order_id, p_proof_id, p_event_id, v_decision, array[]::text[], v_reason,
             v_details || pg_catalog.jsonb_build_object('failures', pg_catalog.jsonb_build_array(v_reason)), p_actor
        from public.orders o where o.id = p_order_id
      returning * into v_match;
    end;
  end if;

  if v_decision = 'CONFIRMED' then
    update public.orders o set status = 'AWAITING_PAYMENT' where o.id = p_order_id and o.status = 'PENDING';
    update public.orders o set status = 'PAID' where o.id = p_order_id;
  end if;

  if p_proof_id is not null then
    update public.payment_proofs p
       set status = case v_decision
                      when 'CONFIRMED' then 'CONFIRMED'
                      when 'DUPLICATE' then 'DUPLICATE'
                      when 'REJECTED' then 'REJECTED'
                      else 'PENDING_REVIEW' end,
           status_reason = v_reason
     where p.id = p_proof_id
       and p.status not in ('CONFIRMED', 'REJECTED', 'DUPLICATE', 'EXPIRED');
  end if;
  return v_match;
end;
$$;

-- Keeps the order's status in step with its proofs, through the order state
-- machine: an open proof (customer says they paid) → VERIFYING; no open proof
-- left (rejected / duplicate) → back to AWAITING_PAYMENT. Never sets PAID.
create function private.sync_order_verification(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
  v_open  boolean;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    return;
  end if;
  v_open := exists (select 1 from public.payment_proofs p
                     where p.order_id = p_order_id and p.status in ('UNMATCHED', 'PENDING_REVIEW', 'MATCHED'));
  if v_open and v_order.status in ('PENDING', 'AWAITING_PAYMENT') then
    update public.orders o set status = 'AWAITING_PAYMENT' where o.id = p_order_id and o.status = 'PENDING';
    update public.orders o set status = 'VERIFYING' where o.id = p_order_id;
  elsif not v_open and v_order.status = 'VERIFYING' then
    update public.orders o set status = 'AWAITING_PAYMENT' where o.id = p_order_id;
  end if;
end;
$$;

-- Proof-driven reconciliation: provider + transaction ID locate the event,
-- then every deterministic check must pass. Idempotent.
-- Lock order everywhere: event → order → proof (no deadlocks, no double use).
create function private.reconcile_proof(p_proof_id uuid)
returns public.payment_proofs
language plpgsql
set search_path = ''
as $$
declare
  v_proof  public.payment_proofs;
  v_event  public.payment_events;
  v_order  public.orders;
  v_events integer;
  v_status text;
  v_reason text;
begin
  select p.* into v_proof from public.payment_proofs p where p.id = p_proof_id;
  if not found then
    raise exception 'Comprovativo não encontrado.' using errcode = 'P0002', hint = 'PROOF_NOT_FOUND';
  end if;
  if v_proof.status in ('CONFIRMED', 'REJECTED', 'DUPLICATE', 'EXPIRED') then
    return v_proof;
  end if;

  <<decide>>
  begin
    if v_proof.provider is null or v_proof.transaction_id is null then
      v_status := 'UNMATCHED';
      v_reason := 'TRANSACTION_ID_REQUIRED';
      exit decide;
    end if;

    select pg_catalog.count(*) into v_events from public.payment_events e
     where e.tenant_id = v_proof.tenant_id and e.provider = v_proof.provider and e.transaction_id = v_proof.transaction_id;
    if v_events = 0 then
      v_status := 'UNMATCHED';
      v_reason := 'NO_EVENT_YET';
      exit decide;
    elsif v_events > 1 then
      -- Same ID on two receiving accounts of the tenant: a person decides.
      v_status := 'PENDING_REVIEW';
      v_reason := 'AMBIGUOUS_EVENT';
      exit decide;
    end if;

    select e.* into v_event from public.payment_events e
     where e.tenant_id = v_proof.tenant_id and e.provider = v_proof.provider and e.transaction_id = v_proof.transaction_id
       for update;
    if v_proof.order_id is null then
      v_status := 'MATCHED';
      v_reason := 'ORDER_REQUIRED';
      exit decide;
    end if;
    select o.* into v_order from public.orders o where o.id = v_proof.order_id for update;
    select p.* into v_proof from public.payment_proofs p where p.id = p_proof_id for update;
    if v_proof.status in ('CONFIRMED', 'REJECTED', 'DUPLICATE', 'EXPIRED') then
      return v_proof;
    end if;

    perform private.apply_payment_decision(v_order.id, v_event.id, v_proof.id,
                                           private.evaluate_payment_match(v_order, v_event, v_proof),
                                           (select auth.uid()));
  end decide;

  if v_status is not null then
    if v_proof.order_id is not null then
      perform 1 from public.orders o where o.id = v_proof.order_id for update;
    end if;
    perform private.set_proof_status(v_proof.id, v_status, v_reason);
  end if;
  if v_proof.order_id is not null then
    perform private.sync_order_verification(v_proof.order_id);
  end if;
  select p.* into v_proof from public.payment_proofs p where p.id = p_proof_id;
  return v_proof;
end;
$$;

-- Event-driven reconciliation (event without proof):
--   1. proofs claiming this transaction decide first;
--   2. otherwise, orders with the exact amount / currency inside the time
--      window are candidates. Confirmed automatically ONLY when there is
--      exactly one candidate AND the provider shows the full sender number and
--      it equals the order's customer phone. Anything else becomes a
--      PENDING_REVIEW candidate for a human — never a silent confirmation.
create function private.reconcile_event(p_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_event      public.payment_events;
  v_order      public.orders;
  v_window     record;
  v_proof_id   uuid;
  v_claims     integer := 0;
  v_candidates uuid[];
  v_count      integer;
  v_eval       jsonb;
begin
  select e.* into v_event from public.payment_events e where e.id = p_event_id for update;
  if not found or exists (select 1 from public.payment_matches m
                           where m.payment_event_id = p_event_id and m.match_status = 'CONFIRMED') then
    return;
  end if;

  for v_proof_id in
    select p.id from public.payment_proofs p
     where p.tenant_id = v_event.tenant_id and p.provider = v_event.provider
       and p.transaction_id = v_event.transaction_id
       and p.status in ('UNMATCHED', 'PENDING_REVIEW', 'MATCHED')
     order by p.created_at
  loop
    v_claims := v_claims + 1;
    perform private.reconcile_proof(v_proof_id);
  end loop;
  if v_claims > 0 then
    return;  -- the customer's claim decides (confirmed, review or duplicate)
  end if;

  select * into v_window from private.payment_match_window(v_event.tenant_id, v_event.provider);
  select pg_catalog.array_agg(o.id order by o.created_at)
    into v_candidates
    from public.orders o
   where o.tenant_id = v_event.tenant_id
     and o.status in ('PENDING', 'AWAITING_PAYMENT', 'VERIFYING')
     and o.currency_snapshot = v_event.currency
     and o.product_price_snapshot = v_event.amount
     and v_event.occurred_at >= o.created_at - pg_catalog.make_interval(mins => v_window.before_minutes)
     and v_event.occurred_at <= o.created_at + pg_catalog.make_interval(mins => v_window.after_minutes)
     and not exists (select 1 from public.payment_matches m where m.order_id = o.id and m.match_status = 'CONFIRMED');
  v_count := coalesce(pg_catalog.cardinality(v_candidates), 0);
  if v_count = 0 then
    return;
  end if;

  if v_count = 1 then
    select o.* into v_order from public.orders o where o.id = v_candidates[1] for update;
    if private.normalize_phone(v_event.sender_identifier) is not null
       and private.normalize_phone(v_event.sender_identifier) = v_order.customer_phone then
      v_eval := private.evaluate_payment_match(v_order, v_event, null);
      if v_eval ->> 'decision' = 'CONFIRMED' then
        -- The full sender number equals the customer's phone: that is the SENDER check here.
        v_eval := pg_catalog.jsonb_set(
                    pg_catalog.jsonb_set(v_eval, '{methods}', (v_eval -> 'methods') || '["SENDER"]'::jsonb),
                    '{checks,sender}', '"PASS"'::jsonb);
        perform private.apply_payment_decision(v_order.id, v_event.id, null, v_eval, (select auth.uid()));
        return;
      end if;
    end if;
  end if;

  for i in 1..least(v_count, 5) loop
    perform private.apply_payment_decision(v_candidates[i], v_event.id, null,
      pg_catalog.jsonb_build_object(
        'decision', 'PENDING_REVIEW',
        'reason', case when v_count = 1 then 'SENDER_NOT_VERIFIED' else 'MULTIPLE_CANDIDATES' end,
        'methods', '["AMOUNT", "TIME_WINDOW", "ORDER_CONTEXT"]'::jsonb,
        'checks', '{"amount": "PASS", "time_window": "PASS", "sender": "SKIPPED"}'::jsonb,
        'candidates', v_count,
        'event_amount', v_event.amount,
        'currency', v_event.currency),
      (select auth.uid()));
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Commands (SECURITY DEFINER in `private`; the API calls invoker wrappers)
--    Each one authorizes explicitly (member role + ACTIVE tenant, derived from
--    the account / order / proof) and validates its input.
-- -----------------------------------------------------------------------------
create function private.create_payment_account(
  p_tenant_id          uuid,
  p_provider           text,
  p_account_name       text,
  p_account_identifier text
)
returns setof public.payment_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.payment_accounts;
begin
  if (select auth.uid()) is null or not private.has_tenant_role(p_tenant_id, array['owner', 'admin']) then
    raise exception 'Só o dono ou um administrador da empresa pode gerir contas de pagamento.' using errcode = '42501', hint = 'PAYMENT_WRITE_DENIED';
  end if;
  if not private.tenant_is_active(p_tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if p_provider is null or p_provider not in ('MPESA', 'EMOLA') then
    raise exception 'Fornecedor inválido.' using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_account_name, ''))) not between 2 and 120 then
    raise exception 'O nome do titular deve ter entre 2 e 120 caracteres.' using errcode = '22023', hint = 'INVALID_ACCOUNT_NAME';
  end if;
  if private.normalize_account_identifier(p_account_identifier) is null then
    raise exception 'Identificador de conta inválido.' using errcode = '22023', hint = 'INVALID_ACCOUNT_IDENTIFIER';
  end if;

  insert into public.payment_accounts (tenant_id, provider, account_name, account_identifier)
  values (p_tenant_id, p_provider, p_account_name, p_account_identifier)
  returning * into v_account;
  return next v_account;
exception when unique_violation then
  raise exception 'Esta conta já está registada.' using errcode = '23505', hint = 'ACCOUNT_EXISTS';
end;
$$;

create function private.update_payment_account(p_account_id uuid, p_account_name text default null, p_status text default null)
returns setof public.payment_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.payment_accounts;
begin
  select a.* into v_account from public.payment_accounts a where a.id = p_account_id for update;
  if not found or (select auth.uid()) is null
     or not private.has_tenant_role(v_account.tenant_id, array['owner', 'admin']) then
    raise exception 'Conta de pagamento não encontrada.' using errcode = 'P0002', hint = 'ACCOUNT_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_account.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if p_status is not null and p_status not in ('ACTIVE', 'INACTIVE') then
    raise exception 'Estado inválido.' using errcode = '22023', hint = 'INVALID_STATUS';
  end if;
  if p_account_name is not null and pg_catalog.char_length(pg_catalog.btrim(p_account_name)) not between 2 and 120 then
    raise exception 'O nome do titular deve ter entre 2 e 120 caracteres.' using errcode = '22023', hint = 'INVALID_ACCOUNT_NAME';
  end if;

  update public.payment_accounts a
     set account_name = coalesce(p_account_name, a.account_name),
         status = coalesce(p_status, a.status)
   where a.id = p_account_id
  returning * into v_account;
  return next v_account;
end;
$$;

-- Manual registration of a real wallet movement (owner / admin), e.g. read
-- from the merchant's own M-Pesa statement. Idempotent per provider + account
-- + transaction ID; audited; then reconciled.
create function private.record_payment_event(
  p_payment_account_id   uuid,
  p_transaction_id       text,
  p_amount               numeric,
  p_occurred_at          timestamptz default null,
  p_currency             text default null,
  p_sender_identifier    text default null,
  p_recipient_identifier text default null,
  p_raw_message          text default null
)
returns setof public.payment_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_account  public.payment_accounts;
  v_event    public.payment_events;
  v_tx       text := private.normalize_transaction_id(p_transaction_id);
  v_currency text;
  v_occurred timestamptz := coalesce(p_occurred_at, pg_catalog.now());
begin
  select a.* into v_account from public.payment_accounts a where a.id = p_payment_account_id;
  if not found or v_actor is null or not private.has_tenant_role(v_account.tenant_id, array['owner', 'admin']) then
    raise exception 'Conta de pagamento não encontrada.' using errcode = 'P0002', hint = 'ACCOUNT_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_account.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if v_tx is null then
    raise exception 'ID de transação inválido.' using errcode = '22023', hint = 'INVALID_TRANSACTION_ID';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> pg_catalog.round(p_amount, 2) then
    raise exception 'Valor inválido.' using errcode = '22023', hint = 'INVALID_AMOUNT';
  end if;
  v_currency := coalesce(pg_catalog.upper(pg_catalog.btrim(p_currency)),
                         (select s.currency from public.tenant_settings s where s.tenant_id = v_account.tenant_id));
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Moeda inválida.' using errcode = '22023', hint = 'INVALID_CURRENCY';
  end if;
  if v_occurred > pg_catalog.now() + interval '10 minutes' then
    raise exception 'A data do movimento não pode estar no futuro.' using errcode = '22023', hint = 'INVALID_OCCURRED_AT';
  end if;

  insert into public.payment_events (payment_account_id, provider, transaction_id, amount, currency,
                                     sender_identifier, recipient_identifier, occurred_at, raw_message, source, recorded_by)
  values (v_account.id, v_account.provider, v_tx, p_amount, v_currency,
          p_sender_identifier, p_recipient_identifier, v_occurred, p_raw_message, 'MANUAL', v_actor)
  on conflict (provider, payment_account_id, transaction_id) do nothing
  returning * into v_event;

  if not found then
    -- Same movement sent again: return it; different data under the same ID is a conflict.
    select e.* into v_event from public.payment_events e
     where e.provider = v_account.provider and e.payment_account_id = v_account.id and e.transaction_id = v_tx;
    if v_event.amount <> p_amount or v_event.currency <> v_currency then
      raise exception 'Já existe um movimento com este ID de transação e dados diferentes.' using errcode = '23505', hint = 'EVENT_CONFLICT';
    end if;
    return next v_event;
    return;
  end if;

  perform private.write_audit_log(v_actor, v_account.tenant_id, 'payment_event.recorded', 'payment_event', v_event.id::text,
    pg_catalog.jsonb_build_object('provider', v_event.provider, 'amount', v_event.amount, 'currency', v_event.currency,
                                  'source', v_event.source));
  perform private.reconcile_event(v_event.id);
  return next v_event;
end;
$$;

-- A customer's proof (any member registers it). Stored, then reconciled.
-- Never confirms by itself.
create function private.submit_payment_proof(
  p_order_id             uuid default null,
  p_provider             text default null,
  p_transaction_id       text default null,
  p_amount               numeric default null,
  p_currency             text default null,
  p_sender_identifier    text default null,
  p_recipient_identifier text default null,
  p_raw_message          text default null,
  p_extracted_data       jsonb default null,
  p_tenant_id            uuid default null
)
returns setof public.payment_proofs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_tenant uuid;
  v_proof  public.payment_proofs;
  v_tx     text := nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_transaction_id, ''), '[[:space:]]', '', 'g')), '');
begin
  if v_actor is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;
  if p_order_id is not null then
    select o.tenant_id into v_tenant from public.orders o where o.id = p_order_id;
    if v_tenant is null or (p_tenant_id is not null and p_tenant_id <> v_tenant) then
      raise exception 'Pedido não encontrado.' using errcode = 'P0002', hint = 'ORDER_NOT_FOUND';
    end if;
  else
    v_tenant := p_tenant_id;
  end if;
  if v_tenant is null or not private.has_tenant_role(v_tenant, array['owner', 'admin', 'operator']) then
    raise exception 'Pedido não encontrado.' using errcode = 'P0002', hint = 'ORDER_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_tenant) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;

  if p_provider is not null and p_provider not in ('MPESA', 'EMOLA') then
    raise exception 'Fornecedor inválido.' using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if v_tx is not null and private.normalize_transaction_id(v_tx) is null then
    raise exception 'ID de transação inválido.' using errcode = '22023', hint = 'INVALID_TRANSACTION_ID';
  end if;
  if p_amount is not null and (p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> pg_catalog.round(p_amount, 2)) then
    raise exception 'Valor inválido.' using errcode = '22023', hint = 'INVALID_AMOUNT';
  end if;
  if p_currency is not null and pg_catalog.upper(pg_catalog.btrim(p_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Moeda inválida.' using errcode = '22023', hint = 'INVALID_CURRENCY';
  end if;
  if v_tx is null and nullif(pg_catalog.btrim(p_raw_message), '') is null then
    raise exception 'Indique o ID da transação ou a mensagem do comprovativo.' using errcode = '22023', hint = 'EVIDENCE_REQUIRED';
  end if;
  if p_extracted_data is not null and not private.payment_metadata_is_safe(p_extracted_data) then
    raise exception 'Dados extraídos inválidos.' using errcode = '22023', hint = 'INVALID_EXTRACTED_DATA';
  end if;

  insert into public.payment_proofs (tenant_id, order_id, provider, transaction_id, amount, currency, sender_identifier,
                                     recipient_identifier, raw_message, source, extracted_data, submitted_by)
  values (v_tenant, p_order_id, p_provider, v_tx, p_amount, pg_catalog.upper(pg_catalog.btrim(p_currency)), p_sender_identifier,
          p_recipient_identifier, p_raw_message, 'MANUAL', coalesce(p_extracted_data, '{}'::jsonb), v_actor)
  returning * into v_proof;

  return next private.reconcile_proof(v_proof.id);
end;
$$;

-- Re-run reconciliation for a proof (e.g. after the event arrived). Members.
create function private.reconcile_payment_proof(p_proof_id uuid)
returns setof public.payment_proofs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select p.tenant_id into v_tenant from public.payment_proofs p where p.id = p_proof_id;
  if v_tenant is null or (select auth.uid()) is null
     or not private.has_tenant_role(v_tenant, array['owner', 'admin', 'operator']) then
    raise exception 'Comprovativo não encontrado.' using errcode = 'P0002', hint = 'PROOF_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_tenant) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  return next private.reconcile_proof(p_proof_id);
end;
$$;

-- Human rejection of a proof (owner / admin). Never touches events. Audited.
create function private.reject_payment_proof(p_proof_id uuid, p_reason text)
returns setof public.payment_proofs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_proof  public.payment_proofs;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
begin
  select p.* into v_proof from public.payment_proofs p where p.id = p_proof_id;
  if found and v_proof.order_id is not null then
    perform 1 from public.orders o where o.id = v_proof.order_id for update;  -- lock order: order → proof
  end if;
  select p.* into v_proof from public.payment_proofs p where p.id = p_proof_id for update;
  if not found or v_actor is null or not private.has_tenant_role(v_proof.tenant_id, array['owner', 'admin']) then
    raise exception 'Comprovativo não encontrado.' using errcode = 'P0002', hint = 'PROOF_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_proof.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if v_reason is null or pg_catalog.char_length(v_reason) > 500 then
    raise exception 'Indique o motivo (até 500 caracteres).' using errcode = '22023', hint = 'INVALID_REASON';
  end if;
  if v_proof.status in ('CONFIRMED', 'REJECTED', 'DUPLICATE', 'EXPIRED') then
    raise exception 'Este comprovativo já foi decidido (%).', v_proof.status using errcode = '55000', hint = 'PROOF_FINAL';
  end if;

  update public.payment_proofs p
     set status = 'REJECTED', status_reason = 'REJECTED_MANUALLY', review_note = v_reason
   where p.id = p_proof_id
  returning * into v_proof;
  perform private.write_audit_log(v_actor, v_proof.tenant_id, 'payment_proof.rejected', 'payment_proof', v_proof.id::text,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('reason', v_reason, 'order_id', v_proof.order_id)));
  if v_proof.order_id is not null then
    perform private.sync_order_verification(v_proof.order_id);
  end if;
  return next v_proof;
end;
$$;

-- Human decision on a review (owner / admin): links a REAL event to an order.
-- May accept a time-window or sender doubt that a person verified, but never
-- a wrong amount / currency, an inactive or foreign account, a used event or
-- an order that cannot be paid. Audited.
create function private.confirm_payment_manually(
  p_order_id         uuid,
  p_payment_event_id uuid,
  p_payment_proof_id uuid default null,
  p_note             text default null
)
returns setof public.payment_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := (select auth.uid());
  v_event     public.payment_events;
  v_order     public.orders;
  v_proof     public.payment_proofs;
  v_eval      jsonb;
  v_blocking  text[];
  v_match     public.payment_matches;
  v_note      text := nullif(pg_catalog.btrim(p_note), '');
begin
  select e.* into v_event from public.payment_events e where e.id = p_payment_event_id for update;
  if not found or v_actor is null or not private.has_tenant_role(v_event.tenant_id, array['owner', 'admin']) then
    raise exception 'Movimento não encontrado.' using errcode = 'P0002', hint = 'EVENT_NOT_FOUND';
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id and o.tenant_id = v_event.tenant_id for update;
  if not found then
    raise exception 'Pedido não encontrado.' using errcode = 'P0002', hint = 'ORDER_NOT_FOUND';
  end if;
  if p_payment_proof_id is not null then
    select p.* into v_proof from public.payment_proofs p
     where p.id = p_payment_proof_id and p.tenant_id = v_event.tenant_id and p.order_id = p_order_id for update;
    if not found then
      raise exception 'Comprovativo não encontrado.' using errcode = 'P0002', hint = 'PROOF_NOT_FOUND';
    end if;
  end if;
  if not private.tenant_is_active(v_event.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 500 then
    raise exception 'A nota deve ter no máximo 500 caracteres.' using errcode = '22023', hint = 'INVALID_REASON';
  end if;

  v_eval := private.evaluate_payment_match(v_order, v_event, v_proof);
  select coalesce(pg_catalog.array_agg(f.value), array[]::text[]) into v_blocking
    from pg_catalog.jsonb_array_elements_text(v_eval -> 'failures') as f(value)
   where f.value not in ('OUTSIDE_TIME_WINDOW', 'SENDER_MISMATCH');
  if v_eval ->> 'decision' = 'DUPLICATE' or pg_catalog.cardinality(v_blocking) > 0 then
    raise exception 'Não é possível confirmar: %.', coalesce(v_blocking[1], v_eval ->> 'reason')
      using errcode = '55000', hint = coalesce(v_blocking[1], v_eval ->> 'reason');
  end if;

  v_eval := v_eval || pg_catalog.jsonb_build_object('decision', 'CONFIRMED', 'reason', 'CONFIRMED_MANUALLY',
              'methods', (v_eval -> 'methods') || '["MANUAL"]'::jsonb, 'overridden', v_eval -> 'failures');
  v_match := private.apply_payment_decision(v_order.id, v_event.id, v_proof.id, v_eval, v_actor);
  if v_match.match_status <> 'CONFIRMED' then
    raise exception 'Não é possível confirmar: %.', v_match.reason using errcode = '55000', hint = v_match.reason;
  end if;

  perform private.write_audit_log(v_actor, v_event.tenant_id, 'payment.confirmed_manually', 'payment_match', v_match.id::text,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'order_id', v_order.id, 'payment_event_id', v_event.id, 'payment_proof_id', v_proof.id,
      'amount', v_event.amount, 'currency', v_event.currency, 'overridden', v_eval -> 'overridden', 'note', v_note)));
  return next v_match;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. API surface (public, SECURITY INVOKER wrappers)
-- -----------------------------------------------------------------------------
create function public.create_payment_account(p_tenant_id uuid, p_provider text, p_account_name text, p_account_identifier text)
returns setof public.payment_accounts language sql set search_path = ''
as $$ select * from private.create_payment_account(p_tenant_id, p_provider, p_account_name, p_account_identifier); $$;

create function public.update_payment_account(p_account_id uuid, p_account_name text default null, p_status text default null)
returns setof public.payment_accounts language sql set search_path = ''
as $$ select * from private.update_payment_account(p_account_id, p_account_name, p_status); $$;

create function public.record_payment_event(
  p_payment_account_id uuid, p_transaction_id text, p_amount numeric, p_occurred_at timestamptz default null,
  p_currency text default null, p_sender_identifier text default null, p_recipient_identifier text default null,
  p_raw_message text default null)
returns setof public.payment_events language sql set search_path = ''
as $$
  select * from private.record_payment_event(p_payment_account_id, p_transaction_id, p_amount, p_occurred_at, p_currency,
                                              p_sender_identifier, p_recipient_identifier, p_raw_message);
$$;

create function public.submit_payment_proof(
  p_order_id uuid default null, p_provider text default null, p_transaction_id text default null,
  p_amount numeric default null, p_currency text default null, p_sender_identifier text default null,
  p_recipient_identifier text default null, p_raw_message text default null, p_extracted_data jsonb default null,
  p_tenant_id uuid default null)
returns setof public.payment_proofs language sql set search_path = ''
as $$
  select * from private.submit_payment_proof(p_order_id, p_provider, p_transaction_id, p_amount, p_currency,
                                              p_sender_identifier, p_recipient_identifier, p_raw_message,
                                              p_extracted_data, p_tenant_id);
$$;

create function public.reconcile_payment_proof(p_proof_id uuid)
returns setof public.payment_proofs language sql set search_path = ''
as $$ select * from private.reconcile_payment_proof(p_proof_id); $$;

create function public.reject_payment_proof(p_proof_id uuid, p_reason text)
returns setof public.payment_proofs language sql set search_path = ''
as $$ select * from private.reject_payment_proof(p_proof_id, p_reason); $$;

create function public.confirm_payment_manually(
  p_order_id uuid, p_payment_event_id uuid, p_payment_proof_id uuid default null, p_note text default null)
returns setof public.payment_matches language sql set search_path = ''
as $$ select * from private.confirm_payment_manually(p_order_id, p_payment_event_id, p_payment_proof_id, p_note); $$;

-- -----------------------------------------------------------------------------
-- 10. Privileges
--     • anon: nothing.
--     • authenticated: SELECT only (RLS); every write is a command.
--     • service_role (future ingestion workers): may insert payment_events
--       (validated by triggers) — never rewrite them, never create matches,
--       never confirm proofs or set orders PAID without a CONFIRMED match.
-- -----------------------------------------------------------------------------
revoke all on table public.payment_accounts, public.payment_events, public.payment_proofs, public.payment_matches
  from anon, authenticated;
grant select on table public.payment_accounts, public.payment_events, public.payment_proofs, public.payment_matches
  to authenticated;
revoke delete, truncate on table public.payment_accounts from service_role;
revoke update, delete, truncate on table public.payment_events from service_role;
revoke delete, truncate on table public.payment_proofs from service_role;
revoke insert, update, delete, truncate on table public.payment_matches from service_role;

revoke all on function private.payment_metadata_is_safe(jsonb) from public;
revoke all on function private.payment_matches_before_insert() from public;
revoke all on function private.normalize_transaction_id(text) from public;
revoke all on function private.normalize_account_identifier(text) from public;
revoke all on function private.sender_digits(text) from public;
revoke all on function private.sender_identifiers_compatible(text, text) from public;
revoke all on function private.payment_match_window(uuid, text) from public;
revoke all on function private.payment_accounts_before_write() from public;
revoke all on function private.audit_payment_account_changes() from public;
revoke all on function private.payment_events_before_insert() from public;
revoke all on function private.payment_proofs_before_write() from public;
revoke all on function private.prevent_financial_record_changes() from public;
revoke all on function private.orders_require_payment_confirmation() from public;
revoke all on function private.evaluate_payment_match(public.orders, public.payment_events, public.payment_proofs) from public;
revoke all on function private.set_proof_status(uuid, text, text) from public;
revoke all on function private.apply_payment_decision(uuid, uuid, uuid, jsonb, uuid) from public;
revoke all on function private.sync_order_verification(uuid) from public;
revoke all on function private.reconcile_proof(uuid) from public;
revoke all on function private.reconcile_event(uuid) from public;
revoke all on function private.create_payment_account(uuid, text, text, text) from public;
revoke all on function private.update_payment_account(uuid, text, text) from public;
revoke all on function private.record_payment_event(uuid, text, numeric, timestamptz, text, text, text, text) from public;
revoke all on function private.submit_payment_proof(uuid, text, text, numeric, text, text, text, text, jsonb, uuid) from public;
revoke all on function private.reconcile_payment_proof(uuid) from public;
revoke all on function private.reject_payment_proof(uuid, text) from public;
revoke all on function private.confirm_payment_manually(uuid, uuid, uuid, text) from public;
-- CHECK constraints and triggers run as the writing role: service_role writes
-- directly (future ingestion); authenticated only through the commands.
grant execute on function private.payment_metadata_is_safe(jsonb) to service_role;
grant execute on function private.normalize_transaction_id(text) to service_role;
grant execute on function private.normalize_account_identifier(text) to service_role;
-- Targets of the invoker wrappers.
grant execute on function private.create_payment_account(uuid, text, text, text) to authenticated;
grant execute on function private.update_payment_account(uuid, text, text) to authenticated;
grant execute on function private.record_payment_event(uuid, text, numeric, timestamptz, text, text, text, text) to authenticated;
grant execute on function private.submit_payment_proof(uuid, text, text, numeric, text, text, text, text, jsonb, uuid) to authenticated;
grant execute on function private.reconcile_payment_proof(uuid) to authenticated;
grant execute on function private.reject_payment_proof(uuid, text) to authenticated;
grant execute on function private.confirm_payment_manually(uuid, uuid, uuid, text) to authenticated;

revoke all on function public.create_payment_account(uuid, text, text, text) from public, anon;
revoke all on function public.update_payment_account(uuid, text, text) from public, anon;
revoke all on function public.record_payment_event(uuid, text, numeric, timestamptz, text, text, text, text) from public, anon;
revoke all on function public.submit_payment_proof(uuid, text, text, numeric, text, text, text, text, jsonb, uuid) from public, anon;
revoke all on function public.reconcile_payment_proof(uuid) from public, anon;
revoke all on function public.reject_payment_proof(uuid, text) from public, anon;
revoke all on function public.confirm_payment_manually(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.create_payment_account(uuid, text, text, text) to authenticated;
grant execute on function public.update_payment_account(uuid, text, text) to authenticated;
grant execute on function public.record_payment_event(uuid, text, numeric, timestamptz, text, text, text, text) to authenticated;
grant execute on function public.submit_payment_proof(uuid, text, text, numeric, text, text, text, text, jsonb, uuid) to authenticated;
grant execute on function public.reconcile_payment_proof(uuid) to authenticated;
grant execute on function public.reject_payment_proof(uuid, text) to authenticated;
grant execute on function public.confirm_payment_manually(uuid, uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Row Level Security — SELECT only, members of the tenant.
-- -----------------------------------------------------------------------------
alter table public.payment_accounts enable row level security;
alter table public.payment_events   enable row level security;
alter table public.payment_proofs   enable row level security;
alter table public.payment_matches  enable row level security;

create policy "payment_accounts_select_members"
  on public.payment_accounts for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy "payment_events_select_members"
  on public.payment_events for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy "payment_proofs_select_members"
  on public.payment_proofs for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy "payment_matches_select_members"
  on public.payment_matches for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));

commit;

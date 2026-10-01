-- =============================================================================
-- MegaBot · 004_orders.sql
--
-- Orders: a customer's intent to buy one of the tenant's products, with an
-- immutable product snapshot, a public reference, idempotent creation, a
-- controlled status machine and an append-only operational history
-- (order_events). Payments and activation are later phases: this migration
-- only models their states.
--
-- • Requires 001, 002 and 003. Changes no object of 001–003.
-- • Additive only: pre-flight check aborts (changing nothing) on conflicts.
-- • Runs in a single transaction: all or nothing.
-- • Apply in Supabase → SQL Editor (runs as the `postgres` role).
--
-- Access model
--   read   : any member of the tenant (owner / admin / operator), via RLS
--   write  : ONLY through the commands below (no INSERT/UPDATE/DELETE grants):
--              create_order, mark_order_awaiting_payment, cancel_order
--            any member of an ACTIVE tenant may run them
--   status : a trigger enforces the transition table for every role
--            (service_role and the owner included) — the app can never just
--            send status = 'COMPLETED'
--   anon   : nothing. Platform admins get no extra RLS (isolation preserved).
--
-- order_events is the order's operational history; audit_logs (002) remains
-- the platform/admin audit trail. They are deliberately separate.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Pre-flight: 001–003 must be applied and nothing from 004 may exist.
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
            ('public.products', pg_catalog.to_regclass('public.products')::oid),
            ('private.set_updated_at()', pg_catalog.to_regprocedure('private.set_updated_at()')::oid),
            ('private.user_tenant_ids()', pg_catalog.to_regprocedure('private.user_tenant_ids()')::oid),
            ('private.has_tenant_role(uuid, text[])', pg_catalog.to_regprocedure('private.has_tenant_role(uuid, text[])')::oid),
            ('private.tenant_is_active(uuid)', pg_catalog.to_regprocedure('private.tenant_is_active(uuid)')::oid),
            ('private.audit_metadata_is_safe(jsonb)', pg_catalog.to_regprocedure('private.audit_metadata_is_safe(jsonb)')::oid)
         ) as x(name, found)
   where x.found is null;
  if v_missing is not null then
    raise exception 'Migration 004 abortada: falta % — aplique primeiro a 001, 002 e 003. Nada foi alterado.', v_missing;
  end if;

  select string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    into v_conflicts
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('orders', 'order_events');
  if v_conflicts is not null then
    raise exception 'Migration 004 abortada: já existe %. Nada foi alterado — reveja o schema antes de continuar.', v_conflicts;
  end if;

  select string_agg(format('%I.%I()', n.nspname, p.proname), ', ')
    into v_conflicts
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where (n.nspname in ('public', 'private') and p.proname in (
            'create_order', 'mark_order_awaiting_payment', 'cancel_order', 'order_status_counts'))
      or (n.nspname = 'private' and p.proname in (
            'normalize_phone', 'order_status_transition_allowed', 'generate_order_reference',
            'orders_before_insert', 'orders_before_update', 'record_order_event',
            'prevent_order_event_changes', 'transition_order'));
  if v_conflicts is not null then
    raise exception 'Migration 004 abortada: já existe a função %. Nada foi alterado.', v_conflicts;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Domain helpers
-- -----------------------------------------------------------------------------

-- Phone numbers → E.164 text ("+258841234567"), or NULL when invalid. Accepts
-- spaces, dots, dashes, parentheses, "00" international prefix and Mozambican
-- local numbers (9 digits starting with 8). Any country can be stored in
-- E.164; +258 numbers must be Mozambican mobiles (82–87 + 7 digits).
create function private.normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := pg_catalog.regexp_replace(coalesce(p_phone, ''), '[[:space:]().-]', '', 'g');
begin
  if v like '00%' then
    v := '+' || pg_catalog.substr(v, 3);
  end if;
  if v ~ '^8[0-9]{8}$' then
    v := '+258' || v;
  elsif v ~ '^258[0-9]{9}$' then
    v := '+' || v;
  end if;
  if v !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;
  if v like '+258%' and v !~ '^\+2588[2-7][0-9]{7}$' then
    return null;
  end if;
  return v;
end;
$$;
comment on function private.normalize_phone(text) is
  'Normalizes a phone number to E.164 (NULL when invalid). +258 numbers must be Mozambican mobiles (82–87).';

-- The order state machine — the single source of truth for transitions.
--   PENDING              → AWAITING_PAYMENT | CANCELLED | EXPIRED
--   AWAITING_PAYMENT     → VERIFYING | PAID | CANCELLED | EXPIRED
--   VERIFYING            → PAID | AWAITING_PAYMENT | CANCELLED   (payment being verified)
--   PAID                 → READY_FOR_ACTIVATION
--   READY_FOR_ACTIVATION → ACTIVATING | FAILED
--   ACTIVATING           → COMPLETED | FAILED
--   FAILED               → READY_FOR_ACTIVATION (retry) | CANCELLED
--   COMPLETED, CANCELLED, EXPIRED: final
create function private.order_status_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_from
    when 'PENDING'              then p_to in ('AWAITING_PAYMENT', 'CANCELLED', 'EXPIRED')
    when 'AWAITING_PAYMENT'     then p_to in ('VERIFYING', 'PAID', 'CANCELLED', 'EXPIRED')
    when 'VERIFYING'            then p_to in ('PAID', 'AWAITING_PAYMENT', 'CANCELLED')
    when 'PAID'                 then p_to in ('READY_FOR_ACTIVATION')
    when 'READY_FOR_ACTIVATION' then p_to in ('ACTIVATING', 'FAILED')
    when 'ACTIVATING'           then p_to in ('COMPLETED', 'FAILED')
    when 'FAILED'               then p_to in ('READY_FOR_ACTIVATION', 'CANCELLED')
    else false
  end, false);
$$;

-- Public reference "MB-YYYYMMDD-XXXXXXXX": date in the tenant's timezone + 8
-- random hex chars. Random (not sequential), so it reveals neither volumes
-- nor other orders, and cannot be enumerated.
create function private.generate_order_reference(p_tenant_id uuid)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_timezone  text;
  v_reference text;
begin
  select s.timezone into v_timezone from public.tenant_settings s where s.tenant_id = p_tenant_id;
  loop
    v_reference := 'MB-'
      || pg_catalog.to_char(pg_catalog.timezone(coalesce(v_timezone, 'Africa/Maputo'), pg_catalog.now()), 'YYYYMMDD')
      || '-'
      || pg_catalog.upper(pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 8));
    exit when not exists (select 1 from public.orders o where o.public_reference = v_reference);
  end loop;
  return v_reference;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. orders
-- -----------------------------------------------------------------------------
create table public.orders (
  id                       uuid           primary key default gen_random_uuid(),
  tenant_id                uuid           not null references public.tenants (id) on delete cascade,
  -- The product keeps owning the USSD flow; orders only reference it.
  -- RESTRICT: products are archived, never deleted (003).
  product_id               uuid           not null references public.products (id) on delete restrict,
  public_reference         text           not null,
  -- The buyer needs no MegaBot account: no FK to auth.users.
  customer_name            text,
  -- Number that receives the package (used later for USSD activation). E.164.
  customer_phone           text           not null,
  -- Snapshot of the product when the order was created (immutable).
  product_name_snapshot    text           not null,
  product_price_snapshot   numeric(12, 2) not null,
  currency_snapshot        text           not null,
  data_amount_snapshot     numeric(10, 2),
  data_unit_snapshot       text,
  validity_hours_snapshot  integer        not null,
  operator_snapshot        text           not null,
  status                   text           not null default 'PENDING',
  status_changed_at        timestamptz    not null default now(),
  cancel_reason            text,
  -- Client-generated key: the same request sent twice creates one order.
  idempotency_key          text,
  created_at               timestamptz    not null default now(),
  updated_at               timestamptz    not null default now(),
  constraint orders_public_reference_key    unique (public_reference),
  constraint orders_public_reference_format check (public_reference ~ '^MB-[0-9]{8}-[0-9A-F]{8}$'),
  constraint orders_tenant_idempotency_key  unique (tenant_id, idempotency_key),
  constraint orders_idempotency_key_format  check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  constraint orders_customer_name_length    check (customer_name is null or char_length(customer_name) between 1 and 80),
  constraint orders_customer_phone_e164     check (customer_phone = private.normalize_phone(customer_phone)),
  constraint orders_price_positive          check (product_price_snapshot > 0),
  constraint orders_currency_format         check (currency_snapshot ~ '^[A-Z]{3}$'),
  constraint orders_data_amount_unit        check ((data_amount_snapshot is null) = (data_unit_snapshot is null)),
  constraint orders_data_unit_valid         check (data_unit_snapshot is null or data_unit_snapshot in ('MB', 'GB')),
  constraint orders_status_valid            check (status in (
    'PENDING', 'AWAITING_PAYMENT', 'VERIFYING', 'PAID', 'READY_FOR_ACTIVATION',
    'ACTIVATING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')),
  constraint orders_cancel_reason_length    check (cancel_reason is null or char_length(cancel_reason) between 1 and 500),
  constraint orders_cancel_reason_status    check (cancel_reason is null or status = 'CANCELLED')
);
comment on table public.orders is
  'Customer orders (one product each) with an immutable product snapshot. Written only through create_order / mark_order_awaiting_payment / cancel_order.';
comment on column public.orders.status is
  'State machine enforced by private.orders_before_update (see private.order_status_transition_allowed).';

create index orders_tenant_created_idx        on public.orders (tenant_id, created_at desc);
create index orders_tenant_status_created_idx on public.orders (tenant_id, status, created_at desc);
create index orders_tenant_phone_idx          on public.orders (tenant_id, customer_phone);
create index orders_product_idx               on public.orders (product_id);

-- -----------------------------------------------------------------------------
-- 3. order_events — append-only operational history
-- -----------------------------------------------------------------------------
create table public.order_events (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants (id) on delete cascade,
  order_id       uuid        not null references public.orders (id) on delete cascade,
  -- order.created | order.status_changed | order.cancelled | order.expired | …
  event_type     text        not null,
  -- Historical value, no FK: the history must survive account deletion. NULL = system.
  actor_user_id  uuid,
  from_status    text,
  to_status      text        not null,
  metadata       jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  constraint order_events_type_format   check (char_length(event_type) <= 64 and event_type ~ '^order\.[a-z][a-z0-9_]*$'),
  constraint order_events_status_valid  check (
    to_status in ('PENDING', 'AWAITING_PAYMENT', 'VERIFYING', 'PAID', 'READY_FOR_ACTIVATION',
                  'ACTIVATING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')
    and (from_status is null or from_status in ('PENDING', 'AWAITING_PAYMENT', 'VERIFYING', 'PAID',
         'READY_FOR_ACTIVATION', 'ACTIVATING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'))),
  -- Same guard as audit_logs (002): small object, no credential-like keys or token values.
  constraint order_events_metadata_safe check (private.audit_metadata_is_safe(metadata))
);
comment on table public.order_events is
  'Append-only history of each order (operational). Not the platform audit trail (audit_logs).';

create index order_events_order_created_idx  on public.order_events (order_id, created_at);
create index order_events_tenant_created_idx on public.order_events (tenant_id, created_at desc);

-- No UPDATE ever; no direct DELETE (only the cascade when the order itself is
-- removed by the database owner).
create function private.prevent_order_event_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;  -- cascade from orders
  end if;
  raise exception 'order_events é append-only: % não é permitido.', tg_op using errcode = '42501';
end;
$$;

create trigger order_events_prevent_update_delete
  before update or delete on public.order_events
  for each row execute function private.prevent_order_event_changes();
create trigger order_events_prevent_truncate
  before truncate on public.order_events
  for each statement execute function private.prevent_order_event_changes();

-- -----------------------------------------------------------------------------
-- 4. Order integrity (applies to every role, service_role and owner included)
-- -----------------------------------------------------------------------------

-- New orders: valid same-tenant product on sale, server-side snapshot,
-- normalized phone, generated reference, always PENDING.
create function private.orders_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_product public.products;
begin
  select p.* into v_product from public.products p where p.id = new.product_id;
  if not found or v_product.tenant_id <> new.tenant_id then
    raise exception 'Produto não encontrado.' using errcode = 'P0002', hint = 'PRODUCT_NOT_FOUND';
  end if;
  if v_product.status <> 'ACTIVE' or v_product.archived_at is not null then
    raise exception 'Este produto não está à venda.' using errcode = '55000', hint = 'PRODUCT_NOT_AVAILABLE';
  end if;

  new.customer_phone := private.normalize_phone(new.customer_phone);
  if new.customer_phone is null then
    raise exception 'Número de telefone inválido.' using errcode = '22023', hint = 'INVALID_PHONE';
  end if;
  new.customer_name := nullif(pg_catalog.btrim(new.customer_name), '');

  -- Snapshot: always from the product, never from the caller.
  new.product_name_snapshot   := v_product.name;
  new.product_price_snapshot  := v_product.price;
  new.currency_snapshot       := v_product.currency;
  new.data_amount_snapshot    := v_product.data_amount;
  new.data_unit_snapshot      := v_product.data_unit;
  new.validity_hours_snapshot := v_product.validity_hours;
  new.operator_snapshot       := v_product.operator;

  new.public_reference  := private.generate_order_reference(new.tenant_id);
  new.status            := 'PENDING';
  new.status_changed_at := pg_catalog.now();
  new.cancel_reason     := null;
  return new;
end;
$$;

create trigger orders_before_insert
  before insert on public.orders
  for each row execute function private.orders_before_insert();

-- Updates: only status (along the state machine) and the cancellation reason
-- may change; everything else is history.
create function private.orders_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.tenant_id, new.product_id, new.public_reference, new.customer_name, new.customer_phone,
      new.product_name_snapshot, new.product_price_snapshot, new.currency_snapshot, new.data_amount_snapshot,
      new.data_unit_snapshot, new.validity_hours_snapshot, new.operator_snapshot, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.product_id, old.public_reference, old.customer_name, old.customer_phone,
      old.product_name_snapshot, old.product_price_snapshot, old.currency_snapshot, old.data_amount_snapshot,
      old.data_unit_snapshot, old.validity_hours_snapshot, old.operator_snapshot, old.idempotency_key, old.created_at) then
    raise exception 'Os dados de um pedido não podem ser alterados depois de criado.' using errcode = '55000', hint = 'IMMUTABLE_ORDER';
  end if;

  if new.status is distinct from old.status then
    if not private.order_status_transition_allowed(old.status, new.status) then
      raise exception 'Transição de estado inválida: % → %.', old.status, new.status
        using errcode = '55000', hint = 'INVALID_TRANSITION';
    end if;
    new.status_changed_at := pg_catalog.now();
  elsif new.cancel_reason is distinct from old.cancel_reason then
    raise exception 'O motivo só pode ser definido ao cancelar.' using errcode = '55000', hint = 'IMMUTABLE_ORDER';
  end if;
  return new;
end;
$$;

create trigger orders_before_update
  before update on public.orders
  for each row execute function private.orders_before_update();
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function private.set_updated_at();

-- Every creation and status change lands in order_events, whatever the path.
create function private.record_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (tenant_id, order_id, event_type, actor_user_id, from_status, to_status, metadata)
    values (new.tenant_id, new.id, 'order.created', (select auth.uid()), null, new.status,
            pg_catalog.jsonb_build_object('product_id', new.product_id, 'public_reference', new.public_reference));
  elsif new.status is distinct from old.status then
    insert into public.order_events (tenant_id, order_id, event_type, actor_user_id, from_status, to_status, metadata)
    values (new.tenant_id, new.id,
            case new.status when 'CANCELLED' then 'order.cancelled' when 'EXPIRED' then 'order.expired' else 'order.status_changed' end,
            (select auth.uid()), old.status, new.status,
            pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('reason', new.cancel_reason)));
  end if;
  return null;
end;
$$;

create trigger orders_record_event
  after insert or update on public.orders
  for each row execute function private.record_order_event();

-- -----------------------------------------------------------------------------
-- 5. Commands (SECURITY DEFINER in `private`; the API calls the invoker wrappers)
--
-- They run as the owner, so they authorize explicitly: the caller (auth.uid())
-- must be a member of the order's tenant, and the tenant must be ACTIVE. The
-- tenant is always derived from the product / order — never from the client.
-- Unknown or foreign ids answer "not found" (no existence leak).
-- -----------------------------------------------------------------------------
create function private.create_order(
  p_product_id      uuid,
  p_customer_phone  text,
  p_customer_name   text default null,
  p_idempotency_key text default null
)
returns setof public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_order   public.orders;
  v_phone   text := private.normalize_phone(p_customer_phone);
  v_name    text := nullif(pg_catalog.btrim(p_customer_name), '');
  v_key     text := nullif(pg_catalog.btrim(p_idempotency_key), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;

  select p.* into v_product from public.products p where p.id = p_product_id;
  if not found or not private.has_tenant_role(v_product.tenant_id, array['owner', 'admin', 'operator']) then
    raise exception 'Produto não encontrado.' using errcode = 'P0002', hint = 'PRODUCT_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_product.tenant_id) then
    raise exception 'A empresa está suspensa: não é possível criar pedidos.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;

  if v_key is not null then
    if v_key !~ '^[A-Za-z0-9._:-]{8,100}$' then
      raise exception 'Chave de idempotência inválida.' using errcode = '22023', hint = 'INVALID_IDEMPOTENCY_KEY';
    end if;
    -- Replay: the same request returns the order it already created.
    select o.* into v_order from public.orders o
     where o.tenant_id = v_product.tenant_id and o.idempotency_key = v_key;
    if found then
      if v_order.product_id <> p_product_id or v_order.customer_phone is distinct from v_phone then
        raise exception 'Esta chave de idempotência já foi usada noutro pedido.' using errcode = '23505', hint = 'IDEMPOTENCY_KEY_REUSED';
      end if;
      return next v_order;
      return;
    end if;
  end if;

  if v_product.status <> 'ACTIVE' or v_product.archived_at is not null then
    raise exception 'Este produto não está à venda.' using errcode = '55000', hint = 'PRODUCT_NOT_AVAILABLE';
  end if;
  if v_phone is null then
    raise exception 'Número de telefone inválido.' using errcode = '22023', hint = 'INVALID_PHONE';
  end if;
  if v_name is not null and pg_catalog.char_length(v_name) > 80 then
    raise exception 'O nome do cliente deve ter no máximo 80 caracteres.' using errcode = '22023', hint = 'INVALID_CUSTOMER_NAME';
  end if;

  insert into public.orders (tenant_id, product_id, customer_name, customer_phone, idempotency_key)
  values (v_product.tenant_id, p_product_id, v_name, v_phone, v_key)
  on conflict (tenant_id, idempotency_key) do nothing
  returning * into v_order;
  if not found then
    -- A concurrent request with the same key won the race: return its order.
    select o.* into v_order from public.orders o
     where o.tenant_id = v_product.tenant_id and o.idempotency_key = v_key;
  end if;
  return next v_order;
end;
$$;

-- Shared by the member commands: authorization + one status change (the
-- trigger validates the transition). Already in the target status = no-op.
create function private.transition_order(p_order_id uuid, p_status text, p_reason text default null)
returns setof public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  public.orders;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found or not private.has_tenant_role(v_order.tenant_id, array['owner', 'admin', 'operator']) then
    raise exception 'Pedido não encontrado.' using errcode = 'P0002', hint = 'ORDER_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_order.tenant_id) then
    raise exception 'A empresa está suspensa: os pedidos não podem ser alterados.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if v_reason is not null and pg_catalog.char_length(v_reason) > 500 then
    raise exception 'O motivo deve ter no máximo 500 caracteres.' using errcode = '22023', hint = 'INVALID_REASON';
  end if;

  if v_order.status <> p_status then
    update public.orders o
       set status = p_status,
           cancel_reason = case when p_status = 'CANCELLED' then v_reason end
     where o.id = p_order_id
    returning * into v_order;
  end if;
  return next v_order;
end;
$$;

create function private.mark_order_awaiting_payment(p_order_id uuid)
returns setof public.orders
language sql
security definer
set search_path = ''
as $$
  select * from private.transition_order(p_order_id, 'AWAITING_PAYMENT');
$$;

create function private.cancel_order(p_order_id uuid, p_reason text default null)
returns setof public.orders
language sql
security definer
set search_path = ''
as $$
  select * from private.transition_order(p_order_id, 'CANCELLED', p_reason);
$$;

-- -----------------------------------------------------------------------------
-- 6. API surface (public, SECURITY INVOKER)
-- -----------------------------------------------------------------------------
create function public.create_order(
  p_product_id      uuid,
  p_customer_phone  text,
  p_customer_name   text default null,
  p_idempotency_key text default null
)
returns setof public.orders
language sql
set search_path = ''
as $$
  select * from private.create_order(p_product_id, p_customer_phone, p_customer_name, p_idempotency_key);
$$;
comment on function public.create_order(uuid, text, text, text) is
  'Members of an active tenant: creates a PENDING order for an active product of that tenant (idempotent by key).';

create function public.mark_order_awaiting_payment(p_order_id uuid)
returns setof public.orders
language sql
set search_path = ''
as $$
  select * from private.mark_order_awaiting_payment(p_order_id);
$$;
comment on function public.mark_order_awaiting_payment(uuid) is 'Members: PENDING → AWAITING_PAYMENT.';

create function public.cancel_order(p_order_id uuid, p_reason text default null)
returns setof public.orders
language sql
set search_path = ''
as $$
  select * from private.cancel_order(p_order_id, p_reason);
$$;
comment on function public.cancel_order(uuid, text) is 'Members: cancels an order where the state machine allows it.';

-- Status totals for the orders screen; RLS limits it to the caller's tenants.
create function public.order_status_counts(p_tenant_id uuid)
returns table (status text, total integer)
language sql
stable
set search_path = ''
as $$
  select o.status, pg_catalog.count(*)::integer
    from public.orders o
   where o.tenant_id = p_tenant_id
   group by o.status;
$$;
comment on function public.order_status_counts(uuid) is 'Order totals per status (RLS: own tenants only).';

-- -----------------------------------------------------------------------------
-- 7. Privileges
--    • anon: nothing.
--    • authenticated: SELECT only (RLS). Every write goes through the commands.
--    • service_role: future trusted workers may move statuses (still validated
--      by the triggers) but can never delete orders or rewrite their history.
-- -----------------------------------------------------------------------------
revoke all on table public.orders, public.order_events from anon, authenticated;
grant select on table public.orders, public.order_events to authenticated;
revoke delete, truncate on table public.orders from service_role;
revoke update, delete, truncate on table public.order_events from service_role;

revoke all on function private.normalize_phone(text) from public;
revoke all on function private.order_status_transition_allowed(text, text) from public;
revoke all on function private.generate_order_reference(uuid) from public;
revoke all on function private.prevent_order_event_changes() from public;
revoke all on function private.orders_before_insert() from public;
revoke all on function private.orders_before_update() from public;
revoke all on function private.record_order_event() from public;
revoke all on function private.transition_order(uuid, text, text) from public;
revoke all on function private.create_order(uuid, text, text, text) from public;
revoke all on function private.mark_order_awaiting_payment(uuid) from public;
revoke all on function private.cancel_order(uuid, text) from public;
-- CHECK constraints and triggers evaluated for trusted backends writing directly.
grant execute on function private.normalize_phone(text) to authenticated, service_role;
grant execute on function private.order_status_transition_allowed(text, text) to service_role;
grant execute on function private.generate_order_reference(uuid) to service_role;
-- Targets of the invoker wrappers.
grant execute on function private.create_order(uuid, text, text, text) to authenticated;
grant execute on function private.mark_order_awaiting_payment(uuid) to authenticated;
grant execute on function private.cancel_order(uuid, text) to authenticated;

revoke all on function public.create_order(uuid, text, text, text) from public, anon;
revoke all on function public.mark_order_awaiting_payment(uuid) from public, anon;
revoke all on function public.cancel_order(uuid, text) from public, anon;
revoke all on function public.order_status_counts(uuid) from public, anon;
grant execute on function public.create_order(uuid, text, text, text) to authenticated;
grant execute on function public.mark_order_awaiting_payment(uuid) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
grant execute on function public.order_status_counts(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Row Level Security — SELECT only, members of the tenant.
-- -----------------------------------------------------------------------------
alter table public.orders       enable row level security;
alter table public.order_events enable row level security;

create policy "orders_select_members"
  on public.orders for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));

create policy "order_events_select_members"
  on public.order_events for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));

commit;

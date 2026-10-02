-- =============================================================================
-- MegaBot · 006_devices_activation.sql
--
-- Activation engine foundation: Android worker devices, their SIMs, activation
-- tasks born from PAID orders, a deterministic dispatcher and the protocol the
-- worker uses to report what really happened on the phone network.
--
--   Order PAID ──▶ activation_tasks (QUEUED, exactly one per order)
--                    │ dispatcher (FOR UPDATE SKIP LOCKED)
--                    ▼
--                 ASSIGNED (device + SIM) ──▶ EXECUTING ──▶ SUBMITTED ──▶ (VERIFYING)
--                    │                            │               │
--                    ▼                            ▼               ▼
--                 QUEUED (released)            FAILED        SUCCESS | FAILED | UNKNOWN
--
-- UNKNOWN = the USSD may have been executed but nothing proves the result. It
-- is NEVER retried automatically: a person decides (resolve_activation_task).
--
-- • Requires 001–005. Changes no object of 001–005 (adds two triggers on
--   public.orders: task creation on PAID and the COMPLETED guard).
-- • Additive only: pre-flight check aborts (changing nothing) on conflicts.
-- • Runs in a single transaction: all or nothing.
-- • Apply in Supabase → SQL Editor (runs as the `postgres` role).
--
-- Access model
--   read    : members of the tenant (owner / admin / operator), via RLS
--   people  : create_device, create_device_pairing_code, update_device,
--             register_device_sim, update_device_sim, dispatch_activation_tasks,
--             retry_activation_task, resolve_activation_task → owner / admin
--   worker  : register_device (pairing code) → device token; then
--             device_heartbeat, worker_fetch_task, worker_start_task,
--             worker_report_progress, worker_report_result. Each call needs a
--             signed-in member of the device's tenant AND the device token
--             (only its SHA-256 is stored, in a table the API cannot read).
--   anon    : nothing. Platform admins only through platform_list_tenant_*.
--   No direct INSERT / UPDATE / DELETE grants: every write is a command.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Pre-flight: 001–005 must be applied and nothing from 006 may exist.
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
            ('public.orders', pg_catalog.to_regclass('public.orders')::oid),
            ('public.payment_matches', pg_catalog.to_regclass('public.payment_matches')::oid),
            ('public.audit_logs', pg_catalog.to_regclass('public.audit_logs')::oid),
            ('private.set_updated_at()', pg_catalog.to_regprocedure('private.set_updated_at()')::oid),
            ('private.user_tenant_ids()', pg_catalog.to_regprocedure('private.user_tenant_ids()')::oid),
            ('private.has_tenant_role(uuid, text[])', pg_catalog.to_regprocedure('private.has_tenant_role(uuid, text[])')::oid),
            ('private.tenant_is_active(uuid)', pg_catalog.to_regprocedure('private.tenant_is_active(uuid)')::oid),
            ('private.audit_metadata_is_safe(jsonb)', pg_catalog.to_regprocedure('private.audit_metadata_is_safe(jsonb)')::oid),
            ('private.write_audit_log(...)', pg_catalog.to_regprocedure('private.write_audit_log(uuid, uuid, text, text, text, jsonb)')::oid),
            ('private.require_platform_permission(text)', pg_catalog.to_regprocedure('private.require_platform_permission(text)')::oid),
            ('private.ussd_flow_is_valid(jsonb)', pg_catalog.to_regprocedure('private.ussd_flow_is_valid(jsonb)')::oid),
            ('private.normalize_phone(text)', pg_catalog.to_regprocedure('private.normalize_phone(text)')::oid),
            ('private.payment_metadata_is_safe(jsonb)', pg_catalog.to_regprocedure('private.payment_metadata_is_safe(jsonb)')::oid)
         ) as x(name, found)
   where x.found is null;
  if v_missing is not null then
    raise exception 'Migration 006 abortada: falta % — aplique primeiro a 001, 002, 003, 004 e 005. Nada foi alterado.', v_missing;
  end if;

  select string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    into v_conflicts
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('devices', 'device_credentials', 'device_sims', 'activation_tasks',
                       'activation_task_attempts', 'activation_task_events');
  if v_conflicts is not null then
    raise exception 'Migration 006 abortada: já existe %. Nada foi alterado — reveja o schema antes de continuar.', v_conflicts;
  end if;

  select string_agg(format('%I.%I()', n.nspname, p.proname), ', ')
    into v_conflicts
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where (n.nspname in ('public', 'private') and p.proname in (
            'create_device', 'create_device_pairing_code', 'update_device', 'register_device', 'register_device_sim',
            'update_device_sim', 'device_heartbeat', 'worker_fetch_task', 'worker_start_task', 'worker_report_progress',
            'worker_report_result', 'dispatch_activation_tasks', 'retry_activation_task', 'resolve_activation_task',
            'platform_list_tenant_devices', 'platform_list_tenant_activation_tasks'))
      or (n.nspname = 'private' and p.proname in (
            'device_capabilities_are_valid', 'device_telemetry_is_valid', 'sim_capabilities_are_valid',
            'automation_setting_seconds', 'device_is_online', 'new_pairing_code', 'normalize_pairing_code',
            'activation_result_code_info', 'classify_ussd_response', 'activation_task_transition_allowed',
            'activation_payload', 'authenticate_device', 'sync_order_with_activation', 'create_activation_task',
            'expire_stale_activation_tasks', 'record_activation_attempt', 'devices_before_write', 'device_sims_before_write',
            'activation_tasks_before_write', 'record_activation_task_event', 'audit_device_changes', 'audit_device_sim_changes',
            'prevent_activation_history_changes', 'orders_create_activation_task', 'orders_require_activation_success'));
  if v_conflicts is not null then
    raise exception 'Migration 006 abortada: já existe a função %. Nada foi alterado.', v_conflicts;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Pure helpers
-- -----------------------------------------------------------------------------

-- What a device can do, as reported by the worker. Only known boolean keys:
--   ussd             — the native USSD executor is installed and allowed
--   ussd_interactive — multi-step menus (select / input / confirm) supported
--   sms              — can read SMS (later phase)
--   multi_sim        — more than one SIM slot
create function private.device_capabilities_are_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value) = 'object'
    and not exists (
      select 1 from pg_catalog.jsonb_each(p_value) as e(key, value)
       where e.key not in ('ussd', 'ussd_interactive', 'sms', 'multi_sim')
          or pg_catalog.jsonb_typeof(e.value) <> 'boolean'),
    false);
$$;

create function private.sim_capabilities_are_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value) = 'object'
    and not exists (
      select 1 from pg_catalog.jsonb_each(p_value) as e(key, value)
       where e.key not in ('ussd', 'sms') or pg_catalog.jsonb_typeof(e.value) <> 'boolean'),
    false);
$$;

-- Health telemetry from the heartbeat: a fixed, small set of non-sensitive keys.
create function private.device_telemetry_is_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value) = 'object'
    and pg_catalog.octet_length(p_value::text) <= 1024
    and not exists (
      select 1 from pg_catalog.jsonb_each(p_value) as e(key, value)
       where not (
         (e.key = 'battery_level' and pg_catalog.jsonb_typeof(e.value) = 'number'
            and (e.value #>> '{}')::numeric between 0 and 100)
         or (e.key = 'charging' and pg_catalog.jsonb_typeof(e.value) = 'boolean')
         or (e.key = 'network_type' and e.value #>> '{}' in ('5G', '4G', '3G', '2G', 'WIFI', 'NONE'))
         or (e.key = 'signal_level' and pg_catalog.jsonb_typeof(e.value) = 'number'
            and (e.value #>> '{}')::numeric in (0, 1, 2, 3, 4))
         or (e.key in ('model', 'os_version') and pg_catalog.jsonb_typeof(e.value) = 'string'
            and pg_catalog.char_length(e.value #>> '{}') between 1 and 60))),
    false);
$$;

-- Timing settings in tenant_settings.automation (seconds), bounded; invalid → default.
--   heartbeat_timeout_seconds   (default 120, 30..3600)   device counts as online
--   assignment_timeout_seconds  (default 300, 60..3600)   ASSIGNED but never started → back to the queue
--   execution_timeout_seconds   (default 600, 60..7200)   started but no result → UNKNOWN
create function private.automation_setting_seconds(p_tenant_id uuid, p_key text)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_default integer;
  v_min     integer;
  v_max     integer;
  v_value   jsonb;
begin
  select d.def, d.lo, d.hi into v_default, v_min, v_max
    from (values ('heartbeat_timeout_seconds', 120, 30, 3600),
                 ('assignment_timeout_seconds', 300, 60, 3600),
                 ('execution_timeout_seconds', 600, 60, 7200)) as d(key, def, lo, hi)
   where d.key = p_key;
  if v_default is null then
    raise exception 'Definição desconhecida: %', p_key;
  end if;
  select s.automation -> p_key into v_value from public.tenant_settings s where s.tenant_id = p_tenant_id;
  if pg_catalog.jsonb_typeof(v_value) = 'number' and (v_value #>> '{}')::numeric between v_min and v_max then
    return pg_catalog.floor((v_value #>> '{}')::numeric)::integer;
  end if;
  return v_default;
end;
$$;

-- Pairing codes: 8 symbols from an unambiguous alphabet (no 0/O/1/I), shown as XXXX-XXXX.
create function private.normalize_pairing_code(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

create function private.new_pairing_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes    bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  v_code     text := '';
begin
  -- Bytes 0–5 and 10–11 of a v4 UUID are fully random; 256 is a multiple of 32 (no bias).
  for i in 0..7 loop
    v_code := v_code || pg_catalog.substr(v_alphabet,
      (pg_catalog.get_byte(v_bytes, case when i < 6 then i else i + 4 end) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- Result codes reported for an attempt: which outcomes they may carry and
-- whether a FAILED attempt with that code may be retried automatically.
-- UNKNOWN is never retried, whatever the code.
create function private.activation_result_code_info(p_code text, out outcomes text[], out retryable boolean, out worker boolean)
language sql
immutable
set search_path = ''
as $$
  select c.outcomes, c.retryable, c.worker
    from (values
      ('ACTIVATED',            array['SUCCESS'],            false, true),
      ('DEVICE_OFFLINE',       array['FAILED'],             true,  true),
      ('SIM_UNAVAILABLE',      array['FAILED'],             true,  true),
      ('USSD_NOT_SUPPORTED',   array['FAILED'],             true,  true),
      ('PERMISSION_DENIED',    array['FAILED'],             true,  true),
      ('NETWORK_ERROR',        array['FAILED', 'UNKNOWN'],  true,  true),
      ('TIMEOUT',              array['FAILED', 'UNKNOWN'],  true,  true),
      ('USSD_REJECTED',        array['FAILED'],             false, true),
      ('INVALID_DESTINATION',  array['FAILED'],             false, true),
      ('INSUFFICIENT_BALANCE', array['FAILED'],             false, true),
      ('FLOW_MISMATCH',        array['FAILED'],             false, true),
      ('INVALID_FLOW',         array['FAILED'],             false, false),
      ('UNKNOWN_RESPONSE',     array['UNKNOWN'],            false, true),
      ('MANUAL_CONFIRMED',     array['SUCCESS'],            false, false),
      ('MANUAL_REJECTED',      array['FAILED'],             false, false)
    ) as c(code, outcomes, retryable, worker)
   where c.code = p_code;
$$;

-- Deterministic reading of the operator's final screen with the product's own
-- success / failure texts (case-insensitive "contains"). Both or neither → UNKNOWN.
create function private.classify_ussd_response(p_flow jsonb, p_response text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text    text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_response, '')));
  v_success boolean;
  v_failure boolean;
begin
  if v_text = '' then
    return 'UNKNOWN';
  end if;
  select coalesce(bool_or(pg_catalog.strpos(v_text, pg_catalog.lower(pg_catalog.btrim(x.value))) > 0), false)
    into v_success
    from pg_catalog.jsonb_array_elements_text(coalesce(p_flow -> 'success' -> 'contains', '[]'::jsonb)) as x(value)
   where pg_catalog.btrim(x.value) <> '';
  select coalesce(bool_or(pg_catalog.strpos(v_text, pg_catalog.lower(pg_catalog.btrim(x.value))) > 0), false)
    into v_failure
    from pg_catalog.jsonb_array_elements_text(coalesce(p_flow -> 'failure' -> 'contains', '[]'::jsonb)) as x(value)
   where pg_catalog.btrim(x.value) <> '';
  if v_success and not v_failure then
    return 'SUCCESS';
  elsif v_failure and not v_success then
    return 'FAILED';
  end if;
  return 'UNKNOWN';
end;
$$;

-- Activation task state machine (enforced for every role by trigger).
create function private.activation_task_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_from
    when 'QUEUED'    then p_to in ('ASSIGNED', 'FAILED')
    when 'ASSIGNED'  then p_to in ('QUEUED', 'EXECUTING', 'FAILED')
    when 'EXECUTING' then p_to in ('SUBMITTED', 'SUCCESS', 'FAILED', 'UNKNOWN')
    when 'SUBMITTED' then p_to in ('VERIFYING', 'SUCCESS', 'FAILED', 'UNKNOWN')
    when 'VERIFYING' then p_to in ('SUCCESS', 'FAILED', 'UNKNOWN')
    when 'FAILED'    then p_to = 'QUEUED'
    when 'UNKNOWN'   then p_to in ('SUCCESS', 'FAILED')
    else false
  end, false);
$$;

-- -----------------------------------------------------------------------------
-- 2. devices — Android workers of a tenant
-- -----------------------------------------------------------------------------
create table public.devices (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          uuid        not null references public.tenants (id) on delete cascade,
  device_name        text        not null,
  -- Reported by the worker at registration (installation id). Not an identity:
  -- the device proves who it is with its token.
  device_identifier  text,
  platform           text,
  app_version        text,
  -- UNREGISTERED (created, waiting for pairing) | ACTIVE | DISABLED.
  -- Online / offline is DERIVED from last_seen_at (private.device_is_online).
  status             text        not null default 'UNREGISTERED',
  capabilities       jsonb       not null default '{}'::jsonb,
  telemetry          jsonb       not null default '{}'::jsonb,
  -- Server clock of the last heartbeat (never a client timestamp).
  last_seen_at       timestamptz,
  registered_at      timestamptz,
  registered_by      uuid,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint devices_name_length         check (char_length(btrim(device_name)) between 2 and 80),
  constraint devices_identifier_format   check (device_identifier is null or device_identifier ~ '^[A-Za-z0-9._:-]{4,128}$'),
  constraint devices_platform_valid      check (platform is null or platform = 'ANDROID'),
  constraint devices_app_version_format  check (app_version is null or app_version ~ '^[0-9A-Za-z.+_-]{1,32}$'),
  constraint devices_status_valid        check (status in ('UNREGISTERED', 'ACTIVE', 'DISABLED')),
  constraint devices_registration        check ((status = 'UNREGISTERED') = (registered_at is null)),
  constraint devices_registered_identity check (registered_at is null or (device_identifier is not null and platform is not null)),
  constraint devices_capabilities_valid  check (private.device_capabilities_are_valid(capabilities)),
  constraint devices_telemetry_valid     check (private.device_telemetry_is_valid(telemetry))
);
comment on table public.devices is
  'Android workers of a tenant. Created by owner/admin (UNREGISTERED), paired with a one-time code, then authenticated by a device token. Online/offline is derived from last_seen_at.';

create unique index devices_tenant_identifier_key on public.devices (tenant_id, device_identifier) where device_identifier is not null;
create index devices_tenant_idx on public.devices (tenant_id, status);

-- Pairing code and device token, hashed (SHA-256). Never readable through the
-- API (no grants, RLS without policies): only the commands below touch it.
create table public.device_credentials (
  device_id           uuid        primary key references public.devices (id) on delete cascade,
  tenant_id           uuid        not null references public.tenants (id) on delete cascade,
  pairing_code_hash   bytea,
  pairing_expires_at  timestamptz,
  token_hash          bytea,
  token_issued_at     timestamptz,
  updated_at          timestamptz not null default now(),
  constraint device_credentials_pairing check ((pairing_code_hash is null) = (pairing_expires_at is null)),
  constraint device_credentials_token   check ((token_hash is null) = (token_issued_at is null))
);
comment on table public.device_credentials is
  'Hashed pairing codes and device tokens. Not exposed to the API.';

create unique index device_credentials_pairing_key on public.device_credentials (pairing_code_hash) where pairing_code_hash is not null;
create unique index device_credentials_token_key on public.device_credentials (token_hash) where token_hash is not null;

-- -----------------------------------------------------------------------------
-- 3. device_sims — SIMs of a device (never assume slot 1 is the same SIM)
-- -----------------------------------------------------------------------------
create table public.device_sims (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references public.tenants (id) on delete cascade,
  device_id           uuid        not null references public.devices (id) on delete cascade,
  -- Android SIM slot index (0-based). Unique within the device.
  slot_index          integer     not null,
  -- Network, explicit (same values as products.operator) — never inferred from the number.
  operator            text        not null,
  -- E.164; sensitive (members only, never in audit metadata).
  phone_number        text,
  -- ACTIVE | UNAVAILABLE (set by the worker: not detected / a different SIM in the slot) | DISABLED (owner/admin).
  status              text        not null default 'ACTIVE',
  unavailable_reason  text,
  capabilities        jsonb       not null default '{"ussd": true}'::jsonb,
  -- Opaque value computed on the phone for the SIM in this slot. Lets the worker
  -- and the backend notice that the slot now holds a different SIM.
  sim_fingerprint     text,
  last_seen_at        timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint device_sims_slot_range       check (slot_index between 0 and 7),
  constraint device_sims_operator_valid   check (operator in ('vodacom', 'movitel', 'tmcel')),
  constraint device_sims_phone_e164       check (phone_number is null or phone_number = private.normalize_phone(phone_number)),
  constraint device_sims_status_valid     check (status in ('ACTIVE', 'UNAVAILABLE', 'DISABLED')),
  constraint device_sims_unavailable      check ((status = 'UNAVAILABLE') = (unavailable_reason is not null)),
  constraint device_sims_reason_valid     check (unavailable_reason is null or unavailable_reason in ('NOT_DETECTED', 'SIM_CHANGED')),
  constraint device_sims_capabilities     check (private.sim_capabilities_are_valid(capabilities)),
  constraint device_sims_fingerprint      check (sim_fingerprint is null or sim_fingerprint ~ '^[A-Za-z0-9:_-]{8,128}$'),
  constraint device_sims_device_slot_key  unique (device_id, slot_index)
);
comment on table public.device_sims is
  'SIMs of a worker device. Operator is explicit. Written by owner/admin (registration, status) and by the worker heartbeat (availability only).';

create index device_sims_tenant_idx on public.device_sims (tenant_id, operator, status);

-- -----------------------------------------------------------------------------
-- 4. activation_tasks — the work an Android worker must execute
-- -----------------------------------------------------------------------------
create table public.activation_tasks (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        uuid        not null references public.tenants (id) on delete cascade,
  -- Exactly one task per order.
  order_id         uuid        not null references public.orders (id) on delete restrict,
  product_id       uuid        not null references public.products (id) on delete restrict,
  device_id        uuid        references public.devices (id) on delete restrict,
  sim_id           uuid        references public.device_sims (id) on delete restrict,
  status           text        not null default 'QUEUED',
  -- Higher first.
  priority         integer     not null default 0,
  -- Network of the package (orders.operator_snapshot): the SIM must match.
  operator         text        not null,
  -- The product's USSD flow when the order was paid (schema version 1, 003).
  -- NULL only when the product had no flow (task created FAILED / INVALID_FLOW).
  ussd_flow        jsonb,
  flow_version     integer     not null default 1,
  attempt_count    integer     not null default 0,
  max_attempts     integer     not null default 3,
  assigned_at      timestamptz,
  started_at       timestamptz,
  submitted_at     timestamptz,
  completed_at     timestamptz,
  result_code      text,
  result_message   text,
  failure_reason   text,
  -- clock_timestamp(): exact FIFO order even for tasks created in one transaction.
  created_at       timestamptz not null default clock_timestamp(),
  updated_at       timestamptz not null default now(),
  constraint activation_tasks_order_key        unique (order_id),
  constraint activation_tasks_status_valid     check (status in (
    'QUEUED', 'ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING', 'SUCCESS', 'FAILED', 'UNKNOWN')),
  constraint activation_tasks_priority_range   check (priority between -100 and 100),
  constraint activation_tasks_operator_valid   check (operator in ('vodacom', 'movitel', 'tmcel')),
  constraint activation_tasks_flow_valid       check (ussd_flow is null or private.ussd_flow_is_valid(ussd_flow)),
  constraint activation_tasks_flow_required    check (ussd_flow is not null or (status = 'FAILED' and result_code = 'INVALID_FLOW')),
  constraint activation_tasks_flow_version     check (flow_version = 1),
  constraint activation_tasks_attempts_range   check (attempt_count >= 0 and max_attempts between 1 and 20 and attempt_count <= max_attempts),
  constraint activation_tasks_assignment       check ((status = 'QUEUED') = (device_id is null and sim_id is null) or status in ('FAILED', 'UNKNOWN', 'SUCCESS')),
  constraint activation_tasks_assigned_needs   check (status not in ('ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING') or (device_id is not null and sim_id is not null)),
  constraint activation_tasks_code_format      check (result_code is null or result_code ~ '^[A-Z_]{3,40}$'),
  constraint activation_tasks_message_length   check (result_message is null or char_length(result_message) <= 500),
  constraint activation_tasks_reason_length    check (failure_reason is null or char_length(failure_reason) <= 500)
);
comment on table public.activation_tasks is
  'One activation per PAID order, executed by an Android worker. State machine enforced by trigger for every role. UNKNOWN is never retried automatically.';

-- One running task per device and per SIM (also under concurrent dispatchers).
create unique index activation_tasks_device_busy_key on public.activation_tasks (device_id)
  where status in ('ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING');
create unique index activation_tasks_sim_busy_key on public.activation_tasks (sim_id)
  where status in ('ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING');
create index activation_tasks_queue_idx  on public.activation_tasks (tenant_id, status, priority desc, created_at);
create index activation_tasks_tenant_idx on public.activation_tasks (tenant_id, created_at desc);
create index activation_tasks_product_idx on public.activation_tasks (product_id);

-- -----------------------------------------------------------------------------
-- 5. History — attempts (immutable results) and events (status changes)
-- -----------------------------------------------------------------------------
create table public.activation_task_attempts (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          uuid        not null references public.tenants (id) on delete cascade,
  task_id            uuid        not null references public.activation_tasks (id) on delete cascade,
  -- Order of the record within the task; attempt_number = the execution it belongs to.
  sequence           integer     not null,
  attempt_number     integer     not null,
  -- Historical values (no FK): history survives device / SIM changes.
  device_id          uuid,
  sim_id             uuid,
  slot_index         integer,
  outcome            text        not null,
  result_code        text        not null,
  retryable          boolean     not null default false,
  -- WORKER (reported by the phone) | SYSTEM (timeout) | MANUAL (a person's decision on UNKNOWN)
  source             text        not null,
  -- What was dialled ("*111# › 5 › 8 › … › 1") and the operator's final screen.
  ussd_trace         text,
  operator_response  text,
  note               text,
  decided_by         uuid,
  started_at         timestamptz,
  finished_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  constraint activation_task_attempts_sequence_key unique (task_id, sequence),
  constraint activation_task_attempts_outcome    check (outcome in ('SUCCESS', 'FAILED', 'UNKNOWN')),
  constraint activation_task_attempts_code       check (result_code ~ '^[A-Z_]{3,40}$'),
  constraint activation_task_attempts_source     check (source in ('WORKER', 'SYSTEM', 'MANUAL')),
  constraint activation_task_attempts_manual     check ((source = 'MANUAL') = (decided_by is not null)),
  constraint activation_task_attempts_retry      check (not retryable or outcome = 'FAILED'),
  constraint activation_task_attempts_trace      check (ussd_trace is null or char_length(ussd_trace) <= 500),
  constraint activation_task_attempts_response   check (operator_response is null or char_length(operator_response) <= 2000),
  constraint activation_task_attempts_note       check (note is null or char_length(note) between 1 and 500)
);
comment on table public.activation_task_attempts is
  'Immutable result of each activation attempt (worker report, timeout or a person''s decision). Never rewritten.';

create index activation_task_attempts_task_idx on public.activation_task_attempts (task_id, sequence);
create index activation_task_attempts_tenant_idx on public.activation_task_attempts (tenant_id, created_at desc);

create table public.activation_task_events (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants (id) on delete cascade,
  task_id        uuid        not null references public.activation_tasks (id) on delete cascade,
  -- activation_task.created | .assigned | .unassigned | .started | .submitted | .verifying
  -- | .completed | .failed | .unknown | .retried | .resolved
  event_type     text        not null,
  from_status    text,
  to_status      text        not null,
  device_id      uuid,
  sim_id         uuid,
  -- NULL = system (dispatcher, timeouts).
  actor_user_id  uuid,
  metadata       jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  constraint activation_task_events_type     check (event_type ~ '^activation_task\.[a-z_]+$'),
  constraint activation_task_events_metadata check (private.audit_metadata_is_safe(metadata))
);
comment on table public.activation_task_events is
  'Append-only history of activation task status changes (who, when, which device / SIM).';

create index activation_task_events_task_idx on public.activation_task_events (task_id, created_at);

-- -----------------------------------------------------------------------------
-- 6. Integrity triggers (apply to every role, service_role included)
-- -----------------------------------------------------------------------------
create function private.devices_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.device_name := pg_catalog.btrim(new.device_name);
  if tg_op = 'UPDATE' and (new.tenant_id, new.created_at, new.created_by)
     is distinct from (old.tenant_id, old.created_at, old.created_by) then
    raise exception 'Um dispositivo não muda de empresa.' using errcode = '55000', hint = 'IMMUTABLE_DEVICE';
  end if;
  if tg_op = 'UPDATE' and old.registered_at is not null and new.registered_at is distinct from old.registered_at then
    raise exception 'A data de registo do dispositivo é fixa.' using errcode = '55000', hint = 'IMMUTABLE_DEVICE';
  end if;
  return new;
end;
$$;

create trigger devices_before_write
  before insert or update on public.devices
  for each row execute function private.devices_before_write();
create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function private.set_updated_at();

-- A SIM belongs to its device's tenant; tenant / device / slot never change.
create function private.device_sims_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_device_tenant uuid;
begin
  if tg_op = 'INSERT' then
    select d.tenant_id into v_device_tenant from public.devices d where d.id = new.device_id;
    if v_device_tenant is null or (new.tenant_id is not null and new.tenant_id <> v_device_tenant) then
      raise exception 'Dispositivo não encontrado.' using errcode = 'P0002', hint = 'DEVICE_NOT_FOUND';
    end if;
    new.tenant_id := v_device_tenant;
  elsif (new.tenant_id, new.device_id, new.slot_index, new.created_at, new.created_by)
        is distinct from (old.tenant_id, old.device_id, old.slot_index, old.created_at, old.created_by) then
    raise exception 'O dispositivo e o slot de um SIM não podem ser alterados — registe outro SIM.'
      using errcode = '55000', hint = 'IMMUTABLE_SIM';
  end if;
  if new.phone_number is not null then
    new.phone_number := coalesce(private.normalize_phone(new.phone_number), new.phone_number);
  end if;
  return new;
end;
$$;

create trigger device_sims_before_write
  before insert or update on public.device_sims
  for each row execute function private.device_sims_before_write();
create trigger device_sims_set_updated_at
  before update on public.device_sims
  for each row execute function private.set_updated_at();

-- Task invariants: state machine, evidence for final states, same-tenant
-- device / SIM of the right network, immutable origin.
create function private.activation_tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order    public.orders;
  v_sim      public.device_sims;
  v_last     public.activation_task_attempts;
begin
  if tg_op = 'INSERT' then
    select o.* into v_order from public.orders o where o.id = new.order_id;
    if not found or v_order.tenant_id <> new.tenant_id or v_order.product_id <> new.product_id
       or v_order.operator_snapshot <> new.operator then
      raise exception 'A tarefa não corresponde ao pedido.' using errcode = '42501', hint = 'TASK_ORDER_MISMATCH';
    end if;
    if v_order.status <> 'PAID' then
      raise exception 'Só um pedido pago tem tarefa de ativação.' using errcode = '42501', hint = 'ORDER_NOT_PAID';
    end if;
    if new.status not in ('QUEUED', 'FAILED') or new.attempt_count <> 0 or new.device_id is not null or new.sim_id is not null then
      raise exception 'Uma tarefa nasce na fila.' using errcode = '42501', hint = 'INVALID_TRANSITION';
    end if;
    if new.status = 'FAILED' and new.result_code is distinct from 'INVALID_FLOW' then
      raise exception 'Uma tarefa nasce na fila.' using errcode = '42501', hint = 'INVALID_TRANSITION';
    end if;
    return new;
  end if;

  if (new.tenant_id, new.order_id, new.product_id, new.operator, new.ussd_flow, new.flow_version, new.created_at)
     is distinct from (old.tenant_id, old.order_id, old.product_id, old.operator, old.ussd_flow, old.flow_version, old.created_at) then
    raise exception 'A origem de uma tarefa de ativação não pode ser alterada.' using errcode = '55000', hint = 'IMMUTABLE_TASK';
  end if;
  if new.attempt_count < old.attempt_count or new.max_attempts < old.max_attempts then
    raise exception 'O histórico de tentativas não pode recuar.' using errcode = '55000', hint = 'IMMUTABLE_TASK';
  end if;

  if new.status is distinct from old.status then
    if not private.activation_task_transition_allowed(old.status, new.status) then
      raise exception 'Transição de estado inválida: % → %.', old.status, new.status
        using errcode = '55000', hint = 'INVALID_TRANSITION';
    end if;
    select a.* into v_last from public.activation_task_attempts a where a.task_id = new.id order by a.sequence desc limit 1;
    -- Final states need evidence: the latest attempt record must say so.
    if new.status in ('SUCCESS', 'FAILED', 'UNKNOWN') and (v_last.id is null or v_last.outcome <> new.status) then
      raise exception 'Resultado sem registo de tentativa (%).', new.status using errcode = '42501', hint = 'RESULT_WITHOUT_EVIDENCE';
    end if;
    -- Leaving UNKNOWN requires a person's decision recorded after it.
    if old.status = 'UNKNOWN' and v_last.source <> 'MANUAL' then
      raise exception 'Um resultado desconhecido só é decidido por uma pessoa.' using errcode = '42501', hint = 'DECISION_REQUIRED';
    end if;
    -- Back to the queue only with attempts left, and either a retryable failure
    -- or a person's explicit retry (retry_activation_task marks the transaction).
    if old.status = 'FAILED' and new.status = 'QUEUED'
       and (new.attempt_count >= new.max_attempts
            or (not coalesce(v_last.retryable, false)
                and coalesce(pg_catalog.current_setting('megabot.manual_retry', true), '') <> new.id::text)) then
      raise exception 'Esta falha não pode ser repetida automaticamente.' using errcode = '55000', hint = 'TASK_NOT_RETRYABLE';
    end if;
  end if;

  if new.status = 'QUEUED' then
    new.device_id := null;
    new.sim_id := null;
    new.assigned_at := null;
    new.started_at := null;
    new.submitted_at := null;
    new.completed_at := null;
  end if;
  if new.sim_id is not null and (new.sim_id is distinct from old.sim_id or new.device_id is distinct from old.device_id) then
    select s.* into v_sim from public.device_sims s where s.id = new.sim_id;
    if not found or v_sim.tenant_id <> new.tenant_id or v_sim.device_id is distinct from new.device_id then
      raise exception 'SIM de outro dispositivo ou empresa.' using errcode = '42501', hint = 'SIM_MISMATCH';
    end if;
    if v_sim.operator <> new.operator then
      raise exception 'O SIM é de outra rede.' using errcode = '42501', hint = 'OPERATOR_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

create trigger activation_tasks_before_write
  before insert or update on public.activation_tasks
  for each row execute function private.activation_tasks_before_write();
create trigger activation_tasks_set_updated_at
  before update on public.activation_tasks
  for each row execute function private.set_updated_at();

-- Every creation and status change → activation_task_events (tenant history)
-- and audit_logs (platform audit). No phone numbers or responses in metadata.
create function private.record_activation_task_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type  text;
  v_meta  jsonb;
begin
  if tg_op = 'INSERT' then
    v_type := case new.status when 'FAILED' then 'failed' else 'created' end;
  elsif new.status is distinct from old.status then
    v_type := case
      when new.status = 'ASSIGNED' then 'assigned'
      when old.status = 'ASSIGNED' and new.status = 'QUEUED' then 'unassigned'
      when old.status = 'FAILED' and new.status = 'QUEUED' then 'retried'
      when old.status = 'UNKNOWN' then 'resolved'
      when new.status = 'EXECUTING' then 'started'
      when new.status = 'SUBMITTED' then 'submitted'
      when new.status = 'VERIFYING' then 'verifying'
      when new.status = 'SUCCESS' then 'completed'
      when new.status = 'FAILED' then 'failed'
      when new.status = 'UNKNOWN' then 'unknown'
      else 'status_changed' end;
  else
    return null;
  end if;
  v_meta := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'order_id', new.order_id, 'device_id', new.device_id, 'sim_id', new.sim_id,
    'attempt', new.attempt_count, 'result_code', new.result_code));
  insert into public.activation_task_events (tenant_id, task_id, event_type, from_status, to_status, device_id, sim_id,
                                             actor_user_id, metadata)
  values (new.tenant_id, new.id, 'activation_task.' || v_type,
          case when tg_op = 'UPDATE' then old.status end, new.status,
          coalesce(new.device_id, case when tg_op = 'UPDATE' then old.device_id end),
          coalesce(new.sim_id, case when tg_op = 'UPDATE' then old.sim_id end),
          (select auth.uid()), v_meta);
  if v_type in ('created', 'assigned', 'started', 'completed', 'failed', 'unknown', 'retried', 'resolved') then
    perform private.write_audit_log((select auth.uid()), new.tenant_id, 'activation_task.' || v_type, 'activation_task',
      new.id::text, v_meta || pg_catalog.jsonb_build_object('status', new.status));
  end if;
  return null;
end;
$$;

create trigger activation_tasks_record_event
  after insert or update on public.activation_tasks
  for each row execute function private.record_activation_task_event();

-- Attempts and events are history: never edited; deleted only with their task's tenant.
create function private.prevent_activation_history_changes()
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

create trigger activation_task_attempts_immutable
  before update or delete on public.activation_task_attempts
  for each row execute function private.prevent_activation_history_changes();
create trigger activation_task_attempts_no_truncate
  before truncate on public.activation_task_attempts
  for each statement execute function private.prevent_activation_history_changes();
create trigger activation_task_events_immutable
  before update or delete on public.activation_task_events
  for each row execute function private.prevent_activation_history_changes();
create trigger activation_task_events_no_truncate
  before truncate on public.activation_task_events
  for each statement execute function private.prevent_activation_history_changes();

-- Device / SIM administration → audit_logs (heartbeat noise is not audited).
create function private.audit_device_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'device.created';
  elsif old.registered_at is null and new.registered_at is not null then
    v_action := 'device.registered';
  elsif new.status is distinct from old.status then
    v_action := case new.status when 'DISABLED' then 'device.disabled' else 'device.enabled' end;
  elsif new.device_name is distinct from old.device_name then
    v_action := 'device.updated';
  else
    return null;
  end if;
  perform private.write_audit_log((select auth.uid()), new.tenant_id, v_action, 'device', new.id::text,
    pg_catalog.jsonb_build_object('status', new.status, 'platform', new.platform, 'app_version', new.app_version));
  return null;
end;
$$;

create trigger devices_audit
  after insert or update on public.devices
  for each row execute function private.audit_device_changes();

create function private.audit_device_sim_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'sim.registered';
  elsif new.status is distinct from old.status and 'DISABLED' in (new.status, old.status) then
    v_action := case new.status when 'DISABLED' then 'sim.disabled' else 'sim.enabled' end;
  elsif new.operator is distinct from old.operator or new.phone_number is distinct from old.phone_number
     or new.capabilities is distinct from old.capabilities
     or (new.status is distinct from old.status and old.unavailable_reason = 'SIM_CHANGED') then
    v_action := 'sim.updated';
  else
    return null;
  end if;
  perform private.write_audit_log((select auth.uid()), new.tenant_id, v_action, 'device_sim', new.id::text,
    pg_catalog.jsonb_build_object('device_id', new.device_id, 'slot_index', new.slot_index, 'operator', new.operator,
                                  'status', new.status));
  return null;
end;
$$;

create trigger device_sims_audit
  after insert or update on public.device_sims
  for each row execute function private.audit_device_sim_changes();

-- -----------------------------------------------------------------------------
-- 7. Engine (internal, not callable through the API)
-- -----------------------------------------------------------------------------

-- Online = registered, enabled and seen within the tenant's heartbeat timeout.
create function private.device_is_online(p_device public.devices)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_device.status = 'ACTIVE'
     and p_device.last_seen_at is not null
     and p_device.last_seen_at >= pg_catalog.now()
         - pg_catalog.make_interval(secs => private.automation_setting_seconds(p_device.tenant_id, 'heartbeat_timeout_seconds'));
$$;

-- Moves the order along the 004 state machine to match its activation:
--   ASSIGNED / re-queued → READY_FOR_ACTIVATION · EXECUTING… / UNKNOWN → ACTIVATING
--   SUCCESS → COMPLETED · FAILED (final) → FAILED.
-- Orders outside the activation path (e.g. finished by hand) are left alone.
create function private.sync_order_with_activation(p_order_id uuid, p_task_status text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_target text := case p_task_status
    when 'ASSIGNED' then 'READY_FOR_ACTIVATION'
    when 'QUEUED' then 'READY_FOR_ACTIVATION'
    when 'EXECUTING' then 'ACTIVATING' when 'SUBMITTED' then 'ACTIVATING'
    when 'VERIFYING' then 'ACTIVATING' when 'UNKNOWN' then 'ACTIVATING'
    when 'SUCCESS' then 'COMPLETED'
    when 'FAILED' then 'FAILED' end;
  v_status text;
begin
  select o.status into v_status from public.orders o where o.id = p_order_id for update;
  if v_status is null or v_target is null or v_status = v_target then
    return;
  end if;
  if p_task_status = 'QUEUED' and v_status not in ('PAID', 'FAILED') then
    return;  -- re-queued after an unassignment: the order already moved on
  end if;
  if v_status = 'PAID' then
    update public.orders o set status = 'READY_FOR_ACTIVATION' where o.id = p_order_id;
    v_status := 'READY_FOR_ACTIVATION';
  elsif v_status = 'FAILED' and v_target <> 'FAILED' then
    update public.orders o set status = 'READY_FOR_ACTIVATION' where o.id = p_order_id;
    v_status := 'READY_FOR_ACTIVATION';
  end if;
  if v_target in ('ACTIVATING', 'COMPLETED') and v_status = 'READY_FOR_ACTIVATION' then
    update public.orders o set status = 'ACTIVATING' where o.id = p_order_id;
    v_status := 'ACTIVATING';
  end if;
  if v_target = 'COMPLETED' and v_status = 'ACTIVATING' then
    update public.orders o set status = 'COMPLETED' where o.id = p_order_id;
  elsif v_target = 'FAILED' and v_status in ('READY_FOR_ACTIVATION', 'ACTIVATING') then
    update public.orders o set status = 'FAILED' where o.id = p_order_id;
  end if;
end;
$$;

-- Exactly one task per PAID order, with the product's flow snapshot. Idempotent.
create function private.create_activation_task(p_order_id uuid)
returns public.activation_tasks
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
  v_flow  jsonb;
  v_task  public.activation_tasks;
begin
  select t.* into v_task from public.activation_tasks t where t.order_id = p_order_id;
  if found then
    return v_task;
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id;
  if not found or v_order.status <> 'PAID' then
    return null;
  end if;
  select p.ussd_flow into v_flow from public.products p where p.id = v_order.product_id;

  if v_flow is null then
    -- Cannot be delivered automatically: the task records why (a person decides).
    insert into public.activation_tasks (tenant_id, order_id, product_id, status, operator, ussd_flow, result_code, failure_reason)
    values (v_order.tenant_id, v_order.id, v_order.product_id, 'FAILED', v_order.operator_snapshot, null, 'INVALID_FLOW',
            'O produto não tem fluxo USSD configurado.')
    on conflict (order_id) do nothing
    returning * into v_task;
  else
    insert into public.activation_tasks (tenant_id, order_id, product_id, operator, ussd_flow)
    values (v_order.tenant_id, v_order.id, v_order.product_id, v_order.operator_snapshot, v_flow)
    on conflict (order_id) do nothing
    returning * into v_task;
  end if;
  if v_task.id is null then
    select t.* into v_task from public.activation_tasks t where t.order_id = p_order_id;
  elsif v_task.status = 'FAILED' then
    perform private.sync_order_with_activation(v_order.id, 'FAILED');
  end if;
  return v_task;
end;
$$;

-- The attempt record that proves an outcome (immutable).
create function private.record_activation_attempt(
  p_task      public.activation_tasks,
  p_outcome   text,
  p_code      text,
  p_source    text,
  p_response  text default null,
  p_trace     text default null,
  p_note      text default null,
  p_decided_by uuid default null
)
returns public.activation_task_attempts
language plpgsql
set search_path = ''
as $$
declare
  v_attempt public.activation_task_attempts;
  v_info    record;
  v_slot    integer;
begin
  select * into v_info from private.activation_result_code_info(p_code);
  if v_info.outcomes is null or not (p_outcome = any (v_info.outcomes)) then
    raise exception 'Código de resultado inválido para %: %.', p_outcome, p_code using errcode = '22023', hint = 'INVALID_RESULT';
  end if;
  select s.slot_index into v_slot from public.device_sims s where s.id = p_task.sim_id;
  insert into public.activation_task_attempts (tenant_id, task_id, sequence, attempt_number, device_id, sim_id, slot_index,
                                               outcome, result_code, retryable, source, ussd_trace, operator_response,
                                               note, decided_by, started_at)
  values (p_task.tenant_id, p_task.id,
          coalesce((select max(a.sequence) from public.activation_task_attempts a where a.task_id = p_task.id), 0) + 1,
          p_task.attempt_count, p_task.device_id, p_task.sim_id, v_slot,
          p_outcome, p_code, p_outcome = 'FAILED' and v_info.retryable, p_source,
          pg_catalog.left(nullif(pg_catalog.btrim(p_trace), ''), 500),
          pg_catalog.left(nullif(pg_catalog.btrim(p_response), ''), 2000),
          p_note, p_decided_by, p_task.started_at)
  returning * into v_attempt;
  return v_attempt;
end;
$$;

-- Releases work that cannot finish: ASSIGNED but never started (device gone)
-- goes back to the queue; started but silent becomes UNKNOWN (it may have run).
create function private.expire_stale_activation_tasks(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  public.activation_tasks;
  v_count integer := 0;
  v_assign_timeout integer := private.automation_setting_seconds(p_tenant_id, 'assignment_timeout_seconds');
  v_exec_timeout   integer := private.automation_setting_seconds(p_tenant_id, 'execution_timeout_seconds');
begin
  for v_task in
    select t.* from public.activation_tasks t
      join public.devices d on d.id = t.device_id
     where t.tenant_id = p_tenant_id and t.status = 'ASSIGNED'
       and (t.assigned_at < pg_catalog.now() - pg_catalog.make_interval(secs => v_assign_timeout)
            or not private.device_is_online(d))
       for update of t skip locked
  loop
    update public.activation_tasks t set status = 'QUEUED' where t.id = v_task.id;
    v_count := v_count + 1;
  end loop;

  for v_task in
    select t.* from public.activation_tasks t
     where t.tenant_id = p_tenant_id and t.status in ('EXECUTING', 'SUBMITTED', 'VERIFYING')
       and coalesce(t.started_at, t.assigned_at) < pg_catalog.now() - pg_catalog.make_interval(secs => v_exec_timeout)
       for update skip locked
  loop
    -- The worker locks order → task; never wait on the order here (no deadlock):
    -- if it is busy (the result is arriving right now), try again next run.
    perform 1 from public.orders o where o.id = v_task.order_id for update skip locked;
    if not found then
      continue;
    end if;
    perform private.record_activation_attempt(v_task, 'UNKNOWN', 'TIMEOUT', 'SYSTEM');
    update public.activation_tasks t
       set status = 'UNKNOWN', result_code = 'TIMEOUT', completed_at = pg_catalog.now(),
           result_message = 'Sem resposta do dispositivo dentro do tempo limite.'
     where t.id = v_task.id;
    perform private.sync_order_with_activation(v_task.order_id, 'UNKNOWN');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The dispatcher: QUEUED → ASSIGNED to the first eligible (device, SIM), in a
-- deterministic order. Safe with concurrent dispatchers: tasks and SIMs are
-- taken with FOR UPDATE SKIP LOCKED and the busy indexes reject double work.
-- No eligible worker → the task simply stays QUEUED (never FAILED for that).
create function private.dispatch_activation_tasks(p_tenant_id uuid, p_limit integer default 20)
returns integer
language plpgsql
-- Definer: scheduled jobs (service_role) run it without any write grant on the tables.
security definer
set search_path = ''
as $$
declare
  v_task      public.activation_tasks;
  v_sim       public.device_sims;
  v_assigned  integer := 0;
  v_timeout   integer;
begin
  if not private.tenant_is_active(p_tenant_id) then
    return 0;
  end if;
  perform private.expire_stale_activation_tasks(p_tenant_id);
  v_timeout := private.automation_setting_seconds(p_tenant_id, 'heartbeat_timeout_seconds');

  for v_task in
    select t.* from public.activation_tasks t
      join public.orders o on o.id = t.order_id
     where t.tenant_id = p_tenant_id and t.status = 'QUEUED'
       and o.status in ('PAID', 'READY_FOR_ACTIVATION')
     order by t.priority desc, t.created_at, t.id
     limit greatest(1, least(coalesce(p_limit, 20), 100))
       for update of t skip locked
  loop
    v_sim := null;
    select s.* into v_sim
      from public.device_sims s
      join public.devices d on d.id = s.device_id
     where s.tenant_id = v_task.tenant_id
       and s.status = 'ACTIVE'
       and s.operator = v_task.operator
       and coalesce((s.capabilities ->> 'ussd')::boolean, false)
       and d.status = 'ACTIVE'
       -- Every flow (003) has at least one menu step after the start code, so
       -- the phone must run USSD sessions interactively, not just single requests.
       and coalesce((d.capabilities ->> 'ussd')::boolean, false)
       and coalesce((d.capabilities ->> 'ussd_interactive')::boolean, false)
       and d.last_seen_at >= pg_catalog.now() - pg_catalog.make_interval(secs => v_timeout)
       and not exists (select 1 from public.activation_tasks b where b.device_id = d.id
                        and b.status in ('ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING'))
       and not exists (select 1 from public.activation_tasks b where b.sim_id = s.id
                        and b.status in ('ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING'))
     -- failover preference: SIMs that already failed this task go last
     order by (select pg_catalog.count(*) from public.activation_task_attempts a
                where a.task_id = v_task.id and a.sim_id = s.id and a.outcome = 'FAILED'),
              d.created_at, d.id, s.slot_index
     limit 1
       for update of s skip locked;
    if v_sim.id is null then
      continue;
    end if;
    begin
      update public.activation_tasks t
         set status = 'ASSIGNED', device_id = v_sim.device_id, sim_id = v_sim.id, assigned_at = pg_catalog.now()
       where t.id = v_task.id and t.status = 'QUEUED';
    exception when unique_violation then
      continue;  -- the device or SIM was taken concurrently: try the next task
    end;
    perform private.sync_order_with_activation(v_task.order_id, 'ASSIGNED');
    v_assigned := v_assigned + 1;
  end loop;
  return v_assigned;
end;
$$;

-- Versioned, validated execution request for the worker. Contains no secrets
-- and nothing the worker could use to change price, tenant or payment.
create function private.activation_payload(p_task public.activation_tasks)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_order public.orders;
  v_sim   public.device_sims;
  v_mb    numeric;
  v_dest  text;
begin
  select o.* into v_order from public.orders o where o.id = p_task.order_id;
  select s.* into v_sim from public.device_sims s where s.id = p_task.sim_id;
  v_mb := case v_order.data_unit_snapshot
            when 'GB' then v_order.data_amount_snapshot * 1024
            when 'MB' then v_order.data_amount_snapshot end;
  -- Mozambican numbers are typed locally (9 digits); others as international digits.
  v_dest := case when v_order.customer_phone like '+258%' then pg_catalog.substr(v_order.customer_phone, 5)
                 else pg_catalog.ltrim(v_order.customer_phone, '+') end;
  return pg_catalog.jsonb_build_object(
    'protocol', 'megabot.activation.v1',
    'task_id', p_task.id,
    'order_id', p_task.order_id,
    'product_id', p_task.product_id,
    'device_id', p_task.device_id,
    'sim_id', p_task.sim_id,
    'status', p_task.status,
    'attempt', p_task.attempt_count,
    'operator', p_task.operator,
    'sim', pg_catalog.jsonb_build_object('slot_index', v_sim.slot_index, 'fingerprint', v_sim.sim_fingerprint,
                                         'operator', v_sim.operator),
    'destination_number', v_order.customer_phone,
    'flow_version', p_task.flow_version,
    'flow', p_task.ussd_flow,
    'values', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'destination_number', v_dest,
      'amount_mb', case when v_mb is not null then pg_catalog.round(v_mb)::bigint::text end,
      'amount_gb', case when v_mb is not null
                        then pg_catalog.rtrim(pg_catalog.rtrim(pg_catalog.round(v_mb / 1024, 2)::text, '0'), '.') end,
      'price', pg_catalog.rtrim(pg_catalog.rtrim(v_order.product_price_snapshot::text, '0'), '.'))),
    'limits', pg_catalog.jsonb_build_object('step_timeout_ms', 30000, 'session_timeout_ms', 120000));
end;
$$;

-- Worker authentication: signed-in member of the device's tenant + the device
-- token. Any mismatch answers "not found" (no hint whether the device exists).
create function private.authenticate_device(p_device_id uuid, p_token text, p_require_active_tenant boolean)
returns public.devices
language plpgsql
set search_path = ''
as $$
declare
  v_device public.devices;
begin
  select d.* into v_device from public.devices d where d.id = p_device_id for update;
  if not found or (select auth.uid()) is null
     or not private.has_tenant_role(v_device.tenant_id, array['owner', 'admin', 'operator'])
     or p_token is null or pg_catalog.char_length(p_token) not between 32 and 128
     or not exists (select 1 from public.device_credentials c
                     where c.device_id = v_device.id
                       and c.token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))) then
    raise exception 'Dispositivo não encontrado.' using errcode = 'P0002', hint = 'DEVICE_NOT_FOUND';
  end if;
  if v_device.status = 'DISABLED' then
    raise exception 'Este dispositivo foi desativado.' using errcode = '42501', hint = 'DEVICE_DISABLED';
  end if;
  if p_require_active_tenant and not private.tenant_is_active(v_device.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  return v_device;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Orders (004) gain two triggers
-- -----------------------------------------------------------------------------

-- PAID → exactly one activation task (idempotent), in the same transaction.
create function private.orders_create_activation_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.create_activation_task(new.id);
  return null;
end;
$$;

create trigger orders_create_activation_task
  after update of status on public.orders
  for each row
  when (new.status = 'PAID' and old.status is distinct from 'PAID')
  execute function private.orders_create_activation_task();

-- API roles (service_role included) cannot complete an order without a
-- successful activation. The database owner keeps maintenance control.
create function private.orders_require_activation_success()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED'
     and current_user in ('anon', 'authenticated', 'service_role')
     and not exists (select 1 from public.activation_tasks t where t.order_id = new.id and t.status = 'SUCCESS') then
    raise exception 'O pedido só fica concluído com uma ativação confirmada.' using errcode = '42501', hint = 'ACTIVATION_NOT_CONFIRMED';
  end if;
  return new;
end;
$$;

create trigger orders_require_activation_success
  before update of status on public.orders
  for each row execute function private.orders_require_activation_success();

-- Orders already PAID before this migration get their task too.
insert into public.activation_tasks (tenant_id, order_id, product_id, operator, ussd_flow)
select o.tenant_id, o.id, o.product_id, o.operator_snapshot, p.ussd_flow
  from public.orders o
  join public.products p on p.id = o.product_id
 where o.status = 'PAID' and p.ussd_flow is not null
on conflict (order_id) do nothing;

-- -----------------------------------------------------------------------------
-- 9. Commands for people (SECURITY DEFINER in `private`; invoker wrappers in public)
-- -----------------------------------------------------------------------------

-- New worker device (UNREGISTERED) + one-time pairing code (15 min).
create function private.create_device(p_tenant_id uuid, p_device_name text)
returns table (device_id uuid, pairing_code text, pairing_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_device public.devices;
  v_code   text := private.new_pairing_code();
  v_expiry timestamptz := pg_catalog.now() + interval '15 minutes';
begin
  if v_actor is null or not private.has_tenant_role(p_tenant_id, array['owner', 'admin']) then
    raise exception 'Só o dono ou um administrador gere dispositivos.' using errcode = '42501', hint = 'DEVICE_WRITE_DENIED';
  end if;
  if not private.tenant_is_active(p_tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_device_name, ''))) not between 2 and 80 then
    raise exception 'O nome do dispositivo deve ter entre 2 e 80 caracteres.' using errcode = '22023', hint = 'INVALID_DEVICE_NAME';
  end if;
  insert into public.devices (tenant_id, device_name, created_by)
  values (p_tenant_id, p_device_name, v_actor)
  returning * into v_device;
  insert into public.device_credentials (device_id, tenant_id, pairing_code_hash, pairing_expires_at)
  values (v_device.id, v_device.tenant_id, pg_catalog.sha256(pg_catalog.convert_to(v_code, 'UTF8')), v_expiry);
  device_id := v_device.id;
  pairing_code := pg_catalog.substr(v_code, 1, 4) || '-' || pg_catalog.substr(v_code, 5, 4);
  pairing_expires_at := v_expiry;
  return next;
end;
$$;

-- New pairing code for an existing device (new phone / reinstall). Pairing
-- again replaces the device token: the old phone stops working.
create function private.create_device_pairing_code(p_device_id uuid)
returns table (device_id uuid, pairing_code text, pairing_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
  v_code   text := private.new_pairing_code();
  v_expiry timestamptz := pg_catalog.now() + interval '15 minutes';
begin
  select d.* into v_device from public.devices d where d.id = p_device_id for update;
  if not found or (select auth.uid()) is null or not private.has_tenant_role(v_device.tenant_id, array['owner', 'admin']) then
    raise exception 'Dispositivo não encontrado.' using errcode = 'P0002', hint = 'DEVICE_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_device.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if v_device.status = 'DISABLED' then
    raise exception 'Ative o dispositivo antes de o emparelhar.' using errcode = '55000', hint = 'DEVICE_DISABLED';
  end if;
  insert into public.device_credentials (device_id, tenant_id, pairing_code_hash, pairing_expires_at)
  values (v_device.id, v_device.tenant_id, pg_catalog.sha256(pg_catalog.convert_to(v_code, 'UTF8')), v_expiry)
  on conflict on constraint device_credentials_pkey do update
     set pairing_code_hash = excluded.pairing_code_hash, pairing_expires_at = excluded.pairing_expires_at,
         updated_at = pg_catalog.now();
  perform private.write_audit_log((select auth.uid()), v_device.tenant_id, 'device.pairing_code_created', 'device',
    v_device.id::text, '{}'::jsonb);
  device_id := v_device.id;
  pairing_code := pg_catalog.substr(v_code, 1, 4) || '-' || pg_catalog.substr(v_code, 5, 4);
  pairing_expires_at := v_expiry;
  return next;
end;
$$;

create function private.update_device(p_device_id uuid, p_device_name text default null, p_status text default null)
returns setof public.devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
  v_task   public.activation_tasks;
begin
  select d.* into v_device from public.devices d where d.id = p_device_id for update;
  if not found or (select auth.uid()) is null or not private.has_tenant_role(v_device.tenant_id, array['owner', 'admin']) then
    raise exception 'Dispositivo não encontrado.' using errcode = 'P0002', hint = 'DEVICE_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_device.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if p_status is not null and p_status not in ('ACTIVE', 'DISABLED') then
    raise exception 'Estado inválido.' using errcode = '22023', hint = 'INVALID_STATUS';
  end if;
  if p_status = 'ACTIVE' and v_device.registered_at is null then
    raise exception 'O dispositivo ainda não foi emparelhado.' using errcode = '55000', hint = 'DEVICE_NOT_REGISTERED';
  end if;
  if p_device_name is not null and pg_catalog.char_length(pg_catalog.btrim(p_device_name)) not between 2 and 80 then
    raise exception 'O nome do dispositivo deve ter entre 2 e 80 caracteres.' using errcode = '22023', hint = 'INVALID_DEVICE_NAME';
  end if;
  if p_status = 'DISABLED' and v_device.status = 'UNREGISTERED' then
    raise exception 'O dispositivo ainda não foi emparelhado.' using errcode = '55000', hint = 'DEVICE_NOT_REGISTERED';
  end if;

  update public.devices d
     set device_name = coalesce(p_device_name, d.device_name), status = coalesce(p_status, d.status)
   where d.id = p_device_id
  returning * into v_device;
  if p_status = 'DISABLED' then
    -- Work not started yet goes back to the queue; started work finishes or times out to UNKNOWN.
    for v_task in select t.* from public.activation_tasks t where t.device_id = p_device_id and t.status = 'ASSIGNED' for update
    loop
      update public.activation_tasks t set status = 'QUEUED' where t.id = v_task.id;
    end loop;
  end if;
  return next v_device;
end;
$$;

create function private.register_device_sim(
  p_device_id    uuid,
  p_slot_index   integer,
  p_operator     text,
  p_phone_number text default null
)
returns setof public.device_sims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
  v_sim    public.device_sims;
  v_phone  text;
begin
  select d.* into v_device from public.devices d where d.id = p_device_id;
  if not found or (select auth.uid()) is null or not private.has_tenant_role(v_device.tenant_id, array['owner', 'admin']) then
    raise exception 'Dispositivo não encontrado.' using errcode = 'P0002', hint = 'DEVICE_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_device.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if p_slot_index is null or p_slot_index not between 0 and 7 then
    raise exception 'Slot inválido.' using errcode = '22023', hint = 'INVALID_SLOT';
  end if;
  if p_operator is null or p_operator not in ('vodacom', 'movitel', 'tmcel') then
    raise exception 'Operadora inválida.' using errcode = '22023', hint = 'INVALID_OPERATOR';
  end if;
  if nullif(pg_catalog.btrim(p_phone_number), '') is not null then
    v_phone := private.normalize_phone(p_phone_number);
    if v_phone is null then
      raise exception 'Número de telefone inválido.' using errcode = '22023', hint = 'INVALID_PHONE';
    end if;
  end if;
  insert into public.device_sims (device_id, slot_index, operator, phone_number, created_by)
  values (v_device.id, p_slot_index, p_operator, v_phone, (select auth.uid()))
  returning * into v_sim;
  return next v_sim;
exception when unique_violation then
  raise exception 'Já existe um SIM registado neste slot.' using errcode = '23505', hint = 'SIM_SLOT_TAKEN';
end;
$$;

create function private.update_device_sim(
  p_sim_id       uuid,
  p_operator     text default null,
  p_phone_number text default null,
  p_status       text default null
)
returns setof public.device_sims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sim   public.device_sims;
  v_phone text;
  v_task  public.activation_tasks;
begin
  select s.* into v_sim from public.device_sims s where s.id = p_sim_id for update;
  if not found or (select auth.uid()) is null or not private.has_tenant_role(v_sim.tenant_id, array['owner', 'admin']) then
    raise exception 'SIM não encontrado.' using errcode = 'P0002', hint = 'SIM_NOT_FOUND';
  end if;
  if not private.tenant_is_active(v_sim.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if p_operator is not null and p_operator not in ('vodacom', 'movitel', 'tmcel') then
    raise exception 'Operadora inválida.' using errcode = '22023', hint = 'INVALID_OPERATOR';
  end if;
  if p_status is not null and p_status not in ('ACTIVE', 'DISABLED') then
    raise exception 'Estado inválido.' using errcode = '22023', hint = 'INVALID_STATUS';
  end if;
  if nullif(pg_catalog.btrim(p_phone_number), '') is not null then
    v_phone := private.normalize_phone(p_phone_number);
    if v_phone is null then
      raise exception 'Número de telefone inválido.' using errcode = '22023', hint = 'INVALID_PHONE';
    end if;
  end if;
  if p_operator is not null and p_operator <> v_sim.operator and exists (
    select 1 from public.activation_tasks t where t.sim_id = v_sim.id and t.status in ('ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING')) then
    raise exception 'O SIM tem uma ativação em curso.' using errcode = '55000', hint = 'SIM_BUSY';
  end if;

  update public.device_sims s
     set operator = coalesce(p_operator, s.operator),
         phone_number = coalesce(v_phone, s.phone_number),
         status = coalesce(p_status, s.status),
         -- Re-activating after "a different SIM is in this slot": the next heartbeat adopts the new SIM.
         unavailable_reason = case when p_status is not null then null else s.unavailable_reason end,
         sim_fingerprint = case when p_status = 'ACTIVE' and s.unavailable_reason = 'SIM_CHANGED' then null else s.sim_fingerprint end
   where s.id = p_sim_id
  returning * into v_sim;
  if p_status = 'DISABLED' then
    for v_task in select t.* from public.activation_tasks t where t.sim_id = p_sim_id and t.status = 'ASSIGNED' for update
    loop
      update public.activation_tasks t set status = 'QUEUED' where t.id = v_task.id;
    end loop;
  end if;
  return next v_sim;
end;
$$;

-- Manual dispatcher run for the caller's tenant (workers also trigger it).
create function private.dispatch_activation_tasks_for(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_tenant_role(p_tenant_id, array['owner', 'admin']) then
    raise exception 'Só o dono ou um administrador pode distribuir tarefas.' using errcode = '42501', hint = 'DEVICE_WRITE_DENIED';
  end if;
  if not private.tenant_is_active(p_tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  return private.dispatch_activation_tasks(p_tenant_id, 20);
end;
$$;

-- Explicit retry of a FAILED task (a person's decision, whatever the code). Audited.
create function private.retry_activation_task(p_task_id uuid, p_note text default null)
returns setof public.activation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.activation_tasks;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
begin
  select t.* into v_task from public.activation_tasks t where t.id = p_task_id;
  if not found or (select auth.uid()) is null or not private.has_tenant_role(v_task.tenant_id, array['owner', 'admin']) then
    raise exception 'Tarefa não encontrada.' using errcode = 'P0002', hint = 'TASK_NOT_FOUND';
  end if;
  perform 1 from public.orders o where o.id = v_task.order_id for update;   -- lock order: order → task
  select t.* into v_task from public.activation_tasks t where t.id = p_task_id for update;
  if not private.tenant_is_active(v_task.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if v_task.status <> 'FAILED' then
    raise exception 'Só uma tarefa falhada pode ser repetida (estado atual: %).', v_task.status
      using errcode = '55000', hint = 'TASK_NOT_RETRYABLE';
  end if;
  if v_task.ussd_flow is null then
    raise exception 'O produto deste pedido não tinha fluxo USSD: não há o que executar.' using errcode = '55000', hint = 'TASK_NOT_RETRYABLE';
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 500 then
    raise exception 'A nota deve ter no máximo 500 caracteres.' using errcode = '22023', hint = 'INVALID_REASON';
  end if;

  perform pg_catalog.set_config('megabot.manual_retry', v_task.id::text, true);
  update public.activation_tasks t
     set status = 'QUEUED', max_attempts = greatest(t.max_attempts, t.attempt_count + 1),
         result_code = null, result_message = null, failure_reason = null
   where t.id = p_task_id
  returning * into v_task;
  perform pg_catalog.set_config('megabot.manual_retry', '', true);
  perform private.sync_order_with_activation(v_task.order_id, 'QUEUED');
  perform private.write_audit_log((select auth.uid()), v_task.tenant_id, 'activation_task.retried_manually', 'activation_task',
    v_task.id::text, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('order_id', v_task.order_id, 'note', v_note)));
  perform private.dispatch_activation_tasks(v_task.tenant_id, 20);
  return query select t.* from public.activation_tasks t where t.id = p_task_id;
end;
$$;

-- A person decides an UNKNOWN activation (e.g. after checking with the customer
-- or the operator). The decision is recorded as evidence. Audited.
create function private.resolve_activation_task(p_task_id uuid, p_outcome text, p_note text)
returns setof public.activation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task  public.activation_tasks;
  v_note  text := nullif(pg_catalog.btrim(p_note), '');
begin
  select t.* into v_task from public.activation_tasks t where t.id = p_task_id;
  if not found or v_actor is null or not private.has_tenant_role(v_task.tenant_id, array['owner', 'admin']) then
    raise exception 'Tarefa não encontrada.' using errcode = 'P0002', hint = 'TASK_NOT_FOUND';
  end if;
  perform 1 from public.orders o where o.id = v_task.order_id for update;
  select t.* into v_task from public.activation_tasks t where t.id = p_task_id for update;
  if not private.tenant_is_active(v_task.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if v_task.status <> 'UNKNOWN' then
    raise exception 'Só um resultado desconhecido é decidido manualmente (estado atual: %).', v_task.status
      using errcode = '55000', hint = 'TASK_NOT_UNKNOWN';
  end if;
  if p_outcome is null or p_outcome not in ('SUCCESS', 'FAILED') then
    raise exception 'Decisão inválida.' using errcode = '22023', hint = 'INVALID_RESULT';
  end if;
  if v_note is null or pg_catalog.char_length(v_note) > 500 then
    raise exception 'Explique a decisão (até 500 caracteres).' using errcode = '22023', hint = 'INVALID_REASON';
  end if;

  perform private.record_activation_attempt(v_task, p_outcome,
    case p_outcome when 'SUCCESS' then 'MANUAL_CONFIRMED' else 'MANUAL_REJECTED' end, 'MANUAL', null, null, v_note, v_actor);
  update public.activation_tasks t
     set status = p_outcome,
         result_code = case p_outcome when 'SUCCESS' then 'MANUAL_CONFIRMED' else 'MANUAL_REJECTED' end,
         failure_reason = case p_outcome when 'FAILED' then v_note end,
         completed_at = pg_catalog.now()
   where t.id = p_task_id
  returning * into v_task;
  perform private.sync_order_with_activation(v_task.order_id, p_outcome);
  return next v_task;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Worker protocol (device token + signed-in member)
-- -----------------------------------------------------------------------------

-- Pairing: one-time code → device identity + token (shown once, stored hashed).
create function private.register_device(
  p_pairing_code       text,
  p_device_identifier  text,
  p_platform           text,
  p_app_version        text
)
returns table (device_id uuid, device_token text, device_name text, tenant_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_cred   public.device_credentials;
  v_device public.devices;
  v_token  text;
  v_again  boolean;
begin
  if v_actor is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;
  select c.* into v_cred from public.device_credentials c
   where c.pairing_code_hash = pg_catalog.sha256(pg_catalog.convert_to(coalesce(private.normalize_pairing_code(p_pairing_code), ''), 'UTF8'))
     and c.pairing_expires_at > pg_catalog.now()
     for update;
  if not found or not private.has_tenant_role(v_cred.tenant_id, array['owner', 'admin', 'operator']) then
    raise exception 'Código de emparelhamento inválido ou expirado.' using errcode = 'P0002', hint = 'PAIRING_CODE_INVALID';
  end if;
  select d.* into v_device from public.devices d where d.id = v_cred.device_id for update;
  if not private.tenant_is_active(v_device.tenant_id) then
    raise exception 'A empresa está suspensa.' using errcode = '42501', hint = 'TENANT_SUSPENDED';
  end if;
  if v_device.status = 'DISABLED' then
    raise exception 'Este dispositivo foi desativado.' using errcode = '42501', hint = 'DEVICE_DISABLED';
  end if;
  if p_device_identifier is null or p_device_identifier !~ '^[A-Za-z0-9._:-]{4,128}$' then
    raise exception 'Identificador do dispositivo inválido.' using errcode = '22023', hint = 'INVALID_DEVICE_IDENTIFIER';
  end if;
  if p_platform is distinct from 'ANDROID' then
    raise exception 'Só Android pode ser worker.' using errcode = '22023', hint = 'INVALID_PLATFORM';
  end if;
  if p_app_version is null or p_app_version !~ '^[0-9A-Za-z.+_-]{1,32}$' then
    raise exception 'Versão da app inválida.' using errcode = '22023', hint = 'INVALID_APP_VERSION';
  end if;
  if exists (select 1 from public.devices d where d.tenant_id = v_device.tenant_id
                and d.device_identifier = p_device_identifier and d.id <> v_device.id) then
    raise exception 'Este telemóvel já está registado como outro dispositivo.' using errcode = '23505', hint = 'DEVICE_IDENTIFIER_TAKEN';
  end if;

  v_again := v_device.registered_at is not null;
  v_token := 'mbdt_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
                     || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  update public.devices d
     set device_identifier = p_device_identifier, platform = p_platform, app_version = p_app_version,
         status = 'ACTIVE', registered_at = coalesce(d.registered_at, pg_catalog.now()),
         registered_by = coalesce(d.registered_by, v_actor), last_seen_at = pg_catalog.now()
   where d.id = v_device.id
  returning * into v_device;
  update public.device_credentials c
     set pairing_code_hash = null, pairing_expires_at = null,
         token_hash = pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')),
         token_issued_at = pg_catalog.now(), updated_at = pg_catalog.now()
   where c.device_id = v_device.id;
  if v_again then
    -- Re-pairing (new phone / reinstall): the previous token no longer works.
    perform private.write_audit_log(v_actor, v_device.tenant_id, 'device.re_paired', 'device', v_device.id::text,
      pg_catalog.jsonb_build_object('app_version', v_device.app_version));
  end if;
  device_id := v_device.id;
  device_token := v_token;
  device_name := v_device.device_name;
  tenant_id := v_device.tenant_id;
  return next;
end;
$$;

-- Heartbeat: proves the device is alive (server clock), updates what it can do
-- and which SIMs it sees, then runs the dispatcher for its tenant.
--   p_sims: [{ "slot_index": 0, "fingerprint": "…" }, …] — NULL = SIM info not available.
create function private.device_heartbeat(
  p_device_id    uuid,
  p_device_token text,
  p_app_version  text default null,
  p_capabilities jsonb default null,
  p_telemetry    jsonb default null,
  p_sims         jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
  v_sim    public.device_sims;
  v_seen   jsonb;
  v_task   uuid;
begin
  v_device := private.authenticate_device(p_device_id, p_device_token, true);
  if p_app_version is not null and p_app_version !~ '^[0-9A-Za-z.+_-]{1,32}$' then
    raise exception 'Versão da app inválida.' using errcode = '22023', hint = 'INVALID_APP_VERSION';
  end if;
  if p_capabilities is not null and not private.device_capabilities_are_valid(p_capabilities) then
    raise exception 'Capacidades inválidas.' using errcode = '22023', hint = 'INVALID_CAPABILITIES';
  end if;
  if p_telemetry is not null and not private.device_telemetry_is_valid(p_telemetry) then
    raise exception 'Telemetria inválida.' using errcode = '22023', hint = 'INVALID_TELEMETRY';
  end if;
  if p_sims is not null and (pg_catalog.jsonb_typeof(p_sims) <> 'array' or pg_catalog.jsonb_array_length(p_sims) > 8
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_sims) as x(value)
                 where pg_catalog.jsonb_typeof(x.value) <> 'object'
                    or pg_catalog.jsonb_typeof(x.value -> 'slot_index') <> 'number'
                    or (x.value ->> 'slot_index')::numeric not in (0, 1, 2, 3, 4, 5, 6, 7)
                    or (x.value ? 'fingerprint' and pg_catalog.jsonb_typeof(x.value -> 'fingerprint') <> 'null'
                        and (x.value ->> 'fingerprint') !~ '^[A-Za-z0-9:_-]{8,128}$'))) then
    raise exception 'Lista de SIMs inválida.' using errcode = '22023', hint = 'INVALID_SIMS';
  end if;

  update public.devices d
     set last_seen_at = greatest(coalesce(d.last_seen_at, pg_catalog.now()), pg_catalog.now()),
         app_version = coalesce(p_app_version, d.app_version),
         capabilities = coalesce(p_capabilities, d.capabilities),
         telemetry = coalesce(p_telemetry, d.telemetry)
   where d.id = v_device.id;

  if p_sims is not null then
    for v_sim in select s.* from public.device_sims s where s.device_id = v_device.id and s.status <> 'DISABLED' for update
    loop
      select x.value into v_seen from pg_catalog.jsonb_array_elements(p_sims) as x(value)
       where (x.value ->> 'slot_index')::integer = v_sim.slot_index limit 1;
      if v_seen is null then
        if v_sim.status = 'ACTIVE' then
          update public.device_sims s set status = 'UNAVAILABLE', unavailable_reason = 'NOT_DETECTED' where s.id = v_sim.id;
        end if;
      elsif v_sim.sim_fingerprint is not null and v_seen ->> 'fingerprint' is not null
            and v_seen ->> 'fingerprint' <> v_sim.sim_fingerprint then
        -- A different SIM is now in this slot: never use it as the registered one.
        update public.device_sims s
           set status = 'UNAVAILABLE', unavailable_reason = 'SIM_CHANGED', last_seen_at = pg_catalog.now()
         where s.id = v_sim.id;
      else
        update public.device_sims s
           set last_seen_at = pg_catalog.now(),
               sim_fingerprint = coalesce(s.sim_fingerprint, v_seen ->> 'fingerprint'),
               status = case when s.unavailable_reason = 'NOT_DETECTED' then 'ACTIVE' else s.status end,
               unavailable_reason = case when s.unavailable_reason = 'NOT_DETECTED' then null else s.unavailable_reason end
         where s.id = v_sim.id;
      end if;
    end loop;
  end if;

  perform private.dispatch_activation_tasks(v_device.tenant_id, 20);
  select t.id into v_task from public.activation_tasks t
   where t.device_id = v_device.id and t.status in ('ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING') limit 1;
  return pg_catalog.jsonb_build_object(
    'device_id', v_device.id,
    'status', 'ACTIVE',
    'server_time', pg_catalog.now(),
    'heartbeat_timeout_seconds', private.automation_setting_seconds(v_device.tenant_id, 'heartbeat_timeout_seconds'),
    'task_id', v_task);
end;
$$;

-- The device's current task (after running the dispatcher), or NULL.
-- A task already EXECUTING / SUBMITTED is returned so a restarted worker can
-- report it — it must NEVER execute it again.
create function private.worker_fetch_task(p_device_id uuid, p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
  v_task   public.activation_tasks;
begin
  v_device := private.authenticate_device(p_device_id, p_device_token, true);
  update public.devices d set last_seen_at = pg_catalog.now() where d.id = v_device.id;
  perform private.dispatch_activation_tasks(v_device.tenant_id, 20);
  select t.* into v_task from public.activation_tasks t
   where t.device_id = v_device.id and t.status in ('ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING')
   limit 1;
  if v_task.id is null then
    return null;
  end if;
  return private.activation_payload(v_task);
end;
$$;

-- ASSIGNED → EXECUTING (compare-and-set: only this device, only once).
create function private.worker_start_task(p_device_id uuid, p_device_token text, p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
  v_task   public.activation_tasks;
begin
  v_device := private.authenticate_device(p_device_id, p_device_token, true);
  select t.* into v_task from public.activation_tasks t where t.id = p_task_id and t.device_id = v_device.id;
  if not found then
    raise exception 'Tarefa não encontrada.' using errcode = 'P0002', hint = 'TASK_NOT_FOUND';
  end if;
  perform 1 from public.orders o where o.id = v_task.order_id for update;
  update public.activation_tasks t
     set status = 'EXECUTING', started_at = pg_catalog.now(), attempt_count = t.attempt_count + 1
   where t.id = p_task_id and t.device_id = v_device.id and t.status = 'ASSIGNED'
  returning * into v_task;
  if not found then
    raise exception 'A tarefa não está atribuída a este dispositivo para execução.' using errcode = '55000', hint = 'TASK_NOT_ASSIGNED';
  end if;
  perform private.sync_order_with_activation(v_task.order_id, 'EXECUTING');
  return private.activation_payload(v_task);
end;
$$;

-- EXECUTING → SUBMITTED (MUST be called before sending the final confirmation)
-- and SUBMITTED → VERIFYING (waiting for the operator's confirmation).
create function private.worker_report_progress(p_device_id uuid, p_device_token text, p_task_id uuid, p_status text)
returns setof public.activation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
  v_task   public.activation_tasks;
begin
  -- Allowed while the tenant is suspended: it reports work already started.
  v_device := private.authenticate_device(p_device_id, p_device_token, false);
  if p_status is null or p_status not in ('SUBMITTED', 'VERIFYING') then
    raise exception 'Estado inválido.' using errcode = '22023', hint = 'INVALID_STATUS';
  end if;
  update public.activation_tasks t
     set status = p_status, submitted_at = case when p_status = 'SUBMITTED' then pg_catalog.now() else t.submitted_at end
   where t.id = p_task_id and t.device_id = v_device.id
     and t.status = case p_status when 'SUBMITTED' then 'EXECUTING' else 'SUBMITTED' end
  returning * into v_task;
  if not found then
    raise exception 'A tarefa não está neste passo neste dispositivo.' using errcode = '55000', hint = 'TASK_NOT_ASSIGNED';
  end if;
  return next v_task;
end;
$$;

-- Final report of an attempt. The worker's claim is checked:
--   • SUCCESS only if the operator's final screen matches the product's
--     success texts (and not its failure texts); otherwise FAILED / UNKNOWN.
--   • After SUBMITTED, a failure needs the failure texts; anything unproven is UNKNOWN.
--   • Before SUBMITTED (nothing confirmed on the network), a failure is safe:
--     retried automatically when the code is retryable and attempts remain.
--   • UNKNOWN is never retried.
create function private.worker_report_result(
  p_device_id         uuid,
  p_device_token      text,
  p_task_id           uuid,
  p_outcome           text,
  p_result_code       text,
  p_operator_response text default null,
  p_ussd_trace        text default null
)
returns setof public.activation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device    public.devices;
  v_task      public.activation_tasks;
  v_info      record;
  v_seen      text;
  v_outcome   text := p_outcome;
  v_code      text := p_result_code;
  v_attempt   public.activation_task_attempts;
  v_submitted boolean;
begin
  v_device := private.authenticate_device(p_device_id, p_device_token, false);
  select t.* into v_task from public.activation_tasks t where t.id = p_task_id and t.device_id = v_device.id;
  if not found then
    raise exception 'Tarefa não encontrada.' using errcode = 'P0002', hint = 'TASK_NOT_FOUND';
  end if;
  perform 1 from public.orders o where o.id = v_task.order_id for update;
  select t.* into v_task from public.activation_tasks t where t.id = p_task_id for update;
  if v_task.device_id is distinct from v_device.id
     or v_task.status not in ('ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING') then
    raise exception 'A tarefa já não está em execução neste dispositivo.' using errcode = '55000', hint = 'TASK_NOT_ASSIGNED';
  end if;
  if v_outcome is null or v_outcome not in ('SUCCESS', 'FAILED', 'UNKNOWN') then
    raise exception 'Resultado inválido.' using errcode = '22023', hint = 'INVALID_RESULT';
  end if;
  select * into v_info from private.activation_result_code_info(v_code);
  if v_info.outcomes is null or not v_info.worker or not (v_outcome = any (v_info.outcomes)) then
    raise exception 'Código de resultado inválido para %: %.', v_outcome, coalesce(v_code, '—') using errcode = '22023', hint = 'INVALID_RESULT';
  end if;
  if p_operator_response is not null and pg_catalog.char_length(p_operator_response) > 2000 then
    raise exception 'Resposta demasiado longa.' using errcode = '22023', hint = 'INVALID_RESULT';
  end if;
  if v_task.status = 'ASSIGNED' and v_outcome <> 'FAILED' then
    -- Nothing was started: only a preparation failure can be reported.
    raise exception 'A tarefa não foi iniciada.' using errcode = '55000', hint = 'TASK_NOT_ASSIGNED';
  end if;

  v_submitted := v_task.status in ('SUBMITTED', 'VERIFYING');
  v_seen := private.classify_ussd_response(v_task.ussd_flow, p_operator_response);
  if v_outcome = 'SUCCESS' then
    if v_seen = 'FAILED' then
      v_outcome := 'FAILED';
      v_code := 'USSD_REJECTED';
    elsif v_seen = 'UNKNOWN' then
      v_outcome := 'UNKNOWN';
      v_code := 'UNKNOWN_RESPONSE';
    end if;
  elsif v_outcome = 'FAILED' and (v_submitted or v_seen = 'SUCCESS') then
    if v_seen = 'SUCCESS' then
      v_outcome := 'UNKNOWN';      -- contradicts the screen
      v_code := 'UNKNOWN_RESPONSE';
    elsif v_seen = 'UNKNOWN' then
      v_outcome := 'UNKNOWN';      -- submitted, failure not proven
      v_code := case when v_code in ('TIMEOUT', 'NETWORK_ERROR') then v_code else 'UNKNOWN_RESPONSE' end;
    elsif v_code not in ('USSD_REJECTED', 'INVALID_DESTINATION', 'INSUFFICIENT_BALANCE') then
      v_code := 'USSD_REJECTED';
    end if;
  end if;

  if v_task.status = 'ASSIGNED' then
    -- A preparation failure still counts as an attempt (retries stay bounded).
    update public.activation_tasks t set attempt_count = t.attempt_count + 1 where t.id = v_task.id returning * into v_task;
  end if;
  v_attempt := private.record_activation_attempt(v_task, v_outcome, v_code, 'WORKER', p_operator_response, p_ussd_trace);

  update public.activation_tasks t
     set status = v_outcome,
         result_code = v_code,
         result_message = pg_catalog.left(nullif(pg_catalog.btrim(p_operator_response), ''), 500),
         failure_reason = case when v_outcome = 'FAILED' then v_code end,
         submitted_at = case when v_outcome = 'SUCCESS' then coalesce(t.submitted_at, pg_catalog.now()) else t.submitted_at end,
         completed_at = pg_catalog.now()
   where t.id = v_task.id
  returning * into v_task;

  if v_code = 'SIM_UNAVAILABLE' then
    update public.device_sims s set status = 'UNAVAILABLE', unavailable_reason = 'NOT_DETECTED'
     where s.id = v_attempt.sim_id and s.status = 'ACTIVE';
  end if;

  if v_outcome = 'FAILED' and v_attempt.retryable and v_task.attempt_count < v_task.max_attempts then
    update public.activation_tasks t set status = 'QUEUED' where t.id = v_task.id returning * into v_task;
    perform private.sync_order_with_activation(v_task.order_id, 'QUEUED');
  else
    perform private.sync_order_with_activation(v_task.order_id, v_outcome);
  end if;
  return next v_task;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Platform administration (explicit, permission-checked, read-only)
-- -----------------------------------------------------------------------------
create function private.platform_list_tenant_devices(p_tenant_id uuid)
returns setof public.devices
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_permission('tenants.read');
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  return query select d.* from public.devices d where d.tenant_id = p_tenant_id order by d.created_at;
end;
$$;

create function private.platform_list_tenant_activation_tasks(p_tenant_id uuid, p_limit integer default 100)
returns setof public.activation_tasks
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_permission('tenants.read');
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  return query
    select t.* from public.activation_tasks t
     where t.tenant_id = p_tenant_id
     order by t.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. API surface (public, SECURITY INVOKER wrappers)
-- -----------------------------------------------------------------------------
create function public.create_device(p_tenant_id uuid, p_device_name text)
returns table (device_id uuid, pairing_code text, pairing_expires_at timestamptz) language sql set search_path = ''
as $$ select * from private.create_device(p_tenant_id, p_device_name); $$;

create function public.create_device_pairing_code(p_device_id uuid)
returns table (device_id uuid, pairing_code text, pairing_expires_at timestamptz) language sql set search_path = ''
as $$ select * from private.create_device_pairing_code(p_device_id); $$;

create function public.update_device(p_device_id uuid, p_device_name text default null, p_status text default null)
returns setof public.devices language sql set search_path = ''
as $$ select * from private.update_device(p_device_id, p_device_name, p_status); $$;

create function public.register_device_sim(p_device_id uuid, p_slot_index integer, p_operator text, p_phone_number text default null)
returns setof public.device_sims language sql set search_path = ''
as $$ select * from private.register_device_sim(p_device_id, p_slot_index, p_operator, p_phone_number); $$;

create function public.update_device_sim(p_sim_id uuid, p_operator text default null, p_phone_number text default null, p_status text default null)
returns setof public.device_sims language sql set search_path = ''
as $$ select * from private.update_device_sim(p_sim_id, p_operator, p_phone_number, p_status); $$;

create function public.dispatch_activation_tasks(p_tenant_id uuid)
returns integer language sql set search_path = ''
as $$ select private.dispatch_activation_tasks_for(p_tenant_id); $$;

create function public.retry_activation_task(p_task_id uuid, p_note text default null)
returns setof public.activation_tasks language sql set search_path = ''
as $$ select * from private.retry_activation_task(p_task_id, p_note); $$;

create function public.resolve_activation_task(p_task_id uuid, p_outcome text, p_note text)
returns setof public.activation_tasks language sql set search_path = ''
as $$ select * from private.resolve_activation_task(p_task_id, p_outcome, p_note); $$;

create function public.register_device(p_pairing_code text, p_device_identifier text, p_platform text, p_app_version text)
returns table (device_id uuid, device_token text, device_name text, tenant_id uuid) language sql set search_path = ''
as $$ select * from private.register_device(p_pairing_code, p_device_identifier, p_platform, p_app_version); $$;

create function public.device_heartbeat(
  p_device_id uuid, p_device_token text, p_app_version text default null, p_capabilities jsonb default null,
  p_telemetry jsonb default null, p_sims jsonb default null)
returns jsonb language sql set search_path = ''
as $$ select private.device_heartbeat(p_device_id, p_device_token, p_app_version, p_capabilities, p_telemetry, p_sims); $$;

create function public.worker_fetch_task(p_device_id uuid, p_device_token text)
returns jsonb language sql set search_path = ''
as $$ select private.worker_fetch_task(p_device_id, p_device_token); $$;

create function public.worker_start_task(p_device_id uuid, p_device_token text, p_task_id uuid)
returns jsonb language sql set search_path = ''
as $$ select private.worker_start_task(p_device_id, p_device_token, p_task_id); $$;

create function public.worker_report_progress(p_device_id uuid, p_device_token text, p_task_id uuid, p_status text)
returns setof public.activation_tasks language sql set search_path = ''
as $$ select * from private.worker_report_progress(p_device_id, p_device_token, p_task_id, p_status); $$;

create function public.worker_report_result(
  p_device_id uuid, p_device_token text, p_task_id uuid, p_outcome text, p_result_code text,
  p_operator_response text default null, p_ussd_trace text default null)
returns setof public.activation_tasks language sql set search_path = ''
as $$
  select * from private.worker_report_result(p_device_id, p_device_token, p_task_id, p_outcome, p_result_code,
                                             p_operator_response, p_ussd_trace);
$$;

create function public.platform_list_tenant_devices(p_tenant_id uuid)
returns setof public.devices language sql stable set search_path = ''
as $$ select * from private.platform_list_tenant_devices(p_tenant_id); $$;

create function public.platform_list_tenant_activation_tasks(p_tenant_id uuid, p_limit integer default 100)
returns setof public.activation_tasks language sql stable set search_path = ''
as $$ select * from private.platform_list_tenant_activation_tasks(p_tenant_id, p_limit); $$;

-- -----------------------------------------------------------------------------
-- 13. Privileges
--     • anon: nothing.
--     • authenticated: SELECT only (RLS) on devices, SIMs, tasks and history;
--       device_credentials not at all. Every write is a command.
--     • service_role: no direct writes either (no forged heartbeat, assignment,
--       result or history); it may run the dispatcher for scheduled jobs.
-- -----------------------------------------------------------------------------
revoke all on table public.devices, public.device_credentials, public.device_sims, public.activation_tasks,
                    public.activation_task_attempts, public.activation_task_events
  from anon, authenticated;
grant select on table public.devices, public.device_sims, public.activation_tasks,
                      public.activation_task_attempts, public.activation_task_events
  to authenticated;
revoke all on table public.device_credentials from service_role;
revoke insert, update, delete, truncate on table public.devices, public.device_sims, public.activation_tasks,
                                                 public.activation_task_attempts, public.activation_task_events
  from service_role;

revoke all on function private.device_capabilities_are_valid(jsonb) from public;
revoke all on function private.sim_capabilities_are_valid(jsonb) from public;
revoke all on function private.device_telemetry_is_valid(jsonb) from public;
revoke all on function private.automation_setting_seconds(uuid, text) from public;
revoke all on function private.normalize_pairing_code(text) from public;
revoke all on function private.new_pairing_code() from public;
revoke all on function private.activation_result_code_info(text) from public;
revoke all on function private.classify_ussd_response(jsonb, text) from public;
revoke all on function private.activation_task_transition_allowed(text, text) from public;
revoke all on function private.devices_before_write() from public;
revoke all on function private.device_sims_before_write() from public;
revoke all on function private.activation_tasks_before_write() from public;
revoke all on function private.record_activation_task_event() from public;
revoke all on function private.prevent_activation_history_changes() from public;
revoke all on function private.audit_device_changes() from public;
revoke all on function private.audit_device_sim_changes() from public;
revoke all on function private.device_is_online(public.devices) from public;
revoke all on function private.sync_order_with_activation(uuid, text) from public;
revoke all on function private.create_activation_task(uuid) from public;
revoke all on function private.record_activation_attempt(public.activation_tasks, text, text, text, text, text, text, uuid) from public;
revoke all on function private.expire_stale_activation_tasks(uuid) from public;
revoke all on function private.dispatch_activation_tasks(uuid, integer) from public;
revoke all on function private.activation_payload(public.activation_tasks) from public;
revoke all on function private.authenticate_device(uuid, text, boolean) from public;
revoke all on function private.orders_create_activation_task() from public;
revoke all on function private.orders_require_activation_success() from public;
revoke all on function private.create_device(uuid, text) from public;
revoke all on function private.create_device_pairing_code(uuid) from public;
revoke all on function private.update_device(uuid, text, text) from public;
revoke all on function private.register_device_sim(uuid, integer, text, text) from public;
revoke all on function private.update_device_sim(uuid, text, text, text) from public;
revoke all on function private.dispatch_activation_tasks_for(uuid) from public;
revoke all on function private.retry_activation_task(uuid, text) from public;
revoke all on function private.resolve_activation_task(uuid, text, text) from public;
revoke all on function private.register_device(text, text, text, text) from public;
revoke all on function private.device_heartbeat(uuid, text, text, jsonb, jsonb, jsonb) from public;
revoke all on function private.worker_fetch_task(uuid, text) from public;
revoke all on function private.worker_start_task(uuid, text, uuid) from public;
revoke all on function private.worker_report_progress(uuid, text, uuid, text) from public;
revoke all on function private.worker_report_result(uuid, text, uuid, text, text, text, text) from public;
revoke all on function private.platform_list_tenant_devices(uuid) from public;
revoke all on function private.platform_list_tenant_activation_tasks(uuid, integer) from public;

-- CHECK constraints evaluated for any writer.
grant execute on function private.device_capabilities_are_valid(jsonb) to authenticated, service_role;
grant execute on function private.sim_capabilities_are_valid(jsonb) to authenticated, service_role;
grant execute on function private.device_telemetry_is_valid(jsonb) to authenticated, service_role;
-- Scheduled dispatcher runs (future cron / Edge Function).
grant execute on function private.dispatch_activation_tasks(uuid, integer) to service_role;
grant execute on function private.expire_stale_activation_tasks(uuid) to service_role;
-- Targets of the invoker wrappers.
grant execute on function private.create_device(uuid, text) to authenticated;
grant execute on function private.create_device_pairing_code(uuid) to authenticated;
grant execute on function private.update_device(uuid, text, text) to authenticated;
grant execute on function private.register_device_sim(uuid, integer, text, text) to authenticated;
grant execute on function private.update_device_sim(uuid, text, text, text) to authenticated;
grant execute on function private.dispatch_activation_tasks_for(uuid) to authenticated;
grant execute on function private.retry_activation_task(uuid, text) to authenticated;
grant execute on function private.resolve_activation_task(uuid, text, text) to authenticated;
grant execute on function private.register_device(text, text, text, text) to authenticated;
grant execute on function private.device_heartbeat(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function private.worker_fetch_task(uuid, text) to authenticated;
grant execute on function private.worker_start_task(uuid, text, uuid) to authenticated;
grant execute on function private.worker_report_progress(uuid, text, uuid, text) to authenticated;
grant execute on function private.worker_report_result(uuid, text, uuid, text, text, text, text) to authenticated;
grant execute on function private.platform_list_tenant_devices(uuid) to authenticated;
grant execute on function private.platform_list_tenant_activation_tasks(uuid, integer) to authenticated;

revoke all on function public.create_device(uuid, text) from public, anon;
revoke all on function public.create_device_pairing_code(uuid) from public, anon;
revoke all on function public.update_device(uuid, text, text) from public, anon;
revoke all on function public.register_device_sim(uuid, integer, text, text) from public, anon;
revoke all on function public.update_device_sim(uuid, text, text, text) from public, anon;
revoke all on function public.dispatch_activation_tasks(uuid) from public, anon;
revoke all on function public.retry_activation_task(uuid, text) from public, anon;
revoke all on function public.resolve_activation_task(uuid, text, text) from public, anon;
revoke all on function public.register_device(text, text, text, text) from public, anon;
revoke all on function public.device_heartbeat(uuid, text, text, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.worker_fetch_task(uuid, text) from public, anon;
revoke all on function public.worker_start_task(uuid, text, uuid) from public, anon;
revoke all on function public.worker_report_progress(uuid, text, uuid, text) from public, anon;
revoke all on function public.worker_report_result(uuid, text, uuid, text, text, text, text) from public, anon;
revoke all on function public.platform_list_tenant_devices(uuid) from public, anon;
revoke all on function public.platform_list_tenant_activation_tasks(uuid, integer) from public, anon;
grant execute on function public.create_device(uuid, text) to authenticated;
grant execute on function public.create_device_pairing_code(uuid) to authenticated;
grant execute on function public.update_device(uuid, text, text) to authenticated;
grant execute on function public.register_device_sim(uuid, integer, text, text) to authenticated;
grant execute on function public.update_device_sim(uuid, text, text, text) to authenticated;
grant execute on function public.dispatch_activation_tasks(uuid) to authenticated;
grant execute on function public.retry_activation_task(uuid, text) to authenticated;
grant execute on function public.resolve_activation_task(uuid, text, text) to authenticated;
grant execute on function public.register_device(text, text, text, text) to authenticated;
grant execute on function public.device_heartbeat(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.worker_fetch_task(uuid, text) to authenticated;
grant execute on function public.worker_start_task(uuid, text, uuid) to authenticated;
grant execute on function public.worker_report_progress(uuid, text, uuid, text) to authenticated;
grant execute on function public.worker_report_result(uuid, text, uuid, text, text, text, text) to authenticated;
grant execute on function public.platform_list_tenant_devices(uuid) to authenticated;
grant execute on function public.platform_list_tenant_activation_tasks(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 14. Row Level Security — SELECT only, members of the tenant.
-- -----------------------------------------------------------------------------
alter table public.devices                  enable row level security;
alter table public.device_credentials       enable row level security;
alter table public.device_sims              enable row level security;
alter table public.activation_tasks         enable row level security;
alter table public.activation_task_attempts enable row level security;
alter table public.activation_task_events   enable row level security;

create policy "devices_select_members"
  on public.devices for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy "device_sims_select_members"
  on public.device_sims for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy "activation_tasks_select_members"
  on public.activation_tasks for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy "activation_task_attempts_select_members"
  on public.activation_task_attempts for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy "activation_task_events_select_members"
  on public.activation_task_events for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
-- device_credentials: RLS on and no policy — invisible to the API.

commit;

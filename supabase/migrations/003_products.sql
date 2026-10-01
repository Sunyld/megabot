-- =============================================================================
-- MegaBot · 003_products.sql
--
-- Products sold by each tenant, each with its own configurable USSD flow.
--
-- • Requires 001_tenants.sql and 002_platform_admin.sql. Changes no object of
--   001/002 (adds new tables, functions, policies only).
-- • Additive only: pre-flight check aborts (changing nothing) on conflicts.
-- • Runs in a single transaction: all or nothing.
-- • Apply in Supabase → SQL Editor (runs as the `postgres` role).
--
-- Access model
--   read   : any member of the tenant (owner / admin / operator)
--   write  : tenant owner / admin, and only while the tenant is ACTIVE
--            (enforced by RLS — a suspended tenant cannot create or edit products)
--   delete : never through the API — products are archived (soft delete) so
--            future orders keep a valid reference
--   platform admins: read-only cross-tenant view through an RPC
--            (permission tenants.read); ordinary queries stay tenant-isolated.
--
-- USSD: every product carries its own flow (products.ussd_flow, JSONB). The
-- database only stores and validates it (schema version 1); executing USSD is
-- the job of the Android worker in a later phase.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Pre-flight: 001 and 002 must be applied and nothing from 003 may exist.
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
            ('public.audit_logs', pg_catalog.to_regclass('public.audit_logs')::oid),
            ('private.set_updated_at()', pg_catalog.to_regprocedure('private.set_updated_at()')::oid),
            ('private.user_tenant_ids()', pg_catalog.to_regprocedure('private.user_tenant_ids()')::oid),
            ('private.has_tenant_role(uuid, text[])', pg_catalog.to_regprocedure('private.has_tenant_role(uuid, text[])')::oid),
            ('private.write_audit_log(...)', pg_catalog.to_regprocedure('private.write_audit_log(uuid, uuid, text, text, text, jsonb)')::oid),
            ('private.require_platform_permission(text)', pg_catalog.to_regprocedure('private.require_platform_permission(text)')::oid)
         ) as x(name, found)
   where x.found is null;
  if v_missing is not null then
    raise exception 'Migration 003 abortada: falta % — aplique primeiro a 001 e a 002. Nada foi alterado.', v_missing;
  end if;

  if pg_catalog.to_regclass('public.products') is not null then
    raise exception 'Migration 003 abortada: já existe public.products. Nada foi alterado — reveja o schema antes de continuar.';
  end if;

  select string_agg(format('%I.%I()', n.nspname, p.proname), ', ')
    into v_conflicts
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where (n.nspname in ('public', 'private') and p.proname = 'platform_list_tenant_products')
      or (n.nspname = 'private' and p.proname in (
            'ussd_text_match_is_valid', 'ussd_flow_is_valid', 'tenant_is_active',
            'products_before_write', 'audit_product_changes'));
  if v_conflicts is not null then
    raise exception 'Migration 003 abortada: já existe a função %. Nada foi alterado.', v_conflicts;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. USSD flow validation (schema version 1)
--
--   {
--     "version": 1,
--     "start":   "*111#",                       -- USSD code that opens the session
--     "steps": [                                -- 1..30, executed in order
--       { "type": "select",  "value": "5" },                  -- menu option
--       { "type": "input",   "source": "destination_number" },-- value known at run time
--       { "type": "confirm", "value": "1" },                  -- value optional
--       { "type": "wait",    "ms": 2000 }                     -- 100..60000
--     ],
--     "success": { "contains": ["sucesso"] },   -- optional: final screen detection
--     "failure": { "contains": ["saldo insuficiente"] }
--   }
--
--   Any step (except wait) may carry "label" (≤ 80 chars, UI only) and
--   "expect": { "contains": [...] } — text the screen must show before the step.
--   input.source ∈ destination_number | amount_mb | amount_gb | price.
--   Unknown keys or step types are rejected. New capabilities (branches,
--   regex matching…) are added by a migration that extends this validator,
--   and "version" lets the executor tell old and new flows apart.
-- -----------------------------------------------------------------------------
create function private.ussd_text_match_is_valid(p_match jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if p_match is null or pg_catalog.jsonb_typeof(p_match) <> 'object' or (p_match - 'contains') <> '{}'::jsonb then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_match -> 'contains') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_match -> 'contains') not between 1 and 20 then
    return false;
  end if;
  for v_item in select e.value from pg_catalog.jsonb_array_elements(p_match -> 'contains') as e loop
    if pg_catalog.jsonb_typeof(v_item) <> 'string'
       or pg_catalog.char_length(pg_catalog.btrim(v_item #>> '{}')) not between 1 and 120 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create function private.ussd_flow_is_valid(p_flow jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_step jsonb;
  v_ms   numeric;
begin
  if p_flow is null or pg_catalog.jsonb_typeof(p_flow) <> 'object'
     or pg_catalog.octet_length(p_flow::text) > 16384
     or (p_flow - array['version', 'start', 'steps', 'success', 'failure']) <> '{}'::jsonb then
    return false;
  end if;
  if (p_flow -> 'version') is distinct from '1'::jsonb then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_flow -> 'start') is distinct from 'string'
     or (p_flow ->> 'start') !~ '^[*#][0-9][0-9*#]{0,37}#$' then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_flow -> 'steps') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_flow -> 'steps') not between 1 and 30 then
    return false;
  end if;
  if (p_flow ? 'success' and not private.ussd_text_match_is_valid(p_flow -> 'success'))
     or (p_flow ? 'failure' and not private.ussd_text_match_is_valid(p_flow -> 'failure')) then
    return false;
  end if;

  for v_step in select e.value from pg_catalog.jsonb_array_elements(p_flow -> 'steps') as e loop
    if pg_catalog.jsonb_typeof(v_step) <> 'object'
       or pg_catalog.jsonb_typeof(v_step -> 'type') is distinct from 'string' then
      return false;
    end if;
    if v_step ? 'label' and (pg_catalog.jsonb_typeof(v_step -> 'label') <> 'string'
                             or pg_catalog.char_length(v_step ->> 'label') > 80) then
      return false;
    end if;
    if v_step ? 'expect' and not private.ussd_text_match_is_valid(v_step -> 'expect') then
      return false;
    end if;

    case v_step ->> 'type'
      when 'select' then
        if (v_step - array['type', 'value', 'label', 'expect']) <> '{}'::jsonb
           or pg_catalog.jsonb_typeof(v_step -> 'value') is distinct from 'string'
           or (v_step ->> 'value') !~ '^[0-9*#]{1,10}$' then
          return false;
        end if;
      when 'input' then
        if (v_step - array['type', 'source', 'label', 'expect']) <> '{}'::jsonb
           or pg_catalog.jsonb_typeof(v_step -> 'source') is distinct from 'string'
           or (v_step ->> 'source') not in ('destination_number', 'amount_mb', 'amount_gb', 'price') then
          return false;
        end if;
      when 'confirm' then
        if (v_step - array['type', 'value', 'label', 'expect']) <> '{}'::jsonb
           or (v_step ? 'value' and (pg_catalog.jsonb_typeof(v_step -> 'value') <> 'string'
                                     or (v_step ->> 'value') !~ '^[0-9*#]{1,10}$')) then
          return false;
        end if;
      when 'wait' then
        if (v_step - array['type', 'ms', 'label']) <> '{}'::jsonb
           or pg_catalog.jsonb_typeof(v_step -> 'ms') is distinct from 'number' then
          return false;
        end if;
        v_ms := (v_step -> 'ms')::numeric;
        if v_ms <> pg_catalog.trunc(v_ms) or v_ms not between 100 and 60000 then
          return false;
        end if;
      else
        return false;
    end case;
  end loop;

  return true;
end;
$$;
comment on function private.ussd_flow_is_valid(jsonb) is
  'Validates a product USSD flow (schema version 1). Storage/validation only — execution happens on the Android worker.';

-- True while the tenant can operate (writes on tenant data require it).
create function private.tenant_is_active(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenants t where t.id = p_tenant_id and t.status = 'active'
  );
$$;
comment on function private.tenant_is_active(uuid) is 'True when the tenant is active (not suspended). Used by write policies.';

-- -----------------------------------------------------------------------------
-- 2. products
-- -----------------------------------------------------------------------------
create table public.products (
  id              uuid           primary key default gen_random_uuid(),
  tenant_id       uuid           not null references public.tenants (id) on delete cascade,
  name            text           not null,
  description     text,
  category        text           not null,
  -- Money: exact decimal in the currency's major unit (MZN 24.50), never float.
  price           numeric(12, 2) not null,
  -- Stored per product so historical prices stay unambiguous. Defaults to the
  -- tenant's currency (tenant_settings.currency) when omitted.
  currency        text           not null,
  -- NULL for unlimited plans.
  data_amount     numeric(10, 2),
  data_unit       text,
  validity_hours  integer        not null,
  -- Network the data package belongs to (where the USSD runs). The payment
  -- wallet (M-Pesa, e-Mola…) is a separate concept that belongs to orders.
  operator        text           not null,
  status          text           not null default 'INACTIVE',
  ussd_flow       jsonb,
  -- Soft delete: archived products are hidden and frozen, but kept for history.
  archived_at     timestamptz,
  created_at      timestamptz    not null default now(),
  updated_at      timestamptz    not null default now(),
  constraint products_name_length          check (char_length(btrim(name)) between 2 and 80),
  constraint products_description_length   check (description is null or char_length(description) <= 500),
  constraint products_category_valid       check (category in ('daily', 'weekly', 'monthly', 'unlimited')),
  constraint products_price_positive       check (price > 0),
  constraint products_currency_format      check (currency ~ '^[A-Z]{3}$'),
  constraint products_data_amount_positive check (data_amount is null or data_amount > 0),
  constraint products_data_unit_valid      check (data_unit is null or data_unit in ('MB', 'GB')),
  constraint products_data_amount_unit     check ((data_amount is null) = (data_unit is null)),
  constraint products_data_required        check (category = 'unlimited' or data_amount is not null),
  constraint products_validity_range       check (validity_hours between 1 and 8784),
  constraint products_operator_valid       check (operator in ('vodacom', 'movitel', 'tmcel')),
  constraint products_status_valid         check (status in ('ACTIVE', 'INACTIVE')),
  constraint products_ussd_flow_valid      check (ussd_flow is null or private.ussd_flow_is_valid(ussd_flow)),
  -- A product can only be sold if it can be delivered.
  constraint products_active_needs_flow    check (status <> 'ACTIVE' or ussd_flow is not null),
  constraint products_archived_inactive    check (archived_at is null or status = 'INACTIVE')
);
comment on table public.products is
  'Packages a tenant sells. Tenant-isolated by RLS; written by tenant owner/admin while the tenant is active; archived, never deleted.';
comment on column public.products.status is 'ACTIVE (on sale) | INACTIVE (hidden, cannot be sold). ACTIVE requires a USSD flow.';
comment on column public.products.ussd_flow is 'Per-product USSD flow, schema version 1 (see private.ussd_flow_is_valid).';

create index products_tenant_created_idx on public.products (tenant_id, created_at desc);
create index products_tenant_status_idx  on public.products (tenant_id, status) where archived_at is null;
-- One live product per name in a tenant (archived ones free the name).
create unique index products_tenant_name_key on public.products (tenant_id, lower(name)) where archived_at is null;

-- Normalizes input and protects history (applies to every role, service_role included).
create function private.products_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := pg_catalog.btrim(new.name);
  new.description := nullif(pg_catalog.btrim(new.description), '');

  if tg_op = 'INSERT' then
    if new.currency is null then
      select s.currency into new.currency from public.tenant_settings s where s.tenant_id = new.tenant_id;
    end if;
    new.archived_at := null;  -- products are created live
    return new;
  end if;

  if new.tenant_id <> old.tenant_id then
    raise exception 'Um produto não pode mudar de empresa.' using errcode = '42501';
  end if;
  if old.archived_at is not null then
    raise exception 'Produto arquivado não pode ser alterado.' using errcode = '55000';
  end if;
  if new.archived_at is not null then
    new.archived_at := pg_catalog.now();  -- server time, never the client's
    new.status := 'INACTIVE';
  end if;
  return new;
end;
$$;

create trigger products_before_write
  before insert or update on public.products
  for each row execute function private.products_before_write();
create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Audit: product.created / updated / activated / deactivated / archived
--    Metadata lists changed field names (never the flow body or other values
--    beyond name/status/price), so audit entries stay small and secret-free.
-- -----------------------------------------------------------------------------
create function private.audit_product_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
  v_action  text;
  v_meta    jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.write_audit_log((select auth.uid()), new.tenant_id, 'product.created', 'product', new.id::text,
      pg_catalog.jsonb_build_object(
        'name', new.name, 'status', new.status, 'operator', new.operator,
        'price', new.price, 'currency', new.currency, 'has_ussd_flow', new.ussd_flow is not null));
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform private.write_audit_log((select auth.uid()), old.tenant_id, 'product.deleted', 'product', old.id::text,
      pg_catalog.jsonb_build_object('name', old.name));
    return null;
  end if;

  select coalesce(pg_catalog.array_agg(n.key order by n.key), array[]::text[])
    into v_changed
    from pg_catalog.jsonb_each(pg_catalog.to_jsonb(new)) as n
    join pg_catalog.jsonb_each(pg_catalog.to_jsonb(old)) as o on o.key = n.key
   where n.value is distinct from o.value
     and n.key <> 'updated_at';
  if pg_catalog.cardinality(v_changed) = 0 then
    return null;
  end if;

  v_action := case
    when old.archived_at is null and new.archived_at is not null then 'product.archived'
    when new.status <> old.status and new.status = 'ACTIVE' then 'product.activated'
    when new.status <> old.status then 'product.deactivated'
    else 'product.updated'
  end;
  v_meta := pg_catalog.jsonb_build_object('name', new.name, 'changed', pg_catalog.to_jsonb(v_changed));
  if new.status <> old.status then
    v_meta := v_meta || pg_catalog.jsonb_build_object('previous_status', old.status, 'status', new.status);
  end if;

  perform private.write_audit_log((select auth.uid()), new.tenant_id, v_action, 'product', new.id::text, v_meta);
  return null;
end;
$$;

create trigger products_audit
  after insert or update or delete on public.products
  for each row execute function private.audit_product_changes();

-- -----------------------------------------------------------------------------
-- 4. Platform admins: read-only cross-tenant view (permission tenants.read)
-- -----------------------------------------------------------------------------
create function private.platform_list_tenant_products(p_tenant_id uuid)
returns setof public.products
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
    select p.*
      from public.products p
     where p.tenant_id = p_tenant_id
     order by p.archived_at nulls first, p.created_at desc;
end;
$$;

create function public.platform_list_tenant_products(p_tenant_id uuid)
returns setof public.products
language sql
stable
set search_path = ''
as $$
  select * from private.platform_list_tenant_products(p_tenant_id);
$$;
comment on function public.platform_list_tenant_products(uuid) is
  'Platform admins (tenants.read): every product of one tenant, archived included. Read-only.';

-- -----------------------------------------------------------------------------
-- 5. Privileges
--    • anon: nothing.
--    • authenticated: SELECT; INSERT/UPDATE only on whitelisted columns —
--      never id, tenant_id (on update), created_at/updated_at; no DELETE.
-- -----------------------------------------------------------------------------
revoke all on table public.products from anon, authenticated;
grant select on table public.products to authenticated;
grant insert (tenant_id, name, description, category, price, currency, data_amount, data_unit,
              validity_hours, operator, status, ussd_flow)
  on table public.products to authenticated;
grant update (name, description, category, price, currency, data_amount, data_unit,
              validity_hours, operator, status, ussd_flow, archived_at)
  on table public.products to authenticated;

revoke all on function private.ussd_text_match_is_valid(jsonb) from public;
revoke all on function private.ussd_flow_is_valid(jsonb) from public;
revoke all on function private.tenant_is_active(uuid) from public;
revoke all on function private.products_before_write() from public;
revoke all on function private.audit_product_changes() from public;
revoke all on function private.platform_list_tenant_products(uuid) from public;
-- CHECK constraints and policies run as the querying role.
grant execute on function private.ussd_text_match_is_valid(jsonb) to authenticated, service_role;
grant execute on function private.ussd_flow_is_valid(jsonb) to authenticated, service_role;
grant execute on function private.tenant_is_active(uuid) to authenticated, service_role;
grant execute on function private.platform_list_tenant_products(uuid) to authenticated;

revoke all on function public.platform_list_tenant_products(uuid) from public, anon;
grant execute on function public.platform_list_tenant_products(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.products enable row level security;

-- Every member (owner / admin / operator) reads its tenants' products.
create policy "products_select_members"
  on public.products for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));

-- Owner / admin of an ACTIVE tenant.
create policy "products_insert_owner_admin_active_tenant"
  on public.products for insert to authenticated
  with check (
    private.has_tenant_role(tenant_id, array['owner', 'admin'])
    and private.tenant_is_active(tenant_id)
  );

-- Members can target live products of their tenants (USING); the new row must
-- satisfy owner/admin + active tenant (WITH CHECK), so operators and suspended
-- tenants get an explicit permission error instead of a silent no-op.
create policy "products_update_owner_admin_active_tenant"
  on public.products for update to authenticated
  using (tenant_id in (select private.user_tenant_ids()) and archived_at is null)
  with check (
    private.has_tenant_role(tenant_id, array['owner', 'admin'])
    and private.tenant_is_active(tenant_id)
  );

commit;

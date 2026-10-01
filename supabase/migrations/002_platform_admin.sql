-- =============================================================================
-- MegaBot · 002_platform_admin.sql
--
-- Platform administration foundation: platform_admins, append-only audit_logs,
-- central authorization helpers, cross-tenant overview for platform staff and
-- tenant suspension / reactivation.
--
-- • Requires 001_tenants.sql. Changes NO object of 001: no policy, grant,
--   column or function of tenants / tenant_users / tenant_settings is touched.
-- • Additive only: pre-flight check aborts (changing nothing) on conflicts.
-- • Runs in a single transaction: all or nothing.
-- • Apply in Supabase → SQL Editor (runs as the `postgres` role).
--
-- Authorization model (authentication ≠ authorization)
--   auth.uid()                          → who is calling (Supabase Auth)
--   platform_admins (status ACTIVE)     → platform role → platform permissions
--   tenant_users (001)                  → tenant membership → tenant role
--
--   Platform access comes ONLY from a row in platform_admins — never from
--   tenant_users.role, email, user metadata or anything the client sends. The
--   API cannot write platform_admins; grants are made by the database owner and
--   every change is audited automatically.
--
-- Tenant isolation is unchanged: platform admins get no extra RLS on tenant
-- tables, so ordinary queries still return only their own memberships' data.
-- Cross-tenant reads happen only through the platform_* RPCs, which check the
-- caller's platform permission before reading anything.
--
-- SECURITY DEFINER functions live only in `private` (not exposed by the Data
-- API). The API surface is a few SECURITY INVOKER wrappers in `public`.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Pre-flight: 001 must be applied and nothing from 002 may exist yet.
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing   text;
  v_conflicts text;
begin
  select string_agg(x.name, ', ')
    into v_missing
    from (values ('public.tenants'), ('public.tenant_users'), ('public.tenant_settings')) as x(name)
   where pg_catalog.to_regclass(x.name) is null;
  if v_missing is null and pg_catalog.to_regprocedure('private.set_updated_at()') is null then
    v_missing := 'private.set_updated_at()';
  end if;
  if v_missing is not null then
    raise exception 'Migration 002 abortada: falta % — aplique primeiro a 001_tenants.sql. Nada foi alterado.', v_missing;
  end if;

  select string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    into v_conflicts
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where (n.nspname = 'public' and c.relname in ('platform_admins', 'audit_logs'))
      or (n.nspname = 'private' and c.relname = 'tenant_overview');
  if v_conflicts is not null then
    raise exception 'Migration 002 abortada: já existe %. Nada foi alterado — reveja o schema antes de continuar.', v_conflicts;
  end if;

  select string_agg(format('%I.%I()', n.nspname, p.proname), ', ')
    into v_conflicts
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where (n.nspname in ('public', 'private') and p.proname in (
            'platform_admin_context', 'platform_list_tenants', 'platform_get_tenant', 'platform_set_tenant_status'))
      or (n.nspname = 'private' and p.proname in (
            'platform_role_permissions', 'is_platform_admin', 'is_super_admin', 'has_platform_permission',
            'require_platform_permission', 'audit_metadata_is_safe', 'write_audit_log',
            'prevent_audit_log_changes', 'audit_platform_admin_changes'));
  if v_conflicts is not null then
    raise exception 'Migration 002 abortada: já existe a função %. Nada foi alterado.', v_conflicts;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. platform_admins — MegaBot staff. Not tenant users.
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  role        text        not null,
  status      text        not null default 'ACTIVE',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint platform_admins_user_id_key  unique (user_id),
  constraint platform_admins_role_valid   check (role in ('SUPER_ADMIN', 'SUPPORT_ADMIN')),
  constraint platform_admins_status_valid check (status in ('ACTIVE', 'SUSPENDED'))
);
comment on table public.platform_admins is
  'MegaBot platform staff. The ONLY source of platform access — never tenant_users.role. Not writable through the API.';
comment on column public.platform_admins.role is
  'SUPER_ADMIN | SUPPORT_ADMIN. New roles: a migration replacing platform_admins_role_valid and private.platform_role_permissions().';
comment on column public.platform_admins.status is
  'ACTIVE | SUSPENDED — a suspended admin keeps the row (history) but has no permissions.';

-- user_id lookups (RLS helpers) are covered by platform_admins_user_id_key.

create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. audit_logs — append-only trail of sensitive actions.
-- -----------------------------------------------------------------------------

-- Metadata guard (used by a CHECK constraint, so it also binds trusted
-- backends): a JSON object of at most 8 KB, with no key that looks like a
-- credential at any depth and no string value that looks like a JWT or a
-- Supabase secret key.
create function private.audit_metadata_is_safe(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_metadata) = 'object'
    and pg_catalog.octet_length(p_metadata::text) <= 8192
    and not exists (
      select 1
        from pg_catalog.jsonb_path_query(p_metadata, 'strict $.** ? (@.type() == "object")') as node(value)
       cross join lateral pg_catalog.jsonb_object_keys(node.value) as k(key)
       where pg_catalog.regexp_replace(pg_catalog.lower(k.key), '[^a-z0-9]', '', 'g')
             ~ '(password|passwd|secret|token|apikey|privatekey|authorization|cookie|jwt|credential|servicerole)'
    )
    and not pg_catalog.jsonb_path_exists(
      p_metadata,
      'strict $.** ? (@.type() == "string" && @ like_regex "^(eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}|sb_secret_)")'
    ),
    false);
$$;
comment on function private.audit_metadata_is_safe(jsonb) is
  'True when audit metadata is a small JSON object without credential-like keys or token-like values.';

create table public.audit_logs (
  id             uuid        primary key default gen_random_uuid(),
  -- NULL = system action (database owner in the SQL Editor, migrations, jobs).
  -- RESTRICT: a user with audit history cannot be hard-deleted (suspend/ban instead).
  actor_user_id  uuid        references auth.users (id) on delete restrict,
  -- No FK on purpose: the trail must outlive the tenant it describes.
  tenant_id      uuid,
  action         text        not null,
  resource_type  text        not null,
  resource_id    text,
  metadata       jsonb       not null default '{}'::jsonb,
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz not null default now(),
  constraint audit_logs_action_format        check (char_length(action) <= 100 and action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint audit_logs_resource_type_format check (char_length(resource_type) <= 64 and resource_type ~ '^[a-z][a-z0-9_]*$'),
  constraint audit_logs_resource_id_length   check (resource_id is null or char_length(resource_id) between 1 and 200),
  constraint audit_logs_user_agent_length    check (user_agent is null or char_length(user_agent) <= 512),
  constraint audit_logs_metadata_safe        check (private.audit_metadata_is_safe(metadata))
);
comment on table public.audit_logs is
  'Append-only audit trail (no UPDATE/DELETE/TRUNCATE for anyone). Written only by server-side functions; read by platform admins.';
comment on column public.audit_logs.action is 'Dotted verb, e.g. tenant.suspended, platform_admin.granted.';
comment on column public.audit_logs.ip_address is 'Best effort, from API gateway request headers. Informational — not a security control.';

create index audit_logs_actor_created_idx    on public.audit_logs (actor_user_id, created_at desc);
create index audit_logs_tenant_created_idx   on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_resource_created_idx on public.audit_logs (resource_type, resource_id, created_at desc);
create index audit_logs_action_created_idx   on public.audit_logs (action, created_at desc);
create index audit_logs_created_idx          on public.audit_logs (created_at desc);

-- Append-only, enforced for every role (including service_role and the owner).
create function private.prevent_audit_log_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs é append-only: % não é permitido.', tg_op using errcode = '42501';
end;
$$;

create trigger audit_logs_prevent_update_delete
  before update or delete on public.audit_logs
  for each row execute function private.prevent_audit_log_changes();
create trigger audit_logs_prevent_truncate
  before truncate on public.audit_logs
  for each statement execute function private.prevent_audit_log_changes();

-- The only writer used by this migration. Invoker rights and no grants: it is
-- reachable only from the SECURITY DEFINER functions below (as the owner).
-- IP / user agent come from the request headers PostgREST exposes, never from
-- arguments the client controls.
create function private.write_audit_log(
  p_actor_user_id uuid,
  p_tenant_id     uuid,
  p_action        text,
  p_resource_type text,
  p_resource_id   text,
  p_metadata      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_ip      inet;
  v_id      uuid;
begin
  begin
    v_headers := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb;
    v_ip := nullif(pg_catalog.btrim(pg_catalog.split_part(
              coalesce(v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip'),
              ',', 1)), '')::inet;
  exception when data_exception then
    v_ip := null;  -- malformed header: keep the log, drop the IP
  end;

  insert into public.audit_logs (actor_user_id, tenant_id, action, resource_type, resource_id, metadata, ip_address, user_agent)
  values (p_actor_user_id, p_tenant_id, p_action, p_resource_type, p_resource_id,
          coalesce(p_metadata, '{}'::jsonb), v_ip, pg_catalog.left(v_headers ->> 'user-agent', 512))
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Central authorization helpers
--
-- SECURITY DEFINER where they read platform_admins, so RLS policies can use
-- them without recursing into platform_admins' own policies. They only answer
-- yes/no, pin search_path and live in the non-exposed `private` schema.
-- -----------------------------------------------------------------------------

-- Permission matrix: the single source of truth for platform permissions. The
-- app receives it through public.platform_admin_context() and never derives it.
-- RLS mirrors it: audit_logs.read = any active admin (is_platform_admin),
-- platform_admins.read = super admin (is_super_admin).
create function private.platform_role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'SUPER_ADMIN'   then array['tenants.read', 'tenants.suspend', 'audit_logs.read', 'platform_admins.read']
    when 'SUPPORT_ADMIN' then array['tenants.read', 'tenants.suspend', 'audit_logs.read']
    else array[]::text[]
  end;
$$;

create function private.is_platform_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.platform_admins pa
     where pa.user_id = p_user_id
       and pa.status = 'ACTIVE'
  );
$$;
comment on function private.is_platform_admin(uuid) is 'True for an ACTIVE platform admin (any role). Used by RLS policies.';

create function private.is_super_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.platform_admins pa
     where pa.user_id = p_user_id
       and pa.status = 'ACTIVE'
       and pa.role = 'SUPER_ADMIN'
  );
$$;
comment on function private.is_super_admin(uuid) is 'True for an ACTIVE SUPER_ADMIN. Used by RLS policies.';

create function private.has_platform_permission(p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.platform_admins pa
     where pa.user_id = p_user_id
       and pa.status = 'ACTIVE'
       and p_permission = any (private.platform_role_permissions(pa.role))
  );
$$;
comment on function private.has_platform_permission(uuid, text) is 'True when an ACTIVE platform admin''s role grants the permission.';

-- Guard used by every platform RPC. Returns the caller (never a client argument).
create function private.require_platform_permission(p_permission text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or not private.has_platform_permission(v_user_id, p_permission) then
    raise exception 'Acesso reservado à administração da plataforma.' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

-- Every grant, role/status change or revocation of platform access is logged,
-- whatever the path (SQL Editor, service_role, future RPCs). Actor = auth.uid(),
-- NULL when the database owner acts directly.
create function private.audit_platform_admin_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action  text;
  v_user_id uuid;
  v_meta    jsonb;
begin
  if tg_op = 'INSERT' then
    v_action  := 'platform_admin.granted';
    v_user_id := new.user_id;
    v_meta    := pg_catalog.jsonb_build_object('role', new.role, 'status', new.status);
  elsif tg_op = 'DELETE' then
    v_action  := 'platform_admin.revoked';
    v_user_id := old.user_id;
    v_meta    := pg_catalog.jsonb_build_object('role', old.role, 'status', old.status);
  else
    if new.role = old.role and new.status = old.status and new.user_id = old.user_id then
      return null;  -- e.g. only updated_at changed
    end if;
    v_action := case
      when new.status <> old.status and new.status = 'SUSPENDED' then 'platform_admin.suspended'
      when new.status <> old.status then 'platform_admin.reactivated'
      when new.role <> old.role then 'platform_admin.role_changed'
      else 'platform_admin.updated'
    end;
    v_user_id := new.user_id;
    v_meta := pg_catalog.jsonb_build_object(
      'previous_role', old.role, 'role', new.role,
      'previous_status', old.status, 'status', new.status);
    if new.user_id <> old.user_id then
      v_meta := v_meta || pg_catalog.jsonb_build_object('previous_user_id', old.user_id);
    end if;
  end if;

  perform private.write_audit_log((select auth.uid()), null, v_action, 'platform_admin', v_user_id::text, v_meta);
  return null;
end;
$$;

create trigger platform_admins_audit
  after insert or update or delete on public.platform_admins
  for each row execute function private.audit_platform_admin_changes();

-- -----------------------------------------------------------------------------
-- 4. Cross-tenant overview (platform admins only, via the functions below)
-- -----------------------------------------------------------------------------

-- security_invoker: runs with the caller's rights, and nobody but the owner has
-- any grant on it — so it is only usable inside the definer functions below.
create view private.tenant_overview
with (security_invoker = true)
as
select t.id,
       t.name,
       t.slug,
       t.status,
       t.created_at,
       t.updated_at,
       s.currency,
       s.timezone,
       s.locale,
       m.member_count,
       m.owner_count,
       m.admin_count,
       m.operator_count
  from public.tenants t
  left join public.tenant_settings s on s.tenant_id = t.id
 cross join lateral (
   select count(*)::integer                                     as member_count,
          (count(*) filter (where tu.role = 'owner'))::integer    as owner_count,
          (count(*) filter (where tu.role = 'admin'))::integer    as admin_count,
          (count(*) filter (where tu.role = 'operator'))::integer as operator_count
     from public.tenant_users tu
    where tu.tenant_id = t.id
 ) as m;
comment on view private.tenant_overview is 'Tenant + settings + member counts per role. Internal to the platform_* functions.';

create function private.platform_list_tenants(
  p_status text    default null,
  p_search text    default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, name text, slug text, status text,
  created_at timestamptz, updated_at timestamptz,
  currency text, timezone text, locale text,
  member_count integer, owner_count integer, admin_count integer, operator_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search  text := nullif(pg_catalog.btrim(p_search), '');
  v_pattern text;
begin
  perform private.require_platform_permission('tenants.read');

  if p_status is not null and p_status not in ('active', 'suspended') then
    raise exception 'Estado de empresa inválido.' using errcode = '22023';
  end if;
  if v_search is not null then
    if pg_catalog.char_length(v_search) > 80 then
      raise exception 'A pesquisa deve ter no máximo 80 caracteres.' using errcode = '22023';
    end if;
    -- Literal match: escape LIKE wildcards typed by the user.
    v_pattern := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
                   v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
    select o.id, o.name, o.slug, o.status, o.created_at, o.updated_at,
           o.currency, o.timezone, o.locale,
           o.member_count, o.owner_count, o.admin_count, o.operator_count
      from private.tenant_overview o
     where (p_status is null or o.status = p_status)
       and (v_pattern is null or o.name ilike v_pattern or o.slug ilike v_pattern)
     order by o.created_at desc, o.id
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create function private.platform_get_tenant(p_tenant_id uuid)
returns table (
  id uuid, name text, slug text, status text,
  created_at timestamptz, updated_at timestamptz,
  currency text, timezone text, locale text,
  member_count integer, owner_count integer, admin_count integer, operator_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_permission('tenants.read');

  return query
    select o.id, o.name, o.slug, o.status, o.created_at, o.updated_at,
           o.currency, o.timezone, o.locale,
           o.member_count, o.owner_count, o.admin_count, o.operator_count
      from private.tenant_overview o
     where o.id = p_tenant_id;
  if not found then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

-- Suspension is a platform action: tenant users can never change tenants.status
-- (001 grants them UPDATE on `name` only). Locks the row, validates the
-- transition and writes the audit entry in the same transaction.
create function private.platform_set_tenant_status(
  p_tenant_id uuid,
  p_status    text,
  p_reason    text default null
)
returns table (
  id uuid, name text, slug text, status text,
  created_at timestamptz, updated_at timestamptz,
  currency text, timezone text, locale text,
  member_count integer, owner_count integer, admin_count integer, operator_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid;
  v_previous text;
  v_reason   text := nullif(pg_catalog.btrim(p_reason), '');
begin
  v_actor := private.require_platform_permission('tenants.suspend');

  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception 'Estado de empresa inválido.' using errcode = '22023';
  end if;
  if v_reason is not null and pg_catalog.char_length(v_reason) > 500 then
    raise exception 'O motivo deve ter no máximo 500 caracteres.' using errcode = '22023';
  end if;

  select t.status into v_previous
    from public.tenants t
   where t.id = p_tenant_id
     for update;
  if not found then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if v_previous = p_status then
    raise exception 'A empresa já está %.', case p_status when 'suspended' then 'suspensa' else 'ativa' end
      using errcode = '55000';
  end if;

  update public.tenants t set status = p_status where t.id = p_tenant_id;

  perform private.write_audit_log(
    v_actor,
    p_tenant_id,
    case p_status when 'suspended' then 'tenant.suspended' else 'tenant.reactivated' end,
    'tenant',
    p_tenant_id::text,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'previous_status', v_previous, 'status', p_status, 'reason', v_reason)));

  return query
    select o.id, o.name, o.slug, o.status, o.created_at, o.updated_at,
           o.currency, o.timezone, o.locale,
           o.member_count, o.owner_count, o.admin_count, o.operator_count
      from private.tenant_overview o
     where o.id = p_tenant_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. API surface (public, SECURITY INVOKER)
-- -----------------------------------------------------------------------------

-- The caller's own platform access (0 rows for non-admins). Reads only the
-- caller's row, allowed by RLS — no definer rights needed.
create function public.platform_admin_context()
returns table (role text, status text, permissions text[])
language sql
stable
set search_path = ''
as $$
  select pa.role,
         pa.status,
         case when pa.status = 'ACTIVE' then private.platform_role_permissions(pa.role) else array[]::text[] end
    from public.platform_admins pa
   where pa.user_id = (select auth.uid());
$$;
comment on function public.platform_admin_context() is 'Platform role, status and permissions of the caller. Empty for non-admins.';

create function public.platform_list_tenants(
  p_status text    default null,
  p_search text    default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, name text, slug text, status text,
  created_at timestamptz, updated_at timestamptz,
  currency text, timezone text, locale text,
  member_count integer, owner_count integer, admin_count integer, operator_count integer
)
language sql
stable
set search_path = ''
as $$
  select * from private.platform_list_tenants(p_status, p_search, p_limit, p_offset);
$$;
comment on function public.platform_list_tenants(text, text, integer, integer) is 'Platform admins (tenants.read): list tenants with member counts.';

create function public.platform_get_tenant(p_tenant_id uuid)
returns table (
  id uuid, name text, slug text, status text,
  created_at timestamptz, updated_at timestamptz,
  currency text, timezone text, locale text,
  member_count integer, owner_count integer, admin_count integer, operator_count integer
)
language sql
stable
set search_path = ''
as $$
  select * from private.platform_get_tenant(p_tenant_id);
$$;
comment on function public.platform_get_tenant(uuid) is 'Platform admins (tenants.read): one tenant with member counts.';

create function public.platform_set_tenant_status(p_tenant_id uuid, p_status text, p_reason text default null)
returns table (
  id uuid, name text, slug text, status text,
  created_at timestamptz, updated_at timestamptz,
  currency text, timezone text, locale text,
  member_count integer, owner_count integer, admin_count integer, operator_count integer
)
language sql
set search_path = ''
as $$
  select * from private.platform_set_tenant_status(p_tenant_id, p_status, p_reason);
$$;
comment on function public.platform_set_tenant_status(uuid, text, text) is
  'Platform admins (tenants.suspend): active ↔ suspended, audited as tenant.suspended / tenant.reactivated.';

-- -----------------------------------------------------------------------------
-- 6. Privileges
--    • anon: nothing.
--    • authenticated: SELECT (filtered by RLS) — never INSERT/UPDATE/DELETE on
--      platform_admins or audit_logs; EXECUTE on the public wrappers.
--    • service_role: may manage platform_admins (audited) and append audit
--      logs, but can never UPDATE/DELETE/TRUNCATE them.
--    • Functions: EXECUTE revoked from PUBLIC, then granted explicitly.
-- -----------------------------------------------------------------------------
revoke all on table public.platform_admins, public.audit_logs from anon, authenticated;
grant select on table public.platform_admins, public.audit_logs to authenticated;
revoke update, delete, truncate on table public.audit_logs from service_role;

revoke all on table private.tenant_overview from public, anon, authenticated, service_role;

-- Internal only (owner / definer context).
revoke all on function private.write_audit_log(uuid, uuid, text, text, text, jsonb) from public;
revoke all on function private.require_platform_permission(text) from public;
revoke all on function private.prevent_audit_log_changes() from public;
revoke all on function private.audit_platform_admin_changes() from public;

-- Evaluated as the querying role (RLS policies, CHECK constraint, invoker wrappers).
revoke all on function private.audit_metadata_is_safe(jsonb) from public;
revoke all on function private.platform_role_permissions(text) from public;
revoke all on function private.is_platform_admin(uuid) from public;
revoke all on function private.is_super_admin(uuid) from public;
revoke all on function private.has_platform_permission(uuid, text) from public;
revoke all on function private.platform_list_tenants(text, text, integer, integer) from public;
revoke all on function private.platform_get_tenant(uuid) from public;
revoke all on function private.platform_set_tenant_status(uuid, text, text) from public;
grant execute on function private.audit_metadata_is_safe(jsonb) to service_role;
grant execute on function private.platform_role_permissions(text) to authenticated, service_role;
grant execute on function private.is_platform_admin(uuid) to authenticated, service_role;
grant execute on function private.is_super_admin(uuid) to authenticated, service_role;
grant execute on function private.has_platform_permission(uuid, text) to authenticated, service_role;
grant execute on function private.platform_list_tenants(text, text, integer, integer) to authenticated;
grant execute on function private.platform_get_tenant(uuid) to authenticated;
grant execute on function private.platform_set_tenant_status(uuid, text, text) to authenticated;

revoke all on function public.platform_admin_context() from public, anon;
revoke all on function public.platform_list_tenants(text, text, integer, integer) from public, anon;
revoke all on function public.platform_get_tenant(uuid) from public, anon;
revoke all on function public.platform_set_tenant_status(uuid, text, text) from public, anon;
grant execute on function public.platform_admin_context() to authenticated;
grant execute on function public.platform_list_tenants(text, text, integer, integer) to authenticated;
grant execute on function public.platform_get_tenant(uuid) to authenticated;
grant execute on function public.platform_set_tenant_status(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Row Level Security — SELECT only. No INSERT/UPDATE/DELETE policy exists,
--    so those are denied to API roles even if a grant were added by mistake.
-- -----------------------------------------------------------------------------
alter table public.platform_admins enable row level security;
alter table public.audit_logs      enable row level security;

-- Own row (to know one's platform access) or, for super admins, every row.
create policy "platform_admins_select_self_or_super_admin"
  on public.platform_admins for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_super_admin((select auth.uid())))
  );

-- Any ACTIVE platform admin; nobody else (tenant users included).
create policy "audit_logs_select_platform_admins"
  on public.audit_logs for select to authenticated
  using ((select private.is_platform_admin((select auth.uid()))));

commit;

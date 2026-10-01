-- =============================================================================
-- MegaBot · 001_tenants.sql
--
-- Multi-tenant foundation: tenants, tenant_users, tenant_settings + RLS.
--
-- • Additive only: creates new objects, never drops/alters existing ones.
-- • Pre-flight check: aborts (changing nothing) if any object already exists.
-- • Runs in a single transaction: all or nothing.
-- • Apply in Supabase → SQL Editor (runs as the `postgres` role).
--
-- Security model
--   auth.uid()  →  tenant_users (membership)  →  tenant_id  →  row.tenant_id
--   The tenant is never taken from the client. Memberships can only be created
--   by the server-side functions below (sign-up trigger / create_tenant RPC).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Pre-flight: refuse to run over existing objects (nothing is changed).
-- -----------------------------------------------------------------------------
do $$
declare
  v_conflicts text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    into v_conflicts
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('tenants', 'tenant_users', 'tenant_settings');
  if v_conflicts is not null then
    raise exception 'Migration 001 abortada: já existe %. Nada foi alterado — reveja o schema antes de continuar.', v_conflicts;
  end if;

  select string_agg(format('%I.%I()', n.nspname, p.proname), ', ')
    into v_conflicts
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'public' and p.proname = 'create_tenant')
      or (n.nspname = 'private' and p.proname in (
            'set_updated_at', 'validate_tenant_settings', 'user_tenant_ids', 'has_tenant_role',
            'slugify', 'create_tenant_with_owner', 'handle_new_user'));
  if v_conflicts is not null then
    raise exception 'Migration 001 abortada: já existe a função %. Nada foi alterado.', v_conflicts;
  end if;

  if exists (select 1 from pg_catalog.pg_trigger where tgname = 'on_auth_user_created_create_tenant') then
    raise exception 'Migration 001 abortada: o trigger on_auth_user_created_create_tenant já existe. Nada foi alterado.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Private schema for RLS helpers (not exposed by the Data API, which only
--    serves the schemas listed in API settings — by default public/graphql_public).
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role, supabase_auth_admin;

-- Keeps updated_at current on every UPDATE.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
create table public.tenants (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null,
  status      text        not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tenants_slug_key       unique (slug),
  constraint tenants_name_length    check (char_length(btrim(name)) between 2 and 80),
  constraint tenants_slug_format    check (char_length(slug) <= 64 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint tenants_status_valid   check (status in ('active', 'suspended'))
);
comment on table public.tenants is 'A seller account (SaaS tenant). Every tenant-owned row references tenants.id.';
comment on column public.tenants.status is 'active | suspended — suspension is a platform action, not editable by tenant users.';

create table public.tenant_users (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  role        text        not null default 'operator',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tenant_users_tenant_user_key unique (tenant_id, user_id),
  constraint tenant_users_role_valid      check (role in ('owner', 'admin', 'operator'))
);
comment on table public.tenant_users is 'Membership of an auth user in a tenant. The source of truth for tenant isolation.';

-- RLS helpers look memberships up by user; (tenant_id, user_id) is covered by the unique key.
create index tenant_users_user_id_idx on public.tenant_users (user_id);

create table public.tenant_settings (
  tenant_id   uuid        primary key references public.tenants (id) on delete cascade,
  currency    text        not null default 'MZN',
  timezone    text        not null default 'Africa/Maputo',
  locale      text        not null default 'pt-MZ',
  payments    jsonb       not null default '{}'::jsonb,
  whatsapp    jsonb       not null default '{}'::jsonb,
  automation  jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tenant_settings_currency_format   check (currency ~ '^[A-Z]{3}$'),
  constraint tenant_settings_locale_format     check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint tenant_settings_sections_objects  check (
    jsonb_typeof(payments) = 'object'
    and jsonb_typeof(whatsapp) = 'object'
    and jsonb_typeof(automation) = 'object'
  )
);
comment on table public.tenant_settings is '1:1 tenant configuration. Typed columns for stable settings, JSON sections (payments/whatsapp/automation) that evolve with later phases.';

-- Timezones must be real IANA names (a CHECK cannot query the catalog).
create function private.validate_tenant_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger tenant_settings_validate
  before insert or update of timezone on public.tenant_settings
  for each row execute function private.validate_tenant_settings();

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function private.set_updated_at();
create trigger tenant_users_set_updated_at
  before update on public.tenant_users
  for each row execute function private.set_updated_at();
create trigger tenant_settings_set_updated_at
  before update on public.tenant_settings
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. RLS helper functions
--
-- SECURITY DEFINER is required: policies on tenant_users would otherwise recurse
-- into tenant_users' own policies. The functions only ever read the caller's own
-- memberships (auth.uid()), pin search_path, and live in the non-exposed
-- `private` schema, so they cannot be called through the Data API.
-- -----------------------------------------------------------------------------
create function private.user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tu.tenant_id
    from public.tenant_users tu
   where tu.user_id = (select auth.uid());
$$;
comment on function private.user_tenant_ids() is 'Tenants the current user belongs to. Used by RLS policies.';

create function private.has_tenant_role(p_tenant_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tenant_users tu
     where tu.tenant_id = p_tenant_id
       and tu.user_id = (select auth.uid())
       and tu.role = any (p_roles)
  );
$$;
comment on function private.has_tenant_role(uuid, text[]) is 'True when the current user has one of the roles in the tenant. Used by RLS policies.';

revoke all on function private.user_tenant_ids() from public;
revoke all on function private.has_tenant_role(uuid, text[]) from public;
grant execute on function private.user_tenant_ids() to authenticated, service_role;
grant execute on function private.has_tenant_role(uuid, text[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Tenant creation (server-side only)
-- -----------------------------------------------------------------------------

-- "Loja do Zé & Filhos" → "loja-do-ze-filhos"
create function private.slugify(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(
           pg_catalog.regexp_replace(
             pg_catalog.lower(
               pg_catalog.translate(
                 p_value,
                 'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                 'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN')),
             '[^a-z0-9]+', '-', 'g'),
           '-');
$$;

-- Creates a tenant, its owner membership and default settings, atomically.
-- Invoker rights: only reachable through the definer functions below.
create function private.create_tenant_with_owner(p_user_id uuid, p_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_name      text := pg_catalog.btrim(p_name);
  v_base      text;
  v_slug      text;
  v_tenant_id uuid;
begin
  if p_user_id is null then
    raise exception 'Utilizador obrigatório para criar a empresa' using errcode = '22004';
  end if;
  if v_name is null or pg_catalog.char_length(v_name) not between 2 and 80 then
    raise exception 'O nome da empresa deve ter entre 2 e 80 caracteres' using errcode = '22023';
  end if;

  v_base := pg_catalog.btrim(pg_catalog.left(private.slugify(v_name), 57), '-');
  if v_base = '' then
    v_base := 'loja';
  end if;

  -- Unique slug: add a short random suffix on collision (normally 0–1 iterations).
  v_slug := v_base;
  while exists (select 1 from public.tenants t where t.slug = v_slug) loop
    v_slug := v_base || '-' || pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 6);
  end loop;

  insert into public.tenants (name, slug) values (v_name, v_slug) returning id into v_tenant_id;
  insert into public.tenant_users (tenant_id, user_id, role) values (v_tenant_id, p_user_id, 'owner');
  insert into public.tenant_settings (tenant_id) values (v_tenant_id);

  return v_tenant_id;
end;
$$;
revoke all on function private.create_tenant_with_owner(uuid, text) from public;

-- Sign-up hook: when the app signs a user up with metadata `business_name`,
-- the tenant is created in the same transaction as the auth user.
-- Users created without business_name (e.g. future invitations) get no tenant.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_name text := nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'business_name'), '');
begin
  if v_business_name is not null then
    perform private.create_tenant_with_owner(new.id, v_business_name);
  end if;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;
grant execute on function private.handle_new_user() to supabase_auth_admin;

create trigger on_auth_user_created_create_tenant
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- RPC for signed-in users that have no tenant yet (e.g. accounts created before
-- this migration). SECURITY DEFINER because the caller is not yet a member and
-- RLS would block the inserts; the function itself enforces the rules:
-- authenticated caller only, validated name, idempotent (one owned tenant).
create function public.create_tenant(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id  uuid := (select auth.uid());
  v_existing uuid;
begin
  if v_user_id is null then
    raise exception 'Autenticação necessária' using errcode = '42501';
  end if;

  -- Serialize concurrent calls from the same user.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select tu.tenant_id
    into v_existing
    from public.tenant_users tu
   where tu.user_id = v_user_id
     and tu.role = 'owner'
   order by tu.created_at
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  return private.create_tenant_with_owner(v_user_id, p_name);
end;
$$;
comment on function public.create_tenant(text) is 'Creates the caller''s tenant (idempotent). SECURITY DEFINER: caller has no membership yet.';
revoke all on function public.create_tenant(text) from public, anon;
grant execute on function public.create_tenant(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Privileges (defence in depth on top of RLS)
--    • anon: no access at all.
--    • authenticated: read; update only whitelisted columns — never tenant_id,
--      status, slug or memberships. Inserts/deletes happen via functions only.
--    • service_role keeps full access for future trusted backends.
-- -----------------------------------------------------------------------------
revoke all on table public.tenants, public.tenant_users, public.tenant_settings from anon;
revoke all on table public.tenants, public.tenant_users, public.tenant_settings from authenticated;
grant select on table public.tenants, public.tenant_users, public.tenant_settings to authenticated;
grant update (name) on table public.tenants to authenticated;
grant update (currency, timezone, locale, payments, whatsapp, automation) on table public.tenant_settings to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.tenants         enable row level security;
alter table public.tenant_users    enable row level security;
alter table public.tenant_settings enable row level security;

create policy "tenants_select_members"
  on public.tenants for select to authenticated
  using (id in (select private.user_tenant_ids()));

create policy "tenants_update_owner_admin"
  on public.tenants for update to authenticated
  using (private.has_tenant_role(id, array['owner', 'admin']))
  with check (private.has_tenant_role(id, array['owner', 'admin']));

create policy "tenant_users_select_members"
  on public.tenant_users for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));

create policy "tenant_settings_select_members"
  on public.tenant_settings for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));

create policy "tenant_settings_update_owner_admin"
  on public.tenant_settings for update to authenticated
  using (private.has_tenant_role(tenant_id, array['owner', 'admin']))
  with check (private.has_tenant_role(tenant_id, array['owner', 'admin']));

commit;

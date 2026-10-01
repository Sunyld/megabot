-- =============================================================================
-- MegaBot · verification for 002_platform_admin.sql
--
-- Run in Supabase → SQL Editor AFTER applying 001 and 002.
-- Everything happens inside one transaction that is ROLLED BACK at the end:
-- no users, tenants, admins or audit entries are left behind.
--
-- Success: the last result shows "PASS — 002_platform_admin".
-- Failure: execution stops with an error message starting with "FAIL".
--
-- Test users (fixed UUIDs, removed by the rollback):
--   …2a1  SA  SUPER_ADMIN (ACTIVE), owner of tenant "PA Teste Alfa 002"
--   …2b1  NB  normal user, owner of tenant "PA Teste Beta 002"
--   …2b2  TA  tenant ADMIN of Beta (tenant role — must NOT be a platform admin)
--   …2c1  SU  SUPPORT_ADMIN (ACTIVE), no tenant
--   …2d1  SX  SUPER_ADMIN but SUSPENDED, no tenant
-- =============================================================================

begin;

-- 1. Structure and privileges ---------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('platform_admins', 'audit_logs')
     and c.relrowsecurity;
  if v_count <> 2 then
    raise exception 'FAIL 1.1: RLS ativo em % de 2 tabelas', v_count;
  end if;

  select count(*) into v_count from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in ('platform_admins', 'audit_logs');
  if v_count <> 2 then
    raise exception 'FAIL 1.2: esperadas 2 policies, encontradas %', v_count;
  end if;
  if exists (select 1 from pg_catalog.pg_policies
              where schemaname = 'public' and tablename in ('platform_admins', 'audit_logs') and cmd <> 'SELECT') then
    raise exception 'FAIL 1.3: existe policy de escrita em platform_admins/audit_logs';
  end if;
  if exists (select 1 from pg_catalog.pg_policies
              where schemaname = 'public'
                and tablename in ('platform_admins', 'audit_logs', 'tenants', 'tenant_users', 'tenant_settings')
                and (pg_catalog.btrim(coalesce(qual, '')) in ('true', '(true)')
                     or pg_catalog.btrim(coalesce(with_check, '')) in ('true', '(true)'))) then
    raise exception 'FAIL 1.4: existe uma policy permissiva using (true)';
  end if;

  -- 001 policies untouched (5) — platform admins get no extra RLS on tenant tables.
  select count(*) into v_count from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in ('tenants', 'tenant_users', 'tenant_settings');
  if v_count <> 5 then
    raise exception 'FAIL 1.5: policies das tabelas da 001 alteradas (% em vez de 5)', v_count;
  end if;

  -- SECURITY DEFINER only in the non-exposed schema, always with a pinned search_path.
  if exists (select 1 from pg_catalog.pg_proc p
               join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and p.proname in ('platform_admin_context', 'platform_list_tenants', 'platform_get_tenant', 'platform_set_tenant_status')) then
    raise exception 'FAIL 1.6: há funções SECURITY DEFINER da 002 no schema public';
  end if;
  select count(*) into v_count
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where ((n.nspname = 'public' and p.proname like 'platform\_%')
       or (n.nspname = 'private' and p.proname in (
             'platform_role_permissions', 'is_platform_admin', 'is_super_admin', 'has_platform_permission',
             'require_platform_permission', 'audit_metadata_is_safe', 'write_audit_log', 'prevent_audit_log_changes',
             'audit_platform_admin_changes', 'platform_list_tenants', 'platform_get_tenant', 'platform_set_tenant_status')))
     and not coalesce(p.proconfig @> array['search_path=""'], false);
  if v_count <> 0 then
    raise exception 'FAIL 1.7: % função(ões) da 002 sem search_path fixo', v_count;
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.platform_admins', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.audit_logs', 'SELECT') then
    raise exception 'FAIL 1.8: anon tem acesso de leitura';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.platform_admins', 'INSERT,UPDATE,DELETE')
     or pg_catalog.has_table_privilege('authenticated', 'public.audit_logs', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'FAIL 1.9: authenticated tem privilégios de escrita';
  end if;
  if pg_catalog.has_table_privilege('service_role', 'public.audit_logs', 'UPDATE,DELETE,TRUNCATE') then
    raise exception 'FAIL 1.10: service_role pode alterar/apagar audit_logs';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.platform_list_tenants(text, text, integer, integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.platform_set_tenant_status(uuid, text, text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.platform_admin_context()', 'EXECUTE') then
    raise exception 'FAIL 1.11: anon pode executar RPCs da plataforma';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'private.write_audit_log(uuid, uuid, text, text, text, jsonb)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'private.require_platform_permission(text)', 'EXECUTE') then
    raise exception 'FAIL 1.12: authenticated pode escrever audit logs diretamente';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'private.tenant_overview', 'SELECT') then
    raise exception 'FAIL 1.13: authenticated lê private.tenant_overview';
  end if;
end;
$$;

-- 2. Users, tenants and promotion -----------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pa-test-sa@megabot.test', '{}', '{"name": "Super", "business_name": "PA Teste Alfa 002"}', now(), now()),
  ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pa-test-nb@megabot.test', '{}', '{"name": "Normal", "business_name": "PA Teste Beta 002"}', now(), now()),
  -- Metadata cannot grant platform access: only platform_admins does.
  ('00000000-0000-4000-8000-0000000002b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pa-test-ta@megabot.test', '{"role": "SUPER_ADMIN"}', '{"name": "Tenant Admin", "platform_role": "SUPER_ADMIN"}', now(), now()),
  ('00000000-0000-4000-8000-0000000002c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pa-test-su@megabot.test', '{}', '{"name": "Suporte"}', now(), now()),
  ('00000000-0000-4000-8000-0000000002d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pa-test-sx@megabot.test', '{}', '{"name": "Suspenso"}', now(), now());

do $$
declare
  v_alfa uuid;
  v_beta uuid;
begin
  select tenant_id into v_alfa from public.tenant_users
   where user_id = '00000000-0000-4000-8000-0000000002a1' and role = 'owner';
  select tenant_id into v_beta from public.tenant_users
   where user_id = '00000000-0000-4000-8000-0000000002b1' and role = 'owner';
  if v_alfa is null or v_beta is null then
    raise exception 'FAIL 2.1: tenants de teste não foram criados pelo trigger da 001';
  end if;
  perform set_config('test.tenant_alfa', v_alfa::text, true);
  perform set_config('test.tenant_beta', v_beta::text, true);
end;
$$;

-- TA is a tenant ADMIN of Beta (tenant role, unrelated to platform access).
insert into public.tenant_users (tenant_id, user_id, role)
values (current_setting('test.tenant_beta')::uuid, '00000000-0000-4000-8000-0000000002b2', 'admin');

-- Promotion — done by the database owner, as in production.
insert into public.platform_admins (user_id, role) values
  ('00000000-0000-4000-8000-0000000002a1', 'SUPER_ADMIN'),
  ('00000000-0000-4000-8000-0000000002c1', 'SUPPORT_ADMIN');
insert into public.platform_admins (user_id, role, status) values
  ('00000000-0000-4000-8000-0000000002d1', 'SUPER_ADMIN', 'SUSPENDED');

do $$
declare
  v_sa uuid := '00000000-0000-4000-8000-0000000002a1';
  v_nb uuid := '00000000-0000-4000-8000-0000000002b1';
  v_ta uuid := '00000000-0000-4000-8000-0000000002b2';
  v_su uuid := '00000000-0000-4000-8000-0000000002c1';
  v_sx uuid := '00000000-0000-4000-8000-0000000002d1';
  v_count int;
begin
  select count(*) into v_count from public.audit_logs
   where action = 'platform_admin.granted' and resource_type = 'platform_admin'
     and resource_id in (v_sa::text, v_su::text, v_sx::text) and actor_user_id is null;
  if v_count <> 3 then
    raise exception 'FAIL 2.2: promoções não foram auditadas (% de 3)', v_count;
  end if;

  begin
    insert into public.platform_admins (user_id, role) values (v_nb, 'OWNER');
    raise exception 'FAIL 2.3: papel de plataforma inválido aceite';
  exception when check_violation then null;
  end;
  begin
    insert into public.platform_admins (user_id, role, status) values (v_nb, 'SUPPORT_ADMIN', 'DISABLED');
    raise exception 'FAIL 2.4: estado inválido aceite';
  exception when check_violation then null;
  end;
  begin
    insert into public.platform_admins (user_id, role) values (v_sa, 'SUPPORT_ADMIN');
    raise exception 'FAIL 2.5: o mesmo utilizador foi promovido duas vezes';
  exception when unique_violation then null;
  end;

  if not private.is_platform_admin(v_sa) or not private.is_super_admin(v_sa) then
    raise exception 'FAIL 2.6: SUPER_ADMIN ativo não reconhecido';
  end if;
  if not private.is_platform_admin(v_su) or private.is_super_admin(v_su) then
    raise exception 'FAIL 2.7: SUPPORT_ADMIN reconhecido incorretamente';
  end if;
  if private.is_platform_admin(v_sx) or private.is_super_admin(v_sx) then
    raise exception 'FAIL 2.8: admin SUSPENDED continua com acesso';
  end if;
  if private.is_platform_admin(v_nb) or private.is_platform_admin(v_ta) or private.is_platform_admin(null) then
    raise exception 'FAIL 2.9: utilizador normal / admin de tenant / null tratado como platform admin';
  end if;
  if not private.has_platform_permission(v_su, 'tenants.read')
     or private.has_platform_permission(v_su, 'platform_admins.read')
     or private.has_platform_permission(v_sx, 'tenants.read')
     or private.has_platform_permission(v_sa, 'unknown.permission') then
    raise exception 'FAIL 2.10: matriz de permissões incorreta';
  end if;
end;
$$;

-- 3. Normal user (NB, owner of Beta) ----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000002b1", "role": "authenticated"}', true);

do $$
declare
  v_alfa uuid := current_setting('test.tenant_alfa')::uuid;
  v_beta uuid := current_setting('test.tenant_beta')::uuid;
  v_count int;
begin
  select count(*) into v_count from public.platform_admins;
  if v_count <> 0 then
    raise exception 'FAIL 3.1: utilizador normal lista platform admins (%)', v_count;
  end if;
  select count(*) into v_count from public.audit_logs;
  if v_count <> 0 then
    raise exception 'FAIL 3.2: utilizador normal lê audit logs (%)', v_count;
  end if;
  select count(*) into v_count from public.platform_admin_context();
  if v_count <> 0 then
    raise exception 'FAIL 3.3: utilizador normal tem contexto de plataforma';
  end if;

  begin
    perform public.platform_list_tenants();
    raise exception 'FAIL 3.4: utilizador normal lista todos os tenants';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_get_tenant(v_alfa);
    raise exception 'FAIL 3.5: utilizador normal vê outro tenant via RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_set_tenant_status(v_alfa, 'suspended');
    raise exception 'FAIL 3.6: utilizador normal suspendeu um tenant';
  exception when insufficient_privilege then null;
  end;

  -- Self-promotion through the API is impossible.
  begin
    insert into public.platform_admins (user_id, role) values ((select auth.uid()), 'SUPER_ADMIN');
    raise exception 'FAIL 3.7: auto-promoção a platform admin';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.platform_admins set role = 'SUPER_ADMIN';
    raise exception 'FAIL 3.8: utilizador normal alterou platform_admins';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.platform_admins;
    raise exception 'FAIL 3.9: utilizador normal apagou platform_admins';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.audit_logs (actor_user_id, action, resource_type) values ((select auth.uid()), 'tenant.suspended', 'tenant');
    raise exception 'FAIL 3.10: utilizador normal escreveu um audit log';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.audit_logs set action = 'tenant.reactivated';
    raise exception 'FAIL 3.11: utilizador normal alterou audit logs';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_logs;
    raise exception 'FAIL 3.12: utilizador normal apagou audit logs';
  exception when insufficient_privilege then null;
  end;

  -- Tenant isolation (001) unchanged.
  select count(*) into v_count from public.tenants where id in (v_alfa, v_beta);
  if v_count <> 1 or not exists (select 1 from public.tenants where id = v_beta) then
    raise exception 'FAIL 3.13: isolamento entre tenants quebrado (vê % dos 2 tenants de teste)', v_count;
  end if;
end;
$$;

-- 4. Tenant ADMIN (TA) is not a platform admin -------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000002b2", "role": "authenticated"}', true);

do $$
declare
  v_beta uuid := current_setting('test.tenant_beta')::uuid;
  v_count int;
begin
  if not exists (select 1 from public.tenant_users where tenant_id = v_beta and user_id = (select auth.uid()) and role = 'admin') then
    raise exception 'FAIL 4.1: pré-condição — TA devia ser admin do tenant Beta';
  end if;
  select count(*) into v_count from public.platform_admin_context();
  if v_count <> 0 then
    raise exception 'FAIL 4.2: admin de tenant tratado como platform admin';
  end if;
  begin
    perform public.platform_list_tenants();
    raise exception 'FAIL 4.3: admin de tenant lista todos os tenants';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_set_tenant_status(v_beta, 'suspended');
    raise exception 'FAIL 4.4: admin de tenant mudou o estado do próprio tenant';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.platform_admins (user_id, role) values ((select auth.uid()), 'SUPER_ADMIN');
    raise exception 'FAIL 4.5: admin de tenant promoveu-se a platform admin';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_count from public.audit_logs;
  if v_count <> 0 then
    raise exception 'FAIL 4.6: admin de tenant lê audit logs';
  end if;
end;
$$;

-- 5. SUPER_ADMIN (SA) ----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000002a1", "role": "authenticated"}', true);

do $$
declare
  v_beta   uuid := current_setting('test.tenant_beta')::uuid;
  v_role   text;
  v_status text;
  v_perms  text[];
  v_count  int;
  v_row    record;
begin
  select c.role, c.status, c.permissions into v_role, v_status, v_perms from public.platform_admin_context() c;
  if v_role is distinct from 'SUPER_ADMIN' or v_status is distinct from 'ACTIVE'
     or not v_perms @> array['tenants.read', 'tenants.suspend', 'audit_logs.read', 'platform_admins.read'] then
    raise exception 'FAIL 5.1: contexto do SUPER_ADMIN incorreto (% / % / %)', v_role, v_status, v_perms;
  end if;

  select count(*) into v_count from public.platform_admins
   where user_id in ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000002c1', '00000000-0000-4000-8000-0000000002d1');
  if v_count <> 3 then
    raise exception 'FAIL 5.2: SUPER_ADMIN devia ver todos os platform admins (vê %)', v_count;
  end if;

  select * into v_row from public.platform_list_tenants(p_search => 'PA Teste Beta 002');
  if v_row.id is distinct from v_beta or v_row.status <> 'active' or v_row.member_count <> 2
     or v_row.owner_count <> 1 or v_row.admin_count <> 1 or v_row.operator_count <> 0 or v_row.currency <> 'MZN' then
    raise exception 'FAIL 5.3: listagem de tenants incorreta (%)', v_row;
  end if;
  select count(*) into v_count from public.platform_list_tenants(p_search => 'PA_Teste_Beta');
  if v_count <> 0 then
    raise exception 'FAIL 5.4: wildcards da pesquisa não foram escapados';
  end if;
  select count(*) into v_count from public.platform_list_tenants(p_limit => 1);
  if v_count > 1 then
    raise exception 'FAIL 5.5: limite de página ignorado';
  end if;
  begin
    perform public.platform_list_tenants(p_status => 'deleted');
    raise exception 'FAIL 5.6: filtro de estado inválido aceite';
  exception when invalid_parameter_value then null;
  end;

  select count(*) into v_count from public.platform_get_tenant(v_beta);
  if v_count <> 1 then
    raise exception 'FAIL 5.7: SUPER_ADMIN não vê o tenant via RPC';
  end if;
  begin
    perform public.platform_get_tenant('00000000-0000-4000-8000-00000000ffff');
    raise exception 'FAIL 5.8: tenant inexistente devolvido';
  exception when no_data_found then null;
  end;

  -- Platform access does not leak into ordinary queries (isolation preserved).
  select count(*) into v_count from public.tenants where id = v_beta;
  if v_count <> 0 then
    raise exception 'FAIL 5.9: platform admin vê outro tenant em queries normais';
  end if;
  select count(*) into v_count from public.tenant_settings where tenant_id = v_beta;
  if v_count <> 0 then
    raise exception 'FAIL 5.10: platform admin vê definições de outro tenant em queries normais';
  end if;

  -- ACTIVE → SUSPENDED, audited.
  select * into v_row from public.platform_set_tenant_status(v_beta, 'suspended', '  Teste automático  ');
  if v_row.status <> 'suspended' then
    raise exception 'FAIL 5.11: suspensão não aplicada';
  end if;
  if not exists (
    select 1 from public.audit_logs
     where action = 'tenant.suspended' and tenant_id = v_beta and resource_type = 'tenant' and resource_id = v_beta::text
       and actor_user_id = (select auth.uid())
       and metadata ->> 'previous_status' = 'active' and metadata ->> 'status' = 'suspended'
       and metadata ->> 'reason' = 'Teste automático') then
    raise exception 'FAIL 5.12: suspensão não auditada corretamente';
  end if;
  begin
    perform public.platform_set_tenant_status(v_beta, 'suspended');
    raise exception 'FAIL 5.13: suspensão repetida aceite';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.platform_set_tenant_status(v_beta, 'deleted');
    raise exception 'FAIL 5.14: estado inválido aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.platform_set_tenant_status(v_beta, 'active', pg_catalog.repeat('x', 501));
    raise exception 'FAIL 5.15: motivo demasiado longo aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.platform_set_tenant_status('00000000-0000-4000-8000-00000000ffff', 'suspended');
    raise exception 'FAIL 5.16: tenant inexistente suspenso';
  exception when no_data_found then null;
  end;

  -- Even a SUPER_ADMIN cannot manage admins or rewrite history through the API.
  begin
    update public.platform_admins set role = 'SUPPORT_ADMIN' where user_id = (select auth.uid());
    raise exception 'FAIL 5.17: platform admin alterou platform_admins pela API';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.platform_admins (user_id, role) values ('00000000-0000-4000-8000-0000000002b1', 'SUPER_ADMIN');
    raise exception 'FAIL 5.18: platform admin promoveu outro utilizador pela API';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.audit_logs set metadata = '{}' where tenant_id = v_beta;
    raise exception 'FAIL 5.19: platform admin alterou audit logs';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_logs where tenant_id = v_beta;
    raise exception 'FAIL 5.20: platform admin apagou audit logs';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 6. The suspended tenant's own owner sees the new status (app shows "Empresa suspensa").
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000002b1", "role": "authenticated"}', true);

do $$
begin
  if not exists (select 1 from public.tenants where id = current_setting('test.tenant_beta')::uuid and status = 'suspended') then
    raise exception 'FAIL 6.1: o owner não vê o tenant como suspenso';
  end if;
end;
$$;

-- 7. SUPPORT_ADMIN (SU) --------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000002c1", "role": "authenticated"}', true);

do $$
declare
  v_beta  uuid := current_setting('test.tenant_beta')::uuid;
  v_role  text;
  v_perms text[];
  v_count int;
  v_row   record;
begin
  select c.role, c.permissions into v_role, v_perms from public.platform_admin_context() c;
  if v_role is distinct from 'SUPPORT_ADMIN' or 'platform_admins.read' = any (v_perms)
     or not v_perms @> array['tenants.read', 'tenants.suspend', 'audit_logs.read'] then
    raise exception 'FAIL 7.1: contexto do SUPPORT_ADMIN incorreto (% / %)', v_role, v_perms;
  end if;

  select count(*) into v_count from public.platform_admins;
  if v_count <> 1 or not exists (select 1 from public.platform_admins where user_id = (select auth.uid())) then
    raise exception 'FAIL 7.2: SUPPORT_ADMIN devia ver apenas a própria linha (vê %)', v_count;
  end if;

  if not exists (select 1 from public.audit_logs where action = 'tenant.suspended' and tenant_id = v_beta) then
    raise exception 'FAIL 7.3: SUPPORT_ADMIN não lê audit logs';
  end if;
  select count(*) into v_count from public.platform_list_tenants(p_status => 'suspended', p_search => 'PA Teste Beta 002');
  if v_count <> 1 then
    raise exception 'FAIL 7.4: SUPPORT_ADMIN não lista tenants suspensos';
  end if;

  -- SUSPENDED → ACTIVE, audited.
  select * into v_row from public.platform_set_tenant_status(v_beta, 'active');
  if v_row.status <> 'active' then
    raise exception 'FAIL 7.5: reativação não aplicada';
  end if;
  if not exists (
    select 1 from public.audit_logs
     where action = 'tenant.reactivated' and tenant_id = v_beta and actor_user_id = (select auth.uid())
       and metadata ->> 'previous_status' = 'suspended' and not metadata ? 'reason') then
    raise exception 'FAIL 7.6: reativação não auditada corretamente';
  end if;
  begin
    perform public.platform_set_tenant_status(v_beta, 'active');
    raise exception 'FAIL 7.7: reativação repetida aceite';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;

-- 8. SUSPENDED platform admin (SX) ----------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000002d1", "role": "authenticated"}', true);

do $$
declare
  v_status text;
  v_perms  text[];
  v_count  int;
begin
  select c.status, c.permissions into v_status, v_perms from public.platform_admin_context() c;
  if v_status is distinct from 'SUSPENDED' or cardinality(v_perms) <> 0 then
    raise exception 'FAIL 8.1: admin suspenso mantém permissões (% / %)', v_status, v_perms;
  end if;
  select count(*) into v_count from public.platform_admins;
  if v_count <> 1 then
    raise exception 'FAIL 8.2: admin suspenso lista platform admins (%)', v_count;
  end if;
  select count(*) into v_count from public.audit_logs;
  if v_count <> 0 then
    raise exception 'FAIL 8.3: admin suspenso lê audit logs';
  end if;
  begin
    perform public.platform_list_tenants();
    raise exception 'FAIL 8.4: admin suspenso lista tenants';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_set_tenant_status(current_setting('test.tenant_beta')::uuid, 'suspended');
    raise exception 'FAIL 8.5: admin suspenso suspendeu um tenant';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 9. Audit log integrity and admin lifecycle (database owner, no JWT) ------------------
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  v_sa uuid := '00000000-0000-4000-8000-0000000002a1';
  v_su uuid := '00000000-0000-4000-8000-0000000002c1';
  v_sx uuid := '00000000-0000-4000-8000-0000000002d1';
  v_id uuid;
  v_count int;
begin
  -- Nullable tenant + structured JSONB metadata.
  v_id := private.write_audit_log(null, null, 'test.system_event', 'test', null,
                                  '{"source": "002 test", "nested": {"count": 2, "tags": ["a", "b"]}}');
  if not exists (select 1 from public.audit_logs
                  where id = v_id and tenant_id is null and actor_user_id is null and resource_id is null
                    and metadata -> 'nested' ->> 'count' = '2' and metadata #>> '{nested,tags,1}' = 'b') then
    raise exception 'FAIL 9.1: audit log sem tenant / metadata JSONB não gravado';
  end if;

  -- Metadata must never carry credentials.
  begin
    perform private.write_audit_log(v_sa, null, 'test.secret', 'test', null, '{"password": "x"}');
    raise exception 'FAIL 9.2: metadata com password aceite';
  exception when check_violation then null;
  end;
  begin
    perform private.write_audit_log(v_sa, null, 'test.secret', 'test', null, '{"request": {"headers": [{"Api-Key": "x"}]}}');
    raise exception 'FAIL 9.3: metadata com api key aninhada aceite';
  exception when check_violation then null;
  end;
  begin
    perform private.write_audit_log(v_sa, null, 'test.secret', 'test', null, '{"note": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig"}');
    raise exception 'FAIL 9.4: metadata com JWT aceite';
  exception when check_violation then null;
  end;
  begin
    perform private.write_audit_log(v_sa, null, 'test.secret', 'test', null, '["not", "an", "object"]');
    raise exception 'FAIL 9.5: metadata que não é objeto aceite';
  exception when check_violation then null;
  end;
  begin
    perform private.write_audit_log(v_sa, null, 'Tenant Suspended', 'test', null, '{}');
    raise exception 'FAIL 9.6: action com formato inválido aceite';
  exception when check_violation then null;
  end;

  -- Append-only for everyone, the owner included.
  begin
    update public.audit_logs set action = 'test.tampered' where id = v_id;
    raise exception 'FAIL 9.7: UPDATE em audit_logs permitido';
  exception when insufficient_privilege then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    delete from public.audit_logs where id = v_id;
    raise exception 'FAIL 9.8: DELETE em audit_logs permitido';
  exception when insufficient_privilege then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    truncate public.audit_logs;
    raise exception 'FAIL 9.9: TRUNCATE em audit_logs permitido';
  exception when insufficient_privilege then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;

  -- Audit history survives: an actor with entries cannot be hard-deleted.
  begin
    delete from auth.users where id = v_sa;
    raise exception 'FAIL 9.10: utilizador com histórico de auditoria foi apagado';
  exception
    when restrict_violation or foreign_key_violation then null;
    when insufficient_privilege then
      raise notice 'SKIP 9.10: sem permissão para apagar auth.users neste ambiente';
  end;

  -- Admin lifecycle is audited whatever the path.
  update public.platform_admins set status = 'SUSPENDED' where user_id = v_su;
  update public.platform_admins set status = 'ACTIVE' where user_id = v_sx;
  update public.platform_admins set role = 'SUPPORT_ADMIN' where user_id = v_sx;
  update public.platform_admins set updated_at = now() where user_id = v_sa;  -- no audit entry
  delete from public.platform_admins where user_id = v_sx;

  select count(*) into v_count from public.audit_logs
   where resource_type = 'platform_admin'
     and ((action = 'platform_admin.suspended'    and resource_id = v_su::text and metadata ->> 'previous_status' = 'ACTIVE')
       or (action = 'platform_admin.reactivated'  and resource_id = v_sx::text)
       or (action = 'platform_admin.role_changed' and resource_id = v_sx::text and metadata ->> 'previous_role' = 'SUPER_ADMIN')
       or (action = 'platform_admin.revoked'      and resource_id = v_sx::text));
  if v_count <> 4 then
    raise exception 'FAIL 9.11: ciclo de vida dos platform admins não auditado (% de 4)', v_count;
  end if;
  if exists (select 1 from public.audit_logs where resource_id = v_sa::text and action <> 'platform_admin.granted') then
    raise exception 'FAIL 9.12: alteração sem efeito (updated_at) foi auditada';
  end if;
  if private.is_platform_admin(v_su) then
    raise exception 'FAIL 9.13: admin suspenso continua ativo';
  end if;
end;
$$;

-- 10. Anonymous --------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

do $$
begin
  begin
    perform 1 from public.platform_admins;
    raise exception 'FAIL 10.1: anon lê platform_admins';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.audit_logs;
    raise exception 'FAIL 10.2: anon lê audit_logs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_context();
    raise exception 'FAIL 10.3: anon executa platform_admin_context';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_list_tenants();
    raise exception 'FAIL 10.4: anon lista tenants';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_set_tenant_status('00000000-0000-4000-8000-00000000ffff', 'suspended');
    raise exception 'FAIL 10.5: anon muda o estado de tenants';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;

select 'PASS — 002_platform_admin: estrutura, privilégios, promoção, SUPER/SUPPORT/SUSPENDED, utilizador normal, admin de tenant, isolamento, suspensão/reativação auditadas, audit append-only e anon verificados (transação revertida)' as resultado;

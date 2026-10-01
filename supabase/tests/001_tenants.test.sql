-- =============================================================================
-- MegaBot · verification for 001_tenants.sql
--
-- Run in Supabase → SQL Editor AFTER applying the migration.
-- Everything happens inside one transaction that is ROLLED BACK at the end:
-- no users, tenants or settings are left behind.
--
-- Success: the last result shows "PASS — 001_tenants".
-- Failure: execution stops with an error message starting with "FAIL".
-- =============================================================================

begin;

-- 1. Structure --------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('tenants', 'tenant_users', 'tenant_settings')
     and c.relrowsecurity;
  if v_count <> 3 then
    raise exception 'FAIL 1.1: RLS ativo em % de 3 tabelas', v_count;
  end if;

  select count(*) into v_count from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in ('tenants', 'tenant_users', 'tenant_settings');
  if v_count <> 5 then
    raise exception 'FAIL 1.2: esperadas 5 policies, encontradas %', v_count;
  end if;

  if not exists (select 1 from pg_catalog.pg_trigger where tgname = 'on_auth_user_created_create_tenant') then
    raise exception 'FAIL 1.3: trigger de criação de tenant em auth.users não existe';
  end if;
end;
$$;

-- 2. Sign-up trigger ---------------------------------------------------------
-- A and B sign up with a business name; C signs up without one.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-test-a@megabot.test', '{}', '{"name": "Teste A", "business_name": "Loja Teste Ção"}', now(), now()),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-test-b@megabot.test', '{}', '{"name": "Teste B", "business_name": "Loja Teste Ção"}', now(), now()),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-test-c@megabot.test', '{}', '{"name": "Teste C"}', now(), now());

do $$
declare
  v_a uuid;
  v_b uuid;
  v_slug_a text;
  v_slug_b text;
begin
  select tenant_id into v_a from public.tenant_users
   where user_id = '00000000-0000-4000-8000-00000000000a' and role = 'owner';
  select tenant_id into v_b from public.tenant_users
   where user_id = '00000000-0000-4000-8000-00000000000b' and role = 'owner';
  if v_a is null or v_b is null then
    raise exception 'FAIL 2.1: o trigger não criou tenant + owner no registo';
  end if;
  if not exists (select 1 from public.tenant_settings where tenant_id = v_a and currency = 'MZN') then
    raise exception 'FAIL 2.2: tenant_settings por omissão não foram criadas';
  end if;
  if exists (select 1 from public.tenant_users where user_id = '00000000-0000-4000-8000-00000000000c') then
    raise exception 'FAIL 2.3: utilizador sem business_name não devia ter tenant';
  end if;

  select slug into v_slug_a from public.tenants where id = v_a;
  select slug into v_slug_b from public.tenants where id = v_b;
  if v_slug_a <> 'loja-teste-cao' or v_slug_b = v_slug_a then
    raise exception 'FAIL 2.4: slugs inesperados (% / %)', v_slug_a, v_slug_b;
  end if;

  perform set_config('test.tenant_a', v_a::text, true);
  perform set_config('test.tenant_b', v_b::text, true);
end;
$$;

-- C joins tenant A as operator (simulates a future invitation, done as postgres).
insert into public.tenant_users (tenant_id, user_id, role)
values (current_setting('test.tenant_a')::uuid, '00000000-0000-4000-8000-00000000000c', 'operator');

-- 3. As owner A ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);

do $$
declare
  v_a uuid := current_setting('test.tenant_a')::uuid;
  v_b uuid := current_setting('test.tenant_b')::uuid;
  v_count int;
begin
  select count(*) into v_count from public.tenants;
  if v_count <> 1 or not exists (select 1 from public.tenants where id = v_a) then
    raise exception 'FAIL 3.1: A deve ver apenas o seu tenant (vê %)', v_count;
  end if;
  select count(*) into v_count from public.tenant_users where tenant_id = v_b;
  if v_count <> 0 then
    raise exception 'FAIL 3.2: A vê membros do tenant B';
  end if;
  select count(*) into v_count from public.tenant_users where tenant_id = v_a;
  if v_count <> 2 then
    raise exception 'FAIL 3.3: A deve ver os 2 membros do seu tenant (vê %)', v_count;
  end if;
  select count(*) into v_count from public.tenant_settings where tenant_id = v_b;
  if v_count <> 0 then
    raise exception 'FAIL 3.4: A vê as definições do tenant B';
  end if;

  update public.tenants set name = 'Invasão' where id = v_b;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL 3.5: A alterou o tenant B';
  end if;

  update public.tenants set name = 'Loja A Renomeada' where id = v_a;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'FAIL 3.6: o owner não conseguiu renomear o seu tenant';
  end if;

  begin
    update public.tenants set status = 'suspended' where id = v_a;
    raise exception 'FAIL 3.7: A conseguiu alterar o status do tenant';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.tenant_settings set tenant_id = v_b where tenant_id = v_a;
    raise exception 'FAIL 3.8: A conseguiu mover as definições para outro tenant';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.tenant_users (tenant_id, user_id, role)
    values (v_b, '00000000-0000-4000-8000-00000000000a', 'owner');
    raise exception 'FAIL 3.9: A conseguiu associar-se ao tenant B';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.tenant_users set role = 'owner'
     where user_id = '00000000-0000-4000-8000-00000000000c';
    raise exception 'FAIL 3.10: A conseguiu alterar papéis diretamente';
  exception when insufficient_privilege then null;
  end;

  update public.tenant_settings set timezone = 'Africa/Johannesburg' where tenant_id = v_a;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'FAIL 3.11: o owner não conseguiu alterar as definições';
  end if;

  begin
    update public.tenant_settings set timezone = 'Marte/Olimpo' where tenant_id = v_a;
    raise exception 'FAIL 3.12: fuso horário inválido foi aceite';
  exception when invalid_parameter_value then null;
  end;

  if public.create_tenant('Outra Loja') <> v_a then
    raise exception 'FAIL 3.13: create_tenant não é idempotente para quem já é owner';
  end if;
end;
$$;

-- 4. As operator C (member of A) -----------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}', true);

do $$
declare
  v_a uuid := current_setting('test.tenant_a')::uuid;
  v_count int;
begin
  select count(*) into v_count from public.tenants;
  if v_count <> 1 then
    raise exception 'FAIL 4.1: o operador deve ver apenas o tenant A (vê %)', v_count;
  end if;

  update public.tenant_settings set locale = 'en-US' where tenant_id = v_a;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL 4.2: o operador conseguiu alterar as definições';
  end if;

  update public.tenants set name = 'Operador' where id = v_a;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL 4.3: o operador conseguiu renomear o tenant';
  end if;
end;
$$;

-- 5. Anonymous -------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

do $$
begin
  begin
    perform 1 from public.tenants;
    raise exception 'FAIL 5.1: anon consegue ler tenants';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_tenant('Anon');
    raise exception 'FAIL 5.2: anon consegue chamar create_tenant';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;

select 'PASS — 001_tenants: estrutura, trigger de registo, isolamento entre tenants, papéis e anon verificados (transação revertida)' as resultado;

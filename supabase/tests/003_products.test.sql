-- =============================================================================
-- MegaBot · verification for 003_products.sql
--
-- Run in Supabase → SQL Editor AFTER applying 001, 002 and 003.
-- Everything happens inside one transaction that is ROLLED BACK at the end:
-- no users, tenants, products or audit entries are left behind.
--
-- Success: the last result shows "PASS — 003_products".
-- Failure: execution stops with an error message starting with "FAIL".
--
-- Test users (fixed UUIDs, removed by the rollback):
--   …3a1  OA  owner of tenant "PR Teste Alfa 003"
--   …3a2  AA  admin of Alfa
--   …3a3  OP  operator of Alfa
--   …3b1  OB  owner of tenant "PR Teste Beta 003"
--   …3c1  PA  platform SUPER_ADMIN, no tenant
-- =============================================================================

begin;

-- 1. Structure and privileges ---------------------------------------------------
do $$
declare
  v_count int;
begin
  if not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'products' and c.relrowsecurity) then
    raise exception 'FAIL 1.1: RLS desativado em products';
  end if;

  select count(*) into v_count from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'products';
  if v_count <> 3 then
    raise exception 'FAIL 1.2: esperadas 3 policies em products, encontradas %', v_count;
  end if;
  if exists (select 1 from pg_catalog.pg_policies
              where schemaname = 'public' and tablename = 'products'
                and (cmd in ('DELETE', 'ALL')
                     or pg_catalog.btrim(coalesce(qual, '')) in ('true', '(true)')
                     or pg_catalog.btrim(coalesce(with_check, '')) in ('true', '(true)'))) then
    raise exception 'FAIL 1.3: policy permissiva ou de DELETE em products';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.products', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'FAIL 1.4: anon tem acesso a products';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.products', 'DELETE,TRUNCATE') then
    raise exception 'FAIL 1.5: authenticated pode apagar produtos';
  end if;
  if pg_catalog.has_column_privilege('authenticated', 'public.products', 'tenant_id', 'UPDATE')
     or pg_catalog.has_column_privilege('authenticated', 'public.products', 'id', 'INSERT')
     or pg_catalog.has_column_privilege('authenticated', 'public.products', 'archived_at', 'INSERT')
     or pg_catalog.has_column_privilege('authenticated', 'public.products', 'created_at', 'UPDATE') then
    raise exception 'FAIL 1.6: privilégios de coluna demasiado largos em products';
  end if;

  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'platform_list_tenant_products' and p.prosecdef) then
    raise exception 'FAIL 1.7: função SECURITY DEFINER no schema public';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.platform_list_tenant_products(uuid)', 'EXECUTE') then
    raise exception 'FAIL 1.8: anon executa platform_list_tenant_products';
  end if;
  select count(*) into v_count
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where ((n.nspname in ('public', 'private') and p.proname = 'platform_list_tenant_products')
       or (n.nspname = 'private' and p.proname in ('ussd_text_match_is_valid', 'ussd_flow_is_valid', 'tenant_is_active',
                                                   'products_before_write', 'audit_product_changes')))
     and not coalesce(p.proconfig @> array['search_path=""'], false);
  if v_count <> 0 then
    raise exception 'FAIL 1.9: % função(ões) da 003 sem search_path fixo', v_count;
  end if;
end;
$$;

-- 2. USSD flow validation -------------------------------------------------------------
do $$
declare
  v_invalid jsonb;
  v_index   int := 0;
begin
  -- Valid: the reference flow and a richer one.
  if not private.ussd_flow_is_valid('{"version": 1, "start": "*111#", "steps": [
        {"type": "select", "value": "5"}, {"type": "select", "value": "8"}, {"type": "select", "value": "2"},
        {"type": "input", "source": "destination_number"}, {"type": "input", "source": "amount_mb"},
        {"type": "confirm"}]}') then
    raise exception 'FAIL 2.1: fluxo de referência rejeitado';
  end if;
  if not private.ussd_flow_is_valid('{"version": 1, "start": "*123*1#", "steps": [
        {"type": "select", "value": "3", "label": "Pacotes", "expect": {"contains": ["Pacotes"]}},
        {"type": "input", "source": "destination_number", "label": "Número"},
        {"type": "wait", "ms": 1500},
        {"type": "confirm", "value": "1", "expect": {"contains": ["Confirmar", "Confirma"]}}],
      "success": {"contains": ["sucesso"]}, "failure": {"contains": ["saldo insuficiente", "erro"]}}') then
    raise exception 'FAIL 2.2: fluxo completo (expect/wait/success/failure) rejeitado';
  end if;

  -- Invalid: each of these must be rejected.
  for v_invalid in select x.flow from (values
      ('{}'::jsonb),
      ('[]'),
      ('"*111#"'),
      ('{"version": 1, "steps": [{"type": "confirm"}]}'),                                       -- no start
      ('{"version": 1, "start": "*111#"}'),                                                     -- no steps
      ('{"version": 1, "start": "*111#", "steps": []}'),                                        -- empty steps
      ('{"version": 2, "start": "*111#", "steps": [{"type": "confirm"}]}'),                     -- unknown version
      ('{"version": "1", "start": "*111#", "steps": [{"type": "confirm"}]}'),                   -- version as text
      ('{"start": "*111#", "steps": [{"type": "confirm"}]}'),                                   -- no version
      ('{"version": 1, "start": "111", "steps": [{"type": "confirm"}]}'),                       -- bad start code
      ('{"version": 1, "start": "*111#; rm -rf", "steps": [{"type": "confirm"}]}'),             -- bad start code
      ('{"version": 1, "start": "*111#", "steps": [{"type": "dance"}]}'),                       -- unknown step type
      ('{"version": 1, "start": "*111#", "steps": [{"type": "select"}]}'),                      -- select without value
      ('{"version": 1, "start": "*111#", "steps": [{"type": "select", "value": "abc"}]}'),      -- non-USSD value
      ('{"version": 1, "start": "*111#", "steps": [{"type": "select", "value": 5}]}'),          -- value not a string
      ('{"version": 1, "start": "*111#", "steps": [{"type": "input"}]}'),                       -- input without source
      ('{"version": 1, "start": "*111#", "steps": [{"type": "input", "source": "pin"}]}'),      -- unknown source
      ('{"version": 1, "start": "*111#", "steps": [{"type": "confirm", "value": "sim"}]}'),     -- bad confirm value
      ('{"version": 1, "start": "*111#", "steps": [{"type": "wait", "ms": 50}]}'),              -- wait too short
      ('{"version": 1, "start": "*111#", "steps": [{"type": "wait", "ms": 1500.5}]}'),          -- wait not integer
      ('{"version": 1, "start": "*111#", "steps": [{"type": "wait"}]}'),                        -- wait without ms
      ('{"version": 1, "start": "*111#", "steps": ["5"]}'),                                     -- step not an object
      ('{"version": 1, "start": "*111#", "steps": [{"type": "confirm", "command": "x"}]}'),     -- unknown step key
      ('{"version": 1, "start": "*111#", "steps": [{"type": "confirm"}], "script": "x"}'),      -- unknown top key
      ('{"version": 1, "start": "*111#", "steps": [{"type": "confirm", "expect": {"contains": []}}]}'),
      ('{"version": 1, "start": "*111#", "steps": [{"type": "confirm"}], "success": {"regex": "ok"}}'),
      (('{"version": 1, "start": "*111#", "steps": [{"type": "confirm", "label": "' || pg_catalog.repeat('x', 81) || '"}]}')::jsonb)
    ) as x(flow)
  loop
    v_index := v_index + 1;
    if private.ussd_flow_is_valid(v_invalid) then
      raise exception 'FAIL 2.3: fluxo inválido #% aceite: %', v_index, v_invalid;
    end if;
  end loop;

  if private.ussd_flow_is_valid(pg_catalog.jsonb_build_object(
       'version', 1, 'start', '*111#',
       'steps', (select pg_catalog.jsonb_agg('{"type": "confirm"}'::jsonb) from pg_catalog.generate_series(1, 31)))) then
    raise exception 'FAIL 2.4: fluxo com 31 passos aceite';
  end if;
  if private.ussd_flow_is_valid(null) then
    raise exception 'FAIL 2.5: fluxo null tratado como válido';
  end if;
end;
$$;

-- 3. Users, tenants, roles ----------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pr-test-oa@megabot.test', '{}', '{"name": "Owner A", "business_name": "PR Teste Alfa 003"}', now(), now()),
  ('00000000-0000-4000-8000-0000000003a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pr-test-aa@megabot.test', '{}', '{"name": "Admin A"}', now(), now()),
  ('00000000-0000-4000-8000-0000000003a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pr-test-op@megabot.test', '{}', '{"name": "Operador A"}', now(), now()),
  ('00000000-0000-4000-8000-0000000003b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pr-test-ob@megabot.test', '{}', '{"name": "Owner B", "business_name": "PR Teste Beta 003"}', now(), now()),
  ('00000000-0000-4000-8000-0000000003c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pr-test-pa@megabot.test', '{}', '{"name": "Platform"}', now(), now());

do $$
declare
  v_alfa uuid;
  v_beta uuid;
begin
  select tenant_id into v_alfa from public.tenant_users where user_id = '00000000-0000-4000-8000-0000000003a1' and role = 'owner';
  select tenant_id into v_beta from public.tenant_users where user_id = '00000000-0000-4000-8000-0000000003b1' and role = 'owner';
  if v_alfa is null or v_beta is null then
    raise exception 'FAIL 3.1: tenants de teste não foram criados pelo trigger da 001';
  end if;
  perform set_config('test.alfa', v_alfa::text, true);
  perform set_config('test.beta', v_beta::text, true);
end;
$$;

insert into public.tenant_users (tenant_id, user_id, role) values
  (current_setting('test.alfa')::uuid, '00000000-0000-4000-8000-0000000003a2', 'admin'),
  (current_setting('test.alfa')::uuid, '00000000-0000-4000-8000-0000000003a3', 'operator');
insert into public.platform_admins (user_id, role) values ('00000000-0000-4000-8000-0000000003c1', 'SUPER_ADMIN');

-- 4. Owner A creates and edits products -------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003a1", "role": "authenticated"}', true);

do $$
declare
  v_alfa uuid := current_setting('test.alfa')::uuid;
  v_beta uuid := current_setting('test.beta')::uuid;
  v_id   uuid;
  v_row  public.products;
  v_count int;
begin
  -- Flow A (reference flow), on sale.
  insert into public.products (tenant_id, name, description, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_alfa, '  Internet 5GB  ', '  Pacote mensal  ', 'monthly', 499.99, 5, 'GB', 720, 'vodacom', 'ACTIVE',
          '{"version": 1, "start": "*111#", "steps": [{"type": "select", "value": "5"}, {"type": "select", "value": "8"},
            {"type": "select", "value": "2"}, {"type": "input", "source": "destination_number"},
            {"type": "input", "source": "amount_mb"}, {"type": "confirm"}]}')
  returning * into v_row;
  if v_row.name <> 'Internet 5GB' or v_row.description <> 'Pacote mensal' or v_row.currency <> 'MZN'
     or v_row.price <> 499.99 or v_row.archived_at is not null then
    raise exception 'FAIL 4.1: produto criado com dados inesperados (%)', v_row;
  end if;
  perform set_config('test.p_a1', v_row.id::text, true);

  -- Unlimited plan without data amount and without flow (INACTIVE).
  insert into public.products (tenant_id, name, category, price, validity_hours, operator)
  values (v_alfa, 'Ilimitado Noite', 'unlimited', 25, 6, 'vodacom')
  returning id into v_id;
  perform set_config('test.p_a2', v_id::text, true);
  if (select status from public.products where id = v_id) <> 'INACTIVE' then
    raise exception 'FAIL 4.2: produto novo devia nascer INACTIVE por omissão';
  end if;

  begin
    insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status)
    values (v_alfa, 'Sem USSD', 'daily', 10, 400, 'MB', 24, 'vodacom', 'ACTIVE');
    raise exception 'FAIL 4.3: produto ACTIVE sem fluxo USSD aceite';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, ussd_flow)
    values (v_alfa, 'Fluxo Mau', 'daily', 10, 400, 'MB', 24, 'vodacom', '{"version": 1, "start": "*111#", "steps": [{"type": "hack"}]}');
    raise exception 'FAIL 4.4: fluxo USSD inválido aceite';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (tenant_id, name, category, price, validity_hours, operator)
    values (v_alfa, 'INTERNET 5gb', 'unlimited', 10, 24, 'vodacom');
    raise exception 'FAIL 4.5: nome duplicado (sem distinção de maiúsculas) aceite no mesmo tenant';
  exception when unique_violation then null;
  end;
  begin
    insert into public.products (tenant_id, name, category, price, validity_hours, operator)
    values (v_alfa, 'Preço Zero', 'unlimited', 0, 24, 'vodacom');
    raise exception 'FAIL 4.6: preço zero aceite';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (tenant_id, name, category, price, validity_hours, operator)
    values (v_alfa, 'Sem Volume', 'daily', 10, 24, 'vodacom');
    raise exception 'FAIL 4.7: pacote diário sem volume de dados aceite';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (tenant_id, name, category, price, data_amount, validity_hours, operator)
    values (v_alfa, 'Sem Unidade', 'daily', 10, 400, 24, 'vodacom');
    raise exception 'FAIL 4.8: volume sem unidade aceite';
  exception when check_violation then null;
  end;

  -- Cannot create in another tenant.
  begin
    insert into public.products (tenant_id, name, category, price, validity_hours, operator)
    values (v_beta, 'Invasão', 'unlimited', 10, 24, 'vodacom');
    raise exception 'FAIL 4.9: owner A criou produto no tenant B';
  exception when insufficient_privilege then null;
  end;

  -- Edit, deactivate, activate.
  update public.products set price = 450 where id = current_setting('test.p_a1')::uuid;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'FAIL 4.10: owner não conseguiu editar o produto';
  end if;
  update public.products set status = 'INACTIVE' where id = current_setting('test.p_a1')::uuid;
  update public.products set status = 'ACTIVE' where id = current_setting('test.p_a1')::uuid;
  begin
    update public.products set status = 'ACTIVE' where id = current_setting('test.p_a2')::uuid;
    raise exception 'FAIL 4.11: ativado produto sem fluxo USSD';
  exception when check_violation then null;
  end;

  -- tenant_id is immutable; nothing is deleted through the API.
  begin
    update public.products set tenant_id = v_beta where id = current_setting('test.p_a1')::uuid;
    raise exception 'FAIL 4.12: produto mudou de tenant';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.products where id = current_setting('test.p_a1')::uuid;
    raise exception 'FAIL 4.13: produto apagado fisicamente pela API';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 5. Admin A creates a product with a different flow ------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003a2", "role": "authenticated"}', true);

do $$
declare
  v_id uuid;
begin
  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (current_setting('test.alfa')::uuid, '1GB Diário', 'daily', 24, 1, 'GB', 24, 'movitel', 'ACTIVE',
          '{"version": 1, "start": "*123*1#", "steps": [{"type": "select", "value": "3", "expect": {"contains": ["Pacotes"]}},
            {"type": "input", "source": "destination_number"}, {"type": "wait", "ms": 1500}, {"type": "confirm", "value": "1"}],
            "success": {"contains": ["sucesso"]}, "failure": {"contains": ["saldo insuficiente"]}}')
  returning id into v_id;
  perform set_config('test.p_a3', v_id::text, true);

  update public.products set description = 'Editado pelo admin' where id = v_id;
  if not found then
    raise exception 'FAIL 5.1: admin do tenant não conseguiu editar';
  end if;
end;
$$;

-- 6. Operator A reads but cannot administer ----------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003a3", "role": "authenticated"}', true);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.products where tenant_id = current_setting('test.alfa')::uuid;
  if v_count <> 3 then
    raise exception 'FAIL 6.1: operador devia ver os 3 produtos do tenant (vê %)', v_count;
  end if;
  begin
    insert into public.products (tenant_id, name, category, price, validity_hours, operator)
    values (current_setting('test.alfa')::uuid, 'Do Operador', 'unlimited', 10, 24, 'vodacom');
    raise exception 'FAIL 6.2: operador criou produto';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.products set price = 1 where id = current_setting('test.p_a1')::uuid;
    raise exception 'FAIL 6.3: operador editou produto';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.products set status = 'INACTIVE' where id = current_setting('test.p_a1')::uuid;
    raise exception 'FAIL 6.4: operador desativou produto';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.products set archived_at = now() where id = current_setting('test.p_a1')::uuid;
    raise exception 'FAIL 6.5: operador arquivou produto';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 7. Owner B: isolation, own products with their own flow -------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003b1", "role": "authenticated"}', true);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.products where tenant_id = current_setting('test.alfa')::uuid;
  if v_count <> 0 then
    raise exception 'FAIL 7.1: tenant B vê produtos do tenant A (%)', v_count;
  end if;
  update public.products set price = 1 where id = current_setting('test.p_a1')::uuid;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL 7.2: tenant B alterou produto do tenant A';
  end if;

  -- Same name as in tenant A is fine: names are unique per tenant only.
  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (current_setting('test.beta')::uuid, 'Internet 5GB', 'monthly', 520, 5, 'GB', 720, 'tmcel', 'ACTIVE',
          '{"version": 1, "start": "*150#", "steps": [{"type": "select", "value": "2"}, {"type": "input", "source": "amount_gb"},
            {"type": "input", "source": "destination_number"}, {"type": "confirm", "value": "1"}]}');

  select count(*) into v_count from public.products;
  if v_count <> 1 then
    raise exception 'FAIL 7.3: tenant B devia ver só o próprio produto (vê %)', v_count;
  end if;
end;
$$;

-- 8. Multiple products keep their own flows ---------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003a1", "role": "authenticated"}', true);

do $$
begin
  if (select ussd_flow ->> 'start' from public.products where id = current_setting('test.p_a1')::uuid) <> '*111#'
     or (select ussd_flow ->> 'start' from public.products where id = current_setting('test.p_a3')::uuid) <> '*123*1#'
     or (select pg_catalog.jsonb_array_length(ussd_flow -> 'steps') from public.products where id = current_setting('test.p_a1')::uuid) <> 6
     or (select pg_catalog.jsonb_array_length(ussd_flow -> 'steps') from public.products where id = current_setting('test.p_a3')::uuid) <> 4 then
    raise exception 'FAIL 8.1: fluxos por produto não foram preservados';
  end if;
end;
$$;

-- 9. Suspended tenant: reads yes, writes no (enforced by RLS) ---------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003c1", "role": "authenticated"}', true);
select status from public.platform_set_tenant_status(current_setting('test.alfa')::uuid, 'suspended', 'Teste 003');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003a1", "role": "authenticated"}', true);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.products where tenant_id = current_setting('test.alfa')::uuid;
  if v_count <> 3 then
    raise exception 'FAIL 9.1: tenant suspenso deixou de ler os seus produtos (%)', v_count;
  end if;
  begin
    insert into public.products (tenant_id, name, category, price, validity_hours, operator)
    values (current_setting('test.alfa')::uuid, 'Durante Suspensão', 'unlimited', 10, 24, 'vodacom');
    raise exception 'FAIL 9.2: tenant suspenso criou produto';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.products set price = 1 where id = current_setting('test.p_a1')::uuid;
    raise exception 'FAIL 9.3: tenant suspenso editou produto';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.products set status = 'INACTIVE' where id = current_setting('test.p_a1')::uuid;
    raise exception 'FAIL 9.4: tenant suspenso desativou produto';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003c1", "role": "authenticated"}', true);
select status from public.platform_set_tenant_status(current_setting('test.alfa')::uuid, 'active');

-- 10. Archive (soft delete) -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003a1", "role": "authenticated"}', true);

do $$
declare
  v_row   public.products;
  v_count int;
begin
  update public.products set archived_at = '2000-01-01' where id = current_setting('test.p_a2')::uuid
  returning * into v_row;
  if v_row.id is null or v_row.status <> 'INACTIVE' or v_row.archived_at < now() - interval '1 minute' then
    raise exception 'FAIL 10.1: arquivo não usou a hora do servidor / não desativou (%)', v_row.archived_at;
  end if;
  update public.products set name = 'Ressuscitado', archived_at = null where id = current_setting('test.p_a2')::uuid;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL 10.2: produto arquivado foi alterado';
  end if;
  -- The archived product still exists (history) and its name is free again.
  if not exists (select 1 from public.products where id = current_setting('test.p_a2')::uuid and archived_at is not null) then
    raise exception 'FAIL 10.3: produto arquivado desapareceu';
  end if;
  insert into public.products (tenant_id, name, category, price, validity_hours, operator)
  values (current_setting('test.alfa')::uuid, 'Ilimitado Noite', 'unlimited', 30, 6, 'vodacom');
end;
$$;

-- 11. Platform admin: cross-tenant view only through the RPC --------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003c1", "role": "authenticated"}', true);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.products;
  if v_count <> 0 then
    raise exception 'FAIL 11.1: platform admin vê produtos em queries normais (%) — isolamento quebrado', v_count;
  end if;
  select count(*) into v_count from public.platform_list_tenant_products(current_setting('test.alfa')::uuid);
  if v_count <> 4 then
    raise exception 'FAIL 11.2: platform admin devia ver os 4 produtos do tenant A via RPC (vê %)', v_count;
  end if;
  begin
    perform public.platform_list_tenant_products('00000000-0000-4000-8000-00000000ffff');
    raise exception 'FAIL 11.3: tenant inexistente aceite';
  exception when no_data_found then null;
  end;
  begin
    update public.products set price = 1 where id = current_setting('test.p_a1')::uuid;
    get diagnostics v_count = row_count;
    if v_count <> 0 then
      raise exception 'FAIL 11.4: platform admin editou produto de um tenant';
    end if;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000003a1", "role": "authenticated"}', true);
do $$
begin
  perform public.platform_list_tenant_products(current_setting('test.beta')::uuid);
  raise exception 'FAIL 11.5: owner de tenant usou a RPC de plataforma';
exception when insufficient_privilege then null;
end;
$$;

-- 12. Audit trail (database owner) ------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  v_a1 text := current_setting('test.p_a1');
  v_oa uuid := '00000000-0000-4000-8000-0000000003a1';
begin
  if not exists (select 1 from public.audit_logs where action = 'product.created' and resource_id = v_a1
                    and actor_user_id = v_oa and tenant_id = current_setting('test.alfa')::uuid
                    and metadata ->> 'name' = 'Internet 5GB' and (metadata ->> 'has_ussd_flow')::boolean) then
    raise exception 'FAIL 12.1: product.created não auditado';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'product.updated' and resource_id = v_a1
                    and metadata -> 'changed' ? 'price') then
    raise exception 'FAIL 12.2: product.updated não auditado com os campos alterados';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'product.deactivated' and resource_id = v_a1
                    and metadata ->> 'previous_status' = 'ACTIVE')
     or not exists (select 1 from public.audit_logs where action = 'product.activated' and resource_id = v_a1) then
    raise exception 'FAIL 12.3: ativação/desativação não auditada';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'product.archived'
                    and resource_id = current_setting('test.p_a2')) then
    raise exception 'FAIL 12.4: arquivo não auditado';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'product.created'
                    and resource_id = current_setting('test.p_a3')
                    and actor_user_id = '00000000-0000-4000-8000-0000000003a2') then
    raise exception 'FAIL 12.5: criação pelo admin do tenant não auditada';
  end if;
  if exists (select 1 from public.audit_logs where resource_type = 'product'
                and (metadata ? 'ussd_flow' or metadata::text like '%"steps"%')) then
    raise exception 'FAIL 12.6: corpo do fluxo USSD copiado para o audit log';
  end if;
  -- Rejected writes (operator, suspended tenant, other tenant) left no audit entries.
  if exists (select 1 from public.audit_logs where resource_type = 'product'
                and actor_user_id in ('00000000-0000-4000-8000-0000000003a3', '00000000-0000-4000-8000-0000000003b1')
                and tenant_id = current_setting('test.alfa')::uuid) then
    raise exception 'FAIL 12.7: tentativas negadas geraram audit logs';
  end if;
end;
$$;

-- 13. Anonymous --------------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

do $$
begin
  begin
    perform 1 from public.products;
    raise exception 'FAIL 13.1: anon lê products';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_list_tenant_products('00000000-0000-4000-8000-00000000ffff');
    raise exception 'FAIL 13.2: anon executa platform_list_tenant_products';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;

select 'PASS — 003_products: estrutura, validação USSD, isolamento, owner/admin/operator, tenant suspenso, fluxos por produto, arquivo, platform admin, auditoria e anon verificados (transação revertida)' as resultado;

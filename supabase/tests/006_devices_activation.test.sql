-- =============================================================================
-- MegaBot · verification for 006_devices_activation.sql
--
-- Run in Supabase → SQL Editor AFTER applying 001–006.
-- Everything happens inside one transaction that is ROLLED BACK at the end:
-- no users, tenants, devices, SIMs, orders or tasks are left behind.
--
-- Success: the last result shows "PASS — 006_devices_activation".
-- Failure: execution stops with an error message starting with "FAIL".
--
-- Test users (fixed UUIDs, removed by the rollback):
--   …6a1  OA  owner of tenant "AT Teste Alfa 006"
--   …6a3  OP  operator of Alfa (the worker phone's account)
--   …6b1  OB  owner of tenant "AT Teste Beta 006"
--   …6c1  PA  platform SUPER_ADMIN, no tenant
--   …6d1  OG  owner of tenant "AT Teste Gama 006" (isolated rule-by-rule checks, section 20)
-- Phone numbers, codes and operator texts below are synthetic.
-- =============================================================================

begin;

-- 1. Structure and privileges ---------------------------------------------------
do $$
declare
  v_tables text[] := array['devices', 'device_sims', 'activation_tasks', 'activation_task_attempts', 'activation_task_events'];
  v_rpcs   text[] := array[
    'public.create_device(uuid, text)', 'public.create_device_pairing_code(uuid)', 'public.update_device(uuid, text, text)',
    'public.register_device_sim(uuid, integer, text, text)', 'public.update_device_sim(uuid, text, text, text)',
    'public.dispatch_activation_tasks(uuid)', 'public.retry_activation_task(uuid, text)',
    'public.resolve_activation_task(uuid, text, text)', 'public.register_device(text, text, text, text)',
    'public.device_heartbeat(uuid, text, text, jsonb, jsonb, jsonb)', 'public.worker_fetch_task(uuid, text)',
    'public.worker_start_task(uuid, text, uuid)', 'public.worker_report_progress(uuid, text, uuid, text)',
    'public.worker_report_result(uuid, text, uuid, text, text, text, text)',
    'public.platform_list_tenant_devices(uuid)', 'public.platform_list_tenant_activation_tasks(uuid, integer)'];
  v_internals text[] := array[
    'private.dispatch_activation_tasks(uuid, integer)', 'private.expire_stale_activation_tasks(uuid)',
    'private.activation_payload(public.activation_tasks)', 'private.authenticate_device(uuid, text, boolean)',
    'private.sync_order_with_activation(uuid, text)', 'private.create_activation_task(uuid)',
    'private.record_activation_attempt(public.activation_tasks, text, text, text, text, text, text, uuid)',
    'private.new_pairing_code()', 'private.classify_ussd_response(jsonb, text)'];
  v_name  text;
  v_count int;
begin
  select count(*) into v_count
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = any (v_tables || 'device_credentials'::text) and c.relrowsecurity;
  if v_count <> 6 then
    raise exception 'FAIL 1.1: RLS ativo em % de 6 tabelas', v_count;
  end if;
  select count(*) into v_count from pg_catalog.pg_policies where schemaname = 'public' and tablename = any (v_tables);
  if v_count <> 5 then
    raise exception 'FAIL 1.2: esperadas 5 policies, encontradas %', v_count;
  end if;
  if exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                and (tablename = 'device_credentials'
                     or (tablename = any (v_tables) and (cmd <> 'SELECT' or 'anon' = any (roles) or 'public' = any (roles)
                         or pg_catalog.btrim(coalesce(qual, '')) in ('true', '(true)'))))) then
    raise exception 'FAIL 1.3: policy de escrita, permissiva ou nas credenciais';
  end if;
  foreach v_name in array v_tables || 'device_credentials'::text loop
    if pg_catalog.has_table_privilege('anon', 'public.' || v_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'FAIL 1.4: anon tem acesso a %', v_name;
    end if;
    if pg_catalog.has_table_privilege('authenticated', 'public.' || v_name, 'INSERT,UPDATE,DELETE,TRUNCATE')
       or pg_catalog.has_any_column_privilege('authenticated', 'public.' || v_name, 'UPDATE') then
      raise exception 'FAIL 1.5: authenticated escreve diretamente em %', v_name;
    end if;
    if pg_catalog.has_table_privilege('service_role', 'public.' || v_name, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'FAIL 1.6: service_role escreve diretamente em %', v_name;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('authenticated', 'public.device_credentials', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'public.device_credentials', 'SELECT') then
    raise exception 'FAIL 1.7: credenciais de dispositivo legíveis pela API';
  end if;

  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef and p.oid = any (array(select v::regprocedure from unnest(v_rpcs) v))) then
    raise exception 'FAIL 1.8: função SECURITY DEFINER no schema public';
  end if;
  select count(*) into v_count
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.oid = any (array(select v::regprocedure from unnest(v_rpcs) v))
          or p.proname in ('create_device', 'create_device_pairing_code', 'update_device', 'register_device_sim', 'update_device_sim',
            'dispatch_activation_tasks', 'dispatch_activation_tasks_for', 'retry_activation_task', 'resolve_activation_task',
            'register_device', 'device_heartbeat', 'worker_fetch_task', 'worker_start_task', 'worker_report_progress',
            'worker_report_result', 'platform_list_tenant_devices', 'platform_list_tenant_activation_tasks',
            'device_capabilities_are_valid', 'device_telemetry_is_valid', 'sim_capabilities_are_valid',
            'automation_setting_seconds', 'device_is_online', 'new_pairing_code', 'normalize_pairing_code',
            'activation_result_code_info', 'classify_ussd_response', 'activation_task_transition_allowed',
            'activation_payload', 'authenticate_device', 'sync_order_with_activation', 'create_activation_task',
            'expire_stale_activation_tasks', 'record_activation_attempt', 'devices_before_write', 'device_sims_before_write',
            'activation_tasks_before_write', 'record_activation_task_event', 'audit_device_changes', 'audit_device_sim_changes',
            'prevent_activation_history_changes', 'orders_create_activation_task', 'orders_require_activation_success'))
     and not coalesce(p.proconfig @> array['search_path=""'], false);
  if v_count <> 0 then
    raise exception 'FAIL 1.9: % função(ões) da 006 sem search_path fixo', v_count;
  end if;
  foreach v_name in array v_rpcs loop
    if pg_catalog.has_function_privilege('anon', v_name, 'EXECUTE') then
      raise exception 'FAIL 1.10: anon executa %', v_name;
    end if;
    if not pg_catalog.has_function_privilege('authenticated', v_name, 'EXECUTE') then
      raise exception 'FAIL 1.11: authenticated não executa %', v_name;
    end if;
  end loop;
  foreach v_name in array v_internals loop
    if pg_catalog.has_function_privilege('authenticated', v_name, 'EXECUTE') or pg_catalog.has_function_privilege('anon', v_name, 'EXECUTE') then
      raise exception 'FAIL 1.12: função interna exposta: %', v_name;
    end if;
  end loop;

  select count(*) into v_count from pg_catalog.pg_indexes
   where schemaname = 'public' and tablename = 'activation_tasks'
     and indexname in ('activation_tasks_device_busy_key', 'activation_tasks_sim_busy_key') and indexdef like 'CREATE UNIQUE INDEX%';
  if v_count <> 2 or not exists (select 1 from pg_catalog.pg_constraint where conname = 'activation_tasks_order_key' and contype = 'u') then
    raise exception 'FAIL 1.13: unicidade (uma tarefa por pedido, um trabalho por SIM/dispositivo) em falta';
  end if;
  select count(*) into v_count from pg_catalog.pg_trigger
   where not tgisinternal and tgname in ('activation_tasks_before_write', 'activation_task_attempts_immutable',
         'activation_task_events_immutable', 'orders_create_activation_task', 'orders_require_activation_success',
         'activation_tasks_record_event');
  if v_count <> 6 then
    raise exception 'FAIL 1.14: triggers de integridade em falta (%)', v_count;
  end if;
end;
$$;

-- 2. Pure helpers -----------------------------------------------------------------
do $$
declare
  v_flow  jsonb := '{"version": 1, "start": "*111#", "steps": [{"type": "confirm"}],
                     "success": {"contains": ["Sucesso", "activado"]}, "failure": {"contains": ["saldo insuficiente"]}}';
  v_case  record;
  v_count int := 0;
  v_from  text;
  v_to    text;
  v_info  record;
begin
  for v_case in select * from (values
      ('Pacote activado com SUCESSO.', 'SUCCESS'),
      ('Operacao falhou: saldo insuficiente', 'FAILED'),
      ('Sucesso? saldo insuficiente', 'UNKNOWN'),
      ('Menu: 1 Dados 2 Voz', 'UNKNOWN'),
      ('', 'UNKNOWN'),
      (null, 'UNKNOWN')
    ) as t(response, expected)
  loop
    if private.classify_ussd_response(v_flow, v_case.response) is distinct from v_case.expected then
      raise exception 'FAIL 2.1: % classificado como %', v_case.response, private.classify_ussd_response(v_flow, v_case.response);
    end if;
  end loop;
  if private.classify_ussd_response('{"version": 1, "start": "*111#", "steps": [{"type": "confirm"}]}', 'Pacote activado') <> 'UNKNOWN' then
    raise exception 'FAIL 2.2: sem textos de sucesso, nenhuma resposta prova sucesso';
  end if;

  foreach v_from in array array['QUEUED', 'ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING', 'SUCCESS', 'FAILED', 'UNKNOWN'] loop
    foreach v_to in array array['QUEUED', 'ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING', 'SUCCESS', 'FAILED', 'UNKNOWN'] loop
      if private.activation_task_transition_allowed(v_from, v_to) then
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;
  if v_count <> 19 or private.activation_task_transition_allowed('SUCCESS', 'EXECUTING')
     or private.activation_task_transition_allowed('FAILED', 'EXECUTING') or private.activation_task_transition_allowed('UNKNOWN', 'QUEUED')
     or private.activation_task_transition_allowed('UNKNOWN', 'EXECUTING') then
    raise exception 'FAIL 2.3: máquina de estados da tarefa inesperada (% transições)', v_count;
  end if;

  select * into v_info from private.activation_result_code_info('NETWORK_ERROR');
  if not v_info.retryable or not ('UNKNOWN' = any (v_info.outcomes)) then
    raise exception 'FAIL 2.4: NETWORK_ERROR deveria ser repetível antes da submissão';
  end if;
  select * into v_info from private.activation_result_code_info('INSUFFICIENT_BALANCE');
  if v_info.retryable then
    raise exception 'FAIL 2.5: saldo insuficiente não é repetido automaticamente';
  end if;
  select * into v_info from private.activation_result_code_info('MANUAL_CONFIRMED');
  if v_info.worker then
    raise exception 'FAIL 2.6: o worker não pode enviar decisões manuais';
  end if;

  if not private.device_capabilities_are_valid('{"ussd": true, "ussd_interactive": false}')
     or private.device_capabilities_are_valid('{"ussd": "yes"}') or private.device_capabilities_are_valid('{"root": true}')
     or not private.device_telemetry_is_valid('{"battery_level": 80, "charging": true, "network_type": "4G", "signal_level": 3, "model": "SM-A12"}')
     or private.device_telemetry_is_valid('{"battery_level": 120}') or private.device_telemetry_is_valid('{"imei": "123"}') then
    raise exception 'FAIL 2.7: validação de capacidades / telemetria';
  end if;
  if private.new_pairing_code() !~ '^[A-HJ-NP-Z2-9]{8}$' or private.normalize_pairing_code(' ab cd-23 45 ') <> 'ABCD2345' then
    raise exception 'FAIL 2.8: código de emparelhamento com formato inesperado';
  end if;
end;
$$;

-- 3. Users, tenants, products, payment account ----------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000006a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'at-test-oa@megabot.test', '{}', '{"name": "Owner A", "business_name": "AT Teste Alfa 006"}', now(), now()),
  ('00000000-0000-4000-8000-0000000006a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'at-test-op@megabot.test', '{}', '{"name": "Operador A"}', now(), now()),
  ('00000000-0000-4000-8000-0000000006b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'at-test-ob@megabot.test', '{}', '{"name": "Owner B", "business_name": "AT Teste Beta 006"}', now(), now()),
  ('00000000-0000-4000-8000-0000000006c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'at-test-pa@megabot.test', '{}', '{"name": "Platform"}', now(), now()),
  ('00000000-0000-4000-8000-0000000006d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'at-test-og@megabot.test', '{}', '{"name": "Owner G", "business_name": "AT Teste Gama 006"}', now(), now());

do $$
declare
  v_alfa uuid;
  v_beta uuid;
  v_flow jsonb := '{"version": 1, "start": "*111#",
                    "steps": [{"type": "select", "value": "5"}, {"type": "input", "source": "destination_number"}, {"type": "confirm"}],
                    "success": {"contains": ["sucesso"]}, "failure": {"contains": ["saldo insuficiente", "numero invalido"]}}';
  v_id   uuid;
begin
  select tenant_id into v_alfa from public.tenant_users where user_id = '00000000-0000-4000-8000-0000000006a1' and role = 'owner';
  select tenant_id into v_beta from public.tenant_users where user_id = '00000000-0000-4000-8000-0000000006b1' and role = 'owner';
  if v_alfa is null or v_beta is null then
    raise exception 'FAIL 3.1: tenants de teste não foram criados pelo trigger da 001';
  end if;
  perform set_config('test.alfa', v_alfa::text, true);
  perform set_config('test.beta', v_beta::text, true);
  insert into public.tenant_users (tenant_id, user_id, role) values (v_alfa, '00000000-0000-4000-8000-0000000006a3', 'operator');
  insert into public.platform_admins (user_id, role) values ('00000000-0000-4000-8000-0000000006c1', 'SUPER_ADMIN');

  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_alfa, 'Internet 5GB', 'monthly', 500, 5, 'GB', 720, 'vodacom', 'ACTIVE', v_flow) returning id into v_id;
  perform set_config('test.p_voda', v_id::text, true);
  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_alfa, 'Movitel 2GB', 'weekly', 70, 2, 'GB', 168, 'movitel', 'ACTIVE', v_flow) returning id into v_id;
  perform set_config('test.p_movi', v_id::text, true);
  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_alfa, 'Unico 777', 'daily', 777, 1, 'GB', 24, 'vodacom', 'ACTIVE', v_flow) returning id into v_id;
  perform set_config('test.p_777', v_id::text, true);
  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_beta, 'Beta 1GB', 'daily', 100, 1, 'GB', 24, 'vodacom', 'ACTIVE', v_flow) returning id into v_id;
  perform set_config('test.p_beta', v_id::text, true);
end;
$$;

-- 4. A PAID order (legitimate 005 path) creates exactly one QUEUED task --------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a1", "role": "authenticated"}', true);
do $$
declare
  v_order   uuid;
  v_account uuid;
  v_task    public.activation_tasks;
  v_count   int;
begin
  select id into v_order from public.create_order(current_setting('test.p_777')::uuid, '840000777', 'Cliente Pago');
  perform set_config('test.o_paid', v_order::text, true);
  select id into v_account from public.create_payment_account(current_setting('test.alfa')::uuid, 'MPESA', 'Loja Alfa', '84 000 0100');
  -- Only candidate with this amount and the full sender = customer phone → confirmed by 005 → PAID.
  perform public.record_payment_event(v_account, 'PP261002.0777.A00777', 777, null, null, '+258 84 000 0777');
  if (select status from public.orders where id = v_order) <> 'PAID' then
    raise exception 'FAIL 4.1: pedido não ficou PAID pela reconciliação (%)', (select status from public.orders where id = v_order);
  end if;
  select * into v_task from public.activation_tasks where order_id = v_order;
  if v_task.id is null or v_task.status <> 'QUEUED' or v_task.operator <> 'vodacom' or v_task.device_id is not null
     or v_task.attempt_count <> 0 or v_task.max_attempts <> 3 or v_task.ussd_flow ->> 'start' <> '*111#'
     or v_task.product_id <> current_setting('test.p_777')::uuid then
    raise exception 'FAIL 4.2: tarefa criada com dados inesperados (%)', v_task;
  end if;
  perform set_config('test.t_paid', v_task.id::text, true);
  if not exists (select 1 from public.activation_task_events where task_id = v_task.id and event_type = 'activation_task.created') then
    raise exception 'FAIL 4.3: criação da tarefa sem histórico';
  end if;
  -- The order stays PAID while nobody can execute it (no worker yet).
  if (select status from public.orders where id = v_order) <> 'PAID' then
    raise exception 'FAIL 4.4: pedido mudou sem atribuição';
  end if;
end;
$$;

-- Idempotency: the same order never gets a second task.
reset role;
do $$
declare
  v_task public.activation_tasks;
begin
  v_task := private.create_activation_task(current_setting('test.o_paid')::uuid);
  if v_task.id <> current_setting('test.t_paid')::uuid or (select count(*) from public.activation_tasks where order_id = current_setting('test.o_paid')::uuid) <> 1 then
    raise exception 'FAIL 4.5: criação de tarefa não é idempotente';
  end if;
  begin
    insert into public.activation_tasks (tenant_id, order_id, product_id, operator, ussd_flow)
    select tenant_id, id, product_id, operator_snapshot, (select ussd_flow from public.products where id = product_id)
      from public.orders where id = current_setting('test.o_paid')::uuid;
    raise exception 'FAIL 4.6: segunda tarefa para o mesmo pedido';
  exception when unique_violation then null;
  end;
end;
$$;

-- Helper: more PAID orders through the owner (maintenance path; the PAID guard of 005
-- exempts the database owner). Each one gets its task from the trigger.
do $$
declare
  v_case record;
  v_id   uuid;
begin
  for v_case in select * from (values
      ('o_v1', 'p_voda', '840000001'), ('o_v2', 'p_voda', '840000002'), ('o_v3', 'p_voda', '840000003'),
      ('o_v4', 'p_voda', '840000004'), ('o_v5', 'p_voda', '840000005'), ('o_v6', 'p_voda', '840000006'),
      ('o_v7', 'p_voda', '840000007'), ('o_m1', 'p_movi', '860000001'), ('o_b1', 'p_beta', '840000091')
    ) as t(key, product, phone)
  loop
    insert into public.orders (tenant_id, product_id, customer_phone)
    select p.tenant_id, p.id, v_case.phone from public.products p where p.id = current_setting('test.' || v_case.product)::uuid
    returning id into v_id;
    update public.orders set status = 'AWAITING_PAYMENT' where id = v_id;
    update public.orders set status = 'PAID' where id = v_id;
    perform set_config('test.' || v_case.key, v_id::text, true);
    perform set_config('test.t_' || substr(v_case.key, 3), (select id::text from public.activation_tasks where order_id = v_id), true);
  end loop;
  if (select count(*) from public.activation_tasks where tenant_id = current_setting('test.alfa')::uuid and status = 'QUEUED') <> 9 then
    raise exception 'FAIL 4.7: esperadas 9 tarefas na fila em Alfa';
  end if;
end;
$$;

-- 5. Devices: creation and pairing ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a1", "role": "authenticated"}', true);
do $$
declare
  v_new record;
  v_dev public.devices;
begin
  select * into v_new from public.create_device(current_setting('test.alfa')::uuid, '  Worker Principal  ');
  if v_new.pairing_code !~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' or v_new.pairing_expires_at <= now() then
    raise exception 'FAIL 5.1: código de emparelhamento inválido (%)', v_new;
  end if;
  select * into v_dev from public.devices where id = v_new.device_id;
  if v_dev.status <> 'UNREGISTERED' or v_dev.device_name <> 'Worker Principal' or v_dev.registered_at is not null
     or v_dev.device_identifier is not null then
    raise exception 'FAIL 5.2: dispositivo criado com dados inesperados (%)', v_dev;
  end if;
  perform set_config('test.dev_a', v_new.device_id::text, true);
  perform set_config('test.code_a', v_new.pairing_code, true);
  select * into v_new from public.create_device(current_setting('test.alfa')::uuid, 'Worker Dois');
  perform set_config('test.dev_a2', v_new.device_id::text, true);
  perform set_config('test.code_a2', v_new.pairing_code, true);

  begin
    perform 1 from public.device_credentials;
    raise exception 'FAIL 5.3: credenciais legíveis';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_device(current_setting('test.beta')::uuid, 'Intruso');
    raise exception 'FAIL 5.4: dispositivo criado noutra empresa (tenant_id forjado)';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_device(current_setting('test.alfa')::uuid, 'X');
    raise exception 'FAIL 5.5: nome inválido aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_device(v_new.device_id, null, 'ACTIVE');
    raise exception 'FAIL 5.6: dispositivo ativado sem emparelhamento';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- The operator can see devices but not manage them.
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a3", "role": "authenticated"}', true);
  if (select count(*) from public.devices) <> 2 then
    raise exception 'FAIL 5.7: operador não lê os dispositivos da empresa';
  end if;
  begin
    perform public.create_device(current_setting('test.alfa')::uuid, 'Do operador');
    raise exception 'FAIL 5.8: operador criou dispositivo';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_device(current_setting('test.dev_a')::uuid, 'Renomeado');
    raise exception 'FAIL 5.9: operador alterou dispositivo';
  exception when no_data_found then null;
  end;
end;
$$;

-- Pairing from the worker phone (signed in as the operator).
do $$
declare
  v_reg   record;
  v_dev   public.devices;
  v_hint  text;
begin
  begin
    perform public.register_device('ZZZZ-ZZZZ', 'android-install-0001', 'ANDROID', '1.0.0');
    raise exception 'FAIL 5.10: código inexistente aceite';
  exception when no_data_found then null;
  end;
  begin
    perform public.register_device(current_setting('test.code_a'), 'android-install-0001', 'IOS', '1.0.0');
    raise exception 'FAIL 5.11: plataforma não Android aceite';
  exception when invalid_parameter_value then null;
  end;
  select * into v_reg from public.register_device(lower(replace(current_setting('test.code_a'), '-', ' ')), 'android-install-0001', 'ANDROID', '1.0.0');
  if v_reg.device_id <> current_setting('test.dev_a')::uuid or v_reg.device_token !~ '^mbdt_[0-9a-f]{64}$'
     or v_reg.tenant_id <> current_setting('test.alfa')::uuid then
    raise exception 'FAIL 5.12: registo devolveu dados inesperados';
  end if;
  perform set_config('test.tok_a', v_reg.device_token, true);
  select * into v_dev from public.devices where id = v_reg.device_id;
  if v_dev.status <> 'ACTIVE' or v_dev.platform <> 'ANDROID' or v_dev.device_identifier <> 'android-install-0001'
     or v_dev.registered_by <> '00000000-0000-4000-8000-0000000006a3' or v_dev.last_seen_at is null then
    raise exception 'FAIL 5.13: dispositivo não ficou registado (%)', v_dev;
  end if;
  begin
    perform public.register_device(current_setting('test.code_a'), 'android-install-0009', 'ANDROID', '1.0.0');
    raise exception 'FAIL 5.14: código de emparelhamento reutilizado';
  exception when no_data_found then null;
  end;
  begin
    perform public.register_device(current_setting('test.code_a2'), 'android-install-0001', 'ANDROID', '1.0.0');
    raise exception 'FAIL 5.15: o mesmo telemóvel registado como dois dispositivos';
  exception when unique_violation then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'DEVICE_IDENTIFIER_TAKEN' then raise exception 'FAIL 5.15b: %', v_hint; end if;
  end;
  select * into v_reg from public.register_device(current_setting('test.code_a2'), 'android-install-0002', 'ANDROID', '1.0.0');
  perform set_config('test.tok_a2', v_reg.device_token, true);
end;
$$;

-- A member of another tenant cannot use Alfa's code.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a1", "role": "authenticated"}', true);
do $$
declare
  v_new record;
begin
  select * into v_new from public.create_device(current_setting('test.alfa')::uuid, 'Worker Tres');
  perform set_config('test.dev_a3', v_new.device_id::text, true);
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006b1", "role": "authenticated"}', true);
  begin
    perform public.register_device(v_new.pairing_code, 'android-install-0b01', 'ANDROID', '1.0.0');
    raise exception 'FAIL 5.16: código de Alfa usado por membro de Beta';
  exception when no_data_found then null;
  end;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a1", "role": "authenticated"}', true);
end;
$$;

-- 6. SIMs, heartbeat and the device token ---------------------------------------------------
do $$
declare
  v_sim public.device_sims;
  v_hb  jsonb;
begin
  select * into v_sim from public.register_device_sim(current_setting('test.dev_a')::uuid, 0, 'vodacom', '84 555 0100');
  if v_sim.phone_number <> '+258845550100' or v_sim.status <> 'ACTIVE' or v_sim.tenant_id <> current_setting('test.alfa')::uuid then
    raise exception 'FAIL 6.1: SIM registado com dados inesperados (%)', v_sim;
  end if;
  perform set_config('test.sim_a0', v_sim.id::text, true);
  select * into v_sim from public.register_device_sim(current_setting('test.dev_a')::uuid, 1, 'movitel');
  perform set_config('test.sim_a1', v_sim.id::text, true);
  select * into v_sim from public.register_device_sim(current_setting('test.dev_a2')::uuid, 0, 'vodacom');
  perform set_config('test.sim_b0', v_sim.id::text, true);
  begin
    perform public.register_device_sim(current_setting('test.dev_a')::uuid, 0, 'tmcel');
    raise exception 'FAIL 6.2: dois SIMs no mesmo slot';
  exception when unique_violation then null;
  end;
  begin
    perform public.register_device_sim(current_setting('test.dev_a')::uuid, 2, 'MTN');
    raise exception 'FAIL 6.3: operadora desconhecida aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.register_device_sim(current_setting('test.dev_a')::uuid, 2, 'vodacom', '123');
    raise exception 'FAIL 6.4: telefone inválido aceite';
  exception when invalid_parameter_value then null;
  end;

  -- The worker heartbeat (operator account + device token).
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a3", "role": "authenticated"}', true);
  begin
    perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a2'));
    raise exception 'FAIL 6.5: token de outro dispositivo aceite (device_id forjado)';
  exception when no_data_found then null;
  end;
  begin
    perform public.device_heartbeat(current_setting('test.dev_a')::uuid, 'mbdt_' || repeat('0', 64));
    raise exception 'FAIL 6.6: token falso aceite';
  exception when no_data_found then null;
  end;
  begin
    perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), null, '{"root": true}');
    raise exception 'FAIL 6.7: capacidades desconhecidas aceites';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), null, null, '{"imei": "1"}');
    raise exception 'FAIL 6.8: telemetria sensível aceite';
  exception when invalid_parameter_value then null;
  end;

  -- Without the interactive USSD capability nothing is dispatched.
  v_hb := public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), '1.0.1',
    '{"ussd": true, "ussd_interactive": false, "multi_sim": true}', '{"battery_level": 77, "charging": false, "network_type": "4G"}',
    '[{"slot_index": 0, "fingerprint": "sub-0001-aaaa"}, {"slot_index": 1, "fingerprint": "sub-0002-bbbb"}]');
  if v_hb ->> 'device_id' <> current_setting('test.dev_a') or v_hb ->> 'task_id' is not null then
    raise exception 'FAIL 6.9: heartbeat inesperado (%)', v_hb;
  end if;
  if exists (select 1 from public.activation_tasks where status <> 'QUEUED' and tenant_id = current_setting('test.alfa')::uuid) then
    raise exception 'FAIL 6.10: tarefa atribuída a um dispositivo sem USSD interativo';
  end if;
  if (select sim_fingerprint from public.device_sims where id = current_setting('test.sim_a0')::uuid) <> 'sub-0001-aaaa'
     or (select app_version from public.devices where id = current_setting('test.dev_a')::uuid) <> '1.0.1'
     or (select telemetry ->> 'battery_level' from public.devices where id = current_setting('test.dev_a')::uuid) <> '77' then
    raise exception 'FAIL 6.11: heartbeat não atualizou SIM / versão / telemetria';
  end if;
end;
$$;

-- 7. Dispatcher ---------------------------------------------------------------------------
do $$
declare
  v_hb   jsonb;
  v_task public.activation_tasks;
begin
  -- Capable device: the oldest QUEUED vodacom task goes to SIM slot 0 (vodacom).
  v_hb := public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), null,
    '{"ussd": true, "ussd_interactive": true, "multi_sim": true}', null,
    '[{"slot_index": 0, "fingerprint": "sub-0001-aaaa"}, {"slot_index": 1, "fingerprint": "sub-0002-bbbb"}]');
  select * into v_task from public.activation_tasks where id = (v_hb ->> 'task_id')::uuid;
  if v_task.id <> current_setting('test.t_paid')::uuid or v_task.status <> 'ASSIGNED' or v_task.device_id <> current_setting('test.dev_a')::uuid
     or v_task.sim_id <> current_setting('test.sim_a0')::uuid or v_task.assigned_at is null then
    raise exception 'FAIL 7.1: atribuição inesperada (%)', v_task;
  end if;
  if (select status from public.orders where id = current_setting('test.o_paid')::uuid) <> 'READY_FOR_ACTIVATION' then
    raise exception 'FAIL 7.2: pedido não passou a READY_FOR_ACTIVATION';
  end if;
  -- One running task per device: nothing else goes to dev_a (even its movitel SIM).
  if (select count(*) from public.activation_tasks where device_id = current_setting('test.dev_a')::uuid
         and status in ('ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING')) <> 1 then
    raise exception 'FAIL 7.3: dispositivo com mais de uma tarefa em curso';
  end if;
  -- dev_a2 offline (never sent a heartbeat with capabilities): stays out.
  if exists (select 1 from public.activation_tasks where device_id = current_setting('test.dev_a2')::uuid) then
    raise exception 'FAIL 7.4: tarefa atribuída a dispositivo sem capacidade USSD';
  end if;
end;
$$;

-- Worker 2 comes online: next vodacom task goes there; the movitel task never goes to a vodacom SIM.
do $$
declare
  v_hb jsonb;
begin
  v_hb := public.device_heartbeat(current_setting('test.dev_a2')::uuid, current_setting('test.tok_a2'), null,
    '{"ussd": true, "ussd_interactive": true}', null, '[{"slot_index": 0, "fingerprint": "sub-0003-cccc"}]');
  if (v_hb ->> 'task_id')::uuid <> current_setting('test.t_v1')::uuid then
    raise exception 'FAIL 7.5: segunda tarefa não foi para o worker 2 (%)', v_hb;
  end if;
  if (select status from public.activation_tasks where id = current_setting('test.t_m1')::uuid) <> 'QUEUED' then
    raise exception 'FAIL 7.6: tarefa movitel atribuída sem SIM movitel livre';
  end if;
end;
$$;

-- 8. Execution, protocol and result verification ----------------------------------------------
do $$
declare
  v_payload jsonb;
  v_task    public.activation_tasks;
  v_hint    text;
begin
  v_payload := public.worker_fetch_task(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'));
  if v_payload ->> 'protocol' <> 'megabot.activation.v1' or v_payload ->> 'task_id' <> current_setting('test.t_paid')
     or v_payload ->> 'destination_number' <> '+258840000777' or v_payload -> 'values' ->> 'destination_number' <> '840000777'
     or v_payload -> 'values' ->> 'amount_mb' <> '1024' or v_payload -> 'values' ->> 'amount_gb' <> '1'
     or v_payload -> 'values' ->> 'price' <> '777' or (v_payload -> 'sim' ->> 'slot_index')::int <> 0
     or v_payload -> 'sim' ->> 'fingerprint' <> 'sub-0001-aaaa' or v_payload -> 'flow' ->> 'start' <> '*111#' then
    raise exception 'FAIL 8.1: payload inesperado (%)', v_payload;
  end if;
  if v_payload::text ~* '(mbdt_|token|secret|service_role|tenant_id|password)' then
    raise exception 'FAIL 8.2: payload contém segredos ou o tenant';
  end if;

  -- The other device cannot start or report this task.
  begin
    perform public.worker_start_task(current_setting('test.dev_a2')::uuid, current_setting('test.tok_a2'), current_setting('test.t_paid')::uuid);
    raise exception 'FAIL 8.3: outro dispositivo iniciou a tarefa';
  exception when no_data_found then null;
  end;
  begin
    perform public.worker_report_result(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'),
      current_setting('test.t_paid')::uuid, 'SUCCESS', 'ACTIVATED', 'Pacote activado com sucesso');
    raise exception 'FAIL 8.4: SUCCESS de uma tarefa não iniciada';
  exception when object_not_in_prerequisite_state then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'TASK_NOT_ASSIGNED' then raise exception 'FAIL 8.4b: %', v_hint; end if;
  end;

  v_payload := public.worker_start_task(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), current_setting('test.t_paid')::uuid);
  select * into v_task from public.activation_tasks where id = current_setting('test.t_paid')::uuid;
  if v_task.status <> 'EXECUTING' or v_task.attempt_count <> 1 or v_task.started_at is null
     or (select status from public.orders where id = v_task.order_id) <> 'ACTIVATING' then
    raise exception 'FAIL 8.5: início da execução incorreto (%)', v_task;
  end if;
  begin
    perform public.worker_start_task(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), current_setting('test.t_paid')::uuid);
    raise exception 'FAIL 8.6: a mesma tarefa iniciada duas vezes';
  exception when object_not_in_prerequisite_state then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'TASK_NOT_ASSIGNED' then raise exception 'FAIL 8.6b: %', v_hint; end if;
  end;
  perform public.worker_report_progress(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), v_task.id, 'SUBMITTED');
  begin
    perform public.worker_report_result(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), v_task.id,
      'SUCCESS', 'MANUAL_CONFIRMED', 'Pacote activado com sucesso');
    raise exception 'FAIL 8.7: worker enviou uma decisão manual';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.worker_report_result(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), v_task.id,
      'SUCCESS', 'TIMEOUT', 'x');
    raise exception 'FAIL 8.8: código incompatível com o resultado aceite';
  exception when invalid_parameter_value then null;
  end;
  select * into v_task from public.worker_report_result(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), v_task.id,
    'SUCCESS', 'ACTIVATED', 'Pacote 1GB activado com SUCESSO para 840000777.', '*111# › 5 › 840000777 › 1');
  if v_task.status <> 'SUCCESS' or v_task.result_code <> 'ACTIVATED' or v_task.completed_at is null
     or (select status from public.orders where id = v_task.order_id) <> 'COMPLETED' then
    raise exception 'FAIL 8.9: sucesso comprovado não concluiu tarefa / pedido (%)', v_task;
  end if;
  if not exists (select 1 from public.activation_task_attempts where task_id = v_task.id and outcome = 'SUCCESS'
                    and source = 'WORKER' and attempt_number = 1 and slot_index = 0 and ussd_trace like '*111#%') then
    raise exception 'FAIL 8.10: tentativa de sucesso não registada';
  end if;
  begin
    perform public.worker_report_result(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), v_task.id,
      'FAILED', 'NETWORK_ERROR');
    raise exception 'FAIL 8.11: resultado reportado duas vezes';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;

-- Worker claims, checked against the product's own texts.
do $$
declare
  v_payload jsonb;
  v_task    public.activation_tasks;
  v_dev     uuid := current_setting('test.dev_a')::uuid;
  v_tok     text := current_setting('test.tok_a');
begin
  -- (a) SUCCESS claimed, screen proves nothing → UNKNOWN, no retry, order stays ACTIVATING.
  v_payload := public.worker_fetch_task(v_dev, v_tok);
  perform set_config('test.t_x', v_payload ->> 'task_id', true);
  perform public.worker_start_task(v_dev, v_tok, (v_payload ->> 'task_id')::uuid);
  perform public.worker_report_progress(v_dev, v_tok, (v_payload ->> 'task_id')::uuid, 'SUBMITTED');
  select * into v_task from public.worker_report_result(v_dev, v_tok, (v_payload ->> 'task_id')::uuid,
    'SUCCESS', 'ACTIVATED', 'Obrigado por usar os nossos servicos.');
  if v_task.status <> 'UNKNOWN' or v_task.result_code <> 'UNKNOWN_RESPONSE'
     or (select status from public.orders where id = v_task.order_id) <> 'ACTIVATING' then
    raise exception 'FAIL 8.12: sucesso não comprovado não ficou UNKNOWN (%)', v_task;
  end if;
  perform set_config('test.t_unknown', v_task.id::text, true);

  -- (b) FAILED after submission without failure text → UNKNOWN (it may have run).
  v_payload := public.worker_fetch_task(v_dev, v_tok);
  perform public.worker_start_task(v_dev, v_tok, (v_payload ->> 'task_id')::uuid);
  perform public.worker_report_progress(v_dev, v_tok, (v_payload ->> 'task_id')::uuid, 'SUBMITTED');
  perform public.worker_report_progress(v_dev, v_tok, (v_payload ->> 'task_id')::uuid, 'VERIFYING');
  select * into v_task from public.worker_report_result(v_dev, v_tok, (v_payload ->> 'task_id')::uuid, 'FAILED', 'TIMEOUT', null);
  if v_task.status <> 'UNKNOWN' or v_task.result_code <> 'TIMEOUT' then
    raise exception 'FAIL 8.13: falha não comprovada após submissão não ficou UNKNOWN (%)', v_task.status;
  end if;
  perform set_config('test.t_unknown2', v_task.id::text, true);

  -- (c) Failure before submission, retryable → back to the queue automatically.
  v_payload := public.worker_fetch_task(v_dev, v_tok);
  perform set_config('test.t_retry', v_payload ->> 'task_id', true);
  perform public.worker_start_task(v_dev, v_tok, (v_payload ->> 'task_id')::uuid);
  select * into v_task from public.worker_report_result(v_dev, v_tok, (v_payload ->> 'task_id')::uuid, 'FAILED', 'NETWORK_ERROR');
  if v_task.status <> 'QUEUED' or v_task.attempt_count <> 1 or v_task.device_id is not null then
    raise exception 'FAIL 8.14: falha repetível não voltou à fila (%)', v_task;
  end if;
  if not exists (select 1 from public.activation_task_events where task_id = v_task.id and event_type = 'activation_task.retried') then
    raise exception 'FAIL 8.15: nova tentativa sem histórico';
  end if;

  -- (d) Operator's failure text after submission → FAILED, not retried (INSUFFICIENT_BALANCE).
  v_payload := public.worker_fetch_task(v_dev, v_tok);
  perform set_config('test.t_balance', v_payload ->> 'task_id', true);
  perform public.worker_start_task(v_dev, v_tok, (v_payload ->> 'task_id')::uuid);
  perform public.worker_report_progress(v_dev, v_tok, (v_payload ->> 'task_id')::uuid, 'SUBMITTED');
  select * into v_task from public.worker_report_result(v_dev, v_tok, (v_payload ->> 'task_id')::uuid,
    'FAILED', 'INSUFFICIENT_BALANCE', 'Operacao falhou: saldo insuficiente.');
  if v_task.status <> 'FAILED' or v_task.result_code <> 'INSUFFICIENT_BALANCE'
     or (select status from public.orders where id = v_task.order_id) <> 'FAILED' then
    raise exception 'FAIL 8.16: falha da operadora não ficou FAILED final (%)', v_task;
  end if;

  -- (e) FAILED claimed but the screen says success → UNKNOWN (contradiction).
  v_payload := public.worker_fetch_task(v_dev, v_tok);
  perform set_config('test.t_contra', v_payload ->> 'task_id', true);
  perform public.worker_start_task(v_dev, v_tok, (v_payload ->> 'task_id')::uuid);
  select * into v_task from public.worker_report_result(v_dev, v_tok, (v_payload ->> 'task_id')::uuid,
    'FAILED', 'USSD_REJECTED', 'Pacote activado com sucesso');
  if v_task.status <> 'UNKNOWN' then
    raise exception 'FAIL 8.17: resultado contraditório não ficou UNKNOWN (%)', v_task.status;
  end if;

  -- (f) SIM_UNAVAILABLE before start: SIM taken out of rotation, task re-queued.
  v_payload := public.worker_fetch_task(v_dev, v_tok);
  perform set_config('test.t_sim', v_payload ->> 'task_id', true);
  select * into v_task from public.worker_report_result(v_dev, v_tok, (v_payload ->> 'task_id')::uuid, 'FAILED', 'SIM_UNAVAILABLE');
  if v_task.status <> 'QUEUED' or v_task.attempt_count <> 1
     or (select status from public.device_sims where id = current_setting('test.sim_a0')::uuid) <> 'UNAVAILABLE' then
    raise exception 'FAIL 8.18: SIM indisponível não saiu de rotação (% / %)', v_task.status,
      (select status from public.device_sims where id = current_setting('test.sim_a0')::uuid);
  end if;
  begin
    perform public.worker_report_result(v_dev, v_tok, (v_payload ->> 'task_id')::uuid, 'SUCCESS', 'ACTIVATED', 'sucesso');
    raise exception 'FAIL 8.19: resultado de tarefa que já não é deste dispositivo';
  exception when no_data_found then null;
  end;
end;
$$;

-- UNKNOWN never retries: no dispatcher run brings it back.
do $$
declare
  v_task public.activation_tasks;
begin
  -- slot 0 detected again → back in rotation
  perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), null, null, null,
    '[{"slot_index": 0, "fingerprint": "sub-0001-aaaa"}, {"slot_index": 1, "fingerprint": "sub-0002-bbbb"}]');
  perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'));
  select * into v_task from public.activation_tasks where id = current_setting('test.t_unknown')::uuid;
  if v_task.status <> 'UNKNOWN' or v_task.attempt_count <> 1 then
    raise exception 'FAIL 8.20: UNKNOWN foi repetido automaticamente';
  end if;
  if (select status from public.device_sims where id = current_setting('test.sim_a0')::uuid) <> 'ACTIVE' then
    raise exception 'FAIL 8.21: SIM detetado novamente não voltou a ACTIVE';
  end if;
end;
$$;

-- 9. SIM identity: a different SIM in the slot is never used as the registered one -------------
do $$
begin
  perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), null, null, null,
    '[{"slot_index": 0, "fingerprint": "sub-9999-zzzz"}, {"slot_index": 1, "fingerprint": "sub-0002-bbbb"}]');
  if (select status || '/' || unavailable_reason from public.device_sims where id = current_setting('test.sim_a0')::uuid) <> 'UNAVAILABLE/SIM_CHANGED' then
    raise exception 'FAIL 9.1: SIM trocado no slot não foi detetado';
  end if;
  -- Re-detection with the old fingerprint does NOT silently restore a changed SIM.
  perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), null, null, null,
    '[{"slot_index": 0, "fingerprint": "sub-9999-zzzz"}]');
  if (select status from public.device_sims where id = current_setting('test.sim_a0')::uuid) <> 'UNAVAILABLE' then
    raise exception 'FAIL 9.2: SIM trocado reativado sem decisão';
  end if;
  -- Slot 1 not reported → NOT_DETECTED.
  if (select unavailable_reason from public.device_sims where id = current_setting('test.sim_a1')::uuid) <> 'NOT_DETECTED' then
    raise exception 'FAIL 9.3: SIM ausente não ficou indisponível';
  end if;

  -- Owner confirms the new SIM: fingerprint cleared, adopted on the next heartbeat.
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a1", "role": "authenticated"}', true);
  perform public.update_device_sim(current_setting('test.sim_a0')::uuid, null, null, 'ACTIVE');
  if (select sim_fingerprint from public.device_sims where id = current_setting('test.sim_a0')::uuid) is not null then
    raise exception 'FAIL 9.4: impressão digital antiga mantida após confirmação';
  end if;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a3", "role": "authenticated"}', true);
  perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'), null, null, null,
    '[{"slot_index": 0, "fingerprint": "sub-9999-zzzz"}, {"slot_index": 1, "fingerprint": "sub-0002-bbbb"}]');
  if (select sim_fingerprint from public.device_sims where id = current_setting('test.sim_a0')::uuid) <> 'sub-9999-zzzz' then
    raise exception 'FAIL 9.5: novo SIM não foi adotado';
  end if;
end;
$$;

-- 10. People decide: resolve UNKNOWN, retry FAILED (owner / admin only) -------------------------
do $$
declare
  v_task public.activation_tasks;
  v_hint text;
begin
  begin
    perform public.resolve_activation_task(current_setting('test.t_unknown')::uuid, 'SUCCESS', 'Operador');
    raise exception 'FAIL 10.1: operador decidiu um UNKNOWN';
  exception when no_data_found then null;
  end;
  begin
    perform public.retry_activation_task(current_setting('test.t_balance')::uuid);
    raise exception 'FAIL 10.2: operador repetiu uma tarefa';
  exception when no_data_found then null;
  end;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a1", "role": "authenticated"}', true);
  begin
    perform public.resolve_activation_task(current_setting('test.t_unknown')::uuid, 'SUCCESS', '   ');
    raise exception 'FAIL 10.3: decisão sem explicação aceite';
  exception when invalid_parameter_value then null;
  end;
  select * into v_task from public.resolve_activation_task(current_setting('test.t_unknown')::uuid, 'SUCCESS',
    'Cliente confirmou por telefone que recebeu o pacote.');
  if v_task.status <> 'SUCCESS' or v_task.result_code <> 'MANUAL_CONFIRMED'
     or (select status from public.orders where id = v_task.order_id) <> 'COMPLETED' then
    raise exception 'FAIL 10.4: decisão manual não concluiu (%)', v_task;
  end if;
  if not exists (select 1 from public.activation_task_attempts where task_id = v_task.id and source = 'MANUAL'
                    and decided_by = '00000000-0000-4000-8000-0000000006a1' and outcome = 'SUCCESS') then
    raise exception 'FAIL 10.5: decisão manual sem evidência registada';
  end if;
  begin
    perform public.resolve_activation_task(current_setting('test.t_paid')::uuid, 'FAILED', 'Mudei de ideias');
    raise exception 'FAIL 10.6: SUCCESS reaberto por decisão manual';
  exception when object_not_in_prerequisite_state then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'TASK_NOT_UNKNOWN' then raise exception 'FAIL 10.6b: %', v_hint; end if;
  end;
  select * into v_task from public.resolve_activation_task(current_setting('test.t_unknown2')::uuid, 'FAILED',
    'Operadora confirmou que a ativação não foi feita.');
  if v_task.status <> 'FAILED' or (select status from public.orders where id = v_task.order_id) <> 'FAILED' then
    raise exception 'FAIL 10.7: rejeição manual incorreta';
  end if;

  -- Explicit retry of a final FAILED (even non-retryable codes: a person decided).
  select * into v_task from public.retry_activation_task(current_setting('test.t_balance')::uuid, 'Saldo carregado no SIM.');
  if v_task.status not in ('QUEUED', 'ASSIGNED') or v_task.max_attempts < v_task.attempt_count + 1
     or (select status from public.orders where id = v_task.order_id) not in ('READY_FOR_ACTIVATION') then
    raise exception 'FAIL 10.8: repetição manual incorreta (% / %)', v_task.status, (select status from public.orders where id = v_task.order_id);
  end if;
  begin
    perform public.retry_activation_task(current_setting('test.t_paid')::uuid);
    raise exception 'FAIL 10.9: tarefa concluída repetida';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.retry_activation_task(current_setting('test.t_contra')::uuid);
    raise exception 'FAIL 10.10: UNKNOWN repetido sem decisão';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;

-- 11. Forgery through the API: all refused --------------------------------------------------
do $$
begin
  begin
    update public.activation_tasks set status = 'SUCCESS' where id = current_setting('test.t_contra')::uuid;
    raise exception 'FAIL 11.1: SUCCESS forjado';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set status = 'COMPLETED' where id = current_setting('test.o_v7')::uuid;
    raise exception 'FAIL 11.2: COMPLETED forjado';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set status = 'PAID' where id = current_setting('test.o_v7')::uuid;
    raise exception 'FAIL 11.3: PAID forjado';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.activation_tasks (tenant_id, order_id, product_id, operator, ussd_flow)
    values (current_setting('test.alfa')::uuid, current_setting('test.o_v7')::uuid, current_setting('test.p_voda')::uuid, 'vodacom', '{}');
    raise exception 'FAIL 11.4: tarefa inserida pela API';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.activation_task_attempts (tenant_id, task_id, sequence, attempt_number, outcome, result_code, source)
    values (current_setting('test.alfa')::uuid, current_setting('test.t_contra')::uuid, 99, 1, 'SUCCESS', 'ACTIVATED', 'WORKER');
    raise exception 'FAIL 11.5: tentativa forjada';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.devices set last_seen_at = now(), status = 'ACTIVE' where id = current_setting('test.dev_a3')::uuid;
    raise exception 'FAIL 11.6: heartbeat / estado forjado diretamente';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.device_sims set status = 'ACTIVE' where id = current_setting('test.sim_a1')::uuid;
    raise exception 'FAIL 11.7: SIM alterado diretamente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.dispatch_activation_tasks(current_setting('test.alfa')::uuid, 10);
    raise exception 'FAIL 11.8: dispatcher interno executado pela API';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.activation_payload(t) from public.activation_tasks t limit 1;
    raise exception 'FAIL 11.9: payload interno pela API';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 12. Database owner: invariants still hold (defense in depth) ------------------------------
reset role;
do $$
declare
  v_hint text;
begin
  begin
    update public.activation_tasks set status = 'SUCCESS' where id = current_setting('test.t_contra')::uuid;
    raise exception 'FAIL 12.1: UNKNOWN → SUCCESS sem decisão';
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint not in ('DECISION_REQUIRED', 'RESULT_WITHOUT_EVIDENCE') then raise exception 'FAIL 12.1b: %', v_hint; end if;
  end;
  begin
    update public.activation_tasks set status = 'EXECUTING' where id = current_setting('test.t_paid')::uuid;
    raise exception 'FAIL 12.2: SUCCESS → EXECUTING';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.activation_tasks set status = 'EXECUTING' where id = current_setting('test.t_unknown2')::uuid;
    raise exception 'FAIL 12.3: FAILED → EXECUTING';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.activation_tasks set status = 'QUEUED' where id = current_setting('test.t_unknown2')::uuid;
    raise exception 'FAIL 12.4: FAILED (rejeição manual) → QUEUED sem decisão de repetir';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.activation_tasks set order_id = current_setting('test.o_v7')::uuid where id = current_setting('test.t_paid')::uuid;
    raise exception 'FAIL 12.5: origem da tarefa alterada';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.activation_task_attempts set outcome = 'SUCCESS' where task_id = current_setting('test.t_unknown2')::uuid;
    raise exception 'FAIL 12.6: tentativa reescrita';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.activation_task_events where task_id = current_setting('test.t_paid')::uuid;
    raise exception 'FAIL 12.7: histórico apagado';
  exception when insufficient_privilege then null;
  end;
  -- Assignment to a SIM of another device / network.
  begin
    update public.activation_tasks set status = 'ASSIGNED', device_id = current_setting('test.dev_a2')::uuid,
           sim_id = current_setting('test.sim_a1')::uuid where id = current_setting('test.t_v7')::uuid;
    raise exception 'FAIL 12.8: SIM de outro dispositivo aceite';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.activation_tasks set status = 'ASSIGNED', device_id = current_setting('test.dev_a')::uuid,
           sim_id = current_setting('test.sim_a1')::uuid where id = current_setting('test.t_v7')::uuid;
    raise exception 'FAIL 12.9: SIM de outra rede aceite';
  exception when insufficient_privilege then null;
  end;
  -- Double assignment of a busy SIM.
  begin
    update public.activation_tasks set status = 'ASSIGNED', device_id = d.device_id, sim_id = d.sim_id
      from (select device_id, sim_id from public.activation_tasks
             where status in ('ASSIGNED', 'EXECUTING') and sim_id is not null limit 1) d
     where id = current_setting('test.t_v7')::uuid;
    if found then
      raise exception 'FAIL 12.10: SIM ocupado atribuído duas vezes';
    end if;
  exception when unique_violation then null;
  end;
  begin
    insert into public.activation_tasks (tenant_id, order_id, product_id, operator, ussd_flow)
    select o.tenant_id, o.id, o.product_id, o.operator_snapshot, '{"version": 1, "start": "*111#", "steps": [{"type": "confirm"}]}'
      from public.orders o where o.tenant_id = current_setting('test.alfa')::uuid and o.status = 'PENDING' limit 1;
    if found then
      raise exception 'FAIL 12.11: tarefa para pedido não pago';
    end if;
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 13. service_role (future backend jobs) is verified outside the SQL Editor: the role switch
--     needs privileges the Editor may not have. See supabase/README.md (Migration 006).

-- 14. Tenant isolation ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006b1", "role": "authenticated"}', true);
do $$
declare
  v_new record;
begin
  if exists (select 1 from public.devices) or exists (select 1 from public.device_sims)
     or exists (select 1 from public.activation_task_attempts)
     or exists (select 1 from public.activation_task_events where tenant_id <> current_setting('test.beta')::uuid)
     or exists (select 1 from public.activation_tasks where tenant_id <> current_setting('test.beta')::uuid)
     or (select count(*) from public.activation_tasks) <> 1 then
    raise exception 'FAIL 14.1: Beta vê dispositivos / tarefas de Alfa';
  end if;
  begin
    perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'));
    raise exception 'FAIL 14.2: Beta usou o token de um dispositivo de Alfa';
  exception when no_data_found then null;
  end;
  begin
    perform public.update_device(current_setting('test.dev_a')::uuid, null, 'DISABLED');
    raise exception 'FAIL 14.3: Beta desativou dispositivo de Alfa';
  exception when no_data_found then null;
  end;
  begin
    perform public.register_device_sim(current_setting('test.dev_a')::uuid, 3, 'vodacom');
    raise exception 'FAIL 14.4: Beta registou SIM em dispositivo de Alfa';
  exception when no_data_found then null;
  end;
  begin
    perform public.update_device_sim(current_setting('test.sim_a0')::uuid, null, null, 'DISABLED');
    raise exception 'FAIL 14.5: Beta alterou SIM de Alfa';
  exception when no_data_found then null;
  end;
  begin
    perform public.retry_activation_task(current_setting('test.t_unknown2')::uuid);
    raise exception 'FAIL 14.6: Beta repetiu tarefa de Alfa';
  exception when no_data_found then null;
  end;
  begin
    perform public.resolve_activation_task(current_setting('test.t_contra')::uuid, 'SUCCESS', 'Intrusão');
    raise exception 'FAIL 14.7: Beta decidiu tarefa de Alfa';
  exception when no_data_found then null;
  end;
  begin
    perform public.dispatch_activation_tasks(current_setting('test.alfa')::uuid);
    raise exception 'FAIL 14.8: Beta distribuiu tarefas de Alfa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_device_pairing_code(current_setting('test.dev_a')::uuid);
    raise exception 'FAIL 14.9: Beta gerou código para dispositivo de Alfa';
  exception when no_data_found then null;
  end;
  -- Beta's own device cannot take Alfa's work.
  select * into v_new from public.create_device(current_setting('test.beta')::uuid, 'Worker Beta');
  perform set_config('test.dev_b', v_new.device_id::text, true);
  perform set_config('test.code_b', v_new.pairing_code, true);
end;
$$;

-- 15. Platform admin: no automatic access; explicit read-only functions ---------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006c1", "role": "authenticated"}', true);
do $$
begin
  if exists (select 1 from public.devices) or exists (select 1 from public.activation_tasks)
     or exists (select 1 from public.activation_task_attempts) or exists (select 1 from public.device_sims) then
    raise exception 'FAIL 15.1: platform admin lê dados de ativação pelas queries normais';
  end if;
  if (select count(*) from public.platform_list_tenant_devices(current_setting('test.alfa')::uuid)) <> 3
     or (select count(*) from public.platform_list_tenant_activation_tasks(current_setting('test.alfa')::uuid)) <> 9 then
    raise exception 'FAIL 15.2: funções de plataforma não devolvem os dados da empresa';
  end if;
  begin
    perform public.update_device(current_setting('test.dev_a')::uuid, null, 'DISABLED');
    raise exception 'FAIL 15.3: platform admin alterou dispositivo';
  exception when no_data_found then null;
  end;
end;
$$;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a3", "role": "authenticated"}', true);
do $$
begin
  begin
    perform public.platform_list_tenant_devices(current_setting('test.alfa')::uuid);
    raise exception 'FAIL 15.4: membro de empresa usou função de plataforma';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 16. Stale work: never-started assignment returns; silent execution becomes UNKNOWN ---------
reset role;
do $$
declare
  v_task public.activation_tasks;
begin
  select * into v_task from public.activation_tasks
   where tenant_id = current_setting('test.alfa')::uuid and status = 'ASSIGNED' limit 1;
  if v_task.id is null then
    raise exception 'FAIL 16.0: esperada uma tarefa atribuída';
  end if;
  update public.activation_tasks set assigned_at = now() - interval '2 hours' where id = v_task.id;
  perform private.expire_stale_activation_tasks(current_setting('test.alfa')::uuid);
  if (select status from public.activation_tasks where id = v_task.id) <> 'QUEUED' then
    raise exception 'FAIL 16.1: atribuição abandonada não voltou à fila';
  end if;
  if not exists (select 1 from public.activation_task_events where task_id = v_task.id and event_type = 'activation_task.unassigned') then
    raise exception 'FAIL 16.2: devolução à fila sem histórico';
  end if;
  perform private.dispatch_activation_tasks(current_setting('test.alfa')::uuid, 5);
  select * into v_task from public.activation_tasks
   where tenant_id = current_setting('test.alfa')::uuid and status = 'ASSIGNED' order by assigned_at limit 1;
  update public.activation_tasks set status = 'EXECUTING', started_at = now() - interval '3 hours', attempt_count = attempt_count + 1
   where id = v_task.id;
  perform private.expire_stale_activation_tasks(current_setting('test.alfa')::uuid);
  select * into v_task from public.activation_tasks where id = v_task.id;
  if v_task.status <> 'UNKNOWN' or v_task.result_code <> 'TIMEOUT'
     or not exists (select 1 from public.activation_task_attempts where task_id = v_task.id and source = 'SYSTEM' and outcome = 'UNKNOWN') then
    raise exception 'FAIL 16.3: execução sem resposta não ficou UNKNOWN (%)', v_task.status;
  end if;
end;
$$;

-- 17. Suspended tenant: reads only; work already started can still report ------------------
do $$
declare
  v_task public.activation_tasks;
begin
  -- dev_a2 has a task running when the tenant is suspended.
  select * into v_task from public.activation_tasks where device_id = current_setting('test.dev_a2')::uuid and status = 'ASSIGNED';
  if v_task.id is null then
    raise exception 'FAIL 17.0: esperada a tarefa do worker 2';
  end if;
  perform set_config('test.t_w2', v_task.id::text, true);
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a3", "role": "authenticated"}', true);
select public.worker_start_task(current_setting('test.dev_a2')::uuid, current_setting('test.tok_a2'), current_setting('test.t_w2')::uuid);
reset role;
update public.tenants set status = 'suspended' where id = current_setting('test.alfa')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a1", "role": "authenticated"}', true);
do $$
declare
  v_hint text;
begin
  if (select count(*) from public.devices) = 0 or (select count(*) from public.activation_tasks) = 0 then
    raise exception 'FAIL 17.1: empresa suspensa deixou de ler o histórico';
  end if;
  begin
    perform public.create_device(current_setting('test.alfa')::uuid, 'Suspenso');
    raise exception 'FAIL 17.2: dispositivo criado com a empresa suspensa';
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'TENANT_SUSPENDED' then raise exception 'FAIL 17.2b: %', v_hint; end if;
  end;
  begin
    perform public.register_device_sim(current_setting('test.dev_a')::uuid, 5, 'vodacom');
    raise exception 'FAIL 17.3: SIM registado com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_device(current_setting('test.dev_a')::uuid, 'Novo nome');
    raise exception 'FAIL 17.4: dispositivo alterado com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.retry_activation_task(current_setting('test.t_unknown2')::uuid);
    raise exception 'FAIL 17.5: tarefa repetida com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.dispatch_activation_tasks(current_setting('test.alfa')::uuid);
    raise exception 'FAIL 17.6: distribuição com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a3", "role": "authenticated"}', true);
  begin
    perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'));
    raise exception 'FAIL 17.7: heartbeat com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.worker_fetch_task(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'));
    raise exception 'FAIL 17.8: nova tarefa entregue com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  -- The activation that was already running reports its result.
  perform public.worker_report_progress(current_setting('test.dev_a2')::uuid, current_setting('test.tok_a2'),
    current_setting('test.t_w2')::uuid, 'SUBMITTED');
  if (select status from public.worker_report_result(current_setting('test.dev_a2')::uuid, current_setting('test.tok_a2'),
        current_setting('test.t_w2')::uuid, 'SUCCESS', 'ACTIVATED', 'Activacao feita com sucesso')) <> 'SUCCESS' then
    raise exception 'FAIL 17.9: resultado de trabalho já iniciado recusado';
  end if;
end;
$$;
reset role;
update public.tenants set status = 'active' where id = current_setting('test.alfa')::uuid;

-- 18. Disabling a device: its pending work returns to the queue; the token stops working ------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a1", "role": "authenticated"}', true);
do $$
declare
  v_code record;
begin
  perform public.update_device(current_setting('test.dev_a2')::uuid, null, 'DISABLED');
  if exists (select 1 from public.activation_tasks where device_id = current_setting('test.dev_a2')::uuid and status = 'ASSIGNED') then
    raise exception 'FAIL 18.1: tarefa ficou atribuída a dispositivo desativado';
  end if;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a3", "role": "authenticated"}', true);
  begin
    perform public.device_heartbeat(current_setting('test.dev_a2')::uuid, current_setting('test.tok_a2'));
    raise exception 'FAIL 18.2: dispositivo desativado continua a trabalhar';
  exception when insufficient_privilege then null;
  end;
  -- Re-pairing replaces the token.
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a1", "role": "authenticated"}', true);
  select * into v_code from public.create_device_pairing_code(current_setting('test.dev_a')::uuid);
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006a3", "role": "authenticated"}', true);
  perform public.register_device(v_code.pairing_code, 'android-install-0001', 'ANDROID', '1.0.2');
  begin
    perform public.device_heartbeat(current_setting('test.dev_a')::uuid, current_setting('test.tok_a'));
    raise exception 'FAIL 18.3: token antigo continua válido após novo emparelhamento';
  exception when no_data_found then null;
  end;
end;
$$;

-- 19. Audit and global invariants ---------------------------------------------------------
reset role;
do $$
declare
  v_alfa uuid := current_setting('test.alfa')::uuid;
  v_action text;
begin
  foreach v_action in array array['device.created', 'device.registered', 'device.disabled', 'device.re_paired',
    'device.pairing_code_created', 'sim.registered', 'activation_task.created', 'activation_task.assigned',
    'activation_task.started', 'activation_task.completed', 'activation_task.failed', 'activation_task.unknown',
    'activation_task.retried', 'activation_task.resolved', 'activation_task.retried_manually'] loop
    if not exists (select 1 from public.audit_logs where tenant_id = v_alfa and action = v_action) then
      raise exception 'FAIL 19.1: auditoria em falta: %', v_action;
    end if;
  end loop;
  if exists (select 1 from public.audit_logs where tenant_id = v_alfa
                and (action like 'device%' or action like 'sim.%' or action like 'activation_task%')
                and metadata::text ~ '(mbdt_|token|\+258|8[2-7][0-9]{7}|sucesso)') then
    raise exception 'FAIL 19.2: tokens, telefones ou respostas na auditoria';
  end if;
  if exists (select order_id from public.activation_tasks group by order_id having count(*) > 1) then
    raise exception 'FAIL 19.3: pedido com mais de uma tarefa';
  end if;
  if exists (select 1 from public.orders o where o.tenant_id = v_alfa and o.status = 'COMPLETED'
                and not exists (select 1 from public.activation_tasks t where t.order_id = o.id and t.status = 'SUCCESS')) then
    raise exception 'FAIL 19.4: pedido concluído sem ativação confirmada';
  end if;
  if exists (select 1 from public.activation_tasks t where t.status = 'SUCCESS'
                and not exists (select 1 from public.activation_task_attempts a where a.task_id = t.id and a.outcome = 'SUCCESS')) then
    raise exception 'FAIL 19.5: sucesso sem evidência';
  end if;
  if exists (select 1 from public.activation_tasks t join public.device_sims s on s.id = t.sim_id
              where t.operator <> s.operator or t.tenant_id <> s.tenant_id or s.device_id <> t.device_id) then
    raise exception 'FAIL 19.6: tarefa ligada a SIM de outra rede, empresa ou dispositivo';
  end if;
end;
$$;

-- 20. Rule by rule, in an isolated tenant (Gama) whose state the test fully controls ------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006d1", "role": "authenticated"}', true);
do $$
declare
  v_gama uuid;
  v_dev  record;
  v_reg  record;
  v_sim  public.device_sims;
begin
  select tenant_id into v_gama from public.tenant_users where user_id = '00000000-0000-4000-8000-0000000006d1' and role = 'owner';
  perform set_config('test.gama', v_gama::text, true);
  -- g1 and g2 paired by the owner (also a member); g3's code will expire.
  select * into v_dev from public.create_device(v_gama, 'Gama 1');
  select * into v_reg from public.register_device(v_dev.pairing_code, 'gama-install-1', 'ANDROID', '1.0.0');
  perform set_config('test.g1', v_reg.device_id::text, true);
  perform set_config('test.g1_tok', v_reg.device_token, true);
  select * into v_dev from public.create_device(v_gama, 'Gama 2');
  select * into v_reg from public.register_device(v_dev.pairing_code, 'gama-install-2', 'ANDROID', '1.0.0');
  perform set_config('test.g2', v_reg.device_id::text, true);
  perform set_config('test.g2_tok', v_reg.device_token, true);
  select * into v_dev from public.create_device(v_gama, 'Gama 3');
  perform set_config('test.g3_code', v_dev.pairing_code, true);
  -- g1: slot 0 disabled, slot 1 active; g2: slot 0 active.
  select * into v_sim from public.register_device_sim(current_setting('test.g1')::uuid, 0, 'vodacom');
  perform public.update_device_sim(v_sim.id, null, null, 'DISABLED');
  perform set_config('test.g1_s0', v_sim.id::text, true);
  select * into v_sim from public.register_device_sim(current_setting('test.g1')::uuid, 1, 'vodacom');
  perform set_config('test.g1_s1', v_sim.id::text, true);
  select * into v_sim from public.register_device_sim(current_setting('test.g2')::uuid, 0, 'vodacom');
  perform set_config('test.g2_s0', v_sim.id::text, true);
  -- g2 reports its capabilities once (then goes silent).
  perform public.device_heartbeat(current_setting('test.g2')::uuid, current_setting('test.g2_tok'), null,
    '{"ussd": true, "ussd_interactive": true}', null, '[{"slot_index": 0, "fingerprint": "gama-0002-sim0"}]');
end;
$$;

reset role;
do $$
declare
  v_product uuid;
  v_case    text;
  v_id      uuid;
begin
  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (current_setting('test.gama')::uuid, 'Gama 1GB', 'daily', 50, 1, 'GB', 24, 'vodacom', 'ACTIVE',
          '{"version": 1, "start": "*111#", "steps": [{"type": "confirm"}], "success": {"contains": ["sucesso"]}}')
  returning id into v_product;
  foreach v_case in array array['g_o1', 'g_o2', 'g_o3', 'g_pending'] loop
    insert into public.orders (tenant_id, product_id, customer_phone) values (current_setting('test.gama')::uuid, v_product, '840000050')
    returning id into v_id;
    if v_case <> 'g_pending' then
      update public.orders set status = 'AWAITING_PAYMENT' where id = v_id;
      update public.orders set status = 'PAID' where id = v_id;
      perform set_config('test.' || replace(v_case, '_o', '_t'), (select id::text from public.activation_tasks where order_id = v_id), true);
    end if;
    perform set_config('test.' || v_case, v_id::text, true);
  end loop;
  update public.devices set last_seen_at = now() - interval '1 hour' where id = current_setting('test.g2')::uuid;
  update public.device_credentials set pairing_expires_at = now() - interval '1 second'
   where device_id = (select id from public.devices where tenant_id = current_setting('test.gama')::uuid and device_name = 'Gama 3');
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006d1", "role": "authenticated"}', true);
do $$
declare
  v_hb   jsonb;
  v_task public.activation_tasks;
  v_hint text;
begin
  begin
    perform public.register_device(current_setting('test.g3_code'), 'gama-install-3', 'ANDROID', '1.0.0');
    raise exception 'FAIL 20.1: código de emparelhamento expirado aceite';
  exception when no_data_found then null;
  end;

  v_hb := public.device_heartbeat(current_setting('test.g1')::uuid, current_setting('test.g1_tok'), null,
    '{"ussd": true, "ussd_interactive": true}', null,
    '[{"slot_index": 0, "fingerprint": "gama-0001-sim0"}, {"slot_index": 1, "fingerprint": "gama-0001-sim1"}]');
  select * into v_task from public.activation_tasks where id = current_setting('test.g_t1')::uuid;
  if v_task.status <> 'ASSIGNED' or v_task.sim_id <> current_setting('test.g1_s1')::uuid then
    raise exception 'FAIL 20.2: tarefa não foi para o SIM ativo (slot 0 está desativado) (% / %)', v_task.status, v_task.sim_id;
  end if;
  if (select status from public.activation_tasks where id = current_setting('test.g_t2')::uuid) <> 'QUEUED' then
    raise exception 'FAIL 20.3: tarefa atribuída a um dispositivo offline';
  end if;

  begin
    perform public.worker_report_result(current_setting('test.g1')::uuid, current_setting('test.g1_tok'),
      current_setting('test.g_t1')::uuid, 'SUCCESS', 'ACTIVATED', 'sucesso');
    raise exception 'FAIL 20.4: SUCCESS de tarefa não iniciada';
  exception when object_not_in_prerequisite_state then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'TASK_NOT_ASSIGNED' then raise exception 'FAIL 20.4b: %', v_hint; end if;
  end;
end;
$$;

-- Last attempt: a retryable failure no longer goes back to the queue.
reset role;
update public.activation_tasks set attempt_count = 2 where id = current_setting('test.g_t1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000006d1", "role": "authenticated"}', true);
do $$
declare
  v_task public.activation_tasks;
begin
  perform public.worker_start_task(current_setting('test.g1')::uuid, current_setting('test.g1_tok'), current_setting('test.g_t1')::uuid);
  select * into v_task from public.worker_report_result(current_setting('test.g1')::uuid, current_setting('test.g1_tok'),
    current_setting('test.g_t1')::uuid, 'FAILED', 'NETWORK_ERROR');
  if v_task.status <> 'FAILED' or v_task.attempt_count <> 3
     or (select status from public.orders where id = current_setting('test.g_o1')::uuid) <> 'FAILED' then
    raise exception 'FAIL 20.5: limite de tentativas ignorado (% / %)', v_task.status, v_task.attempt_count;
  end if;
  -- Next task starts on g1 (for the evidence check below).
  perform public.worker_fetch_task(current_setting('test.g1')::uuid, current_setting('test.g1_tok'));
  perform public.worker_start_task(current_setting('test.g1')::uuid, current_setting('test.g1_tok'), current_setting('test.g_t2')::uuid);
end;
$$;

reset role;
do $$
declare
  v_hint text;
begin
  begin
    update public.activation_tasks set status = 'SUCCESS' where id = current_setting('test.g_t2')::uuid;
    raise exception 'FAIL 20.6: SUCCESS sem tentativa que o prove';
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'RESULT_WITHOUT_EVIDENCE' then raise exception 'FAIL 20.6b: %', v_hint; end if;
  end;
  begin
    insert into public.activation_tasks (tenant_id, order_id, product_id, operator, ussd_flow)
    select o.tenant_id, o.id, o.product_id, o.operator_snapshot, p.ussd_flow
      from public.orders o join public.products p on p.id = o.product_id
     where o.id = current_setting('test.g_pending')::uuid;
    raise exception 'FAIL 20.7: tarefa para pedido não pago';
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'ORDER_NOT_PAID' then raise exception 'FAIL 20.7b: %', v_hint; end if;
  end;
  -- A free vodacom SIM, but of another device.
  begin
    update public.activation_tasks set status = 'ASSIGNED', device_id = current_setting('test.g1')::uuid,
           sim_id = current_setting('test.g2_s0')::uuid
     where id = current_setting('test.g_t3')::uuid;
    raise exception 'FAIL 20.8: SIM de outro dispositivo aceite';
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'SIM_MISMATCH' then raise exception 'FAIL 20.8b: %', v_hint; end if;
  end;
end;
$$;

-- 21. anon: nothing -----------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform 1 from public.devices;
    raise exception 'FAIL 21.1: anon lê devices';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.activation_tasks;
    raise exception 'FAIL 21.2: anon lê activation_tasks';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.register_device('ABCD-EFGH', 'android-anon-0001', 'ANDROID', '1.0.0');
    raise exception 'FAIL 21.3: anon regista dispositivos';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.device_heartbeat('00000000-0000-4000-8000-00000000ffff', 'mbdt_x');
    raise exception 'FAIL 21.4: anon envia heartbeat';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;

select 'PASS — 006_devices_activation: estrutura, privilégios, emparelhamento, token do dispositivo, heartbeat, SIMs, dispatcher, protocolo do worker, verificação do resultado, UNKNOWN sem repetição, decisões manuais, isolamento, platform admin, tenant suspenso, timeouts, auditoria e anon verificados (transação revertida)' as resultado;

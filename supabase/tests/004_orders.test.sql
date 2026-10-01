-- =============================================================================
-- MegaBot · verification for 004_orders.sql
--
-- Run in Supabase → SQL Editor AFTER applying 001, 002, 003 and 004.
-- Everything happens inside one transaction that is ROLLED BACK at the end:
-- no users, tenants, products, orders or events are left behind.
--
-- Success: the last result shows "PASS — 004_orders".
-- Failure: execution stops with an error message starting with "FAIL".
--
-- Test users (fixed UUIDs, removed by the rollback):
--   …4a1  OA  owner of tenant "OR Teste Alfa 004"
--   …4a3  OP  operator of Alfa
--   …4b1  OB  owner of tenant "OR Teste Beta 004"
--   …4c1  PA  platform SUPER_ADMIN, no tenant
-- =============================================================================

begin;

-- 1. Structure and privileges ---------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('orders', 'order_events') and c.relrowsecurity;
  if v_count <> 2 then
    raise exception 'FAIL 1.1: RLS ativo em % de 2 tabelas', v_count;
  end if;

  select count(*) into v_count from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in ('orders', 'order_events');
  if v_count <> 2 then
    raise exception 'FAIL 1.2: esperadas 2 policies, encontradas %', v_count;
  end if;
  if exists (select 1 from pg_catalog.pg_policies
              where schemaname = 'public' and tablename in ('orders', 'order_events')
                and (cmd <> 'SELECT'
                     or pg_catalog.btrim(coalesce(qual, '')) in ('true', '(true)'))) then
    raise exception 'FAIL 1.3: policy de escrita ou permissiva em orders/order_events';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.orders', 'SELECT,INSERT,UPDATE,DELETE')
     or pg_catalog.has_table_privilege('anon', 'public.order_events', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'FAIL 1.4: anon tem acesso a orders/order_events';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.orders', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.order_events', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'FAIL 1.5: authenticated escreve diretamente em orders/order_events';
  end if;
  if pg_catalog.has_table_privilege('service_role', 'public.orders', 'DELETE,TRUNCATE')
     or pg_catalog.has_table_privilege('service_role', 'public.order_events', 'UPDATE,DELETE,TRUNCATE') then
    raise exception 'FAIL 1.6: service_role pode apagar pedidos ou reescrever o histórico';
  end if;

  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and p.proname in ('create_order', 'mark_order_awaiting_payment', 'cancel_order', 'order_status_counts')) then
    raise exception 'FAIL 1.7: função SECURITY DEFINER no schema public';
  end if;
  select count(*) into v_count
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where ((n.nspname in ('public', 'private') and p.proname in ('create_order', 'mark_order_awaiting_payment', 'cancel_order', 'order_status_counts'))
       or (n.nspname = 'private' and p.proname in ('normalize_phone', 'order_status_transition_allowed', 'generate_order_reference',
             'orders_before_insert', 'orders_before_update', 'record_order_event', 'prevent_order_event_changes', 'transition_order')))
     and not coalesce(p.proconfig @> array['search_path=""'], false);
  if v_count <> 0 then
    raise exception 'FAIL 1.8: % função(ões) da 004 sem search_path fixo', v_count;
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.create_order(uuid, text, text, text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.cancel_order(uuid, text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'private.transition_order(uuid, text, text)', 'EXECUTE') then
    raise exception 'FAIL 1.9: RPC de pedidos exposta indevidamente';
  end if;
end;
$$;

-- 2. Phone normalization ---------------------------------------------------------
do $$
declare
  v_case record;
begin
  for v_case in select * from (values
      ('840000001', '+258840000001'),
      ('84 000 0001', '+258840000001'),
      ('84-000-0001', '+258840000001'),
      ('(84) 000.0001', '+258840000001'),
      ('+258 84 000 0001', '+258840000001'),
      ('00258840000001', '+258840000001'),
      ('258840000001', '+258840000001'),
      ('820000001', '+258820000001'),
      ('830000001', '+258830000001'),
      ('850000001', '+258850000001'),
      ('860000001', '+258860000001'),
      ('870000001', '+258870000001'),
      ('+27821234567', '+27821234567')            -- other countries: generic E.164
    ) as t(raw, expected)
  loop
    if private.normalize_phone(v_case.raw) is distinct from v_case.expected then
      raise exception 'FAIL 2.1: % normalizado como % (esperado %)', v_case.raw, private.normalize_phone(v_case.raw), v_case.expected;
    end if;
  end loop;

  for v_case in select * from (values
      ('810000001'), ('880000001'), ('84000000'), ('8400000011'), ('+25884000000'), ('+258840000001234'),
      ('abc'), (''), ('+0840000001'), ('840000001a'), ('+2589')
    ) as t(raw)
  loop
    if private.normalize_phone(v_case.raw) is not null then
      raise exception 'FAIL 2.2: número inválido aceite: %', v_case.raw;
    end if;
  end loop;
  if private.normalize_phone(null) is not null then
    raise exception 'FAIL 2.3: null aceite como telefone';
  end if;
end;
$$;

-- 3. State machine (exhaustive) ------------------------------------------------------
do $$
declare
  v_from text;
  v_to   text;
  v_allowed int := 0;
  v_expected text[] := array[
    'PENDING>AWAITING_PAYMENT', 'PENDING>CANCELLED', 'PENDING>EXPIRED',
    'AWAITING_PAYMENT>VERIFYING', 'AWAITING_PAYMENT>PAID', 'AWAITING_PAYMENT>CANCELLED', 'AWAITING_PAYMENT>EXPIRED',
    'VERIFYING>PAID', 'VERIFYING>AWAITING_PAYMENT', 'VERIFYING>CANCELLED',
    'PAID>READY_FOR_ACTIVATION',
    'READY_FOR_ACTIVATION>ACTIVATING', 'READY_FOR_ACTIVATION>FAILED',
    'ACTIVATING>COMPLETED', 'ACTIVATING>FAILED',
    'FAILED>READY_FOR_ACTIVATION', 'FAILED>CANCELLED'];
  v_statuses text[] := array['PENDING', 'AWAITING_PAYMENT', 'VERIFYING', 'PAID', 'READY_FOR_ACTIVATION',
                             'ACTIVATING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'];
begin
  foreach v_from in array v_statuses loop
    foreach v_to in array v_statuses loop
      if private.order_status_transition_allowed(v_from, v_to) <> ((v_from || '>' || v_to) = any (v_expected)) then
        raise exception 'FAIL 3.1: transição % → % com resultado inesperado', v_from, v_to;
      end if;
      if private.order_status_transition_allowed(v_from, v_to) then
        v_allowed := v_allowed + 1;
      end if;
    end loop;
  end loop;
  if v_allowed <> 17 then
    raise exception 'FAIL 3.2: esperadas 17 transições permitidas, encontradas %', v_allowed;
  end if;
  if private.order_status_transition_allowed('PENDING', 'DONE') or private.order_status_transition_allowed(null, 'PENDING') then
    raise exception 'FAIL 3.3: estado desconhecido aceite';
  end if;
end;
$$;

-- 4. Users, tenants and products ----------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'or-test-oa@megabot.test', '{}', '{"name": "Owner A", "business_name": "OR Teste Alfa 004"}', now(), now()),
  ('00000000-0000-4000-8000-0000000004a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'or-test-op@megabot.test', '{}', '{"name": "Operador A"}', now(), now()),
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'or-test-ob@megabot.test', '{}', '{"name": "Owner B", "business_name": "OR Teste Beta 004"}', now(), now()),
  ('00000000-0000-4000-8000-0000000004c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'or-test-pa@megabot.test', '{}', '{"name": "Platform"}', now(), now());

do $$
declare
  v_alfa uuid;
  v_beta uuid;
  v_flow jsonb := '{"version": 1, "start": "*111#", "steps": [{"type": "select", "value": "5"},
                    {"type": "input", "source": "destination_number"}, {"type": "confirm"}]}';
  v_id   uuid;
begin
  select tenant_id into v_alfa from public.tenant_users where user_id = '00000000-0000-4000-8000-0000000004a1' and role = 'owner';
  select tenant_id into v_beta from public.tenant_users where user_id = '00000000-0000-4000-8000-0000000004b1' and role = 'owner';
  if v_alfa is null or v_beta is null then
    raise exception 'FAIL 4.1: tenants de teste não foram criados pelo trigger da 001';
  end if;
  perform set_config('test.alfa', v_alfa::text, true);
  perform set_config('test.beta', v_beta::text, true);

  insert into public.tenant_users (tenant_id, user_id, role) values (v_alfa, '00000000-0000-4000-8000-0000000004a3', 'operator');
  insert into public.platform_admins (user_id, role) values ('00000000-0000-4000-8000-0000000004c1', 'SUPER_ADMIN');

  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_alfa, 'Internet 5GB', 'monthly', 500, 5, 'GB', 720, 'vodacom', 'ACTIVE', v_flow) returning id into v_id;
  perform set_config('test.p_active', v_id::text, true);
  insert into public.products (tenant_id, name, category, price, validity_hours, operator)
  values (v_alfa, 'Ilimitado Inativo', 'unlimited', 25, 6, 'vodacom') returning id into v_id;
  perform set_config('test.p_inactive', v_id::text, true);
  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_alfa, 'Arquivado 1GB', 'daily', 24, 1, 'GB', 24, 'vodacom', 'ACTIVE', v_flow) returning id into v_id;
  update public.products set archived_at = now() where id = v_id;
  perform set_config('test.p_archived', v_id::text, true);
  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_beta, 'Beta 2GB', 'weekly', 70, 2, 'GB', 168, 'movitel', 'ACTIVE', v_flow) returning id into v_id;
  perform set_config('test.p_beta', v_id::text, true);
end;
$$;

-- 5. Owner A creates and manages orders ------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000004a1", "role": "authenticated"}', true);

do $$
declare
  v_order public.orders;
  v_again public.orders;
  v_count int;
begin
  select * into v_order from public.create_order(current_setting('test.p_active')::uuid, ' 84 000 0001 ', '  João Cliente  ');
  if v_order.id is null or v_order.status <> 'PENDING' or v_order.customer_phone <> '+258840000001'
     or v_order.customer_name <> 'João Cliente' or v_order.tenant_id <> current_setting('test.alfa')::uuid then
    raise exception 'FAIL 5.1: pedido criado com dados inesperados (%)', v_order;
  end if;
  if v_order.product_name_snapshot <> 'Internet 5GB' or v_order.product_price_snapshot <> 500
     or v_order.currency_snapshot <> 'MZN' or v_order.data_amount_snapshot <> 5 or v_order.data_unit_snapshot <> 'GB'
     or v_order.validity_hours_snapshot <> 720 or v_order.operator_snapshot <> 'vodacom' then
    raise exception 'FAIL 5.2: snapshot do produto incorreto (%)', v_order;
  end if;
  if v_order.public_reference !~ '^MB-[0-9]{8}-[0-9A-F]{8}$' then
    raise exception 'FAIL 5.3: referência pública com formato inesperado (%)', v_order.public_reference;
  end if;
  if not exists (select 1 from public.order_events e
                  where e.order_id = v_order.id and e.event_type = 'order.created' and e.to_status = 'PENDING'
                    and e.from_status is null and e.actor_user_id = (select auth.uid())) then
    raise exception 'FAIL 5.4: evento order.created não registado';
  end if;
  perform set_config('test.o1', v_order.id::text, true);

  -- Product ownership and availability.
  begin
    perform public.create_order(current_setting('test.p_beta')::uuid, '840000002');
    raise exception 'FAIL 5.5: pedido criado com produto de outro tenant';
  exception when no_data_found then null;
  end;
  begin
    perform public.create_order(current_setting('test.p_inactive')::uuid, '840000002');
    raise exception 'FAIL 5.6: pedido criado com produto INACTIVE';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.create_order(current_setting('test.p_archived')::uuid, '840000002');
    raise exception 'FAIL 5.7: pedido criado com produto arquivado';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.create_order('00000000-0000-4000-8000-00000000ffff', '840000002');
    raise exception 'FAIL 5.8: produto inexistente aceite';
  exception when no_data_found then null;
  end;

  -- Phone validation.
  begin
    perform public.create_order(current_setting('test.p_active')::uuid, '810000001');
    raise exception 'FAIL 5.9: telefone inválido aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_order(current_setting('test.p_active')::uuid, '');
    raise exception 'FAIL 5.10: telefone vazio aceite';
  exception when invalid_parameter_value then null;
  end;

  -- Idempotency: same key twice → one order.
  select * into v_order from public.create_order(current_setting('test.p_active')::uuid, '850000003', null, 'test-key-0001');
  select * into v_again from public.create_order(current_setting('test.p_active')::uuid, '+258 85 000 0003', null, 'test-key-0001');
  if v_again.id <> v_order.id then
    raise exception 'FAIL 5.11: a mesma chave de idempotência criou dois pedidos';
  end if;
  select count(*) into v_count from public.orders where idempotency_key = 'test-key-0001';
  if v_count <> 1 then
    raise exception 'FAIL 5.12: % pedidos com a mesma chave', v_count;
  end if;
  select count(*) into v_count from public.order_events where order_id = v_order.id and event_type = 'order.created';
  if v_count <> 1 then
    raise exception 'FAIL 5.13: repetição idempotente gerou eventos duplicados';
  end if;
  begin
    perform public.create_order(current_setting('test.p_active')::uuid, '860000009', null, 'test-key-0001');
    raise exception 'FAIL 5.14: chave reutilizada com dados diferentes aceite';
  exception when unique_violation then null;
  end;
  perform set_config('test.o2', v_order.id::text, true);

  -- No direct writes: status cannot simply be set.
  begin
    update public.orders set status = 'COMPLETED' where id = current_setting('test.o1')::uuid;
    raise exception 'FAIL 5.15: status alterado diretamente pela API';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.orders (tenant_id, product_id, customer_phone) values (current_setting('test.alfa')::uuid, current_setting('test.p_active')::uuid, '840000001');
    raise exception 'FAIL 5.16: insert direto em orders aceite';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.orders where id = current_setting('test.o1')::uuid;
    raise exception 'FAIL 5.17: pedido apagado fisicamente';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.order_events (tenant_id, order_id, event_type, to_status)
    values (current_setting('test.alfa')::uuid, current_setting('test.o1')::uuid, 'order.fake', 'COMPLETED');
    raise exception 'FAIL 5.18: evento forjado pela API';
  exception when insufficient_privilege then null;
  end;

  -- Commands: PENDING → AWAITING_PAYMENT → CANCELLED (with reason).
  select * into v_order from public.mark_order_awaiting_payment(current_setting('test.o1')::uuid);
  if v_order.status <> 'AWAITING_PAYMENT' then
    raise exception 'FAIL 5.19: pedido não passou a AWAITING_PAYMENT';
  end if;
  select * into v_order from public.cancel_order(current_setting('test.o1')::uuid, '  Cliente desistiu  ');
  if v_order.status <> 'CANCELLED' or v_order.cancel_reason <> 'Cliente desistiu' then
    raise exception 'FAIL 5.20: cancelamento incorreto (%)', v_order;
  end if;
  if not exists (select 1 from public.order_events where order_id = v_order.id and event_type = 'order.status_changed'
                    and from_status = 'PENDING' and to_status = 'AWAITING_PAYMENT')
     or not exists (select 1 from public.order_events where order_id = v_order.id and event_type = 'order.cancelled'
                    and from_status = 'AWAITING_PAYMENT' and metadata ->> 'reason' = 'Cliente desistiu') then
    raise exception 'FAIL 5.21: histórico de estados incompleto';
  end if;
  -- Cancelling again is a no-op (no new event); moving a cancelled order is refused.
  perform public.cancel_order(current_setting('test.o1')::uuid);
  select count(*) into v_count from public.order_events where order_id = v_order.id;
  if v_count <> 3 then
    raise exception 'FAIL 5.22: esperados 3 eventos, encontrados %', v_count;
  end if;
  begin
    perform public.mark_order_awaiting_payment(current_setting('test.o1')::uuid);
    raise exception 'FAIL 5.23: pedido cancelado reaberto';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;

-- 6. Snapshot survives product changes ---------------------------------------------------
update public.products set price = 550, name = 'Internet 5GB Plus', data_amount = 6 where id = current_setting('test.p_active')::uuid;

do $$
begin
  if not exists (select 1 from public.orders
                  where id = current_setting('test.o2')::uuid
                    and product_name_snapshot = 'Internet 5GB' and product_price_snapshot = 500
                    and currency_snapshot = 'MZN' and data_amount_snapshot = 5 and data_unit_snapshot = 'GB') then
    raise exception 'FAIL 6.1: o pedido não manteve o snapshot depois de o produto mudar';
  end if;
end;
$$;

-- 7. Operator A: reads and operates orders of its tenant ------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000004a3", "role": "authenticated"}', true);

do $$
declare
  v_order public.orders;
  v_count int;
begin
  select count(*) into v_count from public.orders where tenant_id = current_setting('test.alfa')::uuid;
  if v_count <> 2 then
    raise exception 'FAIL 7.1: operador devia ver os 2 pedidos do tenant (vê %)', v_count;
  end if;
  select * into v_order from public.create_order(current_setting('test.p_active')::uuid, '870000004', 'Via operador');
  if v_order.product_price_snapshot <> 550 then
    raise exception 'FAIL 7.2: novo pedido não usou o preço atual do produto';
  end if;
  perform set_config('test.o3', v_order.id::text, true);
  if not exists (select 1 from public.order_status_counts(current_setting('test.alfa')::uuid) c where c.status = 'PENDING' and c.total = 2) then
    raise exception 'FAIL 7.3: contagens por estado incorretas';
  end if;
end;
$$;

-- 8. Owner B: tenant isolation ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000004b1", "role": "authenticated"}', true);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.orders where tenant_id = current_setting('test.alfa')::uuid;
  if v_count <> 0 then
    raise exception 'FAIL 8.1: tenant B vê pedidos do tenant A (%)', v_count;
  end if;
  select count(*) into v_count from public.order_events where tenant_id = current_setting('test.alfa')::uuid;
  if v_count <> 0 then
    raise exception 'FAIL 8.2: tenant B vê o histórico do tenant A';
  end if;
  select count(*) into v_count from public.order_status_counts(current_setting('test.alfa')::uuid);
  if v_count <> 0 then
    raise exception 'FAIL 8.3: tenant B vê contagens do tenant A';
  end if;
  begin
    perform public.cancel_order(current_setting('test.o3')::uuid);
    raise exception 'FAIL 8.4: tenant B cancelou pedido do tenant A';
  exception when no_data_found then null;
  end;
  begin
    perform public.mark_order_awaiting_payment(current_setting('test.o3')::uuid);
    raise exception 'FAIL 8.5: tenant B alterou pedido do tenant A';
  exception when no_data_found then null;
  end;
  begin
    perform public.create_order(current_setting('test.p_active')::uuid, '840000005');
    raise exception 'FAIL 8.6: tenant B usou produto do tenant A';
  exception when no_data_found then null;
  end;
  -- Its own product works.
  perform public.create_order(current_setting('test.p_beta')::uuid, '860000006', 'Cliente B');
  select count(*) into v_count from public.orders;
  if v_count <> 1 then
    raise exception 'FAIL 8.7: tenant B devia ver só o próprio pedido (vê %)', v_count;
  end if;
end;
$$;

-- 9. Suspended tenant: history readable, no new orders, no changes -------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000004c1", "role": "authenticated"}', true);
select status from public.platform_set_tenant_status(current_setting('test.alfa')::uuid, 'suspended', 'Teste 004');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000004a1", "role": "authenticated"}', true);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.orders where tenant_id = current_setting('test.alfa')::uuid;
  if v_count <> 3 then
    raise exception 'FAIL 9.1: tenant suspenso deixou de ler o histórico (%)', v_count;
  end if;
  begin
    perform public.create_order(current_setting('test.p_active')::uuid, '840000007');
    raise exception 'FAIL 9.2: tenant suspenso criou pedido';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cancel_order(current_setting('test.o3')::uuid);
    raise exception 'FAIL 9.3: tenant suspenso cancelou pedido';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000004c1", "role": "authenticated"}', true);
select status from public.platform_set_tenant_status(current_setting('test.alfa')::uuid, 'active');

-- 10. Platform admin: no implicit tenant access ----------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.orders;
  if v_count <> 0 then
    raise exception 'FAIL 10.1: platform admin vê pedidos em queries normais (%)', v_count;
  end if;
  begin
    perform public.create_order(current_setting('test.p_active')::uuid, '840000008');
    raise exception 'FAIL 10.2: platform admin criou pedido num tenant de que não é membro';
  exception when no_data_found then null;
  end;
  begin
    perform public.cancel_order(current_setting('test.o3')::uuid);
    raise exception 'FAIL 10.3: platform admin cancelou pedido de um tenant';
  exception when no_data_found then null;
  end;
end;
$$;

-- 11. State machine for trusted backends (database owner; triggers apply to every role) -------
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  v_id    uuid := current_setting('test.o3')::uuid;
  v_count int;
begin
  update public.orders set status = 'AWAITING_PAYMENT' where id = v_id;
  update public.orders set status = 'VERIFYING' where id = v_id;
  update public.orders set status = 'PAID' where id = v_id;
  update public.orders set status = 'READY_FOR_ACTIVATION' where id = v_id;
  update public.orders set status = 'ACTIVATING' where id = v_id;
  update public.orders set status = 'FAILED' where id = v_id;
  update public.orders set status = 'READY_FOR_ACTIVATION' where id = v_id;
  update public.orders set status = 'ACTIVATING' where id = v_id;
  update public.orders set status = 'COMPLETED' where id = v_id;
  select count(*) into v_count from public.order_events where order_id = v_id and event_type = 'order.status_changed';
  if v_count <> 9 then
    raise exception 'FAIL 11.1: esperados 9 eventos de mudança de estado, encontrados %', v_count;
  end if;
  if exists (select 1 from public.order_events where order_id = v_id and event_type <> 'order.created' and actor_user_id is not null) then
    raise exception 'FAIL 11.2: ação de sistema registada com ator';
  end if;

  begin
    update public.orders set status = 'CANCELLED' where id = v_id;
    raise exception 'FAIL 11.3: pedido concluído foi cancelado';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.orders set status = 'COMPLETED' where id = current_setting('test.o2')::uuid;
    raise exception 'FAIL 11.4: salto PENDING → COMPLETED aceite';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.orders set product_price_snapshot = 1 where id = v_id;
    raise exception 'FAIL 11.5: snapshot alterado depois de criado';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.orders set customer_phone = '+258840000099' where id = v_id;
    raise exception 'FAIL 11.6: telefone do cliente alterado';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.orders set status = 'DONE' where id = v_id;
    raise exception 'FAIL 11.7: estado desconhecido aceite';
  exception when object_not_in_prerequisite_state or check_violation then null;
  end;

  -- PENDING → EXPIRED is recorded as order.expired.
  update public.orders set status = 'EXPIRED' where id = current_setting('test.o2')::uuid;
  if not exists (select 1 from public.order_events where order_id = current_setting('test.o2')::uuid and event_type = 'order.expired') then
    raise exception 'FAIL 11.8: expiração não registada';
  end if;

  -- Even the owner cannot insert inconsistent orders: snapshot and status are forced.
  insert into public.orders (tenant_id, product_id, customer_phone, product_name_snapshot, product_price_snapshot,
                             currency_snapshot, validity_hours_snapshot, operator_snapshot, status, public_reference)
  values (current_setting('test.alfa')::uuid, current_setting('test.p_active')::uuid, '84 000 0010', 'Forjado', 1,
          'USD', 1, 'tmcel', 'COMPLETED', 'MB-00000000-00000000');
  if not exists (select 1 from public.orders where customer_phone = '+258840000010' and product_price_snapshot = 550
                    and status = 'PENDING' and public_reference <> 'MB-00000000-00000000') then
    raise exception 'FAIL 11.9: insert direto não aplicou snapshot/estado do servidor';
  end if;
  begin
    insert into public.orders (tenant_id, product_id, customer_phone)
    values (current_setting('test.beta')::uuid, current_setting('test.p_active')::uuid, '840000011');
    raise exception 'FAIL 11.10: produto de outro tenant aceite num insert direto';
  exception when no_data_found then null;
  end;
end;
$$;

-- 12. order_events is append-only; orders vs audit_logs stay separate ---------------------------
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.order_events where order_id = current_setting('test.o3')::uuid limit 1;
  begin
    update public.order_events set to_status = 'CANCELLED' where id = v_id;
    raise exception 'FAIL 12.1: evento alterado';
  exception when insufficient_privilege then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    delete from public.order_events where id = v_id;
    raise exception 'FAIL 12.2: evento apagado';
  exception when insufficient_privilege then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    truncate public.order_events;
    raise exception 'FAIL 12.3: order_events truncado';
  exception when insufficient_privilege then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    insert into public.order_events (tenant_id, order_id, event_type, to_status, metadata)
    values (current_setting('test.alfa')::uuid, current_setting('test.o3')::uuid, 'order.note', 'COMPLETED', '{"token": "x"}');
    raise exception 'FAIL 12.4: metadata com segredo aceite';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.audit_logs where action like 'order.%') then
    raise exception 'FAIL 12.5: eventos de pedidos misturados com audit_logs';
  end if;
  -- The owner can still remove an order (cascade clears its history).
  delete from public.orders where id = current_setting('test.o2')::uuid;
  if exists (select 1 from public.order_events where order_id = current_setting('test.o2')::uuid) then
    raise exception 'FAIL 12.6: histórico órfão após remover o pedido';
  end if;
end;
$$;

-- 13. Anonymous ---------------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

do $$
begin
  begin
    perform 1 from public.orders;
    raise exception 'FAIL 13.1: anon lê orders';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.order_events;
    raise exception 'FAIL 13.2: anon lê order_events';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_order('00000000-0000-4000-8000-00000000ffff', '840000001');
    raise exception 'FAIL 13.3: anon executa create_order';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cancel_order('00000000-0000-4000-8000-00000000ffff');
    raise exception 'FAIL 13.4: anon executa cancel_order';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;

select 'PASS — 004_orders: estrutura, telefone, máquina de estados, criação, snapshot, idempotência, isolamento, tenant suspenso, platform admin, histórico append-only e anon verificados (transação revertida)' as resultado;

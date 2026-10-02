-- =============================================================================
-- MegaBot · verification for 005_payments.sql
--
-- Run in Supabase → SQL Editor AFTER applying 001, 002, 003, 004 and 005.
-- Everything happens inside one transaction that is ROLLED BACK at the end:
-- no users, tenants, accounts, events, proofs or matches are left behind.
--
-- Success: the last result shows "PASS — 005_payments".
-- Failure: execution stops with an error message starting with "FAIL".
--
-- Test users (fixed UUIDs, removed by the rollback):
--   …5a1  OA  owner of tenant "PG Teste Alfa 005"
--   …5a3  OP  operator of Alfa
--   …5b1  OB  owner of tenant "PG Teste Beta 005"
--   …5c1  PA  platform SUPER_ADMIN, no tenant
-- All phone numbers, transaction IDs and messages below are synthetic.
-- =============================================================================

begin;

-- 1. Structure and privileges ---------------------------------------------------
do $$
declare
  v_tables text[] := array['payment_accounts', 'payment_events', 'payment_proofs', 'payment_matches'];
  v_rpcs   text[] := array[
    'public.create_payment_account(uuid, text, text, text)',
    'public.update_payment_account(uuid, text, text)',
    'public.record_payment_event(uuid, text, numeric, timestamptz, text, text, text, text)',
    'public.submit_payment_proof(uuid, text, text, numeric, text, text, text, text, jsonb, uuid)',
    'public.reconcile_payment_proof(uuid)',
    'public.reject_payment_proof(uuid, text)',
    'public.confirm_payment_manually(uuid, uuid, uuid, text)'];
  v_internals text[] := array[
    'private.reconcile_event(uuid)',
    'private.reconcile_proof(uuid)',
    'private.apply_payment_decision(uuid, uuid, uuid, jsonb, uuid)',
    'private.evaluate_payment_match(public.orders, public.payment_events, public.payment_proofs)',
    'private.set_proof_status(uuid, text, text)',
    'private.sync_order_verification(uuid)',
    'private.payment_match_window(uuid, text)'];
  v_name  text;
  v_count int;
begin
  select count(*) into v_count
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = any (v_tables) and c.relrowsecurity;
  if v_count <> 4 then
    raise exception 'FAIL 1.1: RLS ativo em % de 4 tabelas', v_count;
  end if;
  select count(*) into v_count from pg_catalog.pg_policies where schemaname = 'public' and tablename = any (v_tables);
  if v_count <> 4 then
    raise exception 'FAIL 1.2: esperadas 4 policies, encontradas %', v_count;
  end if;
  if exists (select 1 from pg_catalog.pg_policies
              where schemaname = 'public' and tablename = any (v_tables)
                and (cmd <> 'SELECT' or 'anon' = any (roles) or 'public' = any (roles)
                     or pg_catalog.btrim(coalesce(qual, '')) in ('true', '(true)'))) then
    raise exception 'FAIL 1.3: policy de escrita, permissiva ou para anon nas tabelas de pagamentos';
  end if;

  foreach v_name in array v_tables loop
    if pg_catalog.has_table_privilege('anon', 'public.' || v_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'FAIL 1.4: anon tem acesso a %', v_name;
    end if;
    if pg_catalog.has_table_privilege('authenticated', 'public.' || v_name, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'FAIL 1.5: authenticated escreve diretamente em %', v_name;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('service_role', 'public.payment_events', 'UPDATE,DELETE,TRUNCATE')
     or pg_catalog.has_table_privilege('service_role', 'public.payment_matches', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or pg_catalog.has_table_privilege('service_role', 'public.payment_proofs', 'DELETE,TRUNCATE')
     or pg_catalog.has_table_privilege('service_role', 'public.payment_accounts', 'DELETE,TRUNCATE') then
    raise exception 'FAIL 1.6: service_role pode reescrever eventos, criar correspondências ou apagar registos financeiros';
  end if;

  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and p.proname in ('create_payment_account', 'update_payment_account', 'record_payment_event', 'submit_payment_proof',
                                  'reconcile_payment_proof', 'reject_payment_proof', 'confirm_payment_manually')) then
    raise exception 'FAIL 1.7: função SECURITY DEFINER no schema public';
  end if;
  select count(*) into v_count
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname in ('create_payment_account', 'update_payment_account', 'record_payment_event', 'submit_payment_proof',
                       'reconcile_payment_proof', 'reject_payment_proof', 'confirm_payment_manually', 'payment_metadata_is_safe',
                       'normalize_transaction_id', 'normalize_account_identifier', 'sender_digits', 'sender_identifiers_compatible',
                       'payment_match_window', 'payment_accounts_before_write', 'audit_payment_account_changes',
                       'payment_events_before_insert', 'payment_proofs_before_write', 'payment_matches_before_insert',
                       'prevent_financial_record_changes', 'orders_require_payment_confirmation', 'evaluate_payment_match',
                       'set_proof_status', 'apply_payment_decision', 'sync_order_verification', 'reconcile_proof', 'reconcile_event')
     and not coalesce(p.proconfig @> array['search_path=""'], false);
  if v_count <> 0 then
    raise exception 'FAIL 1.8: % função(ões) da 005 sem search_path fixo', v_count;
  end if;
  foreach v_name in array v_rpcs loop
    if pg_catalog.has_function_privilege('anon', v_name, 'EXECUTE') then
      raise exception 'FAIL 1.9: anon executa %', v_name;
    end if;
    if not pg_catalog.has_function_privilege('authenticated', v_name, 'EXECUTE') then
      raise exception 'FAIL 1.10: authenticated não executa %', v_name;
    end if;
  end loop;
  foreach v_name in array v_internals loop
    if pg_catalog.has_function_privilege('authenticated', v_name, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_name, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_name, 'EXECUTE') then
      raise exception 'FAIL 1.11: função interna exposta: %', v_name;
    end if;
  end loop;

  select count(*) into v_count from pg_catalog.pg_indexes
   where schemaname = 'public' and tablename = 'payment_matches'
     and indexname in ('payment_matches_confirmed_event_key', 'payment_matches_confirmed_order_key', 'payment_matches_confirmed_proof_key')
     and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%WHERE (match_status = ''CONFIRMED''::text)%';
  if v_count <> 3 then
    raise exception 'FAIL 1.12: índices únicos de confirmação em falta (%)', v_count;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'payment_events_provider_account_tx_key' and contype = 'u') then
    raise exception 'FAIL 1.13: unicidade provider + conta + transaction_id em falta';
  end if;
  select count(*) into v_count from pg_catalog.pg_trigger
   where not tgisinternal and tgname in ('payment_events_immutable', 'payment_events_no_truncate', 'payment_matches_immutable',
                                         'payment_matches_no_truncate', 'orders_require_payment_confirmation');
  if v_count <> 5 then
    raise exception 'FAIL 1.14: triggers de imutabilidade / guarda de PAID em falta (%)', v_count;
  end if;
end;
$$;

-- 2. Pure helpers -----------------------------------------------------------------
do $$
declare
  v_case record;
begin
  for v_case in select * from (values
      (' pp261001.1111.a00001 ', 'PP261001.1111.A00001'),
      ('abc def 123', 'ABCDEF123'),
      ('9A8B7C6D5E', '9A8B7C6D5E'),
      ('CI251001_ABCD-12', 'CI251001_ABCD-12')
    ) as t(raw, expected)
  loop
    if private.normalize_transaction_id(v_case.raw) is distinct from v_case.expected then
      raise exception 'FAIL 2.1: transaction_id % normalizado como %', v_case.raw, private.normalize_transaction_id(v_case.raw);
    end if;
  end loop;
  for v_case in select * from (values ('AB1'), (''), ('-ABC1'), ('ABC#123'), (pg_catalog.repeat('A', 65))) as t(raw) loop
    if private.normalize_transaction_id(v_case.raw) is not null then
      raise exception 'FAIL 2.2: transaction_id inválido aceite: %', v_case.raw;
    end if;
  end loop;

  for v_case in select * from (values
      ('84 000 0100', '+258840000100'),
      ('+258 86 000 0200', '+258860000200'),
      ('Till 171717', 'TILL171717'),
      ('(84) 000-0100', '+258840000100'),
      ('8400000100', '8400000100')                 -- not a phone: kept as an account number
    ) as t(raw, expected)
  loop
    if private.normalize_account_identifier(v_case.raw) is distinct from v_case.expected then
      raise exception 'FAIL 2.3: identificador % normalizado como %', v_case.raw, private.normalize_account_identifier(v_case.raw);
    end if;
  end loop;
  if private.normalize_account_identifier('!!') is not null or private.normalize_account_identifier('') is not null
     or private.normalize_account_identifier('AB') is not null then
    raise exception 'FAIL 2.4: identificador inválido aceite';
  end if;

  -- Sender compatibility: masked digits are wildcards; ≥ 3 visible digits must agree.
  for v_case in select * from (values
      ('840000001', '84****001', true),
      ('+258 84 000 0001', '840000001', true),
      ('258840000001', '84xxxx001', true),
      ('00258840000001', '***001', true),
      ('840000001', '86****777', false),
      ('840000001', '840000002', false),
      ('840000001', '****01', null),
      (null, '840000001', null),
      ('840000001', '', null)
    ) as t(a, b, expected)
  loop
    if private.sender_identifiers_compatible(v_case.a, v_case.b) is distinct from v_case.expected then
      raise exception 'FAIL 2.5: remetentes % / % → % (esperado %)',
        v_case.a, v_case.b, private.sender_identifiers_compatible(v_case.a, v_case.b), v_case.expected;
    end if;
  end loop;

  -- Payment data never carries PINs, OTPs or keys.
  for v_case in select * from (values
      ('{}', true), ('{"note": "conta principal"}', true), ('{"shipping": "x", "spinner": 1}', true),
      ('{"pin": "1234"}', false), ('{"mpesa_pin": "1234"}', false), ('{"PIN Code": "1"}', false), ('{"mpin": "1"}', false),
      ('{"otp": "123456"}', false), ('{"passcode": "1"}', false), ('{"apiSecret": "x"}', false),
      ('{"nested": {"access_key": "x"}}', false), ('{"private_key": "x"}', false), ('{"accessToken": "x"}', false)
    ) as t(meta, expected)
  loop
    if private.payment_metadata_is_safe(v_case.meta::jsonb) is distinct from v_case.expected then
      raise exception 'FAIL 2.6: payment_metadata_is_safe(%) ≠ %', v_case.meta, v_case.expected;
    end if;
  end loop;
end;
$$;

-- 3. Users, tenants and products ----------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pg-test-oa@megabot.test', '{}', '{"name": "Owner A", "business_name": "PG Teste Alfa 005"}', now(), now()),
  ('00000000-0000-4000-8000-0000000005a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pg-test-op@megabot.test', '{}', '{"name": "Operador A"}', now(), now()),
  ('00000000-0000-4000-8000-0000000005b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pg-test-ob@megabot.test', '{}', '{"name": "Owner B", "business_name": "PG Teste Beta 005"}', now(), now()),
  ('00000000-0000-4000-8000-0000000005c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pg-test-pa@megabot.test', '{}', '{"name": "Platform"}', now(), now());

do $$
declare
  v_alfa uuid;
  v_beta uuid;
  v_flow jsonb := '{"version": 1, "start": "*111#", "steps": [{"type": "select", "value": "5"},
                    {"type": "input", "source": "destination_number"}, {"type": "confirm"}]}';
  v_id   uuid;
begin
  select tenant_id into v_alfa from public.tenant_users where user_id = '00000000-0000-4000-8000-0000000005a1' and role = 'owner';
  select tenant_id into v_beta from public.tenant_users where user_id = '00000000-0000-4000-8000-0000000005b1' and role = 'owner';
  if v_alfa is null or v_beta is null then
    raise exception 'FAIL 3.1: tenants de teste não foram criados pelo trigger da 001';
  end if;
  perform set_config('test.alfa', v_alfa::text, true);
  perform set_config('test.beta', v_beta::text, true);

  insert into public.tenant_users (tenant_id, user_id, role) values (v_alfa, '00000000-0000-4000-8000-0000000005a3', 'operator');
  insert into public.platform_admins (user_id, role) values ('00000000-0000-4000-8000-0000000005c1', 'SUPER_ADMIN');

  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_alfa, 'Internet 5GB', 'monthly', 500, 5, 'GB', 720, 'vodacom', 'ACTIVE', v_flow) returning id into v_id;
  perform set_config('test.p500', v_id::text, true);
  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_alfa, 'Internet 10GB', 'monthly', 900, 10, 'GB', 720, 'vodacom', 'ACTIVE', v_flow) returning id into v_id;
  perform set_config('test.p900', v_id::text, true);
  insert into public.products (tenant_id, name, category, price, data_amount, data_unit, validity_hours, operator, status, ussd_flow)
  values (v_beta, 'Beta 2GB', 'weekly', 70, 2, 'GB', 168, 'movitel', 'ACTIVE', v_flow) returning id into v_id;
  perform set_config('test.p70', v_id::text, true);
end;
$$;

-- 4. Payment accounts (owner / admin only) -------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);

do $$
declare
  v_alfa    uuid := current_setting('test.alfa')::uuid;
  v_account public.payment_accounts;
begin
  select * into v_account from public.create_payment_account(v_alfa, 'MPESA', '  Loja Alfa  ', '84 000 0100');
  if v_account.provider <> 'MPESA' or v_account.account_identifier <> '+258840000100' or v_account.account_name <> 'Loja Alfa'
     or v_account.status <> 'ACTIVE' or v_account.tenant_id <> v_alfa or v_account.metadata <> '{}'::jsonb then
    raise exception 'FAIL 4.1: conta M-Pesa criada com dados inesperados (%)', v_account;
  end if;
  perform set_config('test.acc_m', v_account.id::text, true);
  select * into v_account from public.create_payment_account(v_alfa, 'EMOLA', 'Loja Alfa', '86 000 0200');
  if v_account.provider <> 'EMOLA' or v_account.account_identifier <> '+258860000200' then
    raise exception 'FAIL 4.2: conta e-Mola criada com dados inesperados (%)', v_account;
  end if;
  perform set_config('test.acc_e', v_account.id::text, true);
  -- Not every identifier is a phone number.
  select * into v_account from public.create_payment_account(v_alfa, 'MPESA', 'Loja Alfa (agente)', 'Till 171717');
  if v_account.account_identifier <> 'TILL171717' then
    raise exception 'FAIL 4.3: identificador não telefónico normalizado como %', v_account.account_identifier;
  end if;
  select * into v_account from public.update_payment_account(v_account.id, null, 'INACTIVE');
  if v_account.status <> 'INACTIVE' then
    raise exception 'FAIL 4.4: conta não foi desativada';
  end if;

  begin
    perform public.create_payment_account(v_alfa, 'MPESA', 'Duplicada', '+258 84 000 0100');
    raise exception 'FAIL 4.5: conta duplicada aceite';
  exception when unique_violation then null;
  end;
  begin
    perform public.create_payment_account(v_alfa, 'MKESH', 'Loja Alfa', '84 000 0101');
    raise exception 'FAIL 4.6: fornecedor desconhecido aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_payment_account(v_alfa, 'MPESA', 'Loja Alfa', '!!');
    raise exception 'FAIL 4.7: identificador inválido aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_payment_account(v_alfa, 'MPESA', 'A', '84 000 0102');
    raise exception 'FAIL 4.8: nome inválido aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_payment_account(current_setting('test.acc_m')::uuid, null, 'DELETED');
    raise exception 'FAIL 4.9: estado inválido aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_payment_account(current_setting('test.beta')::uuid, 'MPESA', 'Intrusa', '84 000 0103');
    raise exception 'FAIL 4.10: conta criada noutro tenant';
  exception when insufficient_privilege then null;
  end;

  -- The operator reads accounts but cannot manage them.
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}', true);
  if (select count(*) from public.payment_accounts) <> 3 then
    raise exception 'FAIL 4.11: operador não lê as contas da empresa';
  end if;
  begin
    perform public.create_payment_account(v_alfa, 'MPESA', 'Operador', '84 000 0104');
    raise exception 'FAIL 4.12: operador criou conta de pagamento';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_payment_account(current_setting('test.acc_m')::uuid, 'Renomeada');
    raise exception 'FAIL 4.13: operador alterou conta de pagamento';
  exception when no_data_found then null;
  end;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);
end;
$$;

-- 5. Proof + event → CONFIRMED → PAID; event first; proof without event ------------------
do $$
declare
  v_p500  uuid := current_setting('test.p500')::uuid;
  v_acc   uuid := current_setting('test.acc_m')::uuid;
  v_order public.orders;
  v_proof public.payment_proofs;
  v_event public.payment_events;
  v_match public.payment_matches;
  v_o2    uuid;
  v_o3    uuid;
  v_count int;
begin
  -- S1: the customer's proof arrives first, then the real wallet event.
  select * into v_order from public.create_order(v_p500, '840000001', 'Cliente Um');
  perform public.mark_order_awaiting_payment(v_order.id);
  perform set_config('test.o1', v_order.id::text, true);

  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}', true);
  select * into v_proof from public.submit_payment_proof(
    p_order_id => v_order.id, p_provider => 'MPESA', p_transaction_id => ' pp261001.1111.a00001 ', p_amount => 500,
    p_currency => 'mzn', p_sender_identifier => '840000001', p_recipient_identifier => '84 000 0100',
    p_raw_message => 'Confirmado PP261001.1111.A00001. Transferiste 500.00MT para 840000100 - LOJA ALFA.');
  if v_proof.status <> 'UNMATCHED' or v_proof.status_reason <> 'NO_EVENT_YET' or v_proof.transaction_id <> 'PP261001.1111.A00001'
     or v_proof.currency <> 'MZN' or v_proof.submitted_by <> '00000000-0000-4000-8000-0000000005a3' then
    raise exception 'FAIL 5.1: comprovativo sem evento com estado inesperado (%)', v_proof;
  end if;
  if (select status from public.orders where id = v_order.id) <> 'VERIFYING' then
    raise exception 'FAIL 5.2: comprovativo recebido não pôs o pedido em VERIFYING';
  end if;
  if exists (select 1 from public.payment_matches where order_id = v_order.id) then
    raise exception 'FAIL 5.3: um comprovativo sozinho criou uma correspondência';
  end if;
  perform set_config('test.pr1', v_proof.id::text, true);

  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);
  select * into v_event from public.record_payment_event(v_acc, 'PP261001.1111.A00001', 500, null, null, '84****001', null,
    'Recebeste 500.00MT de 84****001. ID da transacao PP261001.1111.A00001.');
  if v_event.provider <> 'MPESA' or v_event.tenant_id <> current_setting('test.alfa')::uuid or v_event.currency <> 'MZN'
     or v_event.source <> 'MANUAL' or v_event.recorded_by <> '00000000-0000-4000-8000-0000000005a1' then
    raise exception 'FAIL 5.4: evento registado com dados inesperados (%)', v_event;
  end if;
  perform set_config('test.e1', v_event.id::text, true);
  if (select status from public.payment_proofs where id = v_proof.id) <> 'CONFIRMED' then
    raise exception 'FAIL 5.5: comprovativo + evento compatíveis não confirmaram';
  end if;
  if (select status from public.orders where id = v_order.id) <> 'PAID' then
    raise exception 'FAIL 5.6: pedido não passou a PAID';
  end if;
  select * into v_match from public.payment_matches where order_id = v_order.id and match_status = 'CONFIRMED';
  if v_match.payment_event_id <> v_event.id or v_match.payment_proof_id <> v_proof.id
     or not v_match.match_methods @> array['TRANSACTION_ID', 'AMOUNT', 'ACCOUNT', 'SENDER', 'TIME_WINDOW', 'ORDER_CONTEXT']
     or 'MANUAL' = any (v_match.match_methods)
     or v_match.details -> 'checks' ->> 'amount' <> 'PASS' or v_match.details -> 'checks' ->> 'provider' <> 'PASS' then
    raise exception 'FAIL 5.7: correspondência confirmada incompleta (%)', v_match;
  end if;
  if not exists (select 1 from public.order_events where order_id = v_order.id and from_status = 'VERIFYING' and to_status = 'PAID') then
    raise exception 'FAIL 5.8: transição VERIFYING → PAID não registada no histórico do pedido';
  end if;

  -- S2: event first with two compatible orders → review only; the proof then decides.
  select id into v_o2 from public.create_order(v_p500, '850000002');
  select id into v_o3 from public.create_order(v_p500, '850000003');
  perform set_config('test.o3', v_o3::text, true);
  select * into v_event from public.record_payment_event(v_acc, 'PP261001.2222.B00002', 500, null, null, '+258 85 000 0099');
  if exists (select 1 from public.payment_matches where payment_event_id = v_event.id and match_status = 'CONFIRMED') then
    raise exception 'FAIL 5.9: evento com dois pedidos possíveis confirmado automaticamente';
  end if;
  select count(*) into v_count from public.payment_matches
   where payment_event_id = v_event.id and match_status = 'PENDING_REVIEW' and reason = 'MULTIPLE_CANDIDATES';
  if v_count <> 2 then
    raise exception 'FAIL 5.10: esperados 2 candidatos em revisão, encontrados %', v_count;
  end if;
  if (select status from public.orders where id = v_o2) <> 'PENDING' then
    raise exception 'FAIL 5.11: candidato mudou de estado sem confirmação';
  end if;

  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}', true);
  select * into v_proof from public.submit_payment_proof(p_order_id => v_o2, p_provider => 'MPESA', p_transaction_id => 'PP261001.2222.B00002');
  if v_proof.status <> 'CONFIRMED' or (select status from public.orders where id = v_o2) <> 'PAID' then
    raise exception 'FAIL 5.12: evento + comprovativo posterior não confirmaram (%)', v_proof.status;
  end if;
  if (select status from public.orders where id = v_o3) <> 'PENDING' then
    raise exception 'FAIL 5.13: o outro candidato foi alterado';
  end if;

  -- S3: proof without event: never confirmed, the order waits in VERIFYING.
  select * into v_proof from public.submit_payment_proof(p_order_id => v_o3, p_provider => 'MPESA',
    p_transaction_id => 'PP261001.3333.C00003', p_amount => 500);
  if v_proof.status <> 'UNMATCHED' or v_proof.status_reason <> 'NO_EVENT_YET' then
    raise exception 'FAIL 5.14: comprovativo sem evento com estado %', v_proof.status;
  end if;
  select * into v_proof from public.reconcile_payment_proof(v_proof.id);
  if v_proof.status <> 'UNMATCHED' or (select status from public.orders where id = v_o3) <> 'VERIFYING'
     or exists (select 1 from public.payment_matches where order_id = v_o3 and match_status = 'CONFIRMED') then
    raise exception 'FAIL 5.15: comprovativo sem evento foi confirmado ou o pedido ficou com estado errado';
  end if;
  perform set_config('test.pr3', v_proof.id::text, true);
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);
end;
$$;

-- 6. Amount, provider, reuse, sender and time window ----------------------------------------
do $$
declare
  v_p500  uuid := current_setting('test.p500')::uuid;
  v_acc   uuid := current_setting('test.acc_m')::uuid;
  v_acc_e uuid := current_setting('test.acc_e')::uuid;
  v_oa    text := '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}';
  v_op    text := '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}';
  v_order uuid;
  v_proof public.payment_proofs;
  v_event public.payment_events;
  v_e6m   uuid;
  v_match public.payment_matches;
  v_count int;
  v_hint  text;
begin
  -- S4: underpaid (300 for 500) → review, never PAID.
  select id into v_order from public.create_order(v_p500, '850000004');
  perform set_config('test.o4', v_order::text, true);
  select * into v_event from public.record_payment_event(v_acc, 'PP261001.4444.D00004', 300, null, null, '+258 85 000 0099');
  perform set_config('test.e4', v_event.id::text, true);
  perform set_config('request.jwt.claims', v_op, true);
  select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'MPESA',
    p_transaction_id => 'PP261001.4444.D00004', p_amount => 300);
  if v_proof.status <> 'PENDING_REVIEW' or v_proof.status_reason <> 'UNDERPAID'
     or (select status from public.orders where id = v_order) <> 'VERIFYING' then
    raise exception 'FAIL 6.1: pagamento a menos não ficou em revisão (% / %)', v_proof.status, v_proof.status_reason;
  end if;
  perform set_config('test.pr4', v_proof.id::text, true);
  perform public.reconcile_payment_proof(v_proof.id);
  perform public.reconcile_payment_proof(v_proof.id);
  select count(*) into v_count from public.payment_matches where order_id = v_order and payment_event_id = v_event.id;
  if v_count <> 1 then
    raise exception 'FAIL 6.2: reconciliação repetida duplicou decisões (%)', v_count;
  end if;
  select * into v_match from public.payment_matches where order_id = v_order and payment_event_id = v_event.id;
  if (v_match.details ->> 'event_amount')::numeric <> 300 or (v_match.details ->> 'order_amount')::numeric <> 500
     or v_match.details -> 'checks' ->> 'amount' <> 'FAIL' then
    raise exception 'FAIL 6.3: detalhes do valor em falta (%)', v_match.details;
  end if;

  -- S5: overpaid (700 for 500) → review; no overpayment policy is invented.
  perform set_config('request.jwt.claims', v_oa, true);
  select id into v_order from public.create_order(v_p500, '850000005');
  perform set_config('test.o5', v_order::text, true);
  select * into v_event from public.record_payment_event(v_acc, 'PP261001.5555.E00005', 700, null, null, '+258 85 000 0099');
  perform set_config('test.e5', v_event.id::text, true);
  perform set_config('request.jwt.claims', v_op, true);
  select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'MPESA',
    p_transaction_id => 'PP261001.5555.E00005');
  if v_proof.status <> 'PENDING_REVIEW' or v_proof.status_reason <> 'OVERPAID' then
    raise exception 'FAIL 6.4: pagamento a mais não ficou em revisão (% / %)', v_proof.status, v_proof.status_reason;
  end if;

  -- S6: the provider is explicit, never inferred from the transaction ID.
  perform set_config('request.jwt.claims', v_oa, true);
  select id into v_order from public.create_order(v_p500, '850000006');
  select id into v_e6m from public.record_payment_event(v_acc, 'MP261001.6666.F00006', 500, null, null, '+258 85 000 0099');
  perform set_config('test.e6m', v_e6m::text, true);
  perform set_config('request.jwt.claims', v_op, true);
  select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'EMOLA',
    p_transaction_id => 'MP261001.6666.F00006', p_amount => 500);
  if v_proof.status <> 'UNMATCHED' or v_proof.status_reason <> 'NO_EVENT_YET' then
    raise exception 'FAIL 6.5: comprovativo e-Mola usou um evento M-Pesa (% / %)', v_proof.status, v_proof.status_reason;
  end if;
  perform set_config('request.jwt.claims', v_oa, true);
  select * into v_event from public.record_payment_event(v_acc_e, 'mp261001.6666.f00006', 500, null, null, '+258 86 000 0066');
  if v_event.id = v_e6m or v_event.provider <> 'EMOLA' or v_event.transaction_id <> 'MP261001.6666.F00006' then
    raise exception 'FAIL 6.6: o mesmo ID noutro fornecedor não é um evento distinto';
  end if;
  if (select status from public.payment_proofs where id = v_proof.id) <> 'CONFIRMED'
     or (select status from public.orders where id = v_order) <> 'PAID'
     or exists (select 1 from public.payment_matches where payment_event_id = v_e6m and match_status = 'CONFIRMED') then
    raise exception 'FAIL 6.7: confirmação e-Mola incorreta';
  end if;

  -- S7: a confirmed event can never pay a second order.
  select id into v_order from public.create_order(v_p500, '850000007');
  perform set_config('test.o7', v_order::text, true);
  perform set_config('request.jwt.claims', v_op, true);
  select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'MPESA',
    p_transaction_id => 'PP261001.1111.A00001', p_amount => 500);
  if v_proof.status <> 'DUPLICATE' or v_proof.status_reason <> 'EVENT_ALREADY_USED'
     or (select status from public.orders where id = v_order) = 'PAID' then
    raise exception 'FAIL 6.8: evento reutilizado (% / %)', v_proof.status, v_proof.status_reason;
  end if;
  select count(*) into v_count from public.payment_matches
   where payment_event_id = current_setting('test.e1')::uuid and match_status = 'CONFIRMED';
  if v_count <> 1 then
    raise exception 'FAIL 6.9: evento com % confirmações', v_count;
  end if;
  perform set_config('request.jwt.claims', v_oa, true);
  begin
    perform public.confirm_payment_manually(v_order, current_setting('test.e1')::uuid);
    raise exception 'FAIL 6.10: confirmação manual reutilizou um evento';
  exception when object_not_in_prerequisite_state then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'EVENT_ALREADY_USED' then
      raise exception 'FAIL 6.10b: motivo inesperado %', v_hint;
    end if;
  end;

  -- S8: sender mismatch → review → manual confirmation by the owner (audited).
  select id into v_order from public.create_order(v_p500, '850000008');
  perform set_config('test.o8', v_order::text, true);
  select * into v_event from public.record_payment_event(v_acc, 'PP261001.8888.H00008', 500, null, null, '86****777');
  perform set_config('request.jwt.claims', v_op, true);
  select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'MPESA',
    p_transaction_id => 'PP261001.8888.H00008', p_amount => 500, p_sender_identifier => '840000008');
  if v_proof.status <> 'PENDING_REVIEW' or v_proof.status_reason <> 'SENDER_MISMATCH' then
    raise exception 'FAIL 6.11: remetente divergente não ficou em revisão (% / %)', v_proof.status, v_proof.status_reason;
  end if;
  begin
    perform public.confirm_payment_manually(v_order, v_event.id, v_proof.id);
    raise exception 'FAIL 6.12: operador confirmou um pagamento manualmente';
  exception when no_data_found then null;
  end;
  perform set_config('request.jwt.claims', v_oa, true);
  select * into v_match from public.confirm_payment_manually(v_order, v_event.id, v_proof.id, '  Confirmado com o cliente por telefone  ');
  if v_match.match_status <> 'CONFIRMED' or v_match.reason <> 'CONFIRMED_MANUALLY' or not 'MANUAL' = any (v_match.match_methods)
     or v_match.matched_by <> '00000000-0000-4000-8000-0000000005a1' or not (v_match.details -> 'overridden') ? 'SENDER_MISMATCH' then
    raise exception 'FAIL 6.13: confirmação manual incompleta (%)', v_match;
  end if;
  if (select status from public.orders where id = v_order) <> 'PAID'
     or (select status from public.payment_proofs where id = v_proof.id) <> 'CONFIRMED' then
    raise exception 'FAIL 6.14: confirmação manual não pagou o pedido / comprovativo';
  end if;

  -- S9: outside the time window → review (window is configurable, section 7).
  select id into v_order from public.create_order(v_p500, '850000009');
  perform set_config('test.o9', v_order::text, true);
  perform public.record_payment_event(v_acc, 'PP261001.9999.J00009', 500, now() - interval '3 days', null, '+258 85 000 0099');
  perform set_config('request.jwt.claims', v_op, true);
  select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'MPESA',
    p_transaction_id => 'PP261001.9999.J00009', p_amount => 500);
  if v_proof.status <> 'PENDING_REVIEW' or v_proof.status_reason <> 'OUTSIDE_TIME_WINDOW' then
    raise exception 'FAIL 6.15: evento fora da janela não ficou em revisão (% / %)', v_proof.status, v_proof.status_reason;
  end if;
  perform set_config('test.pr9', v_proof.id::text, true);
  perform set_config('request.jwt.claims', v_oa, true);
end;
$$;

-- 7. Time window per tenant + provider (tenant_settings.payments, owner) ----------------------
do $$
declare
  v_alfa  uuid := current_setting('test.alfa')::uuid;
  v_w     record;
  v_proof public.payment_proofs;
begin
  update public.tenant_settings
     set payments = payments || '{"match_window": {"MPESA": {"before_minutes": 5000, "after_minutes": -5},
                                                   "EMOLA": {"before_minutes": "muito"}}}'
   where tenant_id = v_alfa;
end;
$$;

reset role;
do $$
declare
  v_alfa uuid := current_setting('test.alfa')::uuid;
  v_beta uuid := current_setting('test.beta')::uuid;
  v_w    record;
begin
  select * into v_w from private.payment_match_window(v_alfa, 'MPESA');
  if v_w.before_minutes <> 5000 or v_w.after_minutes <> 2880 then
    raise exception 'FAIL 7.1: janela M-Pesa configurada lida como % / %', v_w.before_minutes, v_w.after_minutes;
  end if;
  select * into v_w from private.payment_match_window(v_alfa, 'EMOLA');
  if v_w.before_minutes <> 60 or v_w.after_minutes <> 2880 then
    raise exception 'FAIL 7.2: valor inválido não foi ignorado (% / %)', v_w.before_minutes, v_w.after_minutes;
  end if;
  select * into v_w from private.payment_match_window(v_beta, 'MPESA');
  if v_w.before_minutes <> 60 or v_w.after_minutes <> 2880 then
    raise exception 'FAIL 7.3: janela de outro tenant afetada';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}', true);
do $$
declare
  v_proof public.payment_proofs;
begin
  select * into v_proof from public.reconcile_payment_proof(current_setting('test.pr9')::uuid);
  if v_proof.status <> 'CONFIRMED' or (select status from public.orders where id = current_setting('test.o9')::uuid) <> 'PAID' then
    raise exception 'FAIL 7.4: janela alargada não permitiu a confirmação (%)', v_proof.status;
  end if;
end;
$$;

-- 8. Event without proof: automatic only with a full, equal sender; manual otherwise -----------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);
do $$
declare
  v_p500  uuid := current_setting('test.p500')::uuid;
  v_p900  uuid := current_setting('test.p900')::uuid;
  v_acc   uuid := current_setting('test.acc_m')::uuid;
  v_order  uuid;
  v_order2 uuid;
  v_event  public.payment_events;
  v_match  public.payment_matches;
  v_case   record;
  v_hint   text;
begin
  -- S10: one candidate and the provider shows the full sender = customer phone.
  select id into v_order from public.create_order(v_p900, '870000010');
  select * into v_event from public.record_payment_event(v_acc, 'PP261001.1010.K00010', 900, null, null, '+258 87 000 0010');
  perform set_config('test.e10', v_event.id::text, true);
  select * into v_match from public.payment_matches where payment_event_id = v_event.id and match_status = 'CONFIRMED';
  if v_match.id is null or v_match.order_id <> v_order or v_match.payment_proof_id is not null
     or not v_match.match_methods @> array['SENDER', 'AMOUNT', 'ACCOUNT', 'TIME_WINDOW', 'ORDER_CONTEXT']
     or v_match.details -> 'checks' ->> 'sender' <> 'PASS' then
    raise exception 'FAIL 8.1: evento sem comprovativo não confirmou o único pedido compatível (%)', v_match;
  end if;
  if (select status from public.orders where id = v_order) <> 'PAID' then
    raise exception 'FAIL 8.2: pedido não passou a PAID';
  end if;

  -- S11: masked sender → review only; then a manual confirmation.
  select id into v_order from public.create_order(v_p900, '870000011');
  select * into v_event from public.record_payment_event(v_acc, 'PP261001.1111.L00011', 900, null, null, '87****011');
  if exists (select 1 from public.payment_matches where payment_event_id = v_event.id and match_status = 'CONFIRMED')
     or not exists (select 1 from public.payment_matches where payment_event_id = v_event.id and order_id = v_order
                       and match_status = 'PENDING_REVIEW' and reason = 'SENDER_NOT_VERIFIED')
     or (select status from public.orders where id = v_order) <> 'PENDING' then
    raise exception 'FAIL 8.3: remetente mascarado confirmou automaticamente';
  end if;
  select * into v_match from public.confirm_payment_manually(v_order, v_event.id);
  if v_match.match_status <> 'CONFIRMED' or (select status from public.orders where id = v_order) <> 'PAID' then
    raise exception 'FAIL 8.4: confirmação manual sem comprovativo falhou';
  end if;

  -- Two compatible orders for the same customer: ambiguous → review, even with a full sender.
  select id into v_order from public.create_order(v_p900, '870000020');
  select id into v_order2 from public.create_order(v_p900, '870000020');
  select * into v_event from public.record_payment_event(v_acc, 'PP261001.2020.M00020', 900, null, null, '+258 87 000 0020');
  if exists (select 1 from public.payment_matches where payment_event_id = v_event.id and match_status = 'CONFIRMED')
     or (select count(*) from public.payment_matches where payment_event_id = v_event.id and reason = 'MULTIPLE_CANDIDATES') <> 2
     or exists (select 1 from public.orders where id in (v_order, v_order2) and status <> 'PENDING') then
    raise exception 'FAIL 8.5: evento ambíguo confirmado automaticamente';
  end if;

  -- Manual confirmation never accepts a wrong amount, a paid / unpayable order or a used event.
  select id into v_order from public.create_order(v_p500, '850000012');
  perform public.cancel_order(v_order, 'Cliente desistiu');
  for v_case in select * from (values
      (current_setting('test.o4')::uuid, current_setting('test.e4')::uuid, 'UNDERPAID'),
      (current_setting('test.o5')::uuid, current_setting('test.e5')::uuid, 'OVERPAID'),
      (current_setting('test.o1')::uuid, current_setting('test.e6m')::uuid, 'ORDER_ALREADY_PAID'),
      (current_setting('test.o3')::uuid, current_setting('test.e10')::uuid, 'EVENT_ALREADY_USED'),
      (v_order, current_setting('test.e6m')::uuid, 'ORDER_NOT_PAYABLE')
    ) as t(order_id, event_id, reason)
  loop
    begin
      perform public.confirm_payment_manually(v_case.order_id, v_case.event_id);
      raise exception 'FAIL 8.6: confirmação manual aceite (%)', v_case.reason;
    exception when object_not_in_prerequisite_state then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> v_case.reason then
        raise exception 'FAIL 8.7: esperado %, obtido %', v_case.reason, v_hint;
      end if;
    end;
  end loop;
end;
$$;

-- 9. Idempotency, input validation and AI without authority ---------------------------------
do $$
declare
  v_p500  uuid := current_setting('test.p500')::uuid;
  v_acc   uuid := current_setting('test.acc_m')::uuid;
  v_o1    uuid := current_setting('test.o1')::uuid;
  v_event public.payment_events;
  v_proof public.payment_proofs;
  v_order uuid;
  v_count int;
  v_hint  text;
begin
  -- Recording the same movement again returns it (no second event).
  select * into v_event from public.record_payment_event(v_acc, ' pp261001.1111.a00001 ', 500);
  if v_event.id <> current_setting('test.e1')::uuid then
    raise exception 'FAIL 9.1: movimento repetido criou outro evento';
  end if;
  select count(*) into v_count from public.payment_events where transaction_id = 'PP261001.1111.A00001' and payment_account_id = v_acc;
  if v_count <> 1 then
    raise exception 'FAIL 9.2: % eventos com o mesmo ID na mesma conta', v_count;
  end if;
  begin
    perform public.record_payment_event(v_acc, 'PP261001.1111.A00001', 501);
    raise exception 'FAIL 9.3: mesmo ID com valor diferente aceite';
  exception when unique_violation then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'EVENT_CONFLICT' then
      raise exception 'FAIL 9.3b: motivo inesperado %', v_hint;
    end if;
  end;
  begin
    perform public.record_payment_event(v_acc, 'AB', 500);
    raise exception 'FAIL 9.4: ID de transação inválido aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_payment_event(v_acc, 'PP261001.0000.Z00001', 0);
    raise exception 'FAIL 9.5: valor zero aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_payment_event(v_acc, 'PP261001.0000.Z00002', 10.555);
    raise exception 'FAIL 9.6: valor com 3 casas decimais aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_payment_event(v_acc, 'PP261001.0000.Z00003', -500);
    raise exception 'FAIL 9.7: valor negativo aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_payment_event(v_acc, 'PP261001.0000.Z00004', 500, now() + interval '1 day');
    raise exception 'FAIL 9.8: movimento no futuro aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_payment_event(v_acc, 'PP261001.0000.Z00005', 500, null, 'MT');
    raise exception 'FAIL 9.9: moeda inválida aceite';
  exception when invalid_parameter_value then null;
  end;

  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}', true);
  begin
    perform public.record_payment_event(v_acc, 'PP261001.0000.Z00006', 500);
    raise exception 'FAIL 9.10: operador registou um movimento real';
  exception when no_data_found then null;
  end;

  -- A second proof for an already paid order and transaction: DUPLICATE, still one confirmation.
  select * into v_proof from public.submit_payment_proof(p_order_id => v_o1, p_provider => 'MPESA',
    p_transaction_id => 'PP261001.1111.A00001');
  if v_proof.status <> 'DUPLICATE' then
    raise exception 'FAIL 9.11: segundo comprovativo do mesmo pagamento com estado %', v_proof.status;
  end if;
  select * into v_proof from public.reconcile_payment_proof(current_setting('test.pr1')::uuid);
  select count(*) into v_count from public.payment_matches where payment_proof_id = v_proof.id;
  if v_proof.status <> 'CONFIRMED' or v_count <> 1 then
    raise exception 'FAIL 9.12: reconciliar um comprovativo confirmado não é idempotente';
  end if;

  -- AI-extracted data is stored but never used to confirm.
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);
  select id into v_order from public.create_order(v_p500, '850000013');
  perform set_config('test.o13', v_order::text, true);
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}', true);
  select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'MPESA',
    p_raw_message => 'Confirmado MP261001.6666.F00006. Transferiste 500.00MT para 840000100.',
    p_extracted_data => '{"transaction_id": "MP261001.6666.F00006", "amount": 500, "provider": "MPESA", "confidence": 0.99}');
  if v_proof.status <> 'UNMATCHED' or v_proof.status_reason <> 'TRANSACTION_ID_REQUIRED'
     or exists (select 1 from public.payment_matches where payment_proof_id = v_proof.id)
     or exists (select 1 from public.payment_matches where payment_event_id = current_setting('test.e6m')::uuid and match_status = 'CONFIRMED')
     or (select status from public.orders where id = v_order) = 'PAID' then
    raise exception 'FAIL 9.13: dados extraídos por IA influenciaram a reconciliação (%)', v_proof.status;
  end if;
  perform set_config('test.pr13', v_proof.id::text, true);
  begin
    perform public.submit_payment_proof(p_order_id => v_order, p_raw_message => 'x', p_extracted_data => '{"pin": "1234"}');
    raise exception 'FAIL 9.14: PIN aceite nos dados extraídos';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.submit_payment_proof(p_order_id => v_order, p_raw_message => 'x', p_extracted_data => '{"access_token": "abc"}');
    raise exception 'FAIL 9.15: token aceite nos dados extraídos';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.submit_payment_proof(p_order_id => v_order, p_provider => 'MPESA');
    raise exception 'FAIL 9.16: comprovativo sem ID nem mensagem aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.submit_payment_proof(p_order_id => v_order, p_provider => 'mpesa', p_transaction_id => 'PP261001.0000.Z00007');
    raise exception 'FAIL 9.17: fornecedor não canónico aceite';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.submit_payment_proof(p_order_id => v_order, p_raw_message => pg_catalog.repeat('x', 2001));
    raise exception 'FAIL 9.18: mensagem acima do limite aceite';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);
end;
$$;

-- 10. Rejection, inactive account, recipient account, currency, proof amount --------------------
do $$
declare
  v_p500  uuid := current_setting('test.p500')::uuid;
  v_acc   uuid := current_setting('test.acc_m')::uuid;
  v_acc_e uuid := current_setting('test.acc_e')::uuid;
  v_oa    text := '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}';
  v_op    text := '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}';
  v_proof public.payment_proofs;
  v_event public.payment_events;
  v_order uuid;
  v_case  record;
  v_hint  text;
begin
  -- Rejection: owner / admin only, final, audited; the order goes back to AWAITING_PAYMENT.
  perform set_config('request.jwt.claims', v_op, true);
  begin
    perform public.reject_payment_proof(current_setting('test.pr3')::uuid, 'Operador');
    raise exception 'FAIL 10.1: operador rejeitou um comprovativo';
  exception when no_data_found then null;
  end;
  perform set_config('request.jwt.claims', v_oa, true);
  select * into v_proof from public.reject_payment_proof(current_setting('test.pr3')::uuid, '  Comprovativo não corresponde  ');
  if v_proof.status <> 'REJECTED' or v_proof.status_reason <> 'REJECTED_MANUALLY' or v_proof.review_note <> 'Comprovativo não corresponde' then
    raise exception 'FAIL 10.2: rejeição incorreta (%)', v_proof;
  end if;
  if (select status from public.orders where id = current_setting('test.o3')::uuid) <> 'AWAITING_PAYMENT' then
    raise exception 'FAIL 10.3: pedido não voltou a AWAITING_PAYMENT após a rejeição';
  end if;
  begin
    perform public.reject_payment_proof(current_setting('test.pr3')::uuid, 'De novo');
    raise exception 'FAIL 10.4: comprovativo rejeitado duas vezes';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.reject_payment_proof(current_setting('test.pr4')::uuid, '   ');
    raise exception 'FAIL 10.5: rejeição sem motivo aceite';
  exception when invalid_parameter_value then null;
  end;
  -- The event arriving later does not resurrect a rejected proof.
  perform public.record_payment_event(v_acc, 'PP261001.3333.C00003', 500, null, null, '+258 85 000 0099');
  if (select status from public.payment_proofs where id = current_setting('test.pr3')::uuid) <> 'REJECTED'
     or exists (select 1 from public.payment_matches where order_id = current_setting('test.o3')::uuid and match_status = 'CONFIRMED') then
    raise exception 'FAIL 10.6: comprovativo rejeitado voltou a ser usado';
  end if;

  -- Inactive receiving account: the money is recorded, but nothing is confirmed.
  perform public.update_payment_account(v_acc_e, null, 'INACTIVE');
  select id into v_order from public.create_order(v_p500, '850000014');
  select * into v_event from public.record_payment_event(v_acc_e, 'MP261001.1414.P00014', 500, null, null, '+258 86 000 0066');
  perform set_config('request.jwt.claims', v_op, true);
  select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'EMOLA',
    p_transaction_id => 'MP261001.1414.P00014', p_amount => 500);
  if v_proof.status <> 'PENDING_REVIEW' or v_proof.status_reason <> 'ACCOUNT_INACTIVE' then
    raise exception 'FAIL 10.7: conta inativa (% / %)', v_proof.status, v_proof.status_reason;
  end if;
  perform set_config('request.jwt.claims', v_oa, true);
  begin
    perform public.confirm_payment_manually(v_order, v_event.id, v_proof.id);
    raise exception 'FAIL 10.8: confirmação manual numa conta inativa';
  exception when object_not_in_prerequisite_state then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'ACCOUNT_INACTIVE' then
      raise exception 'FAIL 10.8b: motivo inesperado %', v_hint;
    end if;
  end;
  perform public.update_payment_account(v_acc_e, null, 'ACTIVE');

  -- Recipient named by the customer, currency and proof amount must agree.
  for v_case in select * from (values
      ('PP261001.1515.Q00015', 500, 'MZN', '84 000 0999', null::numeric, 'ACCOUNT_MISMATCH'),
      ('PP261001.1616.R00016', 500, 'USD', null, null, 'CURRENCY_MISMATCH'),
      ('PP261001.1717.S00017', 500, 'MZN', null, 400, 'PROOF_AMOUNT_MISMATCH')
    ) as t(tx, amount, currency, recipient, claimed, reason)
  loop
    perform set_config('request.jwt.claims', v_oa, true);
    select id into v_order from public.create_order(v_p500, '850000015');
    select * into v_event from public.record_payment_event(v_acc, v_case.tx, v_case.amount, null, v_case.currency, '+258 85 000 0099');
    perform set_config('request.jwt.claims', v_op, true);
    select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'MPESA',
      p_transaction_id => v_case.tx, p_amount => v_case.claimed, p_recipient_identifier => v_case.recipient);
    if v_proof.status <> 'PENDING_REVIEW' or v_proof.status_reason <> v_case.reason then
      raise exception 'FAIL 10.9: esperado PENDING_REVIEW/%, obtido %/%', v_case.reason, v_proof.status, v_proof.status_reason;
    end if;
    perform set_config('request.jwt.claims', v_oa, true);
    begin
      perform public.confirm_payment_manually(v_order, v_event.id, v_proof.id);
      raise exception 'FAIL 10.10: confirmação manual aceite com %', v_case.reason;
    exception when object_not_in_prerequisite_state then null;
    end;
  end loop;

  -- A manual decision cannot link a customer's proof to a different transaction.
  select id into v_order from public.create_order(v_p500, '850000018');
  perform set_config('request.jwt.claims', v_op, true);
  select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'MPESA',
    p_transaction_id => 'PP261001.1818.X00018', p_amount => 500);
  perform set_config('request.jwt.claims', v_oa, true);
  begin
    perform public.confirm_payment_manually(v_order, current_setting('test.e6m')::uuid, v_proof.id);
    raise exception 'FAIL 10.11: comprovativo ligado a outra transação';
  exception when object_not_in_prerequisite_state then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'TRANSACTION_ID_MISMATCH' then
      raise exception 'FAIL 10.11b: motivo inesperado %', v_hint;
    end if;
  end;
end;
$$;

-- 11. Direct writes and internals through the API: all refused -------------------------------
do $$
declare
  v_alfa uuid := current_setting('test.alfa')::uuid;
  v_o3   uuid := current_setting('test.o3')::uuid;
  v_e6m  uuid := current_setting('test.e6m')::uuid;
begin
  begin
    update public.orders set status = 'PAID' where id = v_o3;
    raise exception 'FAIL 11.1: status PAID definido diretamente';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payment_matches (tenant_id, order_id, payment_event_id, match_status)
    values (v_alfa, v_o3, v_e6m, 'CONFIRMED');
    raise exception 'FAIL 11.2: confirmação forjada inserida';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payment_events (payment_account_id, transaction_id, amount, currency, occurred_at)
    values (current_setting('test.acc_m')::uuid, 'FAKE12345', 500, 'MZN', now());
    raise exception 'FAIL 11.3: evento real forjado pela API';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.payment_events set amount = 1 where id = v_e6m;
    raise exception 'FAIL 11.4: valor de um evento alterado';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.payment_proofs set status = 'CONFIRMED' where id = current_setting('test.pr13')::uuid;
    raise exception 'FAIL 11.5: estado do comprovativo alterado diretamente';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payment_proofs (tenant_id, order_id, transaction_id, status) values (v_alfa, v_o3, 'FAKE12345', 'CONFIRMED');
    raise exception 'FAIL 11.6: comprovativo inserido diretamente';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.payment_accounts set tenant_id = current_setting('test.beta')::uuid where id = current_setting('test.acc_m')::uuid;
    raise exception 'FAIL 11.7: tenant de uma conta alterado';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payment_accounts (tenant_id, provider, account_name, account_identifier)
    values (v_alfa, 'MPESA', 'Direta', '840000555');
    raise exception 'FAIL 11.8: conta inserida diretamente';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.payment_proofs where id = current_setting('test.pr13')::uuid;
    raise exception 'FAIL 11.9: comprovativo apagado';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.apply_payment_decision(v_o3, v_e6m, null, '{"decision": "CONFIRMED", "methods": []}', null);
    raise exception 'FAIL 11.10: decisão interna executada pela API';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.reconcile_event(v_e6m);
    raise exception 'FAIL 11.11: reconciliação interna executada pela API';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.orders where id = v_o3) = 'PAID' then
    raise exception 'FAIL 11.12: pedido pago sem confirmação';
  end if;
end;
$$;

-- 12. Tenant isolation (same transaction ID in two tenants) ----------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005b1", "role": "authenticated"}', true);
do $$
declare
  v_beta    uuid := current_setting('test.beta')::uuid;
  v_account public.payment_accounts;
  v_order   uuid;
  v_proof   public.payment_proofs;
  v_event   public.payment_events;
begin
  -- Same receiving number as Alfa: allowed (accounts are per tenant).
  select * into v_account from public.create_payment_account(v_beta, 'MPESA', 'Loja Beta', '84 000 0100');
  perform set_config('test.acc_b', v_account.id::text, true);
  select id into v_order from public.create_order(current_setting('test.p70')::uuid, '840000001');
  perform set_config('test.ob', v_order::text, true);
  if (select count(*) from public.payment_events) <> 0 or (select count(*) from public.payment_proofs) <> 0
     or (select count(*) from public.payment_matches) <> 0 or (select count(*) from public.payment_accounts) <> 1 then
    raise exception 'FAIL 12.1: Beta vê dados de pagamentos de Alfa';
  end if;
  -- Alfa's event with the same transaction ID is invisible to Beta.
  select * into v_proof from public.submit_payment_proof(p_order_id => v_order, p_provider => 'MPESA',
    p_transaction_id => 'PP261001.1111.A00001', p_amount => 70);
  if v_proof.status <> 'UNMATCHED' or v_proof.status_reason <> 'NO_EVENT_YET' then
    raise exception 'FAIL 12.2: comprovativo de Beta usou o evento de Alfa (%)', v_proof.status;
  end if;
  perform set_config('test.pr_b', v_proof.id::text, true);
  select * into v_event from public.record_payment_event(v_account.id, 'PP261001.1111.A00001', 70, null, null, '84****001');
  if v_event.id = current_setting('test.e1')::uuid
     or (select status from public.payment_proofs where id = v_proof.id) <> 'CONFIRMED'
     or (select status from public.orders where id = v_order) <> 'PAID' then
    raise exception 'FAIL 12.3: reconciliação em Beta incorreta';
  end if;
  perform set_config('test.e_b', v_event.id::text, true);
end;
$$;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);
do $$
declare
  v_beta uuid := current_setting('test.beta')::uuid;
  v_ob   uuid := current_setting('test.ob')::uuid;
begin
  if exists (select 1 from public.payment_accounts where tenant_id = v_beta)
     or exists (select 1 from public.payment_events where tenant_id = v_beta)
     or exists (select 1 from public.payment_proofs where tenant_id = v_beta)
     or exists (select 1 from public.payment_matches where tenant_id = v_beta) then
    raise exception 'FAIL 12.4: Alfa lê dados de pagamentos de Beta';
  end if;
  begin
    perform public.record_payment_event(current_setting('test.acc_b')::uuid, 'PP261001.1212.T00012', 70);
    raise exception 'FAIL 12.5: movimento registado na conta de outro tenant';
  exception when no_data_found then null;
  end;
  begin
    perform public.update_payment_account(current_setting('test.acc_b')::uuid, null, 'INACTIVE');
    raise exception 'FAIL 12.6: conta de outro tenant alterada';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_payment_proof(p_order_id => v_ob, p_provider => 'MPESA', p_transaction_id => 'PP261001.1212.T00013');
    raise exception 'FAIL 12.7: comprovativo submetido para pedido de outro tenant';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_payment_proof(p_tenant_id => v_beta, p_provider => 'MPESA', p_transaction_id => 'PP261001.1212.T00014');
    raise exception 'FAIL 12.8: comprovativo submetido noutro tenant';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_payment_proof(p_order_id => current_setting('test.o3')::uuid, p_tenant_id => v_beta,
      p_provider => 'MPESA', p_transaction_id => 'PP261001.1212.T00015');
    raise exception 'FAIL 12.9: tenant_id manipulado aceite';
  exception when no_data_found then null;
  end;
  begin
    perform public.reconcile_payment_proof(current_setting('test.pr_b')::uuid);
    raise exception 'FAIL 12.10: reconciliação de comprovativo de outro tenant';
  exception when no_data_found then null;
  end;
  begin
    perform public.reject_payment_proof(current_setting('test.pr_b')::uuid, 'Intrusão');
    raise exception 'FAIL 12.11: comprovativo de outro tenant rejeitado';
  exception when no_data_found then null;
  end;
  begin
    perform public.confirm_payment_manually(v_ob, current_setting('test.e6m')::uuid);
    raise exception 'FAIL 12.12: evento de Alfa pagou pedido de Beta';
  exception when no_data_found then null;
  end;
  begin
    perform public.confirm_payment_manually(current_setting('test.o3')::uuid, current_setting('test.e_b')::uuid);
    raise exception 'FAIL 12.13: evento de Beta pagou pedido de Alfa';
  exception when no_data_found then null;
  end;
end;
$$;

-- 13. Platform admin: no automatic access to tenant finances ----------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005c1", "role": "authenticated"}', true);
do $$
begin
  if exists (select 1 from public.payment_accounts) or exists (select 1 from public.payment_events)
     or exists (select 1 from public.payment_proofs) or exists (select 1 from public.payment_matches) then
    raise exception 'FAIL 13.1: platform admin lê pagamentos de tenants';
  end if;
  begin
    perform public.create_payment_account(current_setting('test.alfa')::uuid, 'MPESA', 'Plataforma', '840000777');
    raise exception 'FAIL 13.2: platform admin criou conta num tenant';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_payment_event(current_setting('test.acc_m')::uuid, 'PP261001.1313.U00013', 500);
    raise exception 'FAIL 13.3: platform admin registou movimento';
  exception when no_data_found then null;
  end;
  begin
    perform public.confirm_payment_manually(current_setting('test.o3')::uuid, current_setting('test.e6m')::uuid);
    raise exception 'FAIL 13.4: platform admin confirmou pagamento';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_payment_proof(p_order_id => current_setting('test.o3')::uuid, p_provider => 'MPESA',
      p_transaction_id => 'PP261001.1313.U00014');
    raise exception 'FAIL 13.5: platform admin submeteu comprovativo';
  exception when no_data_found then null;
  end;
end;
$$;

-- 14. Suspended tenant: reads only -------------------------------------------------------------
reset role;
update public.tenants set status = 'suspended' where id = current_setting('test.alfa')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);
do $$
declare
  v_hint text;
begin
  if (select count(*) from public.payment_events) = 0 then
    raise exception 'FAIL 14.1: empresa suspensa deixou de ler os pagamentos';
  end if;
  begin
    perform public.record_payment_event(current_setting('test.acc_m')::uuid, 'PP261001.1414.V00014', 500);
    raise exception 'FAIL 14.2: movimento registado com a empresa suspensa';
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'TENANT_SUSPENDED' then
      raise exception 'FAIL 14.2b: motivo inesperado %', v_hint;
    end if;
  end;
  begin
    perform public.create_payment_account(current_setting('test.alfa')::uuid, 'MPESA', 'Suspensa', '840000888');
    raise exception 'FAIL 14.3: conta criada com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_payment_account(current_setting('test.acc_m')::uuid, 'Suspensa');
    raise exception 'FAIL 14.4: conta alterada com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.confirm_payment_manually(current_setting('test.o3')::uuid, current_setting('test.e6m')::uuid);
    raise exception 'FAIL 14.5: pagamento confirmado com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reject_payment_proof(current_setting('test.pr13')::uuid, 'Suspensa');
    raise exception 'FAIL 14.6: comprovativo rejeitado com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}', true);
  begin
    perform public.submit_payment_proof(p_order_id => current_setting('test.o3')::uuid, p_provider => 'MPESA',
      p_transaction_id => 'PP261001.1414.V00015');
    raise exception 'FAIL 14.7: comprovativo submetido com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reconcile_payment_proof(current_setting('test.pr13')::uuid);
    raise exception 'FAIL 14.8: reconciliação com a empresa suspensa';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
update public.tenants set status = 'active' where id = current_setting('test.alfa')::uuid;

-- 15. Trusted backend (database owner): immutability and guards still apply --------------------
do $$
declare
  v_alfa  uuid := current_setting('test.alfa')::uuid;
  v_e1    uuid := current_setting('test.e1')::uuid;
  v_proof public.payment_proofs;
  v_match public.payment_matches;
  v_hint  text;
begin
  begin
    update public.payment_events set amount = 1 where id = v_e1;
    raise exception 'FAIL 15.1: evento alterado';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.payment_events where id = v_e1;
    raise exception 'FAIL 15.2: evento apagado';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.payment_matches set match_status = 'REJECTED' where payment_event_id = v_e1;
    raise exception 'FAIL 15.3: decisão alterada';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.payment_matches where payment_event_id = v_e1;
    raise exception 'FAIL 15.4: decisão apagada';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.payment_proofs set amount = 1 where id = current_setting('test.pr1')::uuid;
    raise exception 'FAIL 15.5: evidência do comprovativo alterada';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.payment_proofs set status = 'PENDING_REVIEW' where id = current_setting('test.pr1')::uuid;
    raise exception 'FAIL 15.6: comprovativo confirmado reaberto';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.payment_proofs set status = 'CONFIRMED' where id = current_setting('test.pr13')::uuid;
    raise exception 'FAIL 15.7: comprovativo confirmado sem correspondência';
  exception when insufficient_privilege then null;
  end;
  insert into public.payment_proofs (tenant_id, order_id, provider, transaction_id, status, status_reason)
  values (v_alfa, current_setting('test.o13')::uuid, 'MPESA', 'zz261001.0001', 'CONFIRMED', 'FORGED')
  returning * into v_proof;
  if v_proof.status <> 'UNMATCHED' or v_proof.status_reason is not null or v_proof.transaction_id <> 'ZZ261001.0001' then
    raise exception 'FAIL 15.8: estado forjado na inserção (%)', v_proof.status;
  end if;
  begin
    update public.payment_accounts set account_identifier = '+258840000999' where id = current_setting('test.acc_m')::uuid;
    raise exception 'FAIL 15.9: identificador da conta alterado';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.payment_accounts set metadata = '{"mpesa_pin": "1234"}' where id = current_setting('test.acc_m')::uuid;
    raise exception 'FAIL 15.10: PIN guardado na conta';
  exception when check_violation then null;
  end;
  begin
    update public.payment_accounts set metadata = '{"api_secret": "x"}' where id = current_setting('test.acc_m')::uuid;
    raise exception 'FAIL 15.11: segredo guardado na conta';
  exception when check_violation then null;
  end;
  begin
    insert into public.payment_events (payment_account_id, provider, transaction_id, amount, currency, occurred_at)
    values (current_setting('test.acc_m')::uuid, 'EMOLA', 'XX261001.0001', 500, 'MZN', now());
    raise exception 'FAIL 15.12: fornecedor do evento diferente do da conta';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.payment_events (tenant_id, payment_account_id, transaction_id, amount, currency, occurred_at)
    values (current_setting('test.beta')::uuid, current_setting('test.acc_m')::uuid, 'XX261001.0002', 500, 'MZN', now());
    raise exception 'FAIL 15.13: evento com tenant manipulado';
  exception when no_data_found then null;
  end;
  begin
    insert into public.payment_events (payment_account_id, transaction_id, amount, currency, occurred_at, raw_message)
    values (current_setting('test.acc_m')::uuid, 'XX261001.0003', 500, 'MZN', now(), pg_catalog.repeat('x', 2001));
    raise exception 'FAIL 15.14: mensagem bruta acima do limite';
  exception when check_violation then null;
  end;
  begin
    insert into public.payment_matches (tenant_id, order_id, payment_event_id, match_status)
    values (v_alfa, current_setting('test.ob')::uuid, current_setting('test.e6m')::uuid, 'PENDING_REVIEW');
    raise exception 'FAIL 15.15: correspondência entre tenants';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payment_matches (tenant_id, order_id, payment_event_id, match_status)
    values (v_alfa, current_setting('test.o3')::uuid, v_e1, 'CONFIRMED');
    raise exception 'FAIL 15.16: evento confirmado duas vezes';
  exception when unique_violation then null;
  end;
  begin
    insert into public.payment_matches (tenant_id, order_id, match_status) values (v_alfa, current_setting('test.o3')::uuid, 'CONFIRMED');
    raise exception 'FAIL 15.17: confirmação sem evento real';
  exception when check_violation then null;
  end;

  -- Concurrency: the loser of a race is recorded, never applied.
  v_match := private.apply_payment_decision(current_setting('test.o3')::uuid, v_e1, null,
                                            '{"decision": "CONFIRMED", "methods": ["AMOUNT"]}', null);
  if v_match.match_status <> 'DUPLICATE' or v_match.reason <> 'EVENT_ALREADY_USED'
     or (select status from public.orders where id = current_setting('test.o3')::uuid) = 'PAID' then
    raise exception 'FAIL 15.18: corrida pelo mesmo evento (% / %)', v_match.match_status, v_match.reason;
  end if;
  v_match := private.apply_payment_decision(current_setting('test.o1')::uuid, current_setting('test.e6m')::uuid, null,
                                            '{"decision": "CONFIRMED", "methods": ["AMOUNT"]}', null);
  if v_match.match_status <> 'PENDING_REVIEW' or v_match.reason <> 'ORDER_ALREADY_PAID'
     or exists (select 1 from public.payment_matches where payment_event_id = current_setting('test.e6m')::uuid and match_status = 'CONFIRMED') then
    raise exception 'FAIL 15.19: corrida pelo mesmo pedido (% / %)', v_match.match_status, v_match.reason;
  end if;
end;
$$;

-- 16. Audit (separate from financial history) and global invariants ----------------------------
do $$
declare
  v_alfa  uuid := current_setting('test.alfa')::uuid;
  v_beta  uuid := current_setting('test.beta')::uuid;
  v_oa    uuid := '00000000-0000-4000-8000-0000000005a1';
  v_count int;
begin
  select count(*) into v_count from public.audit_logs where tenant_id = v_alfa and action = 'payment_account.created' and actor_user_id = v_oa;
  if v_count <> 3 then
    raise exception 'FAIL 16.1: esperadas 3 auditorias de conta criada, encontradas %', v_count;
  end if;
  if (select count(*) from public.audit_logs where tenant_id = v_alfa and action = 'payment_account.deactivated') <> 2
     or (select count(*) from public.audit_logs where tenant_id = v_alfa and action = 'payment_account.activated') <> 1 then
    raise exception 'FAIL 16.2: ativação / desativação de contas não auditada';
  end if;
  if (select count(*) from public.audit_logs where tenant_id = v_alfa and action = 'payment_event.recorded')
     <> (select count(*) from public.payment_events where tenant_id = v_alfa and source = 'MANUAL' and recorded_by is not null) then
    raise exception 'FAIL 16.3: registos manuais de movimentos sem auditoria (ou repetições auditadas)';
  end if;
  if (select count(*) from public.audit_logs where tenant_id = v_alfa and action = 'payment.confirmed_manually' and actor_user_id = v_oa) <> 2 then
    raise exception 'FAIL 16.4: confirmações manuais não auditadas';
  end if;
  if (select count(*) from public.audit_logs where tenant_id = v_alfa and action = 'payment_proof.rejected' and actor_user_id = v_oa) <> 1 then
    raise exception 'FAIL 16.5: rejeição não auditada';
  end if;
  if exists (select 1 from public.audit_logs where tenant_id in (v_alfa, v_beta) and action like 'payment%'
                and (metadata ? 'raw_message' or metadata ? 'sender_identifier' or metadata ? 'transaction_id')) then
    raise exception 'FAIL 16.6: dados financeiros copiados para audit_logs';
  end if;

  if exists (select 1 from public.payment_matches where match_status = 'CONFIRMED' group by payment_event_id having count(*) > 1)
     or exists (select 1 from public.payment_matches where match_status = 'CONFIRMED' group by order_id having count(*) > 1) then
    raise exception 'FAIL 16.7: evento ou pedido com mais de uma confirmação';
  end if;
  if exists (select 1 from public.orders o where o.tenant_id in (v_alfa, v_beta) and o.status = 'PAID'
                and not exists (select 1 from public.payment_matches m where m.order_id = o.id and m.match_status = 'CONFIRMED')) then
    raise exception 'FAIL 16.8: pedido PAID sem confirmação determinística';
  end if;
  if exists (select 1 from public.payment_matches m
               join public.orders o on o.id = m.order_id
               join public.payment_events e on e.id = m.payment_event_id
              where m.match_status = 'CONFIRMED' and m.tenant_id in (v_alfa, v_beta)
                and (e.amount <> o.product_price_snapshot or e.currency <> o.currency_snapshot or o.status <> 'PAID'
                     or e.tenant_id <> o.tenant_id or m.tenant_id <> o.tenant_id)) then
    raise exception 'FAIL 16.9: confirmação com valor, moeda ou tenant divergentes';
  end if;
  if exists (select 1 from public.payment_proofs p where p.tenant_id in (v_alfa, v_beta) and p.status = 'CONFIRMED'
                and not exists (select 1 from public.payment_matches m where m.payment_proof_id = p.id and m.match_status = 'CONFIRMED')) then
    raise exception 'FAIL 16.10: comprovativo confirmado sem correspondência';
  end if;
  select count(*) into v_count from public.orders where tenant_id = v_alfa and status = 'PAID';
  if v_count <> 7 then
    raise exception 'FAIL 16.11: esperados 7 pedidos pagos em Alfa, encontrados %', v_count;
  end if;
end;
$$;

-- 17. anon: nothing ------------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform 1 from public.payment_accounts;
    raise exception 'FAIL 17.1: anon lê payment_accounts';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.payment_events;
    raise exception 'FAIL 17.2: anon lê payment_events';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.payment_proofs;
    raise exception 'FAIL 17.3: anon lê payment_proofs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.payment_matches;
    raise exception 'FAIL 17.4: anon lê payment_matches';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_payment_proof(p_tenant_id => '00000000-0000-4000-8000-00000000ffff', p_raw_message => 'x');
    raise exception 'FAIL 17.5: anon submete comprovativos';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_payment_event('00000000-0000-4000-8000-00000000ffff', 'PP261001.1717.W00017', 500);
    raise exception 'FAIL 17.6: anon regista movimentos';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;

select 'PASS — 005_payments: estrutura, normalização, contas, eventos imutáveis, comprovativos sem autoridade, reconciliação determinística (ID, fornecedor, valor exato, conta, remetente, janela), PAID só por confirmação, reutilização / corridas, isolamento, platform admin, tenant suspenso, auditoria e anon verificados (transação revertida)' as resultado;

# Supabase — MegaBot

Migrations versionadas da base de dados. Nesta fase são aplicadas **manualmente**
no Supabase (SQL Editor). Cada migration é aditiva, corre numa única transação e
aborta sem alterar nada se encontrar objetos já existentes.

| Ficheiro | Conteúdo |
|---|---|
| `migrations/001_tenants.sql` | `tenants`, `tenant_users`, `tenant_settings`, RLS, criação do tenant no registo |
| `tests/001_tenants.test.sql` | Verificação da 001 (corre numa transação revertida — não deixa dados) |
| `migrations/002_platform_admin.sql` | `platform_admins`, `audit_logs` (append-only), autorização central, visão cross-tenant e suspensão de tenants |
| `tests/002_platform_admin.test.sql` | Verificação da 002 (transação revertida) |
| `migrations/003_products.sql` | `products` por tenant, fluxo USSD por produto (validado), RLS com bloqueio de escrita a tenants suspensos, arquivo e auditoria |
| `tests/003_products.test.sql` | Verificação da 003 (transação revertida) |
| `migrations/004_orders.sql` | `orders` (snapshot, referência pública, idempotência, máquina de estados) + `order_events` (histórico append-only) |
| `tests/004_orders.test.sql` | Verificação da 004 (transação revertida) |
| `migrations/005_payments.sql` | `payment_accounts`, `payment_events` (imutáveis), `payment_proofs`, `payment_matches` e reconciliação determinística que leva o pedido a `PAID` |
| `tests/005_payments.test.sql` | Verificação da 005 (transação revertida) |
| `migrations/006_devices_activation.sql` | `devices`, `device_credentials` (só hashes), `device_sims`, `activation_tasks`, `activation_task_attempts` (imutáveis), `activation_task_events`; dispatcher e protocolo do worker Android. **Ainda não aplicada** |
| `tests/006_devices_activation.test.sql` | Verificação da 006 (transação revertida) |

## Aplicar a 001

1. Supabase → **SQL Editor** → **New query**.
2. Colar o conteúdo de `migrations/001_tenants.sql` e executar (**Run**).
   - Sucesso: "Success. No rows returned".
   - Se aparecer `Migration 001 abortada: já existe …`, **nada foi alterado** — envie a
     mensagem para revermos o schema existente antes de continuar.
3. Nova query → colar `tests/001_tenants.test.sql` → **Run**.
   - Sucesso: o resultado final é `PASS — 001_tenants …`.
   - Falha: a execução para com uma mensagem `FAIL x.y: …` (envie-a).
4. **Authentication → Sign In / Providers → Email**: confirmar que *Confirm email* está
   **desativado** (o registo entra de imediato).

## Aplicar a 002 (Platform Admin)

Requer a 001 aplicada. Não altera nenhum objeto da 001.

1. SQL Editor → nova query → colar `migrations/002_platform_admin.sql` → **Run**.
   - Sucesso: "Success. No rows returned".
   - `Migration 002 abortada: falta …` → a 001 não está aplicada. `… já existe …` → a 002
     (ou algo com o mesmo nome) já existe. Em ambos os casos **nada foi alterado**.
2. Nova query → colar `tests/002_platform_admin.test.sql` → **Run**.
   - Sucesso: `PASS — 002_platform_admin …`. Falha: mensagem `FAIL x.y: …` (envie-a).
   - Um `NOTICE SKIP 9.10` só indica que o SQL Editor não pode apagar `auth.users`
     nesse projeto; o resto do teste continua válido.

### Promover o primeiro SUPER_ADMIN

O acesso de plataforma **só** existe com uma linha em `platform_admins`. O app não a pode
criar (sem INSERT/UPDATE para `authenticated`); é feito pelo dono da base de dados:

1. **Authentication → Users → Add user → Create new user**: email + palavra-passe, com
   *Auto Confirm User* ligado. Sem `business_name`, o trigger da 001 **não** cria empresa —
   a conta de plataforma não precisa de ser dona de nenhum tenant.
2. SQL Editor (o Supabase guarda o email em minúsculas; a comparação ignora maiúsculas):

```sql
insert into public.platform_admins (user_id, role, status)
select id, 'SUPER_ADMIN', 'ACTIVE' from auth.users where lower(email) = lower('<o-seu-email>')
returning user_id, role, status;
-- 0 linhas devolvidas = o utilizador ainda não existe em Authentication → Users.
-- Suporte:   ... 'SUPPORT_ADMIN' ...
-- Suspender: update public.platform_admins set status = 'SUSPENDED' where user_id = '<uuid>';
-- Revogar:   delete from public.platform_admins where user_id = '<uuid>';
```

### Login de platform admins (Fase 5)

Depois do login o app decide a área **antes** de exigir uma empresa:

| Conta | Resultado |
|---|---|
| `platform_admins.status = ACTIVE` (com ou sem empresa) | Área **Plataforma** (`/platform`), sem empresa |
| Membro de empresa ativa (e não platform admin ativo) | App da empresa (dashboard) |
| Membro de empresa suspensa | Ecrã "Empresa suspensa" |
| `platform_admins.status = SUSPENDED` **sem** empresa | Acesso negado: "O seu acesso de administração da plataforma está suspenso" |
| `SUSPENDED` **com** empresa | App da empresa (o estado de plataforma não afeta o tenant) |
| Sem empresa e sem acesso de plataforma | "Esta conta não está associada a nenhuma empresa" |

Nunca é criada uma empresa para o platform admin. O papel `admin` de uma empresa não dá
acesso à plataforma.

Cada promoção, mudança de papel/estado ou revogação fica registada em `audit_logs`
(`platform_admin.granted|role_changed|suspended|reactivated|revoked`; `actor_user_id`
fica `NULL` quando é o dono da base de dados a agir).

### Matriz de permissões (fonte única: `private.platform_role_permissions`)

| Permissão | SUPER_ADMIN | SUPPORT_ADMIN | SUSPENDED / utilizador normal / admin de tenant |
|---|:-:|:-:|:-:|
| `tenants.read` — listar/ver tenants e membros por papel | ✓ | ✓ | ✗ |
| `tenants.suspend` — ACTIVE ↔ SUSPENDED (auditado) | ✓ | ✓ | ✗ |
| `audit_logs.read` | ✓ | ✓ | ✗ |
| `platform_admins.read` — ver todos os platform admins | ✓ | só a própria linha | só a própria linha |

Gerir platform admins pela API (promover/revogar) **não** está disponível nesta fase.

### Testes manuais (Fase 3)

Substitua `<ADMIN_ID>` pelo UUID do utilizador promovido e `<TENANT_ID>` por um tenant.
Corra cada bloco inteiro — termina em `rollback`, por isso não altera nada:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
select * from public.platform_admin_context();                    -- SUPER_ADMIN, ACTIVE, permissões
select name, status, member_count, owner_count from public.platform_list_tenants();
select * from public.platform_set_tenant_status('<TENANT_ID>', 'suspended', 'Teste manual');
select action, metadata from public.audit_logs order by created_at desc limit 3;
select count(*) from public.tenants;  -- só os tenants de que o admin é membro (isolamento mantido)
rollback;
```

Com o UUID de um utilizador **normal** em `sub`: `platform_admin_context()` devolve 0 linhas,
`platform_list_tenants()` falha com *Acesso reservado à administração da plataforma*
e `audit_logs` devolve 0 linhas.

## Aplicar a 003 (Produtos)

Requer a 001 e a 002 aplicadas. Não altera nenhum objeto da 001/002.

1. SQL Editor → nova query → colar `migrations/003_products.sql` → **Run**
   ("Success. No rows returned"). `Migration 003 abortada: …` = nada foi alterado.
2. Nova query → colar `tests/003_products.test.sql` → **Run** → último resultado
   `PASS — 003_products …` (transação revertida: não deixa produtos de teste).
3. No app (modo `supabase`): **Mais → Produtos**. A lista começa **vazia** — nenhum
   produto é criado pela migration. Crie os produtos reais em **+** (Novo produto).

### Modelo

| Coluna | Regra |
|---|---|
| `price` | `numeric(12,2)` > 0 — dinheiro exato, nunca float |
| `currency` | ISO (ex.: `MZN`); por omissão a moeda do tenant (`tenant_settings.currency`) |
| `data_amount` + `data_unit` | `MB`/`GB`; ambos `NULL` só em planos `unlimited` |
| `operator` | `vodacom` / `movitel` / `tmcel` — rede do pacote (onde o USSD corre). A carteira de pagamento (M-Pesa, e-Mola) é outro conceito e pertence às encomendas |
| `status` | `ACTIVE` (à venda) / `INACTIVE` (por omissão). **`ACTIVE` exige fluxo USSD** |
| `ussd_flow` | JSONB por produto, validado (abaixo) |
| `archived_at` | Apagar = arquivar (soft delete): sai da lista, fica congelado e mantém o histórico para futuras encomendas. Não há DELETE pela API |

Nome único por tenant entre produtos não arquivados (sem distinção de maiúsculas).

### Fluxo USSD (schema versão 1)

```json
{
  "version": 1,
  "start": "*111#",
  "steps": [
    { "type": "select", "value": "5" },
    { "type": "select", "value": "8" },
    { "type": "select", "value": "2" },
    { "type": "input", "source": "destination_number" },
    { "type": "input", "source": "amount_mb" },
    { "type": "confirm" }
  ],
  "success": { "contains": ["sucesso"] },
  "failure": { "contains": ["saldo insuficiente"] }
}
```

- Passos: `select` (opção, `value` obrigatório), `input` (`source`: `destination_number`,
  `amount_mb`, `amount_gb`, `price`), `confirm` (`value` opcional, "1" por omissão),
  `wait` (`ms` 100–60000). Opcionais por passo: `label`, `expect: { contains: [...] }`.
- `success` / `failure`: textos que identificam o ecrã final.
- Chaves ou tipos desconhecidos são **rejeitados** (`private.ussd_flow_is_valid`). Novas
  capacidades (ramos condicionais, regex…) entram numa nova migration que estende o
  validador; `version` permite ao executor distinguir fluxos antigos e novos.
- A base de dados só guarda e valida — a execução fica para o worker Android.

### Permissões

| Ação | owner | admin | operator | tenant suspenso | platform admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Ler produtos do próprio tenant | ✓ | ✓ | ✓ | ✓ (só leitura) | só os tenants de que é membro |
| Criar / editar / ativar / desativar / arquivar | ✓ | ✓ | ✗ | ✗ (RLS) | ✗ |
| Ver produtos de qualquer tenant | ✗ | ✗ | ✗ | ✗ | ✓ via `platform_list_tenant_products` (só leitura, `tenants.read`) |

Auditoria automática em `audit_logs`: `product.created`, `product.updated`,
`product.activated`, `product.deactivated`, `product.archived` (metadata: nome, campos
alterados, estado — nunca o corpo do fluxo USSD nem segredos).

### Testes manuais (Fase 4)

1. Como owner: criar produto *INACTIVE* sem USSD → aparece com "Sem USSD"; tentar ativá-lo →
   "Configure o USSD deste produto antes de o pôr à venda".
2. Editar, configurar o USSD (código inicial + passos), ativar → aparece na tabela do WhatsApp.
3. Arquivar → sai da lista; o registo continua na base de dados com `archived_at`.
4. Isolamento (SQL Editor, bloco termina em `rollback`):
   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub":"<USER_B_ID>","role":"authenticated"}', true);
   select count(*) from public.products where tenant_id = '<TENANT_A_ID>';  -- 0
   rollback;
   ```

## Aplicar a 004 (Pedidos)

Requer a 001, 002 **e a 003** aplicadas (a 004 aborta sem alterar nada se faltar alguma).
Não altera nenhum objeto da 001–003.

1. SQL Editor → nova query → colar `migrations/004_orders.sql` → **Run**
   ("Success. No rows returned"). `Migration 004 abortada: …` = nada foi alterado.
2. Nova query → colar `tests/004_orders.test.sql` → **Run** → último resultado
   `PASS — 004_orders …` (transação revertida: não deixa pedidos de teste).
3. No app (modo `supabase`): **Pedidos → +** regista um pedido para um produto ativo.

### Modelo

- `orders`: `product_id` (FK, produto do **mesmo** tenant, ativo e não arquivado),
  `public_reference` (`MB-AAAAMMDD-XXXXXXXX`, aleatório — não revela volumes nem é enumerável),
  `customer_name` (opcional), `customer_phone` (E.164 em `text`; números +258 têm de ser
  móveis 82–87; outros países em E.164), **snapshot** do produto (`product_name_snapshot`,
  `product_price_snapshot`, `currency_snapshot`, `data_amount_snapshot`, `data_unit_snapshot`,
  validade e operadora), `status`, `cancel_reason`, `idempotency_key`.
- O snapshot é sempre copiado do produto **pelo servidor** (trigger) — o app nunca envia preços.
  Alterar o produto depois não muda pedidos existentes. O fluxo USSD **não** é copiado: continua
  no produto (`orders.product_id`).
- `order_events`: histórico append-only (`order.created`, `order.status_changed`,
  `order.cancelled`, `order.expired`) com ator, estado anterior/novo e metadata validada.
  É o histórico operacional do pedido; `audit_logs` (002) continua a ser a auditoria da plataforma.

### Estados

```text
PENDING ──▶ AWAITING_PAYMENT ──▶ PAID ──▶ READY_FOR_ACTIVATION ──▶ ACTIVATING ──▶ COMPLETED
   │              │  ▲                          ▲        │               │
   │              ▼  │                          │        ▼               ▼
   │           VERIFYING (pagamento em verificação)     FAILED ◀─────────┘
   ▼              │                                       │ retry → READY_FOR_ACTIVATION
CANCELLED / EXPIRED (a partir de PENDING, AWAITING_PAYMENT, VERIFYING*, FAILED*)
```

(* VERIFYING e FAILED só podem passar a CANCELLED; EXPIRED só a partir de PENDING/AWAITING_PAYMENT.)
A tabela completa está em `private.order_status_transition_allowed` e é imposta por trigger
para **todos** os papéis (incluindo `service_role`). Os dados do pedido são imutáveis depois de criado.

### Comandos (únicas escritas pela API)

| RPC | Quem | Efeito |
|---|---|---|
| `create_order(product_id, phone, name?, idempotency_key?)` | owner / admin / operator de empresa ativa | Pedido `PENDING`; a mesma chave devolve o mesmo pedido |
| `mark_order_awaiting_payment(order_id)` | idem | `PENDING → AWAITING_PAYMENT` |
| `cancel_order(order_id, reason?)` | idem | `→ CANCELLED` onde a máquina de estados permite |
| `order_status_counts(tenant_id)` | membros (RLS) | Totais por estado |

Sem INSERT/UPDATE/DELETE diretos para `authenticated`; `anon` sem acesso; tenant suspenso lê o
histórico mas não cria nem altera pedidos; platform admins não ganham acesso a pedidos de
empresas nas queries normais. `PAID` só é atingido pela reconciliação determinística da 005;
ativação e expiração automática chegam nas próximas fases (worker Android).

### Testes manuais (Fase 5)

1. **Platform admin sem empresa** — entrar com a conta promovida: abre a área **Plataforma**
   (lista de empresas só de leitura). Nenhuma empresa é criada.
2. **Platform admin suspenso** — `update public.platform_admins set status = 'SUSPENDED' where user_id = '<uuid>';`
   → o login mostra "acesso … suspenso". Repor com `status = 'ACTIVE'`.
3. **Utilizador de empresa** — login abre o dashboard como antes.
4. **Pedido** — Pedidos → **+** → escolher produto ativo, número `84 123 4567` → Registar:
   referência `MB-…`, estado *Pendente*, histórico com "Pedido criado".
   **Pedir pagamento** → *Aguarda pagamento*; **Cancelar pedido** (motivo opcional) → *Cancelado*.
5. **Snapshot** — alterar o preço do produto: o pedido mantém o preço antigo.

## Aplicar a 005 (Pagamentos e reconciliação)

Requer a 001, 002, 003 **e a 004** aplicadas (a 005 aborta sem alterar nada se faltar alguma).
Não altera nenhum objeto da 001–004; acrescenta um trigger em `orders` (ver *Pedido PAID*).

1. SQL Editor → nova query → colar `migrations/005_payments.sql` → **Run**
   ("Success. No rows returned"). `Migration 005 abortada: …` = nada foi alterado.
2. Nova query → colar `tests/005_payments.test.sql` → **Run** → último resultado
   `PASS — 005_payments …`. A transação é revertida: não ficam contas, movimentos nem pedidos de teste.
   Os testes 001–004 continuam a passar depois da 005.
3. Verificar as tabelas (RLS ativo e só policies de leitura):

   ```sql
   select c.relname, c.relrowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'payment\_%';      -- 4 linhas, todas true
   select tablename, policyname, cmd, roles
     from pg_policies where tablename like 'payment\_%';             -- 4 policies SELECT para authenticated
   ```

### Modelo — três coisas diferentes, nunca misturadas

| Tabela | O que é | Quem escreve |
|---|---|---|
| `payment_accounts` | Onde a empresa recebe (M-Pesa / e-Mola): fornecedor explícito, titular, identificador (telefone em E.164 ou código de agente/comerciante). **Nunca** PIN, password, tokens ou chaves (a metadata é validada). | owner / admin (auditado) |
| `payment_events` | **Evento real da carteira** — o dinheiro que entrou de facto. Imutável (UPDATE/DELETE/TRUNCATE bloqueados para todos). Correções = novo evento. Único por fornecedor + conta + ID da transação (idempotente). | owner / admin (`record_payment_event`, auditado); no futuro, leitor SMS / API via `service_role` |
| `payment_proofs` | **Comprovativo do cliente** — o que o cliente diz. Nunca confirma nada sozinho. `extracted_data` (IA/parser) é guardado mas a reconciliação **nunca o lê**. A evidência é imutável; o estado só é mudado pelo servidor. | qualquer membro (`submit_payment_proof`) |
| `payment_matches` | **Resultado da reconciliação** — cada decisão (append-only), com os critérios que passaram (`match_methods`) e o resultado de cada regra (`details.checks`). | só o servidor |

Estados (comprovativo e decisão): `UNMATCHED`, `PENDING_REVIEW`, `MATCHED`, `CONFIRMED`,
`REJECTED`, `DUPLICATE`, `EXPIRED` (os quatro últimos são finais para um comprovativo).

### Reconciliação determinística (sem IA)

Um pagamento só é `CONFIRMED` quando um **evento real** corresponde ao pedido em **todas** as regras:

1. **ID da transação** — quando o cliente o indicou: igual ao do evento (normalizado: maiúsculas, sem espaços).
2. **Fornecedor** — M-Pesa e e-Mola nunca se misturam. O fornecedor nunca é deduzido do formato do ID;
   o mesmo ID em fornecedores (ou contas) diferentes são eventos diferentes.
3. **Valor exato** — o valor do evento igual ao `product_price_snapshot` do pedido, na mesma moeda.
   500 para 500 confirma; 300 (`UNDERPAID`) e 700 (`OVERPAID`) vão para revisão. Não há tolerância nem
   política de excesso.
4. **Conta** — a conta que recebeu está `ACTIVE` e é a que o cliente indicou (se indicou).
5. **Remetente** — compatível com o do comprovativo; números mascarados (`84****001`) comparam só os
   dígitos visíveis (mín. 3). Sem evidência suficiente = não conta a favor nem contra.
6. **Janela de tempo** — por fornecedor, configurável em `tenant_settings.payments`
   (por omissão 60 min antes e 2880 min = 48 h depois da criação do pedido; limite 7 dias):

   ```sql
   update public.tenant_settings
      set payments = payments || '{"match_window": {"MPESA": {"before_minutes": 60, "after_minutes": 2880},
                                                    "EMOLA": {"before_minutes": 60, "after_minutes": 2880}}}'
    where tenant_id = '<TENANT_ID>';
   ```

Qualquer regra falhada → `PENDING_REVIEW` com o motivo (`UNDERPAID`, `SENDER_MISMATCH`,
`OUTSIDE_TIME_WINDOW`…). Um evento já usado → `DUPLICATE` (`EVENT_ALREADY_USED`).

| Caso | Resultado |
|---|---|
| Comprovativo sem evento | `UNMATCHED` (`NO_EVENT_YET`); pedido em `VERIFYING`; **nunca** confirmado |
| Comprovativo + evento compatível | `CONFIRMED`; pedido → `PAID` |
| Evento sem comprovativo | Pedidos em aberto com o valor exato dentro da janela são candidatos. Confirmação automática **só** com um único candidato e o remetente completo igual ao telefone do cliente; caso contrário, `PENDING_REVIEW` (`MULTIPLE_CANDIDATES` / `SENDER_NOT_VERIFIED`) para decisão humana |
| Comprovativo chega depois do evento | O comprovativo decide (ID + todas as regras) |
| Mesmo evento para dois pedidos | O segundo é `DUPLICATE` — garantido por índice único (também em concorrência) |

### Pedido PAID

O pedido só passa a `PAID` através de uma decisão `CONFIRMED`, pela máquina de estados da 004
(`PENDING → AWAITING_PAYMENT → PAID` ou `VERIFYING → PAID`). O novo trigger
`orders_require_payment_confirmation` recusa `PAID` sem uma correspondência confirmada para os papéis
da API (`authenticated`, `anon` **e** `service_role`). Índices únicos parciais garantem no máximo uma
confirmação por evento, por pedido e por comprovativo.

### Comandos (únicas escritas pela API)

| RPC | Quem | Efeito |
|---|---|---|
| `create_payment_account(tenant_id, provider, account_name, account_identifier)` | owner / admin, empresa ativa | Conta `ACTIVE` (auditado) |
| `update_payment_account(account_id, account_name?, status?)` | idem | Nome / `ACTIVE`–`INACTIVE` (fornecedor e identificador são fixos) |
| `record_payment_event(account_id, transaction_id, amount, occurred_at?, currency?, sender?, recipient?, raw_message?)` | idem | Regista um movimento real (idempotente; mesmo ID com dados diferentes = erro), audita e reconcilia |
| `submit_payment_proof(order_id?, provider?, transaction_id?, amount?, currency?, sender?, recipient?, raw_message?, extracted_data?, tenant_id?)` | qualquer membro | Guarda o comprovativo e reconcilia |
| `reconcile_payment_proof(proof_id)` | qualquer membro | Repete a reconciliação (idempotente) |
| `reject_payment_proof(proof_id, reason)` | owner / admin | `REJECTED` (final, auditado); o pedido volta a `AWAITING_PAYMENT` |
| `confirm_payment_manually(order_id, event_id, proof_id?, note?)` | owner / admin | Decisão humana sobre uma revisão, sempre com um **evento real**. Pode aceitar uma dúvida de janela ou remetente verificada pela pessoa; nunca valor/moeda errados, conta inativa, evento já usado ou pedido não pagável. Auditado (`payment.confirmed_manually`) |

`anon` sem acesso; tenant suspenso só lê; platform admins **não** ganham acesso às finanças das
empresas (nem por RLS nem por RPC). Decisões administrativas vão para `audit_logs`; o histórico
financeiro fica nas tabelas de pagamentos (sem copiar mensagens, remetentes ou IDs para a auditoria).

### Testes manuais (Fase 6)

O teste seguro é o passo 2 acima (dados sintéticos, transação revertida). Para testar com dados
**reais** (ficam guardados e auditados — use só a conta e um pagamento verdadeiros da empresa):

1. Obter o utilizador e a empresa (como `postgres`, no SQL Editor):

   ```sql
   select u.id as user_id, tu.tenant_id, tu.role
     from auth.users u join public.tenant_users tu on tu.user_id = u.id
    where u.email = '<o-seu-email>';
   ```

2. **Conta** — registar a conta M-Pesa real da empresa (atuando como o owner; `auth.uid()` tem de
   ser o utilizador para a autorização e a auditoria):

   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub": "<USER_ID>", "role": "authenticated"}', true);
   select * from public.create_payment_account('<TENANT_ID>', 'MPESA', '<Nome do titular>', '<84 xxx xxxx>');
   commit;
   ```

   Verificar: `select id, provider, account_identifier, status from public.payment_accounts where tenant_id = '<TENANT_ID>';`
   — no app, **Definições → Pagamentos** mostra a conta.

3. **Pedido + comprovativo** — no app, criar um pedido (**Pedidos → +**) e pagá-lo de verdade a partir
   de outro telemóvel. Com o ID da transação do SMS do **cliente**:

   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub": "<USER_ID>", "role": "authenticated"}', true);
   select status, status_reason from public.submit_payment_proof(
     p_order_id => '<ORDER_ID>', p_provider => 'MPESA', p_transaction_id => '<ID_DA_TRANSACAO>', p_amount => <VALOR>);
   commit;
   ```

   Resultado esperado: `UNMATCHED / NO_EVENT_YET`; o pedido fica *Em verificação*; em **Pagamentos**
   aparece como *Pendente* (nunca *Confirmado*).

4. **Evento real** — com os dados do SMS de **receção** da carteira da empresa:

   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub": "<USER_ID>", "role": "authenticated"}', true);
   select id, provider, transaction_id, amount from public.record_payment_event(
     p_payment_account_id => '<ACCOUNT_ID>', p_transaction_id => '<ID_DA_TRANSACAO>', p_amount => <VALOR>,
     p_occurred_at => '<AAAA-MM-DD HH:MM+02>', p_sender_identifier => '<remetente como aparece no SMS>');
   commit;
   ```

5. **Reconciliação** — verificar:

   ```sql
   select status from public.orders where id = '<ORDER_ID>';                                -- PAID
   select status, status_reason from public.payment_proofs where order_id = '<ORDER_ID>';  -- CONFIRMED
   select match_status, match_methods, reason, details -> 'checks'
     from public.payment_matches where order_id = '<ORDER_ID>';
   select action, created_at from public.audit_logs
    where tenant_id = '<TENANT_ID>' and action like 'payment%' order by created_at desc;
   ```

   Repetir o passo 4 devolve o mesmo evento (idempotente). Um valor diferente do pedido deixa o
   comprovativo em `PENDING_REVIEW` (`UNDERPAID` / `OVERPAID`) e o pedido não fica pago.

## Aplicar a 006 (Dispositivos e motor de ativação)

> **Estado:** a 006 **ainda não foi aplicada** no projeto Supabase. Aplicação manual, como as anteriores.
> Desenho completo: [`docs/phase7/PHASE7_ACTIVATION_ENGINE.md`](../docs/phase7/PHASE7_ACTIVATION_ENGINE.md).

Requer a 001–005 aplicadas (aborta sem alterar nada se faltar alguma ou se algum objeto da 006 já
existir). Não altera nenhum objeto da 001–005; acrescenta dois triggers em `orders`:
`orders_create_activation_task` (cria a tarefa quando o pedido passa a `PAID`) e
`orders_require_activation_success` (recusa `COMPLETED` sem uma ativação `SUCCESS`). Pedidos já `PAID`
no momento da aplicação recebem a sua tarefa `QUEUED`.

1. SQL Editor → nova query → colar `migrations/006_devices_activation.sql` → **Run**
   ("Success. No rows returned"). `Migration 006 abortada: …` = nada foi alterado (envie a mensagem).
2. Nova query → colar `tests/006_devices_activation.test.sql` → **Run** → último resultado
   `PASS — 006_devices_activation …`. A transação é revertida: não ficam dispositivos, SIMs, tarefas nem
   pedidos de teste. Os testes 001–005 continuam a passar depois da 006.
3. Verificar as tabelas (RLS ativo; só policies de leitura; `device_credentials` sem nenhuma policy):

   ```sql
   select c.relname, c.relrowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('devices', 'device_credentials', 'device_sims', 'activation_tasks',
                        'activation_task_attempts', 'activation_task_events');   -- 6 linhas, todas true
   select tablename, policyname, cmd, roles
     from pg_policies
    where tablename in ('devices', 'device_credentials', 'device_sims', 'activation_tasks',
                        'activation_task_attempts', 'activation_task_events');   -- 5 policies SELECT (nenhuma em device_credentials)
   ```

### Modelo

| Tabela | O que é |
|---|---|
| `devices` | Telemóveis Android (workers) da empresa: `UNREGISTERED` → `ACTIVE` ↔ `DISABLED`. *Online* deriva de `last_seen_at` (relógio do servidor) e de `tenant_settings.automation.heartbeat_timeout_seconds` (120 s por omissão) |
| `device_credentials` | Só o SHA-256 do código de emparelhamento e do token do dispositivo. Sem grants nem policies |
| `device_sims` | SIMs por slot (único por dispositivo), operadora explícita (`vodacom` / `movitel` / `tmcel`), número opcional. Nunca PIN, PUK ou OTP |
| `activation_tasks` | Uma por pedido `PAID` (único). Snapshot do fluxo USSD do produto; estados `QUEUED`, `ASSIGNED`, `EXECUTING`, `SUBMITTED`, `VERIFYING`, `SUCCESS`, `FAILED`, `UNKNOWN` |
| `activation_task_attempts` | Cada tentativa (worker, sistema ou pessoa), imutável |
| `activation_task_events` | Histórico das transições, append-only |

`UNKNOWN` = o USSD pode ter sido executado mas nada prova o resultado: **nunca** é repetido
automaticamente; um owner/admin decide (`resolve_activation_task`). Pedido: `SUCCESS` → `COMPLETED`,
`FAILED` → `FAILED`, `UNKNOWN` fica em revisão (`ACTIVATING`).

Tempos configuráveis por empresa (segundos; fora dos limites usa-se o valor por omissão):

```sql
update public.tenant_settings
   set automation = automation || '{"heartbeat_timeout_seconds": 120,
                                    "assignment_timeout_seconds": 300,
                                    "execution_timeout_seconds": 600}'
 where tenant_id = '<TENANT_ID>';
```

### Comandos (únicas escritas pela API)

| RPC | Quem | Efeito |
|---|---|---|
| `create_device(tenant_id, device_name)` | owner / admin, empresa ativa | Dispositivo `UNREGISTERED` + código de emparelhamento (15 min, uso único) |
| `create_device_pairing_code(device_id)` | idem | Novo código (re-emparelhar; o token anterior deixa de valer quando o novo é usado) |
| `update_device(device_id, device_name?, status?)` | idem | Nome / `ACTIVE`–`DISABLED` (desativar devolve à fila as tarefas atribuídas) |
| `register_device_sim(device_id, slot_index, operator, phone_number?)` | idem | SIM `ACTIVE` no slot |
| `update_device_sim(sim_id, operator?, phone_number?, status?)` | idem | Dados / estado do SIM (confirmar um SIM trocado) |
| `dispatch_activation_tasks(tenant_id)` | idem | Corre o dispatcher (também corre a cada heartbeat) |
| `retry_activation_task(task_id, note?)` | idem | Só tarefas `FAILED` → `QUEUED` (auditado) |
| `resolve_activation_task(task_id, outcome, note)` | idem | Só tarefas `UNKNOWN` → `SUCCESS` / `FAILED`, nota obrigatória (auditado) |
| `register_device(pairing_code, device_identifier, platform, app_version)` | membro com sessão, no telemóvel | Consome o código; devolve o token do dispositivo **uma vez** |
| `device_heartbeat`, `worker_fetch_task`, `worker_start_task`, `worker_report_progress`, `worker_report_result` | membro + token do dispositivo | Protocolo `megabot.activation.v1` (o servidor reavalia cada resultado com os textos do produto) |
| `platform_list_tenant_devices`, `platform_list_tenant_activation_tasks` | platform admin (`tenants.read`) | Só leitura |

`anon` sem acesso; empresa suspensa só lê. O `service_role` não tem INSERT/UPDATE/DELETE nas tabelas
da 006 e não consegue levar um pedido a `COMPLETED` sem ativação; pode correr
`private.dispatch_activation_tasks` / `private.expire_stale_activation_tasks` (para um futuro cron).

### Testes manuais (Fase 7)

O teste seguro é o passo 2 acima. Com dados **reais** (ficam guardados e auditados):

1. No app (owner/admin): **Dispositivos → +** → nome → aparece o código `XXXX-XXXX`.
2. No telemóvel Android, com sessão iniciada na mesma empresa: **Mais → Modo worker** → escrever o
   código → *Emparelhar*. O dispositivo passa a *Ativo*.
3. **Dispositivos → (dispositivo) → Registar SIM** → slot, operadora e número.
4. Verificar:

   ```sql
   select id, device_name, status, last_seen_at, capabilities from public.devices where tenant_id = '<TENANT_ID>';
   select device_id, slot_index, operator, status from public.device_sims where tenant_id = '<TENANT_ID>';
   select action, created_at from public.audit_logs
    where tenant_id = '<TENANT_ID>' and (action like 'device.%' or action like 'sim.%') order by created_at desc;
   ```

5. Um pedido que chega a `PAID` (fluxo da Fase 6) cria a tarefa — **Automação** mostra-a *Na fila*:

   ```sql
   select status, device_id, sim_id, attempt_count, result_code from public.activation_tasks where order_id = '<ORDER_ID>';
   select from_status, to_status, event_type, created_at from public.activation_task_events
    where task_id = '<TASK_ID>' order by created_at;
   ```

> **Sem o módulo nativo USSD** (ainda não existe; ver o documento da Fase 7) o worker declara
> `ussd: false` e o dispatcher **não lhe atribui** tarefas: ficam `QUEUED`. Isto é o comportamento
> correto — nenhuma ativação é simulada no modo Supabase.

## Ligar o app ao Supabase

1. Em `.env`: `EXPO_PUBLIC_DATA_SOURCE=supabase`, `EXPO_PUBLIC_SUPABASE_URL` e a chave
   pública em `EXPO_PUBLIC_SUPABASE_ANON_KEY` **ou** `EXPO_PUBLIC_SUPABASE_KEY`.
2. Reiniciar com cache limpa: `npx expo start --clear`
   (variáveis `EXPO_PUBLIC_*` são embutidas no bundle; sem `--clear` o valor antigo pode persistir).
3. No app: **Criar conta** → nome, loja, email, palavra-passe + confirmação. O trigger cria o
   tenant e o utilizador fica como `owner`. Login, sessão persistente e logout passam a ser reais.
4. Produtos e pedidos são reais. Os domínios que ainda não estão no backend (pagamentos,
   dispositivos, SIMs, WhatsApp, automação) aparecem **vazios** no modo `supabase` — os dados de
   demonstração só existem no modo `mock` e nunca se misturam com dados reais.

## Definições do Auth (Dashboard)

| Onde | Valor |
|---|---|
| Authentication → Sign In / Providers → Email → *Confirm email* | **Desativado** |
| Authentication → Sign In / Providers → Email → *Minimum password length* | **8** (igual ao app) |
| Authentication → Sign In / Providers → *Allow anonymous sign-ins* | **Desativado** |
| Authentication → URL Configuration → *Redirect URLs* | ver abaixo |

### Recuperação de palavra-passe (deep link)

O email de recuperação devolve o utilizador ao app em `/reset-password`. O app pede ao
Supabase o redirect gerado por `Linking.createURL('reset-password')`:

| Ambiente | Redirect enviado | Adicionar em *Redirect URLs* |
|---|---|---|
| Development build / produção (scheme `megabot`, `app.json`) | `megabot://reset-password` | `megabot://**` |
| Expo Go (só desenvolvimento) | `exp://<ip>:<porta>/--/reset-password` | `exp://**` |

Sem esta lista, o Supabase ignora o redirect e envia o utilizador para o *Site URL*.
O template "Reset Password" por omissão (`{{ .ConfirmationURL }}`) já respeita o redirect.

## Testes manuais (Fase 2.1)

Use emails de teste reais que controle (para receber o email de recuperação).

1. **Registo 1** — app em modo `supabase`: *Criar conta* com loja `MegaBot Test`.
   Esperado: entra direto no dashboard, saudação com o seu nome. No SQL Editor:
   ```sql
   select u.email, t.name, t.slug, t.status, tu.role, s.currency, s.timezone
     from auth.users u
     join public.tenant_users tu on tu.user_id = u.id
     join public.tenants t on t.id = tu.tenant_id
     join public.tenant_settings s on s.tenant_id = t.id
    order by u.created_at desc
    limit 5;
   ```
   Deve existir 1 linha com `role = owner`, `status = active`, `MZN`, `Africa/Maputo`.
2. **Registo 2** — terminar sessão, criar outra conta (outro email, outra loja).
   A mesma query deve mostrar 2 tenants **diferentes**.
3. **Isolamento (RLS)** — substitua os UUIDs pelos da query anterior e execute:
   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub":"<USER_A_ID>","role":"authenticated"}', true);
   select id, name from public.tenants;                       -- só o tenant A
   select count(*) from public.tenants where id = '<TENANT_B_ID>';        -- 0
   select count(*) from public.tenant_settings where tenant_id = '<TENANT_B_ID>'; -- 0
   rollback;
   ```
4. **Login** — terminar sessão e entrar de novo: abre o mesmo tenant.
   Palavra-passe errada → "Email ou palavra-passe incorretos."
5. **Logout** — *Mais → Terminar sessão*: volta ao login; ao entrar com a conta 2 não
   aparece nada da conta 1 (nome, loja).
6. **Sessão persistente** — com sessão iniciada, fechar o app por completo e reabrir:
   entra direto no dashboard, sem login.
7. **Email repetido** — registar de novo com o email da conta 1:
   "Já existe uma conta com este email…" no campo email.
8. **Recuperação** — *Esqueceu a palavra-passe?* → email → abrir o link **no telemóvel**
   (development build ou Expo Go, conforme a tabela acima) → definir nova palavra-passe →
   entra no app; entrar depois com a nova palavra-passe.
9. **Tenant suspenso** (opcional) — no SQL Editor:
   `update public.tenants set status = 'suspended' where id = '<TENANT_A_ID>';`
   Reabrir o app com a conta A → ecrã "Empresa suspensa". Repor com `status = 'active'`
   e tocar em *Verificar novamente*.

> Os testes automáticos do app (`npm test`) validam a lógica do cliente com um backend
> simulado. **Não** substituem os testes de RLS na base de dados (ponto 3 e
> `tests/001_tenants.test.sql`).

## Modelo de segurança

```text
autenticação   auth.uid()
autorização    platform_admins (ACTIVE) → papel de plataforma → permissões      (002)
               tenant_users (membership) → tenant_id → papel no tenant → linha.tenant_id   (001)
```

- O acesso de plataforma vem **só** de `platform_admins` — nunca de `tenant_users.role`,
  email, metadata do utilizador ou de algo enviado pelo app. Um `owner`/`admin` de tenant
  não é platform admin.
- Platform admins **não** ganham RLS extra nas tabelas de tenant: as queries normais
  continuam isoladas. A leitura cross-tenant é feita só pelas RPCs `platform_*`, que
  verificam a permissão antes de ler.
- `audit_logs` é append-only para todos (trigger bloqueia UPDATE/DELETE/TRUNCATE, até
  para `service_role` e o dono). A metadata é validada: sem chaves do tipo password/token/
  secret/api key e sem valores JWT/`sb_secret_`. Um utilizador com histórico de auditoria
  não pode ser apagado de `auth.users` (suspenda/banir em vez de apagar).
- Funções `SECURITY DEFINER` da 002 vivem só no schema `private`; a API expõe apenas
  wrappers `SECURITY INVOKER` em `public`.

- RLS ativo em todas as tabelas; `anon` sem acesso.
- O `tenant_id` nunca vem do app: memberships só são criadas por funções do servidor.
  O app apenas chama `auth.signUp` com `business_name`; o trigger provisiona o tenant.
  A RPC `create_tenant` (idempotente) existe para recuperação de contas antigas, mas o
  app não a chama automaticamente.
- Utilizadores autenticados só podem alterar colunas permitidas (`tenants.name`,
  definições do tenant) — nunca `tenant_id`, `status`, `slug` ou papéis.
- Funções auxiliares de RLS no schema `private` (não exposto pela API),
  `SECURITY DEFINER` com `search_path` fixo e documentado no SQL.
- O app usa apenas a chave pública (publishable/anon). A `service_role` nunca vai para o app.

## Convenções para as próximas migrations

- `NNN_nome.sql`, uma por domínio, sempre aditiva e com verificação prévia.
- Toda a tabela de tenant tem `tenant_id uuid not null references public.tenants(id)`,
  RLS com `tenant_id in (select private.user_tenant_ids())` e escrita por papel com
  `private.has_tenant_role(tenant_id, array['owner','admin'])`.
- Cada migration tem o seu `tests/NNN_*.test.sql` e atualiza
  `src/lib/supabase/database.types.ts` (ou é regenerado com `supabase gen types`).
- Ações sensíveis são auditadas no servidor com `private.write_audit_log(...)` (dentro de
  funções `SECURITY DEFINER` em `private`), nunca escritas pelo app.
- Escritas com regras de negócio (estados, snapshots) são **comandos RPC**: função
  `SECURITY DEFINER` em `private` (autoriza explicitamente: membro do tenant + tenant ativo) e
  wrapper `SECURITY INVOKER` em `public`; triggers impõem as invariantes para todos os papéis
  (padrão da 004).
- Dados financeiros (005): factos imutáveis (`payment_events`), decisões append-only
  (`payment_matches`), metadata validada contra credenciais (`private.payment_metadata_is_safe`)
  e nenhuma decisão baseada em IA.
- Desde a 003, as policies de escrita de tabelas de tenant exigem também
  `private.tenant_is_active(tenant_id)` (tenant suspenso = só leitura). As tabelas da 001
  ainda não têm esta regra (não foram alteradas).

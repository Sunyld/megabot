# MegaBot — Estado do backend

Auditoria feita em 2026-10-02 sobre o commit `e78e926`, antes de iniciar o motor de ativação USSD (Fase 7).

## Resumo

| Item | Estado |
|---|---|
| Migrations | 001–005 no repositório, nenhuma alterada depois do commit que a criou |
| Supabase (`ssykspkfbblrwgixtast`) | 001–005 aplicadas pelo dono do projeto; existência das tabelas e RPCs confirmada por consulta REST só de leitura (o `anon` é recusado em todas) |
| RLS | Ativo nas 12 tabelas do schema `public`; nenhuma policy `using (true)` nem para `anon` |
| `SECURITY DEFINER` | Todas com `search_path` fixo; só uma fora de `private` (`public.create_tenant`, ver *Observações*) |
| Segredos | Nenhum no repositório nem nos bundles Android; `.env` fora do git (só `.env.example` com marcadores) |
| BityStore / ByteStore | Nenhuma referência |
| TypeScript / Lint | PASS / PASS |
| Jest | 21 suites, 361 testes — PASS |
| SQL (PGlite, Postgres 18) | Testes 001–005, reexecuções e verificações de pré-requisitos — PASS (47 passos) |
| Android (`expo export`) | Modo Supabase e modo mock — PASS |

## Arquitetura atual

### App (React Native + Expo SDK 57, Expo Router)

```text
Screen (src/features/*/screens)
  → Hook (src/hooks)               React Query leve (src/lib/query)
    → Service (contratos em src/services/types.ts)
      → mock (src/services/mock)    EXPO_PUBLIC_DATA_SOURCE=mock — dados de demonstração
      → Supabase (src/services/supabase)  gateway fino (supabase-js) + mapeamento linhas → domínio
```

- O backend é escolhido num único sítio (`src/services/index.ts`). Os ecrãs nunca chamam o Supabase nem importam mocks.
- **No modo Supabase só aparecem dados reais.** Os domínios ainda sem backend (dashboard, dispositivos, SIMs, notificações, WhatsApp, automação) usam os serviços mock filtrados pelo tenant real, por isso aparecem vazios (`stopServingDemoData`).
- A sessão é uma união: `tenant` (app da empresa) ou `platform` (administração MegaBot, sem empresa).
- A app usa só a chave pública (publishable). A `service_role` nunca entra no app; `config.ts` recusa chaves `sb_secret_` / `service_role`.

| Domínio | Modo Supabase | Migration |
|---|---|---|
| Autenticação, tenant, sessão | Real | 001 |
| Administração da plataforma | Real | 002 |
| Produtos + fluxo USSD por produto | Real | 003 |
| Pedidos | Real | 004 |
| Pagamentos e reconciliação | Real | 005 |
| Dashboard, dispositivos, SIMs, tarefas de ativação, WhatsApp, notificações | Vazio (sem backend) | — |

### Base de dados (Supabase / Postgres)

- **Autenticação → autorização:** `auth.uid()` → `tenant_users` → `tenant_id` → papel (owner / admin / operator). O acesso de plataforma vem só de `platform_admins` (002).
- **Leituras:** RLS `tenant_id in (select private.user_tenant_ids())`.
- **Escritas com regras de negócio:** comandos RPC — função `SECURITY DEFINER` em `private` (autoriza: membro + papel + tenant ativo) e wrapper `SECURITY INVOKER` em `public`. Triggers impõem as invariantes a todos os papéis, incluindo `service_role`.
- **Tenant suspenso:** só leitura (`private.tenant_is_active`).
- **Histórico:** `audit_logs` (auditoria administrativa, append-only), `order_events` (histórico do pedido), `payment_events` / `payment_matches` (histórico financeiro, imutável). São registos separados.
- **Erros:** `SQLSTATE` + `hint` com um código máquina (`TENANT_SUSPENDED`, `INVALID_TRANSITION`, `UNDERPAID`…) e mensagem em português; o app mapeia-os para `AppError`.

## Tabelas existentes

| Migration | Tabela | Função | Escrita pela API |
|---|---|---|---|
| 001 | `tenants` | Empresas (`active` / `suspended`) | `UPDATE` do nome por owner/admin |
| 001 | `tenant_users` | Membros e papéis | Nenhuma (trigger de registo) |
| 001 | `tenant_settings` | Moeda, fuso, locale, secções JSON (`payments`, `whatsapp`, `automation`) | `UPDATE` por owner/admin |
| 002 | `platform_admins` | Staff MegaBot (`SUPER_ADMIN` / `SUPPORT_ADMIN`, `ACTIVE` / `SUSPENDED`) | Nenhuma |
| 002 | `audit_logs` | Auditoria append-only (metadata validada contra segredos) | Nenhuma (funções do servidor) |
| 003 | `products` | Catálogo por tenant, preço, validade, operadora, **fluxo USSD validado** | `INSERT` / `UPDATE` por owner/admin de empresa ativa |
| 004 | `orders` | Pedido com snapshot do produto, referência pública, idempotência, máquina de estados | RPCs `create_order`, `mark_order_awaiting_payment`, `cancel_order` |
| 004 | `order_events` | Histórico append-only dos estados | Nenhuma (trigger) |
| 005 | `payment_accounts` | Contas de recebimento (M-Pesa / e-Mola), sem credenciais | RPCs `create_payment_account`, `update_payment_account` |
| 005 | `payment_events` | Movimentos reais da carteira — imutáveis | RPC `record_payment_event` |
| 005 | `payment_proofs` | Comprovativos do cliente — sem autoridade | RPCs `submit_payment_proof`, `reconcile_payment_proof`, `reject_payment_proof` |
| 005 | `payment_matches` | Decisões de reconciliação — append-only | Só o servidor; humano via `confirm_payment_manually` |

RPCs de plataforma (002/003): `platform_admin_context`, `platform_list_tenants`, `platform_get_tenant`, `platform_set_tenant_status`, `platform_list_tenant_products` — todas verificam a permissão de plataforma antes de ler.

## Fluxos implementados

1. **Registo:** `auth.signUp` com `business_name` → trigger cria tenant, owner e definições. O app nunca cria tenants.
2. **Login:** platform admin ativo → área *Plataforma* (sem empresa); admin suspenso → recusado; membro → app da empresa; empresa suspensa → ecrã de suspensão.
3. **Plataforma:** listar/consultar empresas, suspender/reativar (auditado), ver produtos de uma empresa, ler a auditoria.
4. **Produtos:** criar/editar/ativar/desativar/arquivar; um produto só fica ativo com um fluxo USSD válido (`ussd_flow`, schema versão 1 com passos `select` / `input` / `confirm` e textos de sucesso/falha).
5. **Pedidos:** criação idempotente com snapshot do preço; máquina de estados com 17 transições imposta por trigger:

   ```text
   PENDING → AWAITING_PAYMENT → (VERIFYING →) PAID → READY_FOR_ACTIVATION → ACTIVATING → COMPLETED
                                                       FAILED → READY_FOR_ACTIVATION (retry) | CANCELLED
   CANCELLED / EXPIRED como saídas
   ```

6. **Pagamentos:** comprovativo do cliente + movimento real da carteira → reconciliação determinística (ID da transação, fornecedor, valor exato, conta, remetente, janela de tempo por fornecedor) → decisão `CONFIRMED` → pedido `PAID`. Sem IA. Evento sem comprovativo só confirma sozinho com um único candidato e remetente completo igual ao telefone do cliente; o resto vai para revisão humana (auditada). Um evento nunca paga dois pedidos (índices únicos).
7. **PAID só por confirmação:** trigger `orders_require_payment_confirmation` recusa `PAID` sem decisão confirmada para `anon`, `authenticated` e `service_role`.

**Ainda não existe:** passagem `PAID → READY_FOR_ACTIVATION`, tarefas de ativação, dispositivos, SIMs, execução USSD, WhatsApp, leitura de SMS.

## Auditoria (2026-10-02)

| Verificação | Resultado |
|---|---|
| Migrations 001–005 alteradas depois de criadas | Não — cada ficheiro só aparece no commit que o criou (`git log -- <ficheiro>`) |
| Referências BityStore / ByteStore | 0 |
| `.env` no git | Não; `.gitignore` cobre `.env`, `.env.local`, `.env.*.local`; só `.env.example` (marcadores) |
| Segredos em ficheiros versionados | 0 (a única ocorrência é um JWT sintético no teste 002 que prova que a auditoria o rejeita) |
| Segredos nos bundles Android | 0 (só padrões de deteção: `sb_secret_` em `config.ts`, `paymentRules.ts` e supabase-js) |
| Tabelas sem RLS | 0 de 12 |
| Policies permissivas / para `anon` | 0 |
| `SECURITY DEFINER` sem `search_path` fixo | 0 |
| `SECURITY DEFINER` em `public` | 1 — `create_tenant` (ver abaixo) |
| Tabelas acessíveis a `anon` | 0 (local e confirmado no Supabase real) |
| Funções `public` executáveis por `anon` | 0 |

### Observações (sem ação nesta auditoria — exigiriam nova migration)

1. **`public.create_tenant` (001)** é `SECURITY DEFINER` no schema `public`. Exige `auth.uid()`, é idempotente por utilizador (devolve a empresa de que já é owner), tem `search_path` fixo e `anon` não a executa. Existe para recuperar contas antigas e o app não a chama. Risco baixo: um utilizador autenticado sem empresa própria (operador ou platform admin) pode criar uma empresa para si.
2. **`private.set_updated_at`, `private.slugify`, `private.validate_tenant_settings` (001)** mantêm `EXECUTE` para `PUBLIC`. São `SECURITY INVOKER` e `anon` não tem `USAGE` no schema `private`: sem escalada de privilégios.
3. **`service_role` tem `DELETE` em `tenants` (privilégios por omissão da 001).** Apagar uma empresa remove em cascata pedidos e histórico financeiro. A `service_role` nunca está no app, mas convém revogar este privilégio quando houver uma migration de endurecimento.
4. **Concorrência:** as garantias (uma confirmação por evento/pedido, idempotência) assentam em índices únicos e `FOR UPDATE`; o PGlite só tem uma ligação, por isso as corridas foram testadas pelo caminho do índice único, não com transações paralelas reais.
5. **Reclamação de ID de transação:** quem conhecer o ID de um movimento ainda não reclamado pode associá-lo a outro pedido do mesmo valor (o primeiro ganha; o segundo fica `DUPLICATE`). Na fase WhatsApp, exigir o número do cliente/remetente nos comprovativos vindos de clientes.

## Próximos passos

> **Atualização (Fase 7):** o ponto 1 foi implementado na migration `006_devices_activation.sql`
> (**ainda não aplicada** no Supabase) e no worker Android — ver
> [`docs/phase7/PHASE7_ACTIVATION_ENGINE.md`](phase7/PHASE7_ACTIVATION_ENGINE.md). O ponto 2 continua em aberto.

1. **Fase 7 — motor de ativação:** dispositivos e SIMs por tenant, registo seguro do worker Android (sem `service_role` no APK), heartbeat, `activation_tasks` criadas uma única vez quando o pedido chega a `PAID`, dispatcher com bloqueio seguro (`FOR UPDATE SKIP LOCKED`), protocolo versionado backend ↔ worker, resultado `SUCCESS` / `FAILED` / `UNKNOWN` (UNKNOWN nunca repete sozinho) e ligação à máquina de estados dos pedidos (`READY_FOR_ACTIVATION → ACTIVATING → COMPLETED | FAILED`).
2. **Execução USSD real:** exige build de desenvolvimento e módulo nativo Android (Telephony / seleção de SIM) — não existe no Expo Go.
3. **Endurecimento:** revogar `DELETE` de `service_role` em `tenants`; regenerar `src/lib/supabase/database.types.ts` com `supabase gen types` quando o CLI/MCP estiver disponível (hoje é escrito à mão).
4. **Fases seguintes:** WhatsApp (comprovativos de clientes), leitura de SMS da carteira, APIs dos fornecedores, expiração automática de pedidos.

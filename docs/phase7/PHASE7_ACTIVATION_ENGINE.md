# Fase 7 — Motor de ativação, dispositivos, SIMs e worker Android

> **Estado (2026-10-02):** a migration `006_devices_activation.sql` está escrita e testada localmente
> (PGlite), mas **não foi aplicada** no Supabase. O USSD físico **não foi demonstrado**: o backend e o
> worker estão prontos, a execução real depende do módulo nativo `MegabotUssd` (ver
> [Estado do USSD real](#estado-do-ussd-real)).

## Fluxo

```
Pedido PAID ──▶ activation_tasks (QUEUED, exatamente uma por pedido)
                  │ dispatcher (FOR UPDATE SKIP LOCKED)
                  ▼
               ASSIGNED (dispositivo + SIM) ──▶ EXECUTING ──▶ SUBMITTED ──▶ (VERIFYING)
                  │                                │               │
                  ▼                                ▼               ▼
               QUEUED (libertada)               FAILED        SUCCESS | FAILED | UNKNOWN
                                                                   │
                                     Pedido: SUCCESS → COMPLETED · FAILED → FAILED · UNKNOWN → em revisão
```

- A tarefa nasce **só** da transição legítima do pedido para `PAID` (trigger `orders_create_activation_task`,
  que corre depois da confirmação de pagamento da 005). É idempotente: `activation_tasks.order_id` é único.
- O fluxo USSD é **copiado** do produto para a tarefa (`ussd_flow` + `flow_version`); os valores vêm do
  **snapshot do pedido** (número, quantidade, preço) — nunca do produto atual nem do telemóvel.
- Um produto sem fluxo USSD gera a tarefa já `FAILED` (`INVALID_FLOW`) e o pedido vai para `FAILED`.

## Arquitetura

```
App (React Native)
  Screen → Hook (React Query) → Service ─┬─ mock (fixtures em memória, mesmas regras da 006)
                                         └─ supabase (RPCs da 006, sem service_role)

Worker (mesma app, rota /worker, Android)
  WorkerRuntime ─ DeviceManager (emparelhar / esquecer, SecureStore)
               ├─ Heartbeat (30 s: capacidades, telemetria, SIMs)
               ├─ Poller (15 s: worker_fetch_task)
               ├─ TaskExecutor (protocolo megabot.activation.v1)
               └─ UssdExecutor ─┬─ AndroidUssdExecutor → módulo nativo MegabotUssd (a construir)
                                └─ MockUssdExecutor (só modo demonstração e testes)
```

| Camada | Ficheiros |
|---|---|
| Migration / testes SQL | `supabase/migrations/006_devices_activation.sql`, `supabase/tests/006_devices_activation.test.sql` |
| Tipos | `src/types/activation.ts`, `src/types/device.ts`, `src/types/automation.ts` |
| Regras partilhadas | `src/services/activationRules.ts` (máquina de estados, códigos, classificação, validação) |
| Serviços | `src/services/supabase/activationGateway.ts`, `src/services/supabase/activation.ts`, `src/services/mock/activation.ts` |
| Hooks | `src/hooks/useActivation.ts`, `src/hooks/useCatalog.ts`, `src/hooks/usePlatformAdmin.ts` |
| Ecrãs | Dispositivos, Detalhe do dispositivo, SIMs (+ folha do SIM), Automação (tarefas), `src/features/automation/screens/TaskDetailScreen.tsx`, `src/features/platform/components/TenantActivationSheet.tsx` |
| Worker | `src/features/worker/` (`runtime.ts`, `instance.ts`, `taskExecutor.ts`, `credentials.ts`, `ussd/*`, `screens/WorkerScreen.tsx`) |

## Tabelas (006)

| Tabela | Conteúdo | Escrita |
|---|---|---|
| `devices` | Workers Android da empresa. Estado guardado: `UNREGISTERED` → `ACTIVE` ↔ `DISABLED`. `device_identifier` único por empresa. Capacidades (`ussd`, `ussd_interactive`, `sms`, `multi_sim`), telemetria validada, `last_seen_at` (relógio do servidor). | Só RPCs |
| `device_credentials` | Hashes SHA-256 do código de emparelhamento e do token do dispositivo. **Sem grants e sem policies**: a API não a consegue ler. | Só RPCs (definer) |
| `device_sims` | SIMs por slot (`slot_index` 0..7, único por dispositivo). Operadora **explícita** (`vodacom`/`movitel`/`tmcel`), nunca deduzida. Número normalizado (sensível, opcional). Estado `ACTIVE`/`UNAVAILABLE`/`DISABLED`; `UNAVAILABLE` com motivo `NOT_DETECTED` ou `SIM_CHANGED`. Sem PIN, PUK nem OTP. | Só RPCs |
| `activation_tasks` | Uma por pedido `PAID`. Snapshot do fluxo, dispositivo/SIM atribuídos, contadores de tentativas (`max_attempts` 3 por omissão), resultado. Índices únicos parciais: no máximo uma tarefa em curso por dispositivo e por SIM. | Só RPCs / triggers |
| `activation_task_attempts` | Cada tentativa (`WORKER`, `SYSTEM` ou `MANUAL`), imutável. Resposta da operadora e traço USSD (truncados). | Só o servidor |
| `activation_task_events` | Histórico de transições, append-only. | Só o servidor (trigger) |

**Online** não é um estado guardado: deriva de `last_seen_at` e de
`tenant_settings.automation.heartbeat_timeout_seconds` (120 s por omissão, 30..3600).

## Máquina de estados da tarefa (19 transições, validadas na base de dados)

| De | Para |
|---|---|
| `QUEUED` | `ASSIGNED`, `FAILED` |
| `ASSIGNED` | `QUEUED`, `EXECUTING`, `FAILED` |
| `EXECUTING` | `SUBMITTED`, `SUCCESS`, `FAILED`, `UNKNOWN` |
| `SUBMITTED` | `VERIFYING`, `SUCCESS`, `FAILED`, `UNKNOWN` |
| `VERIFYING` | `SUCCESS`, `FAILED`, `UNKNOWN` |
| `FAILED` | `QUEUED` — só repetição automática (código repetível e tentativas disponíveis) ou manual |
| `UNKNOWN` | `SUCCESS`, `FAILED` — só por decisão humana (tentativa `MANUAL` com nota) |

O trigger `activation_tasks_before_write` recusa ainda: estados finais sem uma tentativa com o mesmo
resultado (evidência), SIM de outro dispositivo/empresa/operadora, tarefa para pedido não pago.

**Pedido:** `QUEUED` mantém o pedido `PAID`; `ASSIGNED` → `READY_FOR_ACTIVATION`; `EXECUTING` →
`ACTIVATING`; `SUCCESS` → `COMPLETED`; `FAILED` final → `FAILED`; `UNKNOWN` fica `ACTIVATING` (revisão);
repetição manual `FAILED` → `READY_FOR_ACTIVATION`. O trigger `orders_require_activation_success` recusa
`COMPLETED` sem uma tarefa `SUCCESS` para os papéis da API (incluindo `service_role`).

## UNKNOWN

`UNKNOWN` = o USSD **pode** ter sido executado, mas nada prova o resultado (sem resposta depois da
submissão, resposta que não corresponde a nenhum texto do produto, contradição entre o telemóvel e o ecrã,
tarefa presa depois de `SUBMITTED`). **Nunca** é repetida automaticamente — repetir poderia ativar o
pacote duas vezes. Um owner/admin confirma com o cliente ou a operadora e decide em *Tarefa → Falhou / Foi
ativado* (`resolve_activation_task`, nota obrigatória, auditado).

## Dispatcher

`dispatch_activation_tasks` (chamado pelo heartbeat de cada worker e pelo botão *Distribuir*):

1. Bloqueia tarefas `QUEUED` da empresa por ordem (`priority`, `created_at`) com `FOR UPDATE SKIP LOCKED`.
2. Procura um SIM elegível: mesma empresa, dispositivo `ACTIVE` e online, capacidades `ussd` **e**
   `ussd_interactive`, SIM `ACTIVE` com a operadora do produto, dispositivo e SIM sem tarefa em curso.
   O SIM é bloqueado com `FOR UPDATE OF s SKIP LOCKED`; a preferência evita SIMs onde a tarefa já falhou.
3. Atribui (`ASSIGNED`). Se dois dispatchers concorrerem, os índices únicos parciais fazem um deles
   falhar com `unique_violation`, que é ignorado (passa à próxima).
4. Sem nenhum elegível, a tarefa fica `QUEUED`.

Tarefas presas (`expire_stale_activation_tasks`, também chamado no dispatch):

- `ASSIGNED` há mais de `assignment_timeout_seconds` (300 s; 60..3600) ou com o dispositivo offline → `QUEUED`.
- `EXECUTING`/`SUBMITTED`/`VERIFYING` há mais de `execution_timeout_seconds` (600 s; 60..7200) →
  `UNKNOWN` (`TIMEOUT`, tentativa `SYSTEM`). Nunca repetida.

> **Concorrência:** os testes locais usam PGlite (uma única ligação), por isso não há teste de corrida
> real. A segurança em concorrência assenta em `SKIP LOCKED`, nos índices únicos (uma tarefa por pedido,
> uma tarefa em curso por dispositivo e por SIM) e no compare-and-set de `worker_start_task`. Deve ser
> verificada com duas sessões reais no Supabase antes de produção.

## Registo do dispositivo (emparelhamento)

1. Owner/admin cria o dispositivo (*Dispositivos → +*, `create_device`) → código de 8 símbolos `XXXX-XXXX`
   (alfabeto sem 0/O/1/I), válido 15 minutos, uso único. Só o hash é guardado.
2. No telemóvel, um membro da empresa com sessão iniciada abre *Mais → Modo worker* e escreve o código
   (`register_device`). O servidor devolve um token `mbdt_…` (256 bits) **uma única vez**; fica no
   `expo-secure-store` do telemóvel e na base só o SHA-256.
3. Todas as chamadas do worker exigem **sessão de um membro da empresa do dispositivo + token**.
   Re-emparelhar (novo código, usado no telemóvel) substitui o token anterior; desativar o dispositivo bloqueia-o.

Nunca há `service_role` no APK: o worker usa a mesma chave pública e a sessão do utilizador.

## Protocolo do worker — `megabot.activation.v1`

| Passo | RPC | Notas |
|---|---|---|
| Heartbeat (30 s) | `device_heartbeat` | Envia versão, capacidades, telemetria e SIMs vistos (slot + impressão digital). Atualiza `last_seen_at`, deteta SIM trocado (`SIM_CHANGED`) ou ausente, e corre o dispatcher. |
| Pedir trabalho (15 s) | `worker_fetch_task` | Devolve o payload da tarefa `ASSIGNED` deste dispositivo, ou `null`. |
| Começar | `worker_start_task` | Compare-and-set `ASSIGNED → EXECUTING`. |
| Antes do passo final | `worker_report_progress('SUBMITTED')` | **Obrigatório** antes de enviar a confirmação final. Se falhar, o passo final não é enviado. |
| Resultado | `worker_report_result` | `SUCCESS` / `FAILED` / `UNKNOWN` + código + resposta da operadora. |

**Payload** (sem segredos; o telemóvel não decide preço, empresa nem pagamento):

```json
{
  "protocol": "megabot.activation.v1",
  "task_id": "…", "order_id": "…", "product_id": "…", "device_id": "…", "sim_id": "…",
  "status": "ASSIGNED", "attempt": 1, "operator": "vodacom",
  "sim": { "slot_index": 0, "fingerprint": "…", "operator": "vodacom" },
  "destination_number": "+258840000000",
  "flow_version": 1,
  "flow": { "version": 1, "start": "*111#", "steps": [{ "type": "select", "value": "5" }, { "type": "input", "source": "destination_number" }, { "type": "confirm", "value": "1" }],
            "success": { "contains": ["sucesso"] }, "failure": { "contains": ["saldo insuficiente"] } },
  "values": { "destination_number": "840000000", "amount_mb": "1024", "amount_gb": "1", "price": "50" },
  "limits": { "step_timeout_ms": 30000, "session_timeout_ms": 120000 }
}
```

O app valida o payload (`parseActivationPayload`, falha fechada) e constrói o plano (`buildUssdPlan`):
um valor em falta ou um protocolo diferente → `FAILED FLOW_MISMATCH`, sem tocar na rede.

**O servidor reavalia cada resultado** com os textos de sucesso/falha do produto
(`private.classify_ussd_response`):

- `SUCCESS` só é aceite se o ecrã final contém um texto de sucesso (e nenhum de falha); senão vira
  `FAILED USSD_REJECTED` ou `UNKNOWN`.
- Depois de `SUBMITTED`, `FAILED` só é aceite com um texto de falha; sem prova → `UNKNOWN`.
- Um `FAILED` cujo ecrã diz sucesso → `UNKNOWN` (contradição).
- Antes de `SUBMITTED` nada foi confirmado na rede, por isso uma falha é segura e pode ser repetida.

> **Fronteira de confiança:** o servidor não consegue saber se o telemóvel enviou o passo final sem o
> reportar. Um worker adulterado que salte o `SUBMITTED` e reporte uma falha repetível poderia causar
> uma segunda execução — limitada por `max_attempts` e registada nas tentativas. O APK oficial reporta
> sempre `SUBMITTED` antes do passo final.

**Reinício da app:** uma tarefa que o worker encontra em `EXECUTING` (passo final nunca enviado) é
devolvida com `FAILED DEVICE_OFFLINE` (repetível); em `SUBMITTED`/`VERIFYING` é reportada como
`UNKNOWN` — nunca reexecutada. Resultados que não puderam ser enviados ficam pendentes e são reenviados
antes de pedir novo trabalho.

## Códigos de resultado e repetição

| Código | Resultados possíveis | Repetível | Enviado pelo worker |
|---|---|---|---|
| `ACTIVATED` | SUCCESS | — | sim |
| `DEVICE_OFFLINE` | FAILED | sim | sim |
| `SIM_UNAVAILABLE` | FAILED | sim (o SIM fica `UNAVAILABLE`) | sim |
| `USSD_NOT_SUPPORTED` | FAILED | sim | sim |
| `PERMISSION_DENIED` | FAILED | sim | sim |
| `NETWORK_ERROR` | FAILED, UNKNOWN | sim (só antes de `SUBMITTED`) | sim |
| `TIMEOUT` | FAILED, UNKNOWN | sim (só antes de `SUBMITTED`) | sim |
| `USSD_REJECTED` | FAILED | não | sim |
| `INVALID_DESTINATION` | FAILED | não | sim |
| `INSUFFICIENT_BALANCE` | FAILED | não | sim |
| `FLOW_MISMATCH` | FAILED | não | sim |
| `INVALID_FLOW` | FAILED | não | não (backend) |
| `UNKNOWN_RESPONSE` | UNKNOWN | **nunca** | sim |
| `MANUAL_CONFIRMED` / `MANUAL_REJECTED` | SUCCESS / FAILED | — | não (decisão humana) |

Repetição automática: só `FAILED` com código repetível e `attempt_count < max_attempts` volta a `QUEUED`
(o dispatcher prefere outro SIM — failover). Repetição manual (`retry_activation_task`, owner/admin, só
`FAILED`) aumenta `max_attempts` e é auditada. `UNKNOWN` nunca é repetido.

## Executor USSD

- `UssdExecutor` (`src/features/worker/ussd/types.ts`): `capabilities()`, `listSims()`, `execute()` →
  `SUCCESS` / `FAILED` / `UNKNOWN` com código estruturado.
- `runUssdSession` (`ussd/runner.ts`): abre a sessão **no slot pedido** (se o SIM não puder ser
  selecionado → `FAILED SIM_UNAVAILABLE`, nunca outro SIM), confere cada ecrã com o esperado
  (`FLOW_MISMATCH`), deteta falhas intermédias (`USSD_REJECTED`), reporta `SUBMITTED` antes do passo
  final, classifica o ecrã final com `UssdResponseParser` (os mesmos textos do produto; sem
  correspondência → `UNKNOWN`) e fecha sempre a sessão.
- `AndroidUssdExecutor`: usa o módulo nativo `MegabotUssd` via `requireOptionalNativeModule`. Sem o
  módulo (Expo Go, web, build sem o módulo) declara `ussd: false` — o dispositivo não recebe tarefas — e
  qualquer execução devolve `FAILED USSD_NOT_SUPPORTED`. **Nunca simula sucesso.**
- `MockUssdExecutor`: cenários simulados, só no modo demonstração e nos testes.

### Contrato do módulo nativo `MegabotUssd` (a implementar)

```ts
getCapabilities(): Promise<{ ussd: boolean; interactive: boolean; multiSim: boolean; reason?: string }>;
listSims(): Promise<{ slotIndex: number; fingerprint: string | null; carrierName: string | null }[]>;
openSession(slotIndex: number, expectedFingerprint: string | null, code: string, timeoutMs: number): Promise<{ sessionId: string; text: string }>;
send(sessionId: string, input: string, timeoutMs: number): Promise<string>;
close(sessionId: string): Promise<void>;
// Rejeições com code: SIM_UNAVAILABLE, PERMISSION_DENIED, USSD_NOT_SUPPORTED, TIMEOUT, NETWORK_ERROR
```

Plano de implementação (Expo Modules API, Kotlin, config plugin — sem editar `android/` à mão):

1. `SubscriptionManager.getActiveSubscriptionInfoForSimSlotIndex(slot)` → `subscriptionId`;
   `TelephonyManager.createForSubscriptionId(id)` para garantir o SIM pedido. Impressão digital = hash do
   ICCID/subscription id (nunca o ICCID em claro).
2. `TelephonyManager.sendUssdRequest` (API 26+) só faz **um pedido/uma resposta**: serve para códigos
   diretos, mas os menus interativos (`*111#` → 5 → 8 → …) precisam de uma camada de sessão — tipicamente
   um `AccessibilityService` que lê e responde ao diálogo USSD do sistema (frágil, varia por fabricante
   e versão do Android) ou um acordo com a operadora (API/USSD gateway).
3. Permissões: `CALL_PHONE`, `READ_PHONE_STATE` (e `READ_PHONE_NUMBERS` se necessário), pedidas em
   runtime; o serviço de acessibilidade é ativado manualmente pelo utilizador.
4. Trabalho em segundo plano: hoje o worker só corre com a app aberta em primeiro plano. Para produção é
   preciso um *foreground service* com notificação persistente.
5. Exige *development build* ou build de produção (`eas build --profile development`); não corre em Expo Go.

## Estado do USSD real

**Categoria B — backend pronto + worker Android preparado; USSD físico não demonstrado.**

| | Estado |
|---|---|
| Backend (006): tarefas, dispatcher, protocolo, verificação, auditoria | Pronto, testado localmente; **não aplicado** no Supabase |
| Worker: emparelhamento, heartbeat, poller, executor, parser, reenvio | Pronto, testado com executor simulado |
| Módulo nativo `MegabotUssd` | **Não existe** — o worker real declara `ussd: false` e não recebe tarefas |
| Teste com Android físico + SIM real + operadora real + resultado persistido | **Não feito** |

Não se pode afirmar que "o USSD funciona" até haver: telemóvel Android físico, SIM real, código USSD real,
resposta real da operadora e o resultado persistido em `activation_task_attempts`.

## Segurança

- RLS em todas as tabelas: só leitura para membros da empresa; nenhuma escrita direta (sem grants de
  INSERT/UPDATE/DELETE para `authenticated`, nem para `service_role` nas tabelas da 006).
- `device_credentials` sem grants nem policies. Tokens e códigos só em hash; nunca em logs nem auditoria.
- Funções `SECURITY DEFINER` só no schema `private`, com `search_path = ''`; wrappers públicos
  `SECURITY INVOKER`; `anon` sem acesso.
- O `tenant_id` enviado pelo app nunca é usado como autorização: deriva sempre do dispositivo/tarefa e da
  pertença do utilizador.
- Empresa suspensa: só leitura (sem novos dispositivos, SIMs, heartbeats nem tarefas; um worker pode
  ainda reportar o progresso/resultado de uma execução já em curso).
- Platform admins: só leitura via `platform_list_tenant_devices` / `platform_list_tenant_activation_tasks`
  (permissão `tenants.read`); sem acesso às credenciais.
- Auditoria (`audit_logs`): `device.created/pairing_code_created/registered/re_paired/updated/disabled/enabled`,
  `sim.registered/updated/disabled/enabled`, `activation_task.created/assigned/started/completed/failed/unknown/retried/retried_manually/resolved`.
  Sem tokens, códigos, OTP, PIN nem PUK.

## Testes

| Suite | Cobertura |
|---|---|
| `supabase/tests/006_devices_activation.test.sql` | 21 secções: estrutura e privilégios, PAID → tarefa, emparelhamento, SIMs/heartbeat/token, dispatcher, protocolo e verificação, identidade do SIM, decisões manuais, falsificação pela API, isolamento entre empresas, platform admin, tarefas presas, empresa suspensa, auditoria, `anon` |
| `src/services/__tests__/activationRules.test.ts` | Máquina de estados, códigos, classificação, validação |
| `src/services/supabase/__tests__/activation.test.ts` | Mapeamento, erros, ids forjados, empresa por omissão |
| `src/services/__tests__/activation.mock.test.ts` | Motor mock de ponta a ponta com o protocolo real |
| `src/features/worker/__tests__/worker.test.ts` | Plano, parser, runner, executor Android sem módulo, reinício seguro, reenvio |

Localmente (fora do repositório) também foram corridos: os testes 001–005 depois da 006, verificações
com `service_role` (não consegue completar pedidos sem ativação, forjar tarefas, tentativas ou
heartbeats, nem ler credenciais) e testes de mutação da migration.

## Limitações conhecidas

- 006 **não aplicada** no Supabase (aplicação manual — ver `supabase/README.md`).
- Sem módulo nativo USSD → nenhuma ativação real; USSD interativo exige camada de sessão.
- Worker só em primeiro plano (sem foreground service).
- Concorrência verificada por desenho (locks e índices), não por teste de corrida real.
- O passo `SUBMITTED` depende de o APK o reportar (ver *Fronteira de confiança*).
- O identificador de instalação usa `Math.random` — não é um segredo (a identidade é o token).

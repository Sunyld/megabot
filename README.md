# MegaBot — app móvel

Sistema operacional para vendedores de internet: pedidos no WhatsApp, confirmação de
pagamentos pelo ID da transação e ativação automática de pacotes via USSD em vários
dispositivos Android.

**Fase atual: 2 — fundação Supabase.** Auth e multi-tenancy reais (migration 001);
os restantes domínios continuam com dados de demonstração até às próximas migrations.

## Correr o projeto

```bash
npm install
cp .env.example .env    # preencher (ver abaixo)
npx expo start          # abrir no Android (Expo Go ou development build)
npx expo start --web    # pré-visualização rápida no navegador
```

### Modo de dados (`EXPO_PUBLIC_DATA_SOURCE`)

| Valor | Comportamento |
|---|---|
| `mock` (omissão) | Tudo simulado. Conta demo: `demo@megabot.app` / `megabot`. |
| `supabase` | Registo, login, sessão persistente e tenant reais (Supabase Auth + RLS). Domínios ainda não migrados usam os dados de demonstração. |

Depois de mudar qualquer `EXPO_PUBLIC_*`, reinicie com `npx expo start --clear`.
O `.env` só pode conter valores públicos (URL e publishable/anon key) — nunca a
`service_role`. Como aplicar as migrations: [supabase/README.md](supabase/README.md).

Verificações:

```bash
npm run typecheck
npm run lint
npm test
```

Stack: Expo SDK 57 · React Native 0.86 · React 19.2 · Expo Router 57 (rotas tipadas)
· Reanimated 4 · React Compiler · TypeScript estrito.

## Estrutura

```text
src/
├── app/                 # rotas Expo Router (ficheiros finos → features)
├── features/            # telas e componentes por domínio
│   ├── auth/            # sessão, splash, onboarding, login
│   ├── dashboard/  orders/  payments/  products/  devices/
│   ├── whatsapp/  automation/  notifications/  settings/
├── components/
│   ├── ui/              # design system (Button, Card, Badge, StatCard, Timeline, BottomSheet…)
│   ├── layout/          # Screen, cabeçalhos, tab bar, banner offline
│   └── brand/           # marca MegaBot
├── hooks/               # useOrders, usePayments, useDevices… (dados por domínio)
├── services/            # contratos + implementações (mock/, supabase/) + erros estruturados
├── lib/                 # cache de queries, store e cliente Supabase (lib/supabase)
├── mocks/               # dados de demonstração coerentes entre si
├── theme/               # tokens: cores, espaçamento, raios, tipografia, sombras, ícones
├── constants/           # vocabulário de estados (rótulo + cor + ícone)
├── types/               # modelos de domínio (todos com tenantId)
└── utils/               # formatação pt-MZ, tabela de preços, navegação
```

## Arquitetura de dados

```text
Tela → hook (useOrders) → lib/query (cache) → api (services/index.ts) → mock | Supabase
```

- As telas **nunca** importam `src/mocks`; consomem hooks.
- `src/services/types.ts` define os contratos. `src/services/index.ts` escolhe a
  implementação pelo `EXPO_PUBLIC_DATA_SOURCE`: `mockServices`, ou
  `createSupabaseServices(mockServices)`, que substitui domínio a domínio (hoje: auth).
- Multi-tenancy: no Supabase o tenant vem de `auth.uid()` → `tenant_users` e é imposto
  por RLS; o app nunca envia o `tenant_id` como mecanismo de segurança.
- Erros: todos os serviços rejeitam com `AppError` (`AUTH_ERROR`, `VALIDATION_ERROR`,
  `NOT_FOUND`, `PERMISSION_DENIED`, `NETWORK_ERROR`, `DATABASE_ERROR`, `CONFLICT`,
  `CONFIG_ERROR`, `UNKNOWN_ERROR`).
- Tempo real: `services/realtime.ts` emite alterações; `useRealtimeSync` invalida o cache.
  O mock já simula o pipeline de ativação (aprovar um pagamento em revisão ativa o pacote).
- Regra de negócio refletida na UI: a IA apenas **extrai** dados do comprovativo; a
  confirmação é feita por **regras determinísticas** contra a mensagem real da carteira.

## Design system

- Tokens em `src/theme` (tema claro e escuro). Paleta inspirada na Vodacom (vermelho da
  marca + neutros); ajustar em `src/theme/colors.ts`.
- Estilos com `createStyles((t) => …)` — nenhum valor visual repetido nas telas.
- Ícones semânticos em `src/theme/icons.ts` (Material Symbols no Android/web, SF Symbols
  no iOS). Depois de adicionar um ícone: `npm run generate:icons`.
- Ícone da app, splash e favicon são gerados de `scripts/generate-brand-assets.mjs`
  (`npm run generate:assets`).

## Modo de simulação

**Mais → Definições → Modo de simulação** permite ver todos os estados: latência lenta
(skeletons), offline, erro do servidor e conta vazia. É uma ferramenta de protótipo.

## Próximas fases

A estrutura já prevê: Supabase (Auth, DB, RLS, Realtime) nos `services`; persistência de
sessão via Supabase Auth; gateway Baileys e OpenRouter/Gemma como serviços externos;
módulo nativo Android (Kotlin) para SMS, SIM e USSD, com o modelo de tarefas
`QUEUED → … → SUCCESS | FAILED | UNKNOWN` já definido em `src/types/automation.ts`.

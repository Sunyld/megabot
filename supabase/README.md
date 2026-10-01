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

```sql
insert into public.platform_admins (user_id, role)
select id, 'SUPER_ADMIN' from auth.users where email = '<o-seu-email>';
-- Suporte:   ... 'SUPPORT_ADMIN' ...
-- Suspender: update public.platform_admins set status = 'SUSPENDED' where user_id = '<uuid>';
-- Revogar:   delete from public.platform_admins where user_id = '<uuid>';
```

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

## Ligar o app ao Supabase

1. Em `.env`: `EXPO_PUBLIC_DATA_SOURCE=supabase`, `EXPO_PUBLIC_SUPABASE_URL` e a chave
   pública em `EXPO_PUBLIC_SUPABASE_ANON_KEY` **ou** `EXPO_PUBLIC_SUPABASE_KEY`.
2. Reiniciar com cache limpa: `npx expo start --clear`
   (variáveis `EXPO_PUBLIC_*` são embutidas no bundle; sem `--clear` o valor antigo pode persistir).
3. No app: **Criar conta** → nome, loja, email, palavra-passe + confirmação. O trigger cria o
   tenant e o utilizador fica como `owner`. Login, sessão persistente e logout passam a ser reais.
4. Os restantes domínios (pedidos, pagamentos, dispositivos…) continuam com dados de
   demonstração até às próximas migrations.

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

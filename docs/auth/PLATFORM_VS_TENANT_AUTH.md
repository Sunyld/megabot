# Autenticação: Plataforma vs Empresa (tenant)

O MegaBot tem dois contextos que **não** são a mesma coisa:

| Contexto | Fonte de autoridade | Quem | Área no app |
|---|---|---|---|
| **Plataforma** | `public.platform_admins` (migration 002) | Equipa MegaBot: `SUPER_ADMIN`, `SUPPORT_ADMIN` | `/platform` |
| **Empresa** | `public.tenant_users` (migration 001) | Vendedores: `owner`, `admin`, `operator` de uma empresa | App da empresa (tabs) |

Regras:

- **Um platform admin não precisa de empresa.** Não precisa de linha em `tenant_users`, nem de
  `tenant_id`, e o app **nunca** cria uma empresa para ele.
- **Ser admin de uma empresa não dá acesso à plataforma.** O papel `admin` de `tenant_users` é só da
  empresa.
- O acesso de plataforma **nunca** vem do email, de `user_metadata` / `raw_user_meta_data` nem de um
  papel de empresa: só de uma linha `ACTIVE` em `platform_admins` para o `auth.uid()` da sessão.
- Um utilizador que não é platform admin `ACTIVE` e não pertence a nenhuma empresa **não entra**.

## Fluxo do login

```
Supabase Auth (email + palavra-passe)
        ↓ sessão
platform_admin_context()   ← a própria linha de platform_admins (RLS: user_id = auth.uid())
tenant_users + tenants     ← as empresas do utilizador (RLS)
        ↓  (os dois pedidos em paralelo; a decisão segue esta ordem)
1. platform admin ACTIVE            → área Plataforma (/platform), sem empresa
2. senão, membro de uma empresa     → app da empresa (ou ecrã "Empresa suspensa")
3. senão, platform admin SUSPENDED  → "O seu acesso de administração da plataforma está suspenso"
4. senão                            → "Esta conta não está associada a nenhuma empresa"
```

Código: `loadContext` em [`src/services/supabase/auth.ts`](../../src/services/supabase/auth.ts); o
estado da sessão e as rotas em [`src/features/auth/sessionController.ts`](../../src/features/auth/sessionController.ts)
e [`src/app/_layout.tsx`](../../src/app/_layout.tsx) (`status === 'platform'` abre só `platform/index`;
`status === 'signedIn'` abre só as rotas da empresa).

Se o acesso de plataforma **não puder ser lido** (por exemplo a função `platform_admin_context` não
existe ou não está exposta pela API), o login falha com
`PLATFORM_ACCESS_UNAVAILABLE` ("Não foi possível verificar o acesso de administração da
plataforma…"). Nunca é tratado como "não é admin", o que mandaria um admin sem empresa para a
mensagem 4.

## Matriz de comportamento

| Conta | Empresa | `platform_admins` | Resultado |
|---|:---:|---|---|
| Utilizador normal | — | — | Recusado: "não está associada a nenhuma empresa" |
| `owner` / `admin` / `operator` | ✅ | — | App da empresa, com esse papel |
| `SUPER_ADMIN` | — | `ACTIVE` | Plataforma (`/platform`) |
| `SUPPORT_ADMIN` | — | `ACTIVE` | Plataforma, só com as permissões de suporte |
| `SUPER_ADMIN` / `SUPPORT_ADMIN` + empresa | ✅ | `ACTIVE` | Plataforma. A sessão de plataforma não leva poderes de empresa (sem `tenant`, sem âmbito de dados da empresa) |
| `SUPER_ADMIN` / `SUPPORT_ADMIN` | — | `SUSPENDED` | Recusado: "acesso … suspenso" |
| `SUSPENDED` + empresa | ✅ | `SUSPENDED` | App da empresa (a suspensão de plataforma não afeta a empresa) |

Uma conta com os dois contextos abre a **plataforma**; o app ainda não tem um seletor para entrar na
empresa com a mesma sessão.

Permissões de plataforma (fonte única: `private.platform_role_permissions`, devolvidas por
`platform_admin_context()`; o app só filtra valores desconhecidos, nunca acrescenta):

| Permissão | `SUPER_ADMIN` | `SUPPORT_ADMIN` |
|---|:---:|:---:|
| `tenants.read` | ✅ | ✅ |
| `tenants.suspend` | ✅ | ✅ |
| `audit_logs.read` | ✅ | ✅ |
| `platform_admins.read` | ✅ | — |

Na base de dados nada disto depende do app: `platform_admins` só se lê pela própria linha (ou tudo,
para `SUPER_ADMIN`); não há INSERT/UPDATE para a API; as funções `platform_*` verificam a permissão
em cada chamada; os dados das empresas continuam protegidos por RLS via `tenant_users`.

## Diagnóstico: "a conta do admin não está associada a nenhuma empresa"

O app só mostra essa mensagem quando a base de dados responde que a conta **não** é platform admin
`ACTIVE` **e** não tem empresa. Para ver o estado real de uma conta, corra no **SQL Editor** (como
`postgres`; só lê, não altera nada), trocando o email:

```sql
-- DIAGNOSTICO-INICIO
select c.id                                                     as user_id,
       c.email_confirmed_at is not null                          as email_confirmado,
       pa.role                                                   as platform_role,
       pa.status                                                 as platform_status,
       (select count(*) from public.tenant_users tu where tu.user_id = c.id) as empresas,
       pg_catalog.has_function_privilege('authenticated', 'public.platform_admin_context()', 'EXECUTE')        as rpc_executavel,
       pg_catalog.has_table_privilege('authenticated', 'public.platform_admins', 'SELECT')                    as tabela_legivel,
       pg_catalog.has_function_privilege('authenticated', 'private.platform_role_permissions(text)', 'EXECUTE') as permissoes_executavel,
       exists (select 1 from pg_catalog.pg_policies p
                where p.schemaname = 'public' and p.tablename = 'platform_admins'
                  and p.policyname = 'platform_admins_select_self_or_super_admin')                             as policy_propria_linha
  from (select u.id, u.email_confirmed_at from auth.users u where lower(u.email) = lower('<email-da-conta>')) c
  left join public.platform_admins pa on pa.user_id = c.id;
-- DIAGNOSTICO-FIM
```

| Resultado | Significa | O que fazer |
|---|---|---|
| 0 linhas | O email não existe no Auth **deste** projeto | Confirmar o projeto do `.env` (`EXPO_PUBLIC_SUPABASE_URL`) e o email |
| `platform_role` vazio | A conta nunca foi promovida (ou foi promovida noutro utilizador / projeto, ou dentro de uma transação revertida) | Promover como em [`supabase/README.md`](../../supabase/README.md#promover-o-primeiro-super_admin) |
| `platform_status = SUSPENDED` | Admin suspenso: o acesso é recusado de propósito | Reativar só se for essa a decisão |
| `ACTIVE` e as quatro colunas finais `true` | A base de dados está correta | O login tem de abrir `/platform`; se não abrir, o app aponta para outro projeto ou usa um build antigo |
| Alguma coluna final `false` | O schema da 002 foi alterado em produção | Comparar com `migrations/002_platform_admin.sql` antes de qualquer correção |

Nunca se corrige isto criando uma empresa para o admin, ligando-o à empresa de demonstração ou
atribuindo papéis por email.

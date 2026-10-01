# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> O **[README.md](README.md) é o documento de handoff** e a fonte canônica de arquitetura, runbook de
> produção e histórico de incidentes. Este arquivo cobre só o que muda a forma de trabalhar no código.

## Guias — leia sob demanda

Não leia todos. Cada um carrega quando a tarefa pede; os gatilhos ao longo deste arquivo dizem quando.

| Guia | Quando |
|---|---|
| [01-primeiros-passos](docs/guia/01-primeiros-passos.md) | primeiro dia no projeto |
| [02-mapa-do-codigo](docs/guia/02-mapa-do-codigo.md) | "preciso mudar X, vou onde?" |
| [03-multi-tenancy](docs/guia/03-multi-tenancy.md) | **qualquer** acesso ao banco |
| [04-modulos-e-permissoes](docs/guia/04-modulos-e-permissoes.md) | mexer em módulo, tela, permissão ou i18n |
| [05-rotas-e-jobs](docs/guia/05-rotas-e-jobs.md) | criar ou alterar rota em `src/app/api/` |
| [06-antes-de-commitar](docs/guia/06-antes-de-commitar.md) | uma validação falhou e você não sabe por quê |

## Comandos

```bash
docker compose up -d postgres   # Postgres local (container metodoai-db, porta 5433)
npm run dev                     # Next.js em http://localhost:3000
npm run db:migrate              # prisma migrate dev (local)
npm run db:seed                 # org demo + usuário dono (usa SEED_* do .env)
npm run db:studio               # Prisma Studio
```

**Antes de qualquer commit, os cinco precisam passar:**

```bash
npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node
```

Se `check:isolation` falhar, a mudança abriu uma brecha real entre organizações — não existe
suíte de testes unitários aqui, então é a única rede automatizada dessa fronteira. O que cada uma
das cinco checagens prova (e o que fazer quando falha): [docs/guia/06-antes-de-commitar.md](docs/guia/06-antes-de-commitar.md).

## Regras invioláveis

**1. Isolamento multi-tenant.** Toda tabela de negócio carrega `organizationId` e é filtrada por ela.
Nunca consulte tabela de negócio sem esse filtro.

> **Vai escrever qualquer acesso ao banco? PARE e leia [docs/guia/03-multi-tenancy.md](docs/guia/03-multi-tenancy.md) antes.**
> O `$extends` do `tenantDb` cobre só `create`/`createMany` + as 8 de `WHERE_OPS` (10 ao todo) —
> qualquer outra operação do Prisma passa **sem filtro de organização**.

- Dados sempre pela DAL em [src/lib/queries/](src/lib/queries/), usando `tenantDb(orgId)` de [src/lib/tenant-db.ts](src/lib/tenant-db.ts).
- Trabalho por id: `findFirst` + `updateMany`/`deleteMany` com `{ id }` — nunca `findUnique`/`update`/`delete`/`upsert` direto.
- Prisma cru ([src/lib/prisma.ts](src/lib/prisma.ts)) só em contexto de sistema, com `organizationId` explícito.

**2. Gating pelas fontes de verdade.** Não espalhe `if` de módulo ou permissão pelo código.

> Vocabulário e modelo de domínio (conta × empresa, comprado × instalado, `getOrgContext()`):
> [docs/guia/04-modulos-e-permissoes.md](docs/guia/04-modulos-e-permissoes.md).

- [src/config/modules.ts](src/config/modules.ts) — módulos, telas, features, preços (`hasModule`, `hasFeatureByModules`, `assertFeatureByModules`, `availableScreens`).
- [src/config/screens.ts](src/config/screens.ts) — telas gateáveis. [src/lib/access.ts](src/lib/access.ts) resolve permissão por membro (`requireScreen`, `requireModule`).
- [src/config/limits.ts](src/config/limits.ts) — limites globais (não existem mais planos).
- Gating cross-módulo: o **server** resolve `hasModule(...)` e passa como prop pro client — nunca o inverso.
- Desinstalar módulo = `OrganizationModule` vira `DORMANT`, **nunca apagar**.

**3. Paridade de i18n.** `src/messages/pt.json` e `src/messages/en.json` têm exatamente as mesmas
chaves (2597 hoje). Adicionou de um lado, adiciona do outro.

## Armadilhas específicas deste repo

**Prisma sem engine Rust.** `schema.prisma` usa `engineType = "client"` porque os engines nativos não
sobrevivem ao Passenger/CloudLinux da Hostinger. Consequência: **todo `new PrismaClient()` precisa receber
um driver adapter explícito**, senão estoura `P2038: Missing configured driver adapter` no boot.

```ts
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
```

Vale para scripts avulsos (`prisma/seed.ts`, `scripts/*.ts`) tanto quanto para a app.

**Evolution/WhatsApp.** Sempre resolva credenciais com `resolveEvoCreds()`
([src/lib/integrations/evolution-creds.ts](src/lib/integrations/evolution-creds.ts)). Conexões "de
plataforma" guardam só o `instance`; `baseUrl`/`apiKey` vêm do env. Passar credencial crua quebra o envio
com "Conexão Evolution incompleta".

**Rotas `/api/*` são públicas por padrão** — nenhum middleware protege endpoint de API, cada rota se
protege sozinha.

> **Vai criar ou alterar rota em `src/app/api/`? PARE e leia [docs/guia/05-rotas-e-jobs.md](docs/guia/05-rotas-e-jobs.md) antes.**
> Dois dos quatro endpoints de cron já nasceram sem autenticação nenhuma.

**Produção travada em Node 20.x.** A Hostinger não permite trocar; `engines` no `package.json` é só
aviso pro npm. `.nvmrc` é a fonte da verdade do major ([detalhe](docs/guia/06-antes-de-commitar.md)).

**Variáveis de ambiente.** Nunca leia `process.env.X` direto no código da app — declare em
[src/lib/env.ts](src/lib/env.ts) (zod) e importe de lá. Obrigatórias faltando derrubam o boot.

**Webhooks em dev** exigem túnel (ngrok) com `NEXT_PUBLIC_SITE_URL` apontando pra ele; localhost não recebe webhook.

## Convenções

- **Branch:** trabalha-se na `dev`. **Mergear na `main` publica em produção automaticamente** —
  a Hostinger implanta a cada push (`npm install` → `prisma generate` → `npm run build`). Ela **não**
  roda `prisma migrate deploy`: mudou schema, aplique a migration no Supabase **antes** do merge.
- **Commits:** `[ÁREA] - Verbo + Tarefa`, corpo estruturado, terminando com a linha de co-autoria.
  Ex.: `[CRM] - Adiciona autofill de CEP na empresa`.
- **Sem drawer para criação no CRM** — foi testado e descartado a pedido.
- **Produção é `https://metodotia.com`** — Hostinger (Passenger), banco no Supabase, Evolution em VPS
  separada. Não é Vercel. **Nunca** rode `migrate dev` contra produção. Runbook no §8 do README.
- **Mexeu numa fonte de verdade, atualize o guia no mesmo commit.** `tenant-db.ts` e `lib/queries/` →
  guia 03; `config/modules.ts`, `screens.ts`, `limits.ts` → guia 04; `cron-auth.ts`, `proxy.ts`,
  `app/api/` → guia 05; scripts de validação do `package.json` → guia 06. Guia desatualizado é pior
  que nenhum, porque é seguido com confiança.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

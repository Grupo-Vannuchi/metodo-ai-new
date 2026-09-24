# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> O **[README.md](README.md) é o documento de handoff** e a fonte canônica de arquitetura, runbook de
> produção e histórico de incidentes. Este arquivo cobre só o que muda a forma de trabalhar no código.

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

`check:isolation` sobe dados reais no Postgres local e valida o isolamento multi-tenant — se ele
falhar, a mudança está furando a fronteira de segurança. Não existe suíte de testes unitários no
repositório; `check:isolation` é a rede de proteção automatizada que existe.

## Regras invioláveis

**1. Isolamento multi-tenant.** Toda tabela de negócio carrega `organizationId` e é filtrada por ela.
Nunca consulte tabela de negócio sem esse filtro.

- Dados sempre pela DAL em [src/lib/queries/](src/lib/queries/) (50 arquivos, um por domínio), usando
  `tenantDb(orgId)` de [src/lib/tenant-db.ts](src/lib/tenant-db.ts).
- O `$extends` do `tenantDb` injeta a org em `create`/`createMany` e em `where` de list/bulk/aggregate.
  Ele **não** cobre `findUnique`/`update`/`delete`/`upsert` — para trabalho por id use
  `findFirst` + `updateMany`/`deleteMany` com `{ id }` explícito, para o extends conseguir somar o filtro de org.
- Prisma cru (`src/lib/prisma.ts`) só em contexto de sistema (webhook, job, cron), com `organizationId` explícito.

**2. Gating pelas fontes de verdade.** Não espalhe `if` de módulo ou permissão pelo código.

- [src/config/modules.ts](src/config/modules.ts) — módulos, telas, features, preços. `hasModule`,
  `hasFeatureByModules`, `assertFeatureByModules`, `availableScreens`.
- [src/config/screens.ts](src/config/screens.ts) — telas gateáveis. [src/lib/access.ts](src/lib/access.ts)
  resolve permissão por membro: `requireScreen`, `requireModule`.
- [src/config/limits.ts](src/config/limits.ts) — limites globais (não existem mais planos).
- Nav final = `allowedScreens ∩ availableScreens(modules)`.
- Gating cross-módulo: o **server** resolve `hasModule(...)` e passa como prop pro client.

**3. Paridade de i18n.** `src/messages/pt.json` e `src/messages/en.json` têm exatamente as mesmas
chaves (2597 hoje). Adicionou de um lado, adiciona do outro.

## Contexto de request

`getOrgContext()` / `requireOrgContext()` em [src/lib/tenant.ts](src/lib/tenant.ts) resolvem, a partir do
cookie de sessão: org ativa, papel, template de acesso, telas permitidas, **módulos instalados**,
`accountOwnerId` e `isAccountOwner`. Trocar de empresa = re-selar o cookie com outro `organizationId`.

Conta = usuário dono (`Organization.ownerId`). Módulo é **comprado na conta** (`AccountModule`, cobrado 1×)
e **instalado por empresa** (`OrganizationModule`, `ACTIVE|DORMANT`). Desinstalar = `DORMANT`, nunca apagar.

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

**Rotas `/api/*` são públicas por padrão.** O [src/proxy.ts](src/proxy.ts) exclui `api` do matcher
(`/((?!api|_next|_vercel|.*\..*).*)`), então nenhum middleware protege endpoint de API — cada rota se
protege sozinha. Os 4 `/api/cron/*` usam o guard `isCronAuthorized` de [src/lib/cron-auth.ts](src/lib/cron-auth.ts)
(`Authorization: Bearer $CRON_SECRET`, falha fechado). Rota de cron nova **tem** que chamar o guard —
dois dos quatro já nasceram sem ele por ser copy-paste.

**Os crons não são automáticos — e nem todos valem a pena.** Nada no repositório os agenda; o
`vercel.json` que os declarava era resquício de uma fase Vercel que nunca foi produção. Nenhum dos quatro
dá sintoma visível quando não roda. Só `extractions` tem justificativa clara (é o único ponto que aplica a
retenção LGPD dos leads); `campaigns` é quase inútil, porque a promoção `SCHEDULED` → `RUNNING` é
inalcançável (nada cria campanha SCHEDULED). Quadro completo no §8 do README.

**Produção travada em Node 20.x.** A Hostinger não permite trocar a versão. Nenhuma dependência pode
exigir Node acima disso, e `engines` é só **aviso** para o npm (não há `.npmrc` com `engine-strict`) —
sem verificação, a quebra só apareceria no deploy. `npm run check:node` varre a árvore instalada e falha
se alguma exigir mais, separando o que roda em produção do que só é usado no build. O `.nvmrc` é a fonte
da verdade do major e o script lê dele: se a Hostinger um dia mudar, mude o `.nvmrc` e a checagem acompanha.

**Variáveis de ambiente.** Nunca leia `process.env.X` direto no código da app — declare em
[src/lib/env.ts](src/lib/env.ts) (zod) e importe de lá. Obrigatórias faltando derrubam o boot.

**Webhooks em dev** exigem túnel (ngrok) com `NEXT_PUBLIC_SITE_URL` apontando pra ele; localhost não recebe webhook.

## Convenções

- **Branch:** trabalha-se na `dev`. `main` = produção (o deploy sai da `main`).
- **Commits:** `[ÁREA] - Verbo + Tarefa`, corpo estruturado, terminando com a linha de co-autoria.
  Ex.: `[CRM] - Adiciona autofill de CEP na empresa`.
- **Sem drawer para criação no CRM** — foi testado e descartado a pedido.
- **Produção é `https://metodotia.com`**, na Hostinger (Passenger), com banco no Supabase e Evolution
  em VPS separada. **Não é Vercel, e não há mais projeto lá** — o que existia era resquício da escolha
  de plataforma e foi apagado em 24/09/2026, depois de implantar sozinho e servir o app em paralelo
  com a produção real.
  Migração em produção é manual (`prisma migrate deploy`) — nunca `migrate dev` contra produção.
  Veja o runbook no §8 do README antes de qualquer deploy.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

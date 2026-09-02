# MétodoAI

Plataforma **SaaS modular** de CRM/ERP multi-tenant para PMEs brasileiras: o cliente instala só os módulos que precisa (CRM, Financeiro, RH, Suprimentos, Marketing, Atendimento WhatsApp, IA, Tarefas, Baixador) e cada um soma na mensalidade. Uma conta pode ter **várias empresas**, com dados isolados.

> **Este README é o documento de handoff.** Foi escrito para um dev novo conseguir rodar, entender a arquitetura e fazer deploy do zero. Leia a seção **Runbook de produção** com atenção — ela concentra o conhecimento operacional que mais dá dor de cabeça.

- **Repositório:** `Grupo-Vannuchi/metodo-ai-new`
- **Branches:** trabalha-se na `dev`; `main` = produção (deploy sai da `main`).
- **Node:** ≥ 20.9

---

## 1. O que é o produto (visão atual)

O MétodoAI **deixou de ser um SaaS de planos fixos** e virou uma **plataforma modular** ("MetodoLoja"):

- O núcleo é "cru" (sem funções de negócio). O cliente **compra módulos na Loja** (`/app/loja`) e cada módulo habilita telas/funções e soma um preço na mensalidade (cobrança **simulada** — não há gateway de pagamento real ainda).
- **Multi-empresa:** uma conta (o usuário **dono**) pode ter até 5 empresas (`Organization`), cada uma com dados totalmente isolados (funil, financeiro, RH…). O seletor de empresas fica na sidebar (só para o dono).
- **Módulos são comprados na conta** (`AccountModule`), cobrados 1× e **instaláveis em qualquer empresa** sem custo extra (`OrganizationModule` = ativo naquela empresa).
- **IA (copiloto)** consegue consultar dados de qualquer empresa da conta a partir de qualquer ponto.

### Módulos (registro em `src/config/modules.ts`)

| id | Nome | Telas | Observações |
|---|---|---|---|
| `crm` | CRM Comercial | crm, proposals, contacts, companies | Funil Kanban, oportunidades, propostas, metas, automações |
| `finance` | Financeiro | finance | Lançamentos, fluxo de caixa, DRE |
| `hr` | Pessoas (RH) | hr | Funcionários, folha, férias, documentos |
| `supplies` | Suprimentos | supplies | Estoque, compras, patrimônio, manutenção, equip. de clientes |
| `marketing` | Marketing | campaigns, prospecting | Campanhas WhatsApp/e-mail, prospecção (Google Places) |
| `inbox` | Atendimento WhatsApp | inbox | Caixa de entrada multi-conversa (Evolution) |
| `ia` | Inteligência Artificial | — | Copiloto no sistema + agente que responde no WhatsApp |
| `tasks` | Tarefas | tasks | To-do da equipe (grátis) |
| `downloader` | Baixador | downloader | Baixa vídeos IG/X/YouTube por link (MVP, ver §7) |

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Framework | **Next.js 16** (App Router, Server Components, Server Actions) |
| Linguagem | **TypeScript** (strict) |
| UI | **Tailwind CSS v4** (`@theme`, dark por classe `.dark`), **lucide-react** |
| Formulários | **react-hook-form** + **zod** |
| Banco | **PostgreSQL** + **Prisma 6** (client Rust-free) |
| i18n | **next-intl 4** (pt/en) — chaves em `src/messages/{pt,en}.json` |
| Auth | **jose** (JWT HS256, cookie de sessão) + **bcryptjs**; OAuth Google/Microsoft/LinkedIn |
| Jobs/Cache | **Upstash QStash** (jobs) + **Upstash Redis** (rate-limit) — opcionais |
| Storage | **Vercel Blob** (mídia do inbox) |
| E-mail | **Resend** (verificação, convites, reset) |
| IA | **Anthropic** (copiloto/agente) + **OpenAI** (transcrição de áudio, imagens) |
| WhatsApp | **Evolution API** (não-oficial) numa **VPS separada** |

---

## 3. Arquitetura

### 3.1 Multi-tenancy (isolamento por empresa)
- **Toda tabela de negócio carrega `organizationId`** e é filtrada por ela. A regra é sagrada — nunca consulte tabela de negócio sem o filtro de org.
- A DAL (`src/lib/queries/*`) usa `tenantDb(orgId)` (`src/lib/tenant-db.ts`) — um Prisma `$extends` que injeta a org em `create`/`where`. O que o extends não cobre (`findUnique`/`update`/`delete`/`upsert`) usa `findFirst` + `updateMany`/`deleteMany` filtrando por `{ id }`.
- Contextos de sistema (webhooks, jobs) usam o `prisma` cru com `organizationId` explícito.
- `npm run check:isolation` valida que nada escapa do isolamento.

### 3.2 Conta & multi-empresa
- **Conta = usuário dono.** `Organization.ownerId` aponta pro dono. "Empresas da conta" = orgs com aquele `ownerId`.
- **Multi-membership:** um usuário pode ter várias `Membership` (o `@@unique([userId])` foi removido). Na prática, só o **dono** cria/alterna empresas (via `createCompany`/`switchCompany` em `src/app/actions/account-companies.ts`); convidados continuam em uma empresa só (o convite bloqueia multi-org).
- `getOrgContext()`/`requireOrgContext()` (`src/lib/tenant.ts`) resolvem a org ativa da sessão, o papel, o template de acesso, as telas permitidas, **os módulos instalados**, o `accountOwnerId` e `isAccountOwner`.
- Trocar de empresa = re-selar o cookie de sessão com outro `organizationId`.

### 3.3 Sistema modular & gating
- **Fonte única:** `src/config/modules.ts` (registro dos módulos, telas, dependências, detalhes da Loja) e `src/config/limits.ts` (limites globais — não há mais planos).
- **Comprar** (conta): `AccountModule (ownerUserId, moduleId)` → cobrado 1×. **Instalar** (empresa): `OrganizationModule (organizationId, moduleId, status ACTIVE|DORMANT)`. Desinstalar = DORMANT (dados preservados).
- Gating de tela: `hasModule(ctx.modules, id)` / `requireModule` + `availableScreens()`. Gating de feature: `hasFeatureByModules` / `assertFeatureByModules`.
- **Gating cross-módulo:** uma opção que depende de outro módulo só aparece se ele estiver instalado (ex.: "lançar no Financeiro" em Compras/Folha; anexos do mural/chat só de módulos instalados). Padrão: o server resolve `hasModule(...)` e passa como prop pro client.

### 3.4 Controle de acesso (por membro)
- `src/config/screens.ts` lista as telas gateáveis. `src/lib/access.ts` resolve as telas permitidas a partir do `AccessTemplate` do membro; OWNER/ADMIN têm acesso livre. Protege nav + `layout.tsx`/`page.tsx` de cada tela (`requireScreen`).
- Nav final = `allowedScreens ∩ availableScreens(modules)`.

### 3.5 Modelo de dados (Prisma) — principais
`Organization` (com `ownerId`), `User`, `Membership`, `AccountModule`, `OrganizationModule`, `AccessTemplate`, `Invitation`, `AuthToken`, `Account` (OAuth), `UserProfile` · CRM: `Company`, `Contact`, `ContactFolder`, `Pipeline`, `Stage`, `Opportunity`, `ProductService`, `Automation`, `Goal` · Financeiro: `FinanceEntry`, `FinanceCategory` · RH: `Employee`, `PayrollRun`, `TimeOff` · Suprimentos: `SupplyItem`, `PurchaseOrder`, `Asset`, `MaintenanceEvent`, `Supplier`, `ClientEquipment` · Marketing: `MessageTemplate`, `Campaign`, `CampaignRecipient`, `ExtractionJob`, `ExtractedLead` · Inbox: `IntegrationConnection`, `Conversation`, `Message`, `WhatsappAgent` · Colaboração: `TeamChat*`, `FeedPost*`, `Notification`, `PinnedItem` · `AuditLog`.

---

## 4. Estrutura de pastas

```
src/
  app/[locale]/
    (auth)/            # login, cadastro, verify, verify-email, invite, reset
    app/               # o produto (dashboard, crm, finance, hr, supplies,
                       #   campaigns, prospecting, inbox, feed, downloader,
                       #   loja, settings/*, hr/*, supplies/*, crm/* ...)
    api/               # webhooks (evolution/genérico), cron, jobs, inbox,
                       #   assistant, downloader/fetch, team-chat, ...
    (landing/pricing)  # vitrine pública
  components/          # UI por domínio (app, crm, finance, hr, supplies,
                       #   campaigns, inbox, downloader, modules, settings, ...)
  config/              # modules.ts, limits.ts, screens.ts (FONTES DE VERDADE)
  lib/
    queries/           # DAL por domínio (sempre via tenantDb)
    tenant.ts, tenant-db.ts, access.ts, session.ts, env.ts
    integrations/      # channels (evolution/email), crypto, evolution-creds
    downloader/        # resolvers YouTube/X/Instagram
    assistant/         # copiloto: tools, system prompt, threads
    whatsapp/          # inbound parser + ingest + media
  messages/            # pt.json, en.json (next-intl) — mantenha PARIDADE
prisma/
  schema.prisma, migrations/, seed.ts
scripts/               # create-project-task.ts, check-isolation.ts, ...
```

---

## 5. Rodando localmente

```bash
# 1. Postgres local (Docker) — container "metodoai-db"
docker compose up -d

# 2. Dependências
npm install

# 3. .env (ver tabela §6). O mínimo p/ subir: DATABASE_URL, DIRECT_URL,
#    SESSION_SECRET, INTEGRATION_ENC_KEY, NEXT_PUBLIC_SITE_URL.

# 4. Banco
npm run db:migrate        # aplica migrations (dev)
npm run db:seed           # cria org/owner inicial (usa SEED_* do .env)

# 5. App
npm run dev               # http://localhost:3000
```

Antes de commitar: **`npm run typecheck` + `npm run lint` + `npm run build` + `npm run check:isolation`** devem passar. (Webhooks em dev exigem túnel — ex.: ngrok — com `NEXT_PUBLIC_SITE_URL` apontando pra ele; localhost não recebe webhook.)

### Scripts (`package.json`)
| Comando | O que faz |
|---|---|
| `dev` / `build` / `start` | ciclo Next.js |
| `typecheck` | `tsc --noEmit` |
| `lint` | ESLint |
| `check:isolation` | valida isolamento multi-tenant |
| `db:migrate` / `db:deploy` / `db:push` / `db:seed` / `db:studio` | Prisma |
| `db:dump` / `db:restore` | snapshot do Postgres (container `metodoai-db`) |

---

## 6. Variáveis de ambiente

Validadas em `src/lib/env.ts` (zod). Obrigatórias faltando derrubam o boot.

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | **sim** | Postgres (runtime) |
| `DIRECT_URL` | **sim** | conexão direta p/ Prisma Migrate |
| `SESSION_SECRET` | **sim** | assina o JWT de sessão (≥ 32 chars) |
| `INTEGRATION_ENC_KEY` | **sim** | AES-256-GCM p/ credenciais (64 hex = 32 bytes) |
| `NEXT_PUBLIC_SITE_URL` | **recomendada** | URL pública (webhooks, links de e-mail) |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` | p/ WhatsApp | servidor Evolution compartilhado (VPS) |
| `ANTHROPIC_API_KEY` | p/ IA | copiloto + agente WhatsApp |
| `OPENAI_API_KEY` | p/ IA | transcrição de áudio, geração de imagem |
| `RESEND_API_KEY`, `EMAIL_FROM` | p/ e-mail | verificação, convites, reset |
| `BLOB_READ_WRITE_TOKEN` | p/ mídia | Vercel Blob (mídia do inbox) |
| `QSTASH_TOKEN`, `QSTASH_URL`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | p/ jobs | fila (prospecção, mídia). Sem eles, degrada. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | não | rate-limit |
| `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_*`, `LINKEDIN_*` | não | login OAuth |
| `CRON_SECRET` | p/ cron | autentica os endpoints `/api/cron/*` |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `SEED_ORG_NAME` | não | usadas pelo seed |

> **Nunca commite segredos.** `.env` está no `.gitignore`.

---

## 7. Módulos/áreas com detalhes que salvam tempo

- **Inbox WhatsApp (Evolution):** conexão por usuário (`IntegrationConnection.ownerId`), credenciais **criptografadas**. Envio: `src/app/actions/inbox.ts` → adapter `WHATSAPP_EVOLUTION`. **Sempre resolva as credenciais com `resolveEvoCreds()`** (`src/lib/integrations/evolution-creds.ts`) — conexões "de plataforma" guardam só o `instance`; `baseUrl`/`apiKey` vêm do env. Passar credenciais cruas quebra o envio ("Conexão Evolution incompleta"). Recebimento: webhook por conexão `/api/webhooks/evolution/[connectionId]/[token]` → `lib/whatsapp/inbound.ts` + `ingest.ts`. Histórico exige instância criada com `syncFullHistory` (número já conectado precisa desconectar+reconectar). Mídia é assíncrona (QStash → baixa → Vercel Blob).
- **IA/Copiloto:** `src/lib/assistant/*` (tools read-only + ações com confirmação). Tools aceitam `companyId` opcional para consultar outra empresa da conta (owner-only).
- **Prospecção:** Google Places com **chave do próprio cliente (BYO)**, assíncrona via QStash, descarte LGPD.
- **Baixador (MVP frágil):** `src/lib/downloader/` — YouTube via `@distube/ytdl-core` (quebra quando o YouTube muda; atualizar a lib ajuda), X via endpoint de syndication, Instagram via `og:video` (só público). Download passa por `/api/downloader/fetch` (proxy com allowlist de host anti-SSRF, gateado por módulo). **Se o YouTube for crítico, migrar para `yt-dlp` numa VPS é o caminho estável.**

---

## 8. Runbook de produção ⚠️ (leia antes de qualquer deploy)

**Infra:** app na **Hostinger** (Node via Passenger/CloudLinux — **NÃO Vercel**) + banco no **Supabase** (só produção) + **Evolution numa VPS separada** (WhatsApp).

### Migrações (Supabase) — processo MANUAL
Nunca rode `prisma migrate dev` contra produção. As migrations são aplicadas manualmente:
```bash
# com DATABASE_URL apontando pro Supabase:
npx prisma migrate deploy        # aplica as pendentes na ordem, idempotente
# (alternativa manual, uma a uma:)
# npx prisma db execute --file prisma/migrations/<nome>/migration.sql --schema prisma/schema.prisma
# npx prisma migrate resolve --applied <nome>
```
Sempre **backup antes** de migração destrutiva. Confira com `npx prisma migrate status`.

### Deploy do app na Hostinger (na ordem)
```bash
git pull origin main
npm install          # se houver dependência nova (ex.: o Baixador adicionou @distube/ytdl-core)
npx prisma generate  # se o schema mudou
npm run build        # rebuild do Next
mkdir -p tmp && touch tmp/restart.txt   # reinicia o Passenger
```
**Gotchas que já causaram incidente:**
1. **500 em todo o app após deploy** = faltou `prisma generate` + `npm run build` (o servidor continua com o client/bundle antigos). O `git pull` sozinho não muda nada.
2. **Dependência nova** exige `npm install` no servidor (não só build).
3. **Migração destrutiva rodou mas o app 500** = o app não foi rebuildado com o código novo (código antigo × schema novo).
4. **Logs do app:** `console.error` vai pro log de erro do site (hPanel → Logs de erro, ou `~/domains/<dominio>/logs/`). Procure prefixos como `[evolution] send`, `[inbox]`, `[downloader]`, `[ingest]`.

### Incidentes já resolvidos (histórico útil)
- **QStash `DeduplicationId cannot contain ':'`** (ingest de mídia): o id `media:<id>` tinha `:`. Corrigido + `enqueue` sanitiza qualquer id.
- **WhatsApp recebia mas não enviava** ("Conexão Evolution incompleta"): o envio não resolvia as credenciais pelo env — corrigido usando `resolveEvoCreds` em todos os caminhos.

---

## 9. Convenções

- **Commits:** `[ÁREA] - Verbo + Tarefa`, com corpo estruturado, terminando com a linha de co-autoria. Ex.: `[CRM] - Adiciona autofill de CEP na empresa`.
- **Validação por entrega:** `typecheck` + `lint` + `build` + `check:isolation` antes de commitar; manter **paridade de chaves** entre `pt.json` e `en.json`.
- **Gating sempre pelas fontes de verdade:** `config/modules.ts` (módulos), `config/screens.ts` (telas), `config/limits.ts` (limites). Não espalhe `if` de módulo/permissão pelo código.
- **Dados sempre pela DAL** (`lib/queries/*`) com `tenantDb`; Prisma cru só em contextos de sistema (webhook/job/cron) com `organizationId` explícito.
- **Sem drawer para criação** no CRM (foi testado e descartado a pedido).

---

## 10. Pendências / próximos passos

- **Cobrança real:** hoje é simulada (sem gateway). Ligar Stripe/pagamento é dívida em aberto.
- **Baixador:** YouTube via ytdl-core é frágil; considerar `yt-dlp` na VPS. Ideias: TikTok, baixar só áudio (MP3), histórico.
- **Gating cross-módulo server-side:** o gate é na UI; blindar as actions/endpoints (ex.: recusar anexo de módulo não instalado) é um reforço pendente.
- **Google Places (BYO):** as rotas `/app/connections` seguem vivas (fora do menu) só para gerenciar essa chave — mover para Prospecção/Marketing é um follow-up.
- **Realtime:** inbox/feed usam SSE + polling de fallback (sem Pusher/Ably).

---

_Documento de handoff — mantido no repositório. Dúvidas de arquitetura: comece por `src/lib/tenant.ts`, `src/config/modules.ts` e `src/lib/queries/`._

# MétodoAI

CRM SaaS multi-tenant para prospecção, disparo em escala e atendimento por WhatsApp — tudo em um só lugar. Reconstrução do produto antigo em uma base moderna (Next.js 16 + Prisma + PostgreSQL).

---

## Objetivo do projeto

Entregar a uma equipe comercial um único painel onde ela consegue:

1. **Encontrar empresas** (prospecção via Google Places, com enriquecimento do site da empresa).
2. **Organizar o funil** (CRM com empresas, contatos e oportunidades em Kanban).
3. **Disparar contato em escala** (campanhas de WhatsApp e e-mail, com agendamento).
4. **Atender as respostas** (inbox de WhatsApp integrado ao CRM).

Tudo isolado por organização (multi-tenant), com controle de acesso por tela, planos com limites e cobrança por assinatura.

---

## Estado atual

O produto está em reconstrução feature a feature. O núcleo já está implementado e validado (typecheck + lint + build + checagem de isolamento de tenant a cada entrega).

**Pronto e em uso:**

- **Autenticação** própria (sessão JWT com `jose`, senha com `bcrypt`), login/cadastro/convite.
- **Multi-tenancy** com isolamento por `organizationId` em toda a camada de dados.
- **Uma equipe por usuário** (para entrar em outra, abandona a anterior).
- **Controle de acesso por tela** via *templates de acesso* (ex.: "comercial", "jurídico"); OWNER/ADMIN têm acesso livre.
- **CRM**: empresas, contatos (com pastas organizáveis, drag-and-drop, modos grade/lista) e oportunidades em pipeline Kanban.
- **Prospecção**: extração de leads via Google Places (chave do próprio cliente — BYO key) + enriquecimento de site, assíncrona, com limites por plano e descarte LGPD.
- **Campanhas**: disparo de WhatsApp (Evolution) e e-mail, com templates de mensagem e agendamento.
- **Inbox de WhatsApp**: recebimento, envio e visualização de conversas via Evolution API, vinculadas automaticamente ao contato do CRM; badge de não-lidas, painel do contato e botão "Conversar" em contatos/empresas/oportunidades.
- **Conexões**: integrações por tenant (BYO), com credenciais criptografadas.
- **Painel admin**: gestão de equipe, templates de acesso e log de auditoria.
- **Landing page** de vitrine + tela de planos (`/pricing`).
- **Internacionalização** PT/EN e tema claro/escuro.

**Pendências conhecidas / próximos passos:**

- Tempo real no inbox ainda é por **polling** (sem Pusher/Ably).
- Inbox trata **apenas texto** (mídia entra como placeholder; falta armazenamento tipo Blob/S3).
- Persistência de estado de UI ainda parcial (ex.: pastas comuns dos contatos não lembram aberto/fechado).
- Integração de cobrança (gateway de pagamento) a finalizar.

---

## Stack e tecnologias

| Camada | Tecnologia |
|---|---|
| Framework | **Next.js 16** (App Router, Server Components, Server Actions, Turbopack) |
| Linguagem | **TypeScript** (strict) |
| UI | **Tailwind CSS v4** (`@theme`, dark mode por classe), **lucide-react** |
| Formulários | **react-hook-form** + **zod** |
| Banco | **PostgreSQL** + **Prisma 6** |
| i18n | **next-intl 4** (pt/en) |
| Auth | **jose** (JWT HS256) + **bcryptjs** |
| Filas/Cache | **Upstash QStash** (jobs) + **Upstash Redis** (rate-limit) — opcionais, degradam com elegância |
| Cripto | **AES-256-GCM** para credenciais de integração |
| Integrações | **Evolution API** (WhatsApp não-oficial), **Google Places API** |

Requer **Node ≥ 20.9**.

---

## Implementação

### Arquitetura multi-tenant

- Tudo é escopado por `organizationId`.
- A camada de dados (`src/lib/queries/*`) usa `tenantDb(orgId)` — um Prisma `$extends` (`src/lib/tenant-db.ts`) que injeta a organização em `create`/`where`. Operações que o extends não cobre (`findUnique`/`update`/`delete`/`upsert`) usam `findFirst` + `updateMany`/`deleteMany` filtrando por `{ id }`.
- Contextos de sistema (webhooks, jobs) usam o `prisma` cru com `organizationId` explícito.
- `getOrgContext()` / `requireOrgContext()` (`src/lib/tenant.ts`) resolvem org, template de acesso e telas permitidas.
- O script `npm run check:isolation` valida que nenhuma query escapa do isolamento.

### Controle de acesso

- `src/config/screens.ts` lista as telas "gateáveis"; `src/lib/access.ts` resolve as telas permitidas a partir do `AccessTemplate` do membro e protege nav + `layout.tsx` de cada tela.
- Dashboard e settings são sempre acessíveis (settings é role-gated para ADMIN+).

### Planos e limites

- `src/config/plans.ts` é a fonte única de verdade: planos **STANDARD / PLUS / GOLD / ENTERPRISE** com `seatLimit`, cota de disparos, cota de leads, nº de extrações, limite de conexões e flags de feature.
- O código gateia sempre por `hasFeature(plan, …)` / `assertFeature(...)` — nunca com `if (plan === …)` espalhado.

### Integrações e mensageria

- **Evolution (WhatsApp)**: conexão por tenant; envio via `/message/sendText/{instance}`; recebimento por **webhook por conexão** (`/api/webhooks/evolution/[connectionId]/[token]`) — o `connectionId` resolve o tenant e o token (em `meta.webhookToken`) autentica. Status de entrega (`messages.update`) atualiza campanhas e o inbox.
- **Google Places**: prospecção com a chave do próprio cliente (criptografada), enfileirada via QStash, com enriquecimento do site da empresa.
- Jobs agendados rodam por **Vercel Cron** (`/api/cron/*`).

### Modelo de dados (Prisma)

Organization, User, Membership, AccessTemplate, Invitation · Company, Contact, ContactFolder · Pipeline, Stage, Opportunity · IntegrationConnection, WebhookEndpoint, WebhookEvent · MessageTemplate, Campaign, CampaignRecipient · ExtractionJob, ExtractedLead · Conversation, Message · AuditLog.

---

## Estrutura de pastas

```
src/
  app/[locale]/        # rotas (route groups: (auth), app/*, pricing, landing)
    api/               # webhooks (evolution/genérico), cron, jobs, inbox
  components/          # UI por domínio (app, crm, campaigns, inbox, ...)
  config/              # screens.ts, plans.ts (fontes de verdade)
  lib/
    queries/           # camada de acesso a dados (DAL), por domínio
    tenant.ts, tenant-db.ts, access.ts, env.ts, phone.ts
    integrations/      # channels (evolution/email), crypto, webhooks
  messages/            # pt.json, en.json (next-intl)
prisma/
  schema.prisma, migrations/, seed.ts, backups/
scripts/               # check-isolation.ts, backfill-pipelines.ts
```

---

## Como rodar

```bash
# 1. Dependências
npm install

# 2. Variáveis de ambiente (.env) — ver tabela abaixo

# 3. Banco
npm run db:migrate        # aplica migrations (dev)
npm run db:seed           # cria org/owner inicial (opcional)

# 4. Dev
npm run dev               # http://localhost:3000
```

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` / `build` / `start` | ciclo de vida Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run check:isolation` | valida o isolamento multi-tenant |
| `npm run db:migrate` / `db:push` / `db:seed` / `db:studio` | Prisma |
| `npm run db:dump` / `db:restore` | snapshot do Postgres (Docker) |
| `npm run backfill:pipelines` | backfill de pipelines |

### Variáveis de ambiente

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | sim | conexão Postgres (runtime) |
| `DIRECT_URL` | não | conexão direta p/ Prisma Migrate |
| `SESSION_SECRET` | sim | assinatura de sessão JWT (≥ 32 chars) |
| `INTEGRATION_ENC_KEY` | sim | AES-256-GCM (64 hex = 32 bytes) p/ credenciais |
| `NEXT_PUBLIC_SITE_URL` | recomendada | URL pública (webhooks, links) |
| `QSTASH_TOKEN`, `QSTASH_*_SIGNING_KEY` | não | jobs em background (Upstash QStash) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | não | cache / rate-limit |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `SEED_ORG_NAME` | não | usadas pelo seed |

> O `.env` é versionado no `.gitignore`. **Nunca** commite segredos. Em dev, o recebimento de webhooks exige um túnel (ex.: ngrok) com `NEXT_PUBLIC_SITE_URL` apontando para ele.

---

## Convenções

- **Commits**: `[ÁREA] - Verbo + Tarefa` (`CRE` criar · `IMP` integrar · `UPD` evoluir · `CRX` corrigir · `RMV` remover), com corpo estruturado.
- **Validação por entrega**: `typecheck` + `lint` + `build` + `check:isolation` devem passar antes do commit.
- **Gating**: telas via `config/screens.ts`; planos via `config/plans.ts`. Não espalhar condicionais de plano/permissão pelo código.
- **Dados**: acessar sempre pela DAL (`lib/queries/*`) com `tenantDb`; nada de Prisma cru fora dos contextos de sistema.

---

_Repositório: `Grupo-Vannuchi/metodo-ai-new` · Documento gerado para dar visão geral do projeto._

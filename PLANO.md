# MétodoAI — Plano de Negócio & Implementação

> SaaS de CRM com prospecção, agentes de disparo, extratores e conexões (APIs/Webhooks).
> Reconstrução do legado PHP seguindo **fielmente a arquitetura, stack e práticas do projeto `n8x`**,
> agora com multi-tenancy de verdade, clean code e escalabilidade desde a fundação.

---

## 1. Decisões travadas (norte do projeto)

| Decisão | Escolha | Consequência arquitetural |
| --- | --- | --- |
| **Escopo v1** | Núcleo | CRM/Funil + Contatos/Empresas + Prospecção/Extratores + Agentes de disparo + Conexões/Webhooks. Demais módulos (financeiro, RH, operação, suprimentos, marketing) entram em fases futuras sobre a **mesma fundação**. |
| **Multi-tenancy** | Prisma + tenant na aplicação | Postgres puro, coluna `organizationId` em todo dado de cliente, isolamento garantido na **camada DAL** (`src/lib/queries`). Portável e sob nosso controle (sem depender de RLS do banco). |
| **Hospedagem / Jobs** | Vercel + fila gerenciada | Next.js na Vercel; jobs longos (disparos, extratores, campanhas agendadas) via **QStash** + **Upstash Redis** + **Vercel Cron**, com processamento em lotes (chunking) para respeitar limites serverless. |
| **Idioma** | Bilíngue PT/EN | Mantém `next-intl` com catálogos `pt.json`/`en.json` tipados, igual ao n8x. Conteúdo de UI nos catálogos; dados no Postgres. |

---

## 2. Visão de negócio (resumo)

**Posicionamento:** plataforma brasileira de **aquisição de clientes** — encontra empresas (extratores), centraliza no CRM (funil Kanban) e dispara contato em escala (WhatsApp/e-mail), tudo conectável via integrações e webhooks.

**Proposta de valor:** substituir a colcha de retalhos (planilha + extrator avulso + ferramenta de disparo + CRM separado) por um fluxo único: **extrair → qualificar no funil → disparar → acompanhar resposta**.

**Planos (gating por feature + cota + assentos)** — herdados do legado, simplificados para o núcleo:

| Plano | Assentos | Núcleo CRM | Prospecção/Extratores | Disparos (cota/mês) | Conexões |
| --- | --- | --- | --- | --- | --- |
| **Standard** | 1–3 | ✅ | Google/CNPJ básico | 1.000 | 1 conexão |
| **Plus** | até 10 | ✅ | + Redes sociais | 10.000 | 3 conexões |
| **Gold** | até 25 | ✅ | Tudo + agendamento avançado | 50.000 | ilimitado |
| **Empresa** | sob medida | ✅ | Tudo + API/Webhooks de saída | sob medida | ilimitado + SSO |

> O gating é por **config + `organization.plan`** (mapa de features no código), não por código duplicado. Um único ponto de verificação (`assertFeature(org, "extractor.social")`).

---

## 3. Stack definitiva

Espelha o `n8x` 1:1 e adiciona **apenas** o necessário para multi-tenant SaaS + jobs.

| Camada | Escolha (igual ao n8x) | Observação |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router, Server Components, Turbopack) | idem |
| Linguagem | **TypeScript strict** | idem |
| Estilo | **Tailwind CSS v4** (`@theme` CSS-first) | idem |
| i18n | **next-intl 4** (rotas por locale + mensagens tipadas) | PT/EN |
| ORM / DB | **Prisma 6 + PostgreSQL** | idem |
| Auth | **jose** (JWT HS256 em cookie httpOnly) + **bcryptjs** | + `organizationId`/`role` no payload |
| Forms | **react-hook-form + zod** (schema único client/server) | idem |
| Ícones | **lucide-react** | idem |

**Adições (mínimas e justificadas):**

| Necessidade | Escolha | Por quê |
| --- | --- | --- |
| Postgres serverless-friendly | **Neon** (ou Supabase usado só como Postgres) | Pooling (pgBouncer) p/ serverless + `DIRECT_URL` p/ migrations — padrão **já documentado no schema do n8x**. |
| Fila / jobs | **Upstash QStash** | Entrega HTTP com retry, delay e agendamento; perfeito p/ Vercel (sem worker próprio). |
| Cache / rate-limit / locks | **Upstash Redis** (`@upstash/ratelimit`) | Throttle de disparo por tenant/canal, dedupe e locks de campanha. |
| Cron | **Vercel Cron** (`vercel.json`) | Dispara o scheduler de campanhas/extrações periódicas. |
| Validação de env | **zod** (`src/lib/env.ts`, já existe no n8x) | Falha rápida no boot; estende com chaves de fila/integração. |
| Cripto de credenciais | **AES-256-GCM** (Node `crypto`, chave em env) | Credenciais de integração nunca em texto puro. |
| E-mail | **Resend** (ou SMTP via Nodemailer) | Disparo de e-mail e transacional (convites, reset). |
| Erros/observabilidade | **Sentry** (opcional, fase 1) | Rastreio de falhas em jobs e actions. |

> Nada de dependência nova "porque sim". Cada item acima cobre um requisito que o n8x não tinha (multi-tenant SaaS + processamento assíncrono) e que o núcleo do MétodoAI exige.

---

## 4. Arquitetura de alto nível

```
                        ┌─────────────────────────────────────────────┐
        Browser  ─────► │  Next.js (Vercel) — App Router               │
                        │  • (marketing) site público + (app) dashboard │
                        │  • Server Components leem via DAL (tenant-safe)│
                        │  • Server Actions re-validam com zod          │
                        └───────┬───────────────────────┬──────────────┘
                                │                        │
                  leitura/escrita (DAL)          enfileira jobs
                                │                        │
                        ┌───────▼────────┐      ┌────────▼─────────┐
                        │  PostgreSQL     │      │  Upstash QStash   │
                        │  (Prisma)       │      │  (fila + delays)  │
                        │  organizationId │      └────────┬─────────┘
                        │  em todo dado   │               │ HTTP callback (assinado)
                        └───────▲────────┘                ▼
                                │              ┌──────────────────────────┐
                                │              │ app/api/jobs/*  (handlers)│
                                └──────────────┤ processa LOTE pequeno,    │
                                  grava status │ chama adapters, re-enfila │
                                               └───────┬──────────────────┘
   Vercel Cron ──► app/api/cron/* ──► scheduler        │
                                                        ▼
                                          ┌───────────────────────────┐
   Webhooks de entrada ──► app/api/webhooks/[provider] │ Adapters de integração     │
   (Meta/Evolution/etc, assinados)                     │ Evolution, Meta Cloud,     │
                                                        │ Google CSE/Maps, CNPJ, SMTP│
                                                        └───────────────────────────┘
```

### Fluxo de requisição (leitura) — idêntico ao n8x
```
Request → proxy.ts (negocia locale) → app/[locale]/layout.tsx (fontes, tema, i18n)
        → page (Server Component)
             ├─ copy da UI  via getTranslations() → src/messages/*.json
             └─ dados       via src/lib/queries.ts → Postgres (SEMPRE filtrado por organizationId)
        → HTML
```

### Fluxo de job (disparo de campanha)
```
Cron (a cada 1 min) → /api/cron/campaigns
   → busca campanhas devidas da org (respeitando janela/recorrência)
   → para cada lote de destinatários: QStash.publish(delay escalonado) → /api/jobs/dispatch-message
        → assertFeature + checa cota + ratelimit(org, canal)
        → adapter.send(connection, contato, template)
        → grava CampaignRecipient.status = SENT + providerMessageId
   Webhook do provedor → /api/webhooks/[provider] (verifica assinatura, dedupe)
        → atualiza status para DELIVERED/READ/FAILED
```

---

## 5. Multi-tenancy & fronteira de segurança

Princípio: **toda linha de dado de cliente carrega `organizationId`; nenhuma query toca o banco sem esse filtro.** A fronteira é a DAL, exatamente como o n8x faz com `requireAdmin` + `src/lib/queries.ts`.

**Modelo de tenancy:**
- `Organization` = tenant (o "workspace" do legado). Tem `plan`, `seatLimit`.
- `User` = identidade global (login).
- `Membership` = vínculo User↔Organization com `role` (`OWNER` / `ADMIN` / `MEMBER`). Um user pode estar em várias orgs.
- A sessão JWT carrega `userId` + `activeOrganizationId` + `role`.

**Como o isolamento é garantido (defesa em camadas):**
1. **DAL tenant-aware** — `src/lib/tenant.ts` expõe `getOrgContext()` (lê sessão → org ativa + papel). Toda função em `src/lib/queries/*` recebe esse contexto e injeta `where: { organizationId }`.
2. **Prisma Client Extension** (`$extends`) — um cliente derivado por requisição que **força** `organizationId` em `findMany/update/delete`, prevenindo o "esqueci o where". Rede de segurança, não substituto da DAL.
3. **Server Actions re-validam** — toda action confere `getOrgContext()` + `assertRole()` antes de escrever (igual o n8x re-valida com zod).
4. **Sem IDs cross-tenant** — updates/deletes sempre por `where: { id, organizationId }` (nunca só `id`).

> Resultado: mesmo um bug numa página não vaza dado de outro tenant — a DAL e a extension barram. Esse é o ponto que o legado resolvia com RLS; aqui resolvemos na aplicação, com testes automatizados de isolamento.

---

## 6. Modelo de dados (Prisma — núcleo)

Convenções do n8x mantidas: `cuid()` em IDs, `createdAt/updatedAt`, `@@map` snake_case, `@@index` nos campos de filtro, campos bilíngues como `Json` quando aplicável.

```prisma
// ---------- Tenancy & Auth ----------
enum Role { OWNER ADMIN MEMBER }
enum Plan { STANDARD PLUS GOLD ENTERPRISE }

model Organization {
  id         String   @id @default(cuid())
  name       String
  slug       String   @unique
  plan       Plan     @default(STANDARD)
  seatLimit  Int      @default(3)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  memberships Membership[]
  @@map("organizations")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  memberships  Membership[]
  @@map("users")
}

model Membership {
  id             String       @id @default(cuid())
  organizationId String
  userId         String
  role           Role         @default(MEMBER)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())
  @@unique([organizationId, userId])
  @@index([userId])
  @@map("memberships")
}

model Invitation {
  id             String   @id @default(cuid())
  organizationId String
  email          String
  role           Role     @default(MEMBER)
  tokenHash      String   @unique
  expiresAt      DateTime
  createdAt      DateTime @default(now())
  @@index([organizationId])
  @@map("invitations")
}

// ---------- CRM ----------
model Company {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  cnpj           String?
  email          String?
  phone          String?
  // endereço quebrado (logradouro, número, bairro, cidade, uf, cep, país)
  address        Json     @default("{}")
  notes          String?
  source         String?  // "extractor:google", "manual", "import"
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([organizationId, name])
  @@index([organizationId, cnpj])
  @@map("companies")
}

model Contact {
  id             String   @id @default(cuid())
  organizationId String
  companyId      String?
  name           String
  email          String?
  phone          String?
  role           String?
  tags           String[] @default([])
  source         String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([organizationId, companyId])
  @@map("contacts")
}

model Pipeline {
  id             String  @id @default(cuid())
  organizationId String
  name           String
  isDefault      Boolean @default(false)
  order          Int     @default(0)
  stages         Stage[]
  @@index([organizationId])
  @@map("pipelines")
}

model Stage {
  id             String @id @default(cuid())
  organizationId String
  pipelineId     String
  name           String
  order          Int    @default(0)
  probability    Int    @default(0) // 0–100
  pipeline       Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  @@index([organizationId, pipelineId, order])
  @@map("stages")
}

enum OpportunityStatus { OPEN WON LOST }

model Opportunity {
  id             String   @id @default(cuid())
  organizationId String
  pipelineId     String
  stageId        String
  companyId      String?
  contactId      String?
  title          String
  value          Decimal  @default(0) @db.Decimal(14,2)
  status         OpportunityStatus @default(OPEN)
  order          Int      @default(0) // posição no Kanban
  ownerId        String?  // membership responsável
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([organizationId, pipelineId, stageId, order])
  @@map("opportunities")
}

model Activity {            // tarefas/follow-ups
  id             String   @id @default(cuid())
  organizationId String
  opportunityId  String?
  contactId      String?
  type           String   // call, email, whatsapp, note
  dueAt          DateTime?
  doneAt         DateTime?
  notes          String?
  createdAt      DateTime @default(now())
  @@index([organizationId, dueAt])
  @@map("activities")
}

// ---------- Prospecção / Extratores ----------
enum ExtractorProvider { GOOGLE_MAPS GOOGLE_CSE CNPJ INSTAGRAM LINKEDIN }
enum JobStatus { QUEUED RUNNING DONE FAILED CANCELED }

model ExtractionJob {
  id             String   @id @default(cuid())
  organizationId String
  provider       ExtractorProvider
  params         Json     // query, localização, filtros
  status         JobStatus @default(QUEUED)
  totalFound     Int      @default(0)
  cursor         Json?    // estado p/ paginação/chunking
  createdById    String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  results        ExtractedLead[]
  @@index([organizationId, status])
  @@map("extraction_jobs")
}

model ExtractedLead {
  id               String   @id @default(cuid())
  organizationId   String
  extractionJobId  String
  name             String?
  cnpj             String?
  email            String?
  phone            String?
  raw              Json     // payload bruto do provedor
  importedContactId String?
  job              ExtractionJob @relation(fields: [extractionJobId], references: [id], onDelete: Cascade)
  @@index([organizationId, extractionJobId])
  @@map("extracted_leads")
}

// ---------- Conexões / Integrações ----------
enum IntegrationProvider { EVOLUTION META_CLOUD GOOGLE SMTP RESEND N8N }
enum ConnectionStatus { ACTIVE INACTIVE ERROR }

model IntegrationConnection {
  id             String   @id @default(cuid())
  organizationId String
  provider       IntegrationProvider
  label          String
  credentialsEnc String   // AES-256-GCM (nunca texto puro)
  status         ConnectionStatus @default(INACTIVE)
  lastTestAt     DateTime?
  meta           Json     @default("{}")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([organizationId, provider])
  @@map("integration_connections")
}

model WebhookEndpoint {       // entrada: provedores chamam aqui
  id             String   @id @default(cuid())
  organizationId String
  provider       IntegrationProvider
  secret         String
  events         String[] @default([])
  createdAt      DateTime @default(now())
  @@index([organizationId, provider])
  @@map("webhook_endpoints")
}

model WebhookEvent {          // log idempotente de eventos recebidos
  id             String   @id @default(cuid())
  organizationId String
  provider       IntegrationProvider
  eventType      String
  dedupeKey      String   @unique  // evita processar 2x
  payload        Json
  processedAt    DateTime?
  createdAt      DateTime @default(now())
  @@index([organizationId, provider, eventType])
  @@map("webhook_events")
}

// ---------- Agentes de disparo / Campanhas ----------
enum Channel { WHATSAPP_EVOLUTION WHATSAPP_CLOUD EMAIL }
enum CampaignStatus { DRAFT SCHEDULED RUNNING PAUSED DONE CANCELED }
enum RecipientStatus { PENDING SENT DELIVERED READ FAILED }

model ContactList {
  id             String @id @default(cuid())
  organizationId String
  name           String
  items          ContactListItem[]
  createdAt      DateTime @default(now())
  @@index([organizationId])
  @@map("contact_lists")
}

model ContactListItem {
  id        String @id @default(cuid())
  listId    String
  contactId String
  list      ContactList @relation(fields: [listId], references: [id], onDelete: Cascade)
  @@unique([listId, contactId])
  @@map("contact_list_items")
}

model MessageTemplate {
  id             String   @id @default(cuid())
  organizationId String
  channel        Channel
  name           String
  body           String   // suporta variáveis {{nome}}, {{empresa}}
  meta           Json     @default("{}") // metaTemplateName p/ Meta Cloud, etc.
  createdAt      DateTime @default(now())
  @@index([organizationId, channel])
  @@map("message_templates")
}

model Campaign {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  channel        Channel
  connectionId   String   // IntegrationConnection usada
  templateId     String?
  status         CampaignStatus @default(DRAFT)
  schedule       Json     @default("{}") // janela, dias da semana, delayMin/Max, recorrência
  startAt        DateTime?
  createdById    String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  recipients     CampaignRecipient[]
  @@index([organizationId, status])
  @@map("campaigns")
}

model CampaignRecipient {
  id                String   @id @default(cuid())
  organizationId    String
  campaignId        String
  contactId         String
  status            RecipientStatus @default(PENDING)
  providerMessageId String?
  error             String?
  sentAt            DateTime?
  campaign          Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  @@unique([campaignId, contactId]) // idempotência: 1 envio por contato/campanha
  @@index([organizationId, status])
  @@map("campaign_recipients")
}

// ---------- Sistema ----------
model AuditLog {
  id             String   @id @default(cuid())
  organizationId String
  userId         String?
  action         String   // "campaign.created", "contact.deleted"
  entity         String
  entityId       String?
  meta           Json     @default("{}")
  createdAt      DateTime @default(now())
  @@index([organizationId, createdAt])
  @@map("audit_logs")
}
```

> **Quota de disparo** = agregação por `organizationId` + mês sobre `CampaignRecipient` com `status != PENDING`, validada antes de enfileirar (e cache no Redis p/ contagem rápida).

---

## 7. Módulos do v1 (núcleo) — detalhamento

### 7.1 CRM / Funil Kanban
- Pipelines + Stages configuráveis (drag-drop). Oportunidades como cards com valor, contato, empresa, responsável.
- Reordenação otimista no client → Server Action persiste `stageId` + `order`.
- Insights básicos: total por estágio, valor ponderado por `probability`, conversão.

### 7.2 Contatos & Empresas
- CRUD com `zod` compartilhado (client + server), igual aos forms do n8x (`src/lib/validations/*`).
- Busca/filtro por nome, CNPJ, tags. Importação a partir de extratores (1 clique: `ExtractedLead → Contact/Company`).

### 7.3 Prospecção & Extratores
- Provedores como **adapters** (`src/lib/integrations/extractors/*`): `googleMaps`, `googleCse`, `cnpj` (ReceitaWS/BrasilAPI), `instagram`/`linkedin` (Plus+).
- Extração roda como **ExtractionJob** assíncrono: cria job → QStash → handler busca um lote, salva `ExtractedLead`, atualiza `cursor`, re-enfileira até esgotar.
- UI mostra progresso (status + totalFound) e botão "importar selecionados para o CRM".

### 7.4 Agentes de disparo (Campanhas)
- Canais: WhatsApp (Evolution e Meta Cloud) e E-mail. Cada um é um **adapter** com a mesma interface `ChannelAdapter.send()`.
- Campanha = lista/segmento + template + conexão + agendamento (janela, dias, delay aleatório entre min/max, recorrência).
- Scheduler (Cron) detecta campanhas devidas → enfileira destinatários com **delays escalonados** → cada job envia 1 mensagem, respeita **rate-limit por tenant/canal** (Redis) e **cota do plano**.
- Status de entrega atualizado por **webhook** do provedor.

### 7.5 Conexões & Webhooks
- Tela de Conexões: cadastrar credenciais por provedor (criptografadas), testar conexão (`lastTestAt`/`status`).
- Webhooks de **entrada**: `app/api/webhooks/[provider]` valida assinatura, grava `WebhookEvent` (dedupe), processa (atualiza recipient/conversa).
- Webhooks de **saída** (plano Empresa): notificar sistema do cliente em eventos (lead.created, message.delivered) com payload assinado (HMAC).

---

## 8. Background jobs, agendamento e rate-limit

**Padrão geral (chunking serverless-safe):** nenhum handler roda "para sempre". Cada job processa um **lote pequeno** (ex.: 25 itens), grava progresso e **re-enfileira o próximo lote** via QStash. Assim respeitamos o limite de execução da Vercel.

- **QStash** (`src/lib/queue.ts`): wrapper `enqueue(jobName, payload, { delaySeconds })`. Cada `jobName` mapeia para `app/api/jobs/<jobName>/route.ts`. Toda chamada é **verificada por assinatura** (`Upstash-Signature`).
- **Vercel Cron** (`vercel.json`): `* * * * *` → `/api/cron/campaigns` (scheduler de disparo) e `*/5 * * * *` → `/api/cron/extractions` (retoma jobs presos).
- **Upstash Redis**: `@upstash/ratelimit` por `org:canal` (ex.: WhatsApp 1 msg/seg/conexão), locks de campanha (evita scheduler duplicar), contagem de cota em cache.
- **Idempotência**: `CampaignRecipient @@unique([campaignId, contactId])` + `WebhookEvent.dedupeKey @unique` garantem que retry do QStash não duplica envio nem processamento.
- **Retry/falha**: QStash re-tenta automaticamente; após N falhas, marca `RecipientStatus.FAILED` com `error` e segue.

---

## 9. Integrações (adapters)

Interface única por categoria, implementações plugáveis — para adicionar provedor é só um arquivo novo:

```
src/lib/integrations/
  crypto.ts                 # encrypt/decrypt AES-256-GCM de credenciais
  registry.ts               # mapa provider → adapter + metadados (campos do form, ícone)
  channels/
    types.ts                # interface ChannelAdapter { send, verifyWebhook, parseStatus }
    evolution.ts            # WhatsApp via Evolution API
    meta-cloud.ts           # WhatsApp Cloud API (Meta)
    email.ts                # Resend/SMTP
  extractors/
    types.ts                # interface ExtractorAdapter { run(params, cursor) -> {leads, nextCursor} }
    google-maps.ts
    google-cse.ts
    cnpj.ts                 # BrasilAPI/ReceitaWS
```

- **Credenciais**: sempre `credentialsEnc` (AES-256-GCM, chave em `INTEGRATION_ENC_KEY`). Decifradas só no servidor, no momento do uso.
- **Teste de conexão**: cada adapter expõe `test()` → atualiza `status`/`lastTestAt`.

---

## 10. Estrutura de pastas (segue o n8x, estendida)

```
src/
  app/
    [locale]/
      (marketing)/            # site público: home, preços, contato (lead capture)
      (auth)/                 # login, cadastro, aceitar convite, reset de senha
      (app)/                  # DASHBOARD do SaaS (session + org guard)
        [orgSlug]?/           # (opcional) escopo de org na URL
        crm/                  # funil, oportunidades
        contatos/  empresas/
        prospeccao/           # extratores + resultados
        campanhas/            # agentes de disparo
        conexoes/             # integrações + webhooks
        configuracoes/        # org, membros/convites, plano, perfil
      layout.tsx
    actions/                  # Server Actions (auth, org, crm, prospeccao, campanhas, conexoes)
    api/
      jobs/<jobName>/route.ts # handlers de fila (assinados pelo QStash)
      cron/<name>/route.ts    # endpoints do Vercel Cron
      webhooks/[provider]/route.ts
    sitemap.ts robots.ts manifest.ts
  components/                 # ui, layout, sections (marketing), app (dashboard), forms
  config/
    site.ts                  # ⭐ white-label (marca, contato, tema) — igual n8x
    plans.ts                 # ⭐ planos + features (gating num único lugar)
  i18n/                      # routing, navigation, request (PT/EN)
  lib/
    env.ts                   # zod (estendido: QStash, Redis, enc key, integrações)
    prisma.ts                # singleton (igual n8x)
    session.ts auth.ts       # jose + bcrypt; payload com orgId/role
    tenant.ts                # getOrgContext(), assertRole(), assertFeature()
    queue.ts                 # wrapper QStash
    ratelimit.ts             # wrapper Upstash Redis
    queries/                 # DAL tenant-aware (1 arquivo por agregado)
    validations/             # schemas zod (1 por agregado)
    integrations/            # adapters (ver §9)
  messages/                  # pt.json, en.json (tipados)
  proxy.ts                   # next-intl (igual n8x)
prisma/                      # schema.prisma + migrations + seed.ts
vercel.json                  # crons
docker-compose.yml           # Postgres local (igual n8x)
```

---

## 11. Convenções de código / clean code (não-negociáveis)

Herdadas do n8x e reforçadas:

1. **DAL é a única porta para o banco.** Server Components e Actions chamam `src/lib/queries/*`; nunca usam `prisma` direto numa página.
2. **Toda query é tenant-scoped.** `organizationId` injetado pela DAL; reforçado pela Prisma Extension.
3. **zod uma vez, validado duas.** Mesmo schema no client (react-hook-form) e re-validado no server (Action). Mensagens traduzidas vêm do catálogo.
4. **Server Actions re-checam auth + papel + feature** antes de qualquer escrita.
5. **Marca por config** (`config/site.ts`) e **features por config** (`config/plans.ts`) — zero `if (plan === ...)` espalhado.
6. **`env.ts` valida tudo no boot** — falha rápida, nunca `process.env.X` solto.
7. **Adapters plugáveis** para canais/extratores — adicionar provedor = adicionar arquivo, não editar o core.
8. **Idempotência por design** em jobs/webhooks (chaves únicas), nunca "confiar que roda 1x".
9. **TypeScript strict + ESLint + `tsc --noEmit`** no CI; sem `any` sem justificativa.
10. **Sem segredos no client** — só `NEXT_PUBLIC_*` cruza para o browser.

---

## 12. Segurança & conformidade

- **Isolamento multi-tenant**: DAL + Prisma Extension + `where:{id,organizationId}` em updates/deletes. **Teste automatizado de isolamento** (tenta acessar dado de outra org → deve falhar).
- **Auth**: cookie httpOnly/secure/sameSite=lax (igual n8x), JWT HS256, senha bcrypt, rate-limit em login (Redis).
- **Convites**: token hash + expiração; aceitar cria `Membership` respeitando `seatLimit`.
- **Credenciais de integração**: AES-256-GCM, decifradas só no uso.
- **Webhooks de entrada**: verificação de assinatura por provedor + dedupe.
- **Jobs**: só executam com assinatura QStash válida (`/api/jobs/*` rejeita chamada não assinada).
- **LGPD**: `AuditLog`, opt-out/descadastro em disparos, exclusão de contato em cascata, base legal por origem do lead. (Disparo em massa exige consentimento — refletir isso no produto, especialmente WhatsApp não-oficial.)
- **Anti-abuso de disparo**: cota por plano + rate-limit por conexão para reduzir risco de ban (WhatsApp).

---

## 13. Roadmap por fases

> Cada fase entrega algo executável e testável. Datas relativas a partir do início.

**Fase 0 — Fundação (semana 1)**
- Scaffold Next.js 16 + TS strict + Tailwind v4 + next-intl (PT/EN) copiando convenções do n8x.
- `prisma.ts`, `env.ts`, `session.ts`, `auth.ts`, `tenant.ts`. Schema base (Org/User/Membership). Migrations + seed (org demo + owner).
- Docker Postgres local; deploy inicial na Vercel + Neon; `vercel.json`.
- **Entregável:** login/cadastro, criar org, dashboard vazio com guard de sessão/org.

**Fase 1 — CRM núcleo (semanas 2–3)**
- Contatos, Empresas (CRUD + validações zod). Pipelines/Stages. Funil Kanban (drag-drop, otimista).
- DAL tenant-aware + Prisma Extension + teste de isolamento.
- **Entregável:** CRM utilizável de ponta a ponta para 1 org.

**Fase 2 — Conexões & infra de jobs (semana 4)**
- `IntegrationConnection` + cripto + tela de Conexões + teste de conexão.
- `queue.ts` (QStash), `ratelimit.ts` (Redis), `/api/jobs/*`, `/api/cron/*`, `/api/webhooks/[provider]`.
- **Entregável:** cadastrar/testar uma conexão; pipeline de jobs operante (job de eco).

**Fase 3 — Prospecção/Extratores (semanas 5–6)**
- Adapters Google Maps/CSE + CNPJ. `ExtractionJob` assíncrono com chunking. UI de progresso + importar para CRM.
- **Entregável:** extrair empresas reais e importar como contatos.

**Fase 4 — Agentes de disparo (semanas 7–8)**
- Templates, Listas, Campanhas. Adapters de canal (Evolution, Meta Cloud, E-mail). Scheduler + delays + rate-limit + cota. Webhooks de status.
- **Entregável:** criar campanha, agendar, disparar com throttle, ver status de entrega.

**Fase 5 — SaaS & polimento (semana 9)**
- Planos/feature gating (`config/plans.ts`), assentos/convites, cota mensal, billing (Stripe — opcional), `AuditLog`, Sentry, página de preços.
- **Entregável:** onboarding de cliente self-service com plano e limites aplicados.

**Fases futuras (pós-núcleo):** WhatsApp CRM (inbox realtime), Financeiro/DRE, RH, Operação/Inspeções, Suprimentos, Marketing/IA — todos sobre a **mesma fundação multi-tenant**.

---

## 14. DevOps & observabilidade

- **Ambientes**: local (Docker Postgres) → preview (Vercel + Neon branch) → produção.
- **Migrations**: `prisma migrate` com `DIRECT_URL` (não roda pelo pooler) — padrão já no schema do n8x.
- **CI**: `lint` + `typecheck` + testes (isolamento de tenant, adapters mockados) antes do deploy.
- **Segredos**: Vercel env vars, validados por `env.ts` no boot.
- **Observabilidade**: Sentry (erros em actions/jobs), logs estruturados, dashboard de fila do QStash.

---

## 15. Riscos & mitigações

| Risco | Mitigação |
| --- | --- |
| Limite de execução serverless em jobs longos | Chunking + re-enfileiramento (lotes pequenos), nunca loop infinito num handler. |
| Ban de WhatsApp em disparo massivo | Rate-limit por conexão, delays aleatórios, cota por plano, preferir Meta Cloud oficial; avisos de consentimento. |
| Vazamento cross-tenant | DAL + Prisma Extension + `where:{id,orgId}` + teste automatizado de isolamento. |
| Custo Upstash/Neon escalando | Métricas de uso por org; cota por plano alinhada ao custo. |
| Conexão Prisma esgotando no serverless | URL com pgBouncer (`?pgbouncer=true`) + `DIRECT_URL` p/ migrations. |
| Escopo inflar (voltar a virar o monolito legado) | Núcleo travado; novos módulos só após o núcleo estável. |

---

## 16. Próximos passos imediatos

1. **Confirmar provedores** que você já tem conta/chave: Neon (ou Supabase-Postgres), Upstash (QStash+Redis), Resend/SMTP, Google (Maps/CSE), Evolution e/ou Meta Cloud. *(Posso seguir com placeholders em `.env` e você preenche.)*
2. **Scaffold da Fase 0** neste diretório (`metodo-ai`), espelhando o n8x: estrutura de pastas, `package.json`, `prisma/schema.prisma` (Org/User/Membership), `env.ts`, auth, i18n PT/EN, Docker + `vercel.json`.
3. Subir Postgres local, rodar migration + seed, validar login/criação de org.

> Diga **"pode começar o scaffold da Fase 0"** que eu inicio a construção seguindo este plano. Se quiser ajustar escopo, planos ou ordem das fases antes, me avise.
```

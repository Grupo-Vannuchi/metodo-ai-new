# E-mail em massa (submenu E-mail) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o submenu **E-mail**. Ele envia e-mails em massa pela conta Resend do próprio cliente para a soma de contatos, empresas e endereços avulsos. Cada endereço recebe um e-mail só por envio, e é o banco que garante isso.

**Architecture:** O módulo é independente de Campanhas. São três tabelas novas: `EmailBroadcast`, `EmailBroadcastRecipient` com `@@unique([broadcastId, email])` e `EmailSuppression`. A lógica pura (normalização, deduplicação, renderização, assinatura Svix e transições de status) fica em arquivos sem `server-only`, verificados por `npm run check:email`. O disparo usa `/emails/batch` em lotes fixos de 100 com `Idempotency-Key` por lote, roda em segundo plano (`after()` ou QStash) e tem lease por heartbeat e botão "Retomar". O descadastro usa link HMAC próprio mais `List-Unsubscribe` one-click. O status de entrega chega pelo webhook do Resend, registrado via API e verificado com assinatura Svix.

**Tech Stack:** Next.js 16 (App Router, server actions, `after`), Prisma 6 + PostgreSQL (Supabase em prod), next-intl 4, zod 3, TipTap (o editor das Propostas), API REST do Resend. Não entra nenhuma dependência nova.

**Spec:** [docs/superpowers/specs/2026-10-06-email-em-massa-design.md](../specs/2026-10-06-email-em-massa-design.md). Leia junto com este plano.

## Global Constraints

- **Nada de Campanhas muda.** Arquivos proibidos:
  - `src/lib/dispatch.ts`, `src/lib/integrations/channels/email.ts`, `src/lib/integrations/webhooks/**`;
  - `src/app/api/webhooks/[provider]/route.ts`;
  - `src/app/actions/campaigns.ts`, `src/lib/queries/campaigns.ts`, `src/lib/validations/campaign.ts`;
  - `src/components/campaigns/**`, `src/app/[locale]/app/campaigns/**`;
  - `src/lib/unsubscribe.ts`, `src/app/[locale]/unsubscribe/**`, `src/app/actions/unsubscribe.ts`;
  - os models `Campaign`, `CampaignRecipient` e `MessageTemplate`;
  - `LIMITS.dispatchQuotaPerMonth`.
- **`Contact.optedOut` é só leitura.** Nunca escreva nele.
- **Multi-tenant (guia 03):**
  - Em request de usuário, use `tenantDb(orgId)`. Trabalho por id é `findFirst` + `updateMany`/`deleteMany` com checagem de `count`.
  - Nunca `findUnique`/`update`/`delete`/`upsert`/`*AndReturn` em tabela de negócio.
  - Prisma cru só em contexto de sistema (dispatcher, webhook, páginas públicas autorizadas por HMAC), sempre com `organizationId` explícito ou derivado da linha autorizada.
- Os três models novos entram em `TENANT_MODELS`.
- **Gating:** `canAccessScreen(ctx, "email")` + `hasModule(ctx.modules, "marketing")` nas actions; `requireScreen`/`requireModule` no layout.
- **i18n:** `src/messages/pt.json` e `en.json` com exatamente as mesmas chaves. Nada de `{{` dentro de mensagem, porque o ICU interpreta chaves; tokens como `{{nome}}` são renderizados no JSX.
- **Env:** só via `src/lib/env.ts`, nunca `process.env` no código da app.
- **Rotas `/api/*`** se protegem sozinhas, na primeira linha do handler (guia 05).
- **Números fixos:**
  - lote `100` (`BATCH_SIZE`), pausa `150` ms entre lotes;
  - lease `90 s`, "envio parado" depois de `2 min`;
  - cota `LIMITS.emailBroadcastQuotaPerMonth = 50_000`;
  - chaves `eb-{broadcastId}-{batchNo}` (lote) e `eb-{broadcastId}-{batchNo}-{recipientId}` (individual);
  - eventos do webhook: `email.delivered`, `email.bounced`, `email.complained`, `email.failed`;
  - prefixo HMAC `email-broadcast-unsub:`.
- **Arquivos puros** (`normalize.ts`, `audience-core.ts`, `render.ts`, `signing.ts`, `webhook.ts`, `types.ts`): **sem** `import "server-only"` e sem imports de módulos que o tenham. O `tsx` não resolve o pacote `server-only`.
- **Next 16:** antes de escrever page, layout, route ou action, leia em `node_modules/next/dist/docs/01-app/`:
  - `01-getting-started/07-mutating-data.md` e `15-route-handlers.md`;
  - `03-api-reference/04-functions/after.md`;
  - `03-api-reference/03-file-conventions/route.md`.
  Siga os padrões já usados no repo: `params` é `Promise`.
- **Produção em Node 20.x.** Não use API mais nova que o Node 20.
- **Commits:** `[E-mail] - Verbo + tarefa`, corpo curto e a última linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feature/email-em-massa`; não faça push sem pedir.
- **Comentários de código em inglês**; docs em pt-BR.
- Depois de `prisma generate`, mate e reinicie o `next dev` na porta 3000. Não suba um segundo servidor em outra porta.

## Review Focus

1. **Mesmo endereço com maiúsculas e espaços diferentes** num contato, numa empresa e digitado à mão → um destinatário só, com origem "Contato + Empresa + Avulso". Cobertura: `check:email` (Task 2) e E2E (Task 10, passo de dedupe).
2. **Envio interrompido depois que o Resend aceitou o lote, mas antes de gravar no banco**, e depois "Retomar" → ninguém recebe duas vezes. Cobertura: Task 10, passo "simular queda", com a mesma `Idempotency-Key`.
3. **Duplo envio** (o mesmo rascunho enviado de duas abas) → uma materialização só; a segunda aba recebe erro. Cobertura: Task 10, passo "duas abas", com a consulta SQL de duplicados.
4. **Scanner de link abrindo o descadastro com GET** → não descadastra; só o clique no botão ou o POST one-click. Cobertura: Task 12, passos de GET e POST.
5. **Webhook com assinatura inválida, conexão desconhecida, `email_id` de outro sistema e evento repetido** → 401, 404, 200 sem mudança e 200 `duplicate`. Cobertura: Task 13, passos de curl.

---

### Task 1: Schema, migration e isolamento

**Files:**
- Modify: `prisma/schema.prisma` (anexar no fim do arquivo)
- Create: `prisma/migrations/<timestamp>_email_broadcasts/migration.sql` (gerado)
- Modify: `src/lib/tenant-db.ts` (fim do array `TENANT_MODELS`)
- Modify: `scripts/check-isolation.ts`
- Modify: `docs/guia/03-multi-tenancy.md`

**Interfaces:**
- Produz os models Prisma `emailBroadcast`, `emailBroadcastRecipient` e `emailSuppression` e os enums `EmailBroadcastStatus`, `EmailRecipientStatus` e `EmailSuppressionReason`, usados por todas as tasks seguintes.

- [ ] **Step 1: Escrever o teste que falha (isolamento)**

Em `scripts/check-isolation.ts`, logo antes de `console.log("\n✅ Tenant isolation: all checks passed.");`:

```ts
    // 9) Mass e-mail broadcasts and their recipients are tenant-scoped too.
    const broadcastA = await prisma.emailBroadcast.create({
      data: {
        organizationId: orgA.id,
        subject: `ISO-EB-A-${stamp}`,
        html: "<p>x</p>",
        createdById: userA.id,
      },
    });
    await prisma.emailBroadcastRecipient.create({
      data: {
        organizationId: orgA.id,
        broadcastId: broadcastA.id,
        email: `iso-${stamp}@example.com`,
        batchNo: 0,
      },
    });
    const broadcastsB = await prisma.emailBroadcast.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      broadcastsB.length === 0,
      "email broadcast list scoped to org B excludes org A's broadcast",
    );
    const recipientsB = await prisma.emailBroadcastRecipient.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      recipientsB.length === 0,
      "email recipient list scoped to org B excludes org A's recipient",
    );

    // 10) The suppression list is per org: an address blocked in A is still
    // free in B (the unique key is [organizationId, email]).
    const blockedEmail = `iso-block-${stamp}@example.com`;
    await prisma.emailSuppression.create({
      data: { organizationId: orgA.id, email: blockedEmail, reason: "UNSUBSCRIBED" },
    });
    const blockedInB = await prisma.emailSuppression.findMany({
      where: { organizationId: orgB.id, email: blockedEmail },
    });
    assert(
      blockedInB.length === 0,
      "an address suppressed in org A is not suppressed in org B",
    );
```

E no `finally`, antes de `await prisma.conversation.deleteMany(...)`:

```ts
    await prisma.emailSuppression.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
    // Recipients go with their broadcast (onDelete: Cascade).
    await prisma.emailBroadcast.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Garanta o Postgres local de pé (`docker compose up -d postgres`) e rode `npm run typecheck`.
Esperado: FAIL com `Property 'emailBroadcast' does not exist on type 'PrismaClient'`.

- [ ] **Step 3: Adicionar os models ao schema**

Anexar ao fim de `prisma/schema.prisma`:

```prisma
// ---------------------------------------------------------------------------
// Mass e-mail (submenu E-mail). Independent from Campaigns on purpose: its own
// recipients (by address, not by contact), suppression list and quota. See
// docs/superpowers/specs/2026-10-06-email-em-massa-design.md.
// ---------------------------------------------------------------------------

enum EmailBroadcastStatus {
  DRAFT
  SENDING
  PAUSED
  DONE
}

enum EmailRecipientStatus {
  QUEUED
  SENT
  DELIVERED
  BOUNCED
  COMPLAINED
  FAILED
}

enum EmailSuppressionReason {
  UNSUBSCRIBED
  BOUNCED
  COMPLAINED
}

/// One mass e-mail send. The audience selection is kept as JSON so a draft
/// reopens as it was; recipients are materialized only when sending starts.
model EmailBroadcast {
  id             String               @id @default(cuid())
  organizationId String
  subject        String
  /// Editor HTML as typed; sanitized again at render time.
  html           String               @db.Text
  fromName       String?
  replyTo        String?
  /// AudienceSelection (src/lib/validations/email-broadcast.ts).
  audience       Json                 @default("{}")
  /// { selected, invalid, duplicates, suppressed, total } frozen at send time.
  stats          Json                 @default("{}")
  status         EmailBroadcastStatus @default(DRAFT)
  /// "no_connection" | "quota" | "provider_error"
  pausedReason   String?
  /// Resend's message when paused by a provider error.
  lastError      String?
  createdById    String
  startedAt      DateTime?
  finishedAt     DateTime?
  /// Dispatcher heartbeat / lease (src/lib/email-broadcast/dispatch.ts).
  lastDispatchAt DateTime?
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  recipients EmailBroadcastRecipient[]

  @@index([organizationId, createdAt])
  @@index([organizationId, status])
  @@map("email_broadcasts")
}

/// One ADDRESS in a send. Unique per (broadcast, email): the database, not the
/// code, guarantees nobody gets the same send twice.
model EmailBroadcastRecipient {
  id                String               @id @default(cuid())
  organizationId    String
  broadcastId       String
  /// Normalized: trimmed + lowercased.
  email             String
  name              String?
  companyName       String?
  /// "contact" | "company" | "manual" — where the address came from.
  sources           String[]             @default([])
  /// Loose references (no FK): deleting a contact keeps the send history.
  contactId         String?
  companyId         String?
  /// Fixed batch of 100 assigned at creation; the batch idempotency key uses it.
  batchNo           Int
  status            EmailRecipientStatus @default(QUEUED)
  providerMessageId String?
  error             String?
  sentAt            DateTime?
  updatedAt         DateTime             @updatedAt

  broadcast EmailBroadcast @relation(fields: [broadcastId], references: [id], onDelete: Cascade)

  @@unique([broadcastId, email])
  @@index([broadcastId, status])
  @@index([broadcastId, batchNo])
  @@index([organizationId, sentAt])
  @@index([providerMessageId])
  @@map("email_broadcast_recipients")
}

/// Addresses that must never receive a mass e-mail from this org again
/// (unsubscribed, hard bounce, spam complaint).
model EmailSuppression {
  id             String                 @id @default(cuid())
  organizationId String
  /// Normalized: trimmed + lowercased.
  email          String
  reason         EmailSuppressionReason
  recipientId    String?
  createdAt      DateTime               @default(now())

  @@unique([organizationId, email])
  @@map("email_suppressions")
}
```

- [ ] **Step 4: Gerar a migration e registrar os models no tenantDb**

Run: `npm run db:migrate -- --name email_broadcasts`
Esperado: cria `prisma/migrations/<timestamp>_email_broadcasts/migration.sql` só com `CREATE TYPE`, `CREATE TABLE` e `CREATE INDEX`, sem nenhum `ALTER`/`DROP` em tabela existente. Abra o SQL e confirme.

Em `src/lib/tenant-db.ts`, no fim do array `TENANT_MODELS` (depois de `"WhatsappAgent",`):

```ts
  "EmailBroadcast",
  "EmailBroadcastRecipient",
  "EmailSuppression",
```

Mate e reinicie o `next dev` se estiver rodando.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run typecheck && npm run check:isolation`
Esperado: PASS, terminando em `✅ Tenant isolation: all checks passed.`, com as três linhas novas listadas.

- [ ] **Step 6: Atualizar o guia 03**

Em `docs/guia/03-multi-tenancy.md`:
- Troque "**71 hoje**" pelo novo total. Confira com `node -e "const s=require('fs').readFileSync('src/lib/tenant-db.ts','utf8');const m=s.match(/TENANT_MODELS[\s\S]*?\]\)/)[0];console.log((m.match(/\"[A-Za-z]+\"/g)||[]).length)"`; o esperado é 74.
- Na frase do `check:isolation`, troque "**9 asserções**" pelo total novo (`grep -c "    assert(" scripts/check-isolation.ts`; o esperado é 12).
- Acrescente "envio de e-mail, destinatário e bloqueio de e-mail" à lista do que o script popula.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/tenant-db.ts scripts/check-isolation.ts docs/guia/03-multi-tenancy.md
git commit -m "[E-mail] - Adiciona as tabelas de envio, destinatarios e bloqueio" -m "Tres tabelas novas (migration so aditiva), registradas no TENANT_MODELS e cobertas pelo check:isolation." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Normalização, deduplicação e o `check:email`

**Files:**
- Create: `src/lib/email-broadcast/normalize.ts`
- Create: `src/lib/email-broadcast/audience-core.ts`
- Create: `scripts/check-email-broadcast.ts`
- Modify: `package.json` (scripts)
- Modify: `docs/guia/06-antes-de-commitar.md`

**Interfaces:**
- Produz:
  - `normalizeEmail(raw: string): string`
  - `isValidEmail(normalized: string): boolean`
  - `parseEmailList(text: string): string[]`
  - `type CandidateSource = "contact" | "company" | "manual"`
  - `type Candidate = { email: string; source: CandidateSource; name?: string | null; companyName?: string | null; contactId?: string | null; companyId?: string | null }`
  - `type ResolvedRecipient = { email: string; name: string | null; companyName: string | null; sources: CandidateSource[]; contactId: string | null; companyId: string | null }`
  - `type AudienceStats = { selected: number; invalid: number; duplicates: number; suppressed: number; total: number }`
  - `mergeCandidates(candidates: readonly Candidate[], blocked: ReadonlySet<string>): { recipients: ResolvedRecipient[]; stats: AudienceStats; invalidEmails: string[] }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/check-email-broadcast.ts`:

```ts
/**
 * Self-check for the pure helpers of the mass e-mail module (no DB, no
 * network, no env). Run with `npm run check:email`; exits non-zero on the
 * first failure.
 *
 * Only modules WITHOUT `import "server-only"` can be imported here: outside
 * Next's bundler there is no `server-only` package to resolve.
 */
import assert from "node:assert/strict";
import { isValidEmail, normalizeEmail, parseEmailList } from "../src/lib/email-broadcast/normalize";
import { mergeCandidates, type Candidate } from "../src/lib/email-broadcast/audience-core";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- normalize ---------------------------------------------------------------
check("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Ana.Souza@Exemplo.COM.br "), "ana.souza@exemplo.com.br");
});

check("isValidEmail accepts common addresses and rejects broken ones", () => {
  for (const ok of ["ana.souza@exemplo.com.br", "a+tag@x.io", "joao_lima@sub.dominio.com"]) {
    assert.ok(isValidEmail(ok), ok);
  }
  for (const bad of ["maria@@exemplo", "a@b", "x y@z.com", "@x.com", "sem-arroba", "a@-x.com", ""]) {
    assert.ok(!isValidEmail(bad), bad);
  }
});

check("parseEmailList splits on comma, semicolon, spaces and newlines", () => {
  assert.deepEqual(parseEmailList(" A@X.com, b@y.com;c@z.com\n d@w.com e@v.com "), [
    "a@x.com",
    "b@y.com",
    "c@z.com",
    "d@w.com",
    "e@v.com",
  ]);
});

check("parseEmailList keeps the address inside 'Name <addr>' and drops plain words", () => {
  assert.deepEqual(
    parseEmailList("João Lima <Joao@Exemplo.com.br>; Maria <maria@x.com>, sem-arroba, maria@@exemplo"),
    ["joao@exemplo.com.br", "maria@x.com", "maria@@exemplo"],
  );
});

// --- mergeCandidates -----------------------------------------------------------
check("mergeCandidates dedupes across sources and keeps the arithmetic", () => {
  const candidates: Candidate[] = [
    { email: "Carla@X.com ", source: "contact", name: "Carla", companyName: "Construtora", contactId: "c1" },
    { email: "carla@x.com", source: "company", name: "Construtora", companyName: "Construtora", companyId: "co1" },
    { email: "carla@x.com", source: "manual" },
    { email: "maria@@exemplo", source: "manual" },
    { email: "bloqueado@x.com", source: "manual" },
    { email: "contato@y.com", source: "company", name: "Y Ltda", companyName: "Y Ltda", companyId: "co2" },
  ];
  const { recipients, stats, invalidEmails } = mergeCandidates(candidates, new Set(["bloqueado@x.com"]));
  assert.deepEqual(stats, { selected: 6, invalid: 1, duplicates: 2, suppressed: 1, total: 2 });
  assert.equal(stats.selected - stats.invalid - stats.duplicates - stats.suppressed, stats.total);
  assert.deepEqual(invalidEmails, ["maria@@exemplo"]);
  assert.deepEqual(
    recipients.map((r) => r.email),
    ["carla@x.com", "contato@y.com"],
  );
  assert.deepEqual(recipients[0], {
    email: "carla@x.com",
    name: "Carla",
    companyName: "Construtora",
    sources: ["contact", "company", "manual"],
    contactId: "c1",
    companyId: "co1",
  });
});

check("mergeCandidates lets a contact's name win over an earlier manual entry", () => {
  const { recipients } = mergeCandidates(
    [
      { email: "a@x.com", source: "manual" },
      { email: "A@x.com", source: "contact", name: "Ana", companyName: "ACME", contactId: "c9" },
    ],
    new Set(),
  );
  assert.deepEqual(recipients, [
    { email: "a@x.com", name: "Ana", companyName: "ACME", sources: ["contact", "manual"], contactId: "c9", companyId: null },
  ]);
});

check("mergeCandidates with nothing selected yields zeros", () => {
  assert.deepEqual(mergeCandidates([], new Set()).stats, {
    selected: 0,
    invalid: 0,
    duplicates: 0,
    suppressed: 0,
    total: 0,
  });
});

console.log(`\n✅ email-broadcast: ${passed} checks passed.`);
```

Em `package.json`, dentro de `scripts`, depois de `"check:node"`:

```json
    "check:email": "tsx scripts/check-email-broadcast.ts",
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run check:email`
Esperado: FAIL com `Cannot find module '../src/lib/email-broadcast/normalize'`.

- [ ] **Step 3: Implementar `normalize.ts`**

```ts
/**
 * E-mail helpers shared by the composer (to paint invalid chips red) and the
 * server (to resolve the audience), so both sides agree on what "the same
 * address" and "invalid" mean. Client-safe and free of `server-only` on
 * purpose: scripts/check-email-broadcast.ts imports it directly.
 */

const EMAIL_RE =
  /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** Dedupe key for an address: trimmed and lowercased. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Pragmatic validity check on an already-normalized address. */
export function isValidEmail(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= 254 && EMAIL_RE.test(normalized);
}

/**
 * Split a typed or pasted list into normalized addresses. Separators: comma,
 * semicolon, whitespace and newlines. "Name <addr>" keeps only `addr`. Tokens
 * without "@" are dropped (they're names or search terms, not addresses), so
 * only things that look like an address — valid or not — come back.
 */
export function parseEmailList(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/[,;\r\n]+/)) {
    const angle = chunk.match(/<([^>]*)>/);
    const candidate = angle ? angle[1] : chunk;
    for (const token of candidate.split(/\s+/)) {
      const email = normalizeEmail(token);
      if (email.includes("@")) out.push(email);
    }
  }
  return out;
}
```

- [ ] **Step 4: Implementar `audience-core.ts`**

```ts
import { isValidEmail, normalizeEmail } from "./normalize";

/**
 * The pure core of the audience resolution: every address found in every
 * selected source goes in, one recipient per normalized address comes out.
 * No DB here (src/lib/email-broadcast/audience.ts does the queries) so the
 * dedupe rules are checked by scripts/check-email-broadcast.ts.
 */

export type CandidateSource = "contact" | "company" | "manual";

/** One address as found in one place (a contact, a company or the typed list). */
export type Candidate = {
  email: string;
  source: CandidateSource;
  name?: string | null;
  companyName?: string | null;
  contactId?: string | null;
  companyId?: string | null;
};

export type ResolvedRecipient = {
  email: string;
  name: string | null;
  companyName: string | null;
  sources: CandidateSource[];
  contactId: string | null;
  companyId: string | null;
};

/** Invariant: selected − invalid − duplicates − suppressed = total. */
export type AudienceStats = {
  selected: number;
  invalid: number;
  duplicates: number;
  suppressed: number;
  total: number;
};

/** Which source names the recipient ({{nome}}/{{empresa}}) when an address repeats. */
const PRIORITY: Record<CandidateSource, number> = { contact: 0, company: 1, manual: 2 };

export function mergeCandidates(
  candidates: readonly Candidate[],
  blocked: ReadonlySet<string>,
): { recipients: ResolvedRecipient[]; stats: AudienceStats; invalidEmails: string[] } {
  const byEmail = new Map<string, { recipient: ResolvedRecipient; rank: number }>();
  const invalidEmails: string[] = [];
  let valid = 0;

  for (const c of candidates) {
    const email = normalizeEmail(c.email);
    if (!isValidEmail(email)) {
      invalidEmails.push(email);
      continue;
    }
    valid++;
    const rank = PRIORITY[c.source];
    const seen = byEmail.get(email);
    if (!seen) {
      byEmail.set(email, {
        rank,
        recipient: {
          email,
          name: c.name ?? null,
          companyName: c.companyName ?? null,
          sources: [c.source],
          contactId: c.contactId ?? null,
          companyId: c.companyId ?? null,
        },
      });
      continue;
    }
    const r = seen.recipient;
    if (!r.sources.includes(c.source)) r.sources.push(c.source);
    if (!r.contactId && c.contactId) r.contactId = c.contactId;
    if (!r.companyId && c.companyId) r.companyId = c.companyId;
    if (rank < seen.rank) {
      seen.rank = rank;
      r.name = c.name ?? r.name;
      r.companyName = c.companyName ?? r.companyName;
    } else {
      if (!r.name && c.name) r.name = c.name;
      if (!r.companyName && c.companyName) r.companyName = c.companyName;
    }
  }

  const unique = [...byEmail.values()].map((v) => v.recipient);
  for (const r of unique) r.sources.sort((a, b) => PRIORITY[a] - PRIORITY[b]);
  // Deterministic order: batch numbers (and so the batch idempotency keys)
  // must not depend on query order.
  const recipients = unique
    .filter((r) => !blocked.has(r.email))
    .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));

  return {
    recipients,
    invalidEmails,
    stats: {
      selected: candidates.length,
      invalid: invalidEmails.length,
      duplicates: valid - unique.length,
      suppressed: unique.length - recipients.length,
      total: recipients.length,
    },
  };
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run check:email`
Esperado: PASS, com 7 linhas `✓` e `✅ email-broadcast: 7 checks passed.`

- [ ] **Step 6: Registrar no guia 06**

Em `docs/guia/06-antes-de-commitar.md`, depois da tabela das cinco checagens, um parágrafo curto:

```markdown
**Checagem de módulo (fora das cinco):** `npm run check:email` roda as asserções das funções puras do
submenu E-mail (normalização, deduplicação, renderização, assinatura Svix, transições de status). Não
usa banco nem rede. Rode sempre que mexer em `src/lib/email-broadcast/`.
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/email-broadcast/normalize.ts src/lib/email-broadcast/audience-core.ts scripts/check-email-broadcast.ts package.json docs/guia/06-antes-de-commitar.md
git commit -m "[E-mail] - Adiciona normalizacao e deduplicacao de destinatarios" -m "Funcoes puras verificadas pelo novo npm run check:email." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Renderização do e-mail

**Files:**
- Create: `src/lib/email-broadcast/render.ts`
- Create: `src/lib/email-broadcast/compose.ts`
- Modify: `scripts/check-email-broadcast.ts`

**Interfaces:**
- Consome: nada das tasks anteriores. Usa `sanitizeHtml` de `@/lib/proposals/sanitize`, que **não muda**.
- Produz:
  - `type TemplateVars = { nome: string; empresa: string }`
  - `escapeHtml(value: string): string`
  - `fillHtmlVars(html: string, vars: TemplateVars): string`
  - `fillTextVars(text: string, vars: TemplateVars): string`
  - `formatFrom(fromName: string | null | undefined, fromEmail: string): string`
  - `htmlToText(html: string): string`
  - `buildEmailDocument(input: { bodyHtml: string; orgName: string; unsubscribeUrl: string }): string`
  - `type ComposedEmail = { subject: string; html: string; text: string }`
  - `composeEmail(input: { subject: string; bodyHtml: string; vars: TemplateVars; orgName: string; unsubscribeUrl: string }): ComposedEmail` (server-only)

- [ ] **Step 1: Escrever o teste que falha**

No topo de `scripts/check-email-broadcast.ts`, junto dos imports:

```ts
import { buildEmailDocument, fillHtmlVars, fillTextVars, formatFrom, htmlToText } from "../src/lib/email-broadcast/render";
```

E antes do `console.log` final:

```ts
// --- render --------------------------------------------------------------------
check("fillHtmlVars escapes values and accepts spacing/case variations", () => {
  assert.equal(
    fillHtmlVars("<p>Olá {{ nome }}, {{EMPRESA}}</p>", { nome: "<script>x</script>", empresa: "A&B" }),
    "<p>Olá &lt;script&gt;x&lt;/script&gt;, A&amp;B</p>",
  );
});

check("fillTextVars fills the subject and strips line breaks (header injection)", () => {
  assert.equal(fillTextVars("{{nome}}, oi\r\nBcc: x@y.com", { nome: "Ana", empresa: "" }), "Ana, oi Bcc: x@y.com");
});

check("formatFrom builds 'Name <addr>' and drops header-breaking characters", () => {
  assert.equal(formatFrom('Empresa "Exemplo" <x>', "contato@ex.com"), "Empresa Exemplo x <contato@ex.com>");
  assert.equal(formatFrom("  ", "contato@ex.com"), "contato@ex.com");
  assert.equal(formatFrom(null, "contato@ex.com"), "contato@ex.com");
});

check("htmlToText keeps paragraphs, bullets and link targets", () => {
  assert.equal(
    htmlToText('<p>Olá <strong>Ana</strong></p><ul><li>Um</li><li>Dois</li></ul><p><a href="https://x.com">Ver</a></p>'),
    "Olá Ana\n• Um\n• Dois\nVer (https://x.com)",
  );
});

check("buildEmailDocument wraps the body and adds the escaped footer link", () => {
  const doc = buildEmailDocument({
    bodyHtml: "<p>Oi</p>",
    orgName: "A & B Ltda",
    unsubscribeUrl: "https://site.test/email-unsubscribe/r1/abc",
  });
  assert.ok(doc.includes("<p>Oi</p>"));
  assert.ok(doc.includes("A &amp; B Ltda"));
  assert.ok(doc.includes('href="https://site.test/email-unsubscribe/r1/abc"'));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run check:email`
Esperado: FAIL com `Cannot find module '../src/lib/email-broadcast/render'`.

- [ ] **Step 3: Implementar `render.ts`**

```ts
/**
 * Pure rendering for the mass e-mail: variable filling, the e-mail document
 * around the editor HTML and the plain-text alternative. Free of
 * `server-only` so scripts/check-email-broadcast.ts can run it; compose.ts
 * sanitizes the editor HTML BEFORE it reaches these functions.
 */

export type TemplateVars = { nome: string; empresa: string };

const VAR_RE = /\{\{\s*(nome|empresa)\s*\}\}/gi;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function lookup(vars: TemplateVars, key: string): string {
  return key.toLowerCase() === "empresa" ? vars.empresa : vars.nome;
}

/** Fill {{nome}}/{{empresa}} in (sanitized) HTML; values are HTML-escaped. */
export function fillHtmlVars(html: string, vars: TemplateVars): string {
  return html.replace(VAR_RE, (_match, key: string) => escapeHtml(lookup(vars, key)));
}

/** Fill variables in a plain-text header (the subject); line breaks are
 * removed so a value can't inject extra headers. */
export function fillTextVars(text: string, vars: TemplateVars): string {
  return text
    .replace(VAR_RE, (_match, key: string) => lookup(vars, key))
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/** "Name <addr>", or just the address when there's no usable name. */
export function formatFrom(fromName: string | null | undefined, fromEmail: string): string {
  const name = (fromName ?? "").replace(/[<>"\r\n]/g, "").trim();
  return name ? `${name} <${fromEmail}>` : fromEmail;
}

/** Plain-text alternative of the body (improves deliverability). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The full HTML e-mail: 600px card, inline styles, and the mandatory footer
 * (sender org + unsubscribe link, LGPD). Footer copy is pt-BR in v1. */
export function buildEmailDocument(input: {
  bodyHtml: string;
  orgName: string;
  unsubscribeUrl: string;
}): string {
  const org = escapeHtml(input.orgName);
  const url = escapeHtml(input.unsubscribeUrl);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  .content p { margin: 0 0 14px; }
  .content h2 { font-size: 20px; margin: 0 0 12px; }
  .content h3 { font-size: 17px; margin: 0 0 10px; }
  .content ul, .content ol { margin: 0 0 14px; padding-left: 22px; }
  .content a { color: #1d4ed8; }
</style>
</head>
<body style="margin:0;padding:0;background:#f5f7fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;">
<tr><td class="content" style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0a0a0a;">${input.bodyHtml}</td></tr>
</table>
<p style="max-width:600px;margin:16px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#55657a;">Você recebeu este e-mail de ${org}. <a href="${url}" style="color:#55657a;">Não quero mais receber</a></p>
</td></tr>
</table>
</body>
</html>`;
}
```

- [ ] **Step 4: Implementar `compose.ts`**

```ts
import "server-only";
import { sanitizeHtml } from "@/lib/proposals/sanitize";
import {
  buildEmailDocument,
  fillHtmlVars,
  fillTextVars,
  htmlToText,
  type TemplateVars,
} from "./render";

export type ComposedEmail = { subject: string; html: string; text: string };

/**
 * Final subject/HTML/text for one recipient. The editor HTML goes through the
 * Proposals allowlist sanitizer first (reused, not modified), then the
 * variables are filled with escaped values.
 */
export function composeEmail(input: {
  subject: string;
  bodyHtml: string;
  vars: TemplateVars;
  orgName: string;
  unsubscribeUrl: string;
}): ComposedEmail {
  const body = fillHtmlVars(sanitizeHtml(input.bodyHtml), input.vars);
  return {
    subject: fillTextVars(input.subject, input.vars),
    html: buildEmailDocument({ bodyHtml: body, orgName: input.orgName, unsubscribeUrl: input.unsubscribeUrl }),
    text: `${htmlToText(body)}\n\n--\nVocê recebeu este e-mail de ${input.orgName}. Para não receber mais: ${input.unsubscribeUrl}`,
  };
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run check:email && npm run typecheck`
Esperado: PASS, `✅ email-broadcast: 12 checks passed.`

- [ ] **Step 6: Commit**

```bash
git add src/lib/email-broadcast/render.ts src/lib/email-broadcast/compose.ts scripts/check-email-broadcast.ts
git commit -m "[E-mail] - Adiciona a renderizacao do e-mail com rodape de descadastro" -m "Variaveis escapadas, assunto sem quebra de linha, versao texto e HTML sanitizado com o allowlist das Propostas." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Assinaturas (descadastro e Svix) e transições de status

**Files:**
- Create: `src/lib/email-broadcast/signing.ts`
- Create: `src/lib/email-broadcast/webhook.ts`
- Create: `src/lib/email-broadcast/unsubscribe.ts`
- Modify: `scripts/check-email-broadcast.ts`

**Interfaces:**
- Produz:
  - `hmacHex(secret: string, data: string): string`
  - `safeEqual(a: string, b: string): boolean`
  - `RESEND_WEBHOOK_EVENTS`: `readonly ["email.delivered", "email.bounced", "email.complained", "email.failed"]`
  - `type ResendEventType`, `type RecipientStatusName`
  - `type ResendEvent = { type: ResendEventType; emailId: string; bouncePermanent: boolean; message: string | null }`
  - `signSvix(secret, id, timestamp, body): string`
  - `verifySvixSignature(input): boolean`
  - `parseResendEvent(payload: unknown): ResendEvent | null`
  - `TRANSITIONS: Record<ResendEventType, { to: RecipientStatusName; from: RecipientStatusName[] }>`
  - `nextRecipientStatus(current, type): RecipientStatusName | null`
  - `suppressionFor(event): "BOUNCED" | "COMPLAINED" | null`
  - Em `unsubscribe.ts` (server-only): `emailUnsubscribeSig(recipientId)`, `verifyEmailUnsubscribeSig(recipientId, sig)`, `emailUnsubscribePageUrl(recipientId)`, `emailUnsubscribeOneClickUrl(recipientId)`

- [ ] **Step 1: Escrever o teste que falha**

Imports no topo de `scripts/check-email-broadcast.ts`:

```ts
import { hmacHex, safeEqual } from "../src/lib/email-broadcast/signing";
import {
  nextRecipientStatus,
  parseResendEvent,
  signSvix,
  suppressionFor,
  verifySvixSignature,
} from "../src/lib/email-broadcast/webhook";
```

Antes do `console.log` final:

```ts
// --- signing / webhook -----------------------------------------------------------
const SVIX_SECRET = "whsec_" + Buffer.from("check-email-broadcast-secret").toString("base64");
const SVIX_BODY = '{"type":"email.delivered","data":{"email_id":"e1"}}';

check("hmacHex is stable and safeEqual compares exactly", () => {
  const a = hmacHex("k", "email-broadcast-unsub:r1");
  assert.equal(a, hmacHex("k", "email-broadcast-unsub:r1"));
  assert.notEqual(a, hmacHex("k", "email-broadcast-unsub:r2"));
  assert.ok(safeEqual(a, a));
  assert.ok(!safeEqual(a, a.slice(1)));
});

check("verifySvixSignature accepts a valid signature among several", () => {
  const sig = signSvix(SVIX_SECRET, "msg_1", "1700000000", SVIX_BODY);
  assert.ok(
    verifySvixSignature({
      secret: SVIX_SECRET,
      id: "msg_1",
      timestamp: "1700000000",
      signature: `v1,AAAA ${sig}`,
      body: SVIX_BODY,
      nowSeconds: 1700000100,
    }),
  );
});

check("verifySvixSignature rejects tampered body, stale timestamp and missing headers", () => {
  const sig = signSvix(SVIX_SECRET, "msg_1", "1700000000", SVIX_BODY);
  const base = {
    secret: SVIX_SECRET,
    id: "msg_1",
    timestamp: "1700000000",
    signature: sig,
    body: SVIX_BODY,
    nowSeconds: 1700000100,
  };
  assert.ok(verifySvixSignature(base));
  assert.ok(!verifySvixSignature({ ...base, body: SVIX_BODY + " " }));
  assert.ok(!verifySvixSignature({ ...base, nowSeconds: 1700000000 + 301 }));
  assert.ok(!verifySvixSignature({ ...base, signature: null }));
  assert.ok(!verifySvixSignature({ ...base, id: null }));
});

check("parseResendEvent reads bounces and ignores unknown or incomplete events", () => {
  assert.deepEqual(
    parseResendEvent({
      type: "email.bounced",
      data: { email_id: "e1", bounce: { type: "Permanent", message: "Caixa inexistente" } },
    }),
    { type: "email.bounced", emailId: "e1", bouncePermanent: true, message: "Caixa inexistente" },
  );
  assert.equal(parseResendEvent({ type: "email.opened", data: { email_id: "e1" } }), null);
  assert.equal(parseResendEvent({ type: "email.delivered", data: {} }), null);
  assert.equal(parseResendEvent("lixo"), null);
});

check("status transitions only move forward", () => {
  assert.equal(nextRecipientStatus("SENT", "email.delivered"), "DELIVERED");
  assert.equal(nextRecipientStatus("BOUNCED", "email.delivered"), null);
  assert.equal(nextRecipientStatus("DELIVERED", "email.bounced"), "BOUNCED");
  assert.equal(nextRecipientStatus("FAILED", "email.complained"), null);
  assert.equal(nextRecipientStatus("QUEUED", "email.failed"), "FAILED");
  assert.equal(nextRecipientStatus("DELIVERED", "email.failed"), null);
});

check("only permanent bounces and complaints suppress the address", () => {
  const ev = (type: "email.bounced" | "email.complained" | "email.delivered", bouncePermanent: boolean) => ({
    type,
    emailId: "e",
    bouncePermanent,
    message: null,
  });
  assert.equal(suppressionFor(ev("email.bounced", true)), "BOUNCED");
  assert.equal(suppressionFor(ev("email.bounced", false)), null);
  assert.equal(suppressionFor(ev("email.complained", false)), "COMPLAINED");
  assert.equal(suppressionFor(ev("email.delivered", false)), null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run check:email`
Esperado: FAIL com `Cannot find module '../src/lib/email-broadcast/signing'`.

- [ ] **Step 3: Implementar `signing.ts`**

```ts
import { createHmac, timingSafeEqual } from "crypto";

/** HMAC-SHA256 as hex. Pure (no env) so the self-check can run it. */
export function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Constant-time string compare; false on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
```

- [ ] **Step 4: Implementar `webhook.ts`**

```ts
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Pure side of the Resend delivery webhook: Svix signature check, payload
 * parsing and the forward-only status transitions. The route
 * (src/app/api/webhooks/resend/[connectionId]/route.ts) does the DB writes.
 */

export const RESEND_WEBHOOK_EVENTS = [
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
] as const;

export type ResendEventType = (typeof RESEND_WEBHOOK_EVENTS)[number];

export type RecipientStatusName = "QUEUED" | "SENT" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "FAILED";

export type ResendEvent = {
  type: ResendEventType;
  emailId: string;
  bouncePermanent: boolean;
  message: string | null;
};

function secretKey(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(raw, "base64");
}

/** "v1,<base64 HMAC-SHA256 of `${id}.${timestamp}.${body}`>" — the Svix scheme Resend uses. */
export function signSvix(secret: string, id: string, timestamp: string, body: string): string {
  return "v1," + createHmac("sha256", secretKey(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
}

/**
 * Verify the `svix-*` headers against the raw body. The signature header may
 * carry several space-separated "v1,<sig>" entries (key rotation); any match
 * passes. Timestamps older/newer than the tolerance are rejected (replay).
 */
export function verifySvixSignature(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (input.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(signSvix(input.secret, id, timestamp, input.body));
  return signature.split(" ").some((candidate) => {
    const got = Buffer.from(candidate.trim());
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** The parts of a Resend event we act on, or null for anything else. */
export function parseResendEvent(payload: unknown): ResendEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    type?: unknown;
    data?: { email_id?: unknown; bounce?: { type?: unknown; message?: unknown }; failed?: { reason?: unknown } };
  };
  const type = String(p.type ?? "");
  if (!(RESEND_WEBHOOK_EVENTS as readonly string[]).includes(type)) return null;
  const emailId = typeof p.data?.email_id === "string" ? p.data.email_id : "";
  if (!emailId) return null;
  const bounceMessage = typeof p.data?.bounce?.message === "string" ? p.data.bounce.message : null;
  const failedReason = typeof p.data?.failed?.reason === "string" ? p.data.failed.reason : null;
  return {
    type: type as ResendEventType,
    emailId,
    bouncePermanent: p.data?.bounce?.type === "Permanent",
    message: bounceMessage ?? failedReason,
  };
}

/** Target status per event and the statuses it may move from (forward-only). */
export const TRANSITIONS: Record<ResendEventType, { to: RecipientStatusName; from: RecipientStatusName[] }> = {
  "email.delivered": { to: "DELIVERED", from: ["SENT"] },
  "email.bounced": { to: "BOUNCED", from: ["SENT", "DELIVERED"] },
  "email.complained": { to: "COMPLAINED", from: ["QUEUED", "SENT", "DELIVERED", "BOUNCED"] },
  "email.failed": { to: "FAILED", from: ["QUEUED", "SENT"] },
};

export function nextRecipientStatus(
  current: RecipientStatusName,
  type: ResendEventType,
): RecipientStatusName | null {
  const t = TRANSITIONS[type];
  return t.from.includes(current) ? t.to : null;
}

/** Only hard bounces and spam complaints block the address for future sends. */
export function suppressionFor(event: ResendEvent): "BOUNCED" | "COMPLAINED" | null {
  if (event.type === "email.complained") return "COMPLAINED";
  if (event.type === "email.bounced" && event.bouncePermanent) return "BOUNCED";
  return null;
}
```

- [ ] **Step 5: Implementar `unsubscribe.ts`**

```ts
import "server-only";
import { env } from "@/lib/env";
import { hmacHex, safeEqual } from "./signing";

/**
 * Unsubscribe links of the mass e-mail. Signed per RECIPIENT row (which
 * carries the org and the address), domain-separated from the Campaigns
 * opt-out HMAC in src/lib/unsubscribe.ts — which stays untouched.
 */
const SIG_PREFIX = "email-broadcast-unsub:";

export function emailUnsubscribeSig(recipientId: string): string {
  return hmacHex(env.SESSION_SECRET, SIG_PREFIX + recipientId);
}

export function verifyEmailUnsubscribeSig(recipientId: string, sig: string): boolean {
  return safeEqual(emailUnsubscribeSig(recipientId), sig);
}

function siteBase(): string {
  return env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
}

/** Footer link: a page with a confirm button (a GET alone never unsubscribes). */
export function emailUnsubscribePageUrl(recipientId: string): string {
  return `${siteBase()}/email-unsubscribe/${recipientId}/${emailUnsubscribeSig(recipientId)}`;
}

/** RFC 8058 one-click target for the List-Unsubscribe header (POST only). */
export function emailUnsubscribeOneClickUrl(recipientId: string): string {
  return `${siteBase()}/api/email/unsubscribe/${recipientId}/${emailUnsubscribeSig(recipientId)}`;
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npm run check:email && npm run typecheck`
Esperado: PASS, `✅ email-broadcast: 18 checks passed.`

- [ ] **Step 7: Commit**

```bash
git add src/lib/email-broadcast/signing.ts src/lib/email-broadcast/webhook.ts src/lib/email-broadcast/unsubscribe.ts scripts/check-email-broadcast.ts
git commit -m "[E-mail] - Adiciona assinaturas de descadastro e do webhook do Resend" -m "HMAC por destinatario, verificacao Svix sem dependencia nova e transicoes de status so para frente." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cliente do Resend e conexão do cliente

**Files:**
- Create: `src/lib/email-broadcast/resend.ts`
- Create: `src/lib/email-broadcast/connection.ts`

**Interfaces:**
- Consome: `RESEND_WEBHOOK_EVENTS` (Task 4).
- Produz:
  - `type ResendEmail = { from: string; to: string[]; subject: string; html: string; text: string; reply_to?: string; headers?: Record<string, string> }`
  - `type ResendCallResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string; retryAfter: number | null }`
  - `sendBatch(apiKey, emails: ResendEmail[], idempotencyKey: string): Promise<ResendCallResult<{ data?: { id: string }[] }>>`
  - `sendOne(apiKey, email: ResendEmail, idempotencyKey?: string): Promise<ResendCallResult<{ id?: string }>>`
  - `createWebhook(apiKey, endpoint, events)` e `deleteWebhook(apiKey, id)`
  - `type ResendConnection = { id: string; organizationId: string; apiKey: string; fromEmail: string; meta: Record<string, unknown> }`
  - `getResendConnection(organizationId): Promise<ResendConnection | null>`
  - `webhookEndpoint(connectionId): string | null`
  - `deliveryTrackingActive(conn): boolean`
  - `webhookSecret(meta: unknown): string | null`
  - `ensureResendWebhook(conn): Promise<boolean>`

- [ ] **Step 1: Implementar `resend.ts`**

```ts
import "server-only";

/**
 * Minimal Resend REST client for the mass e-mail, always with the CLIENT's
 * key. Separate from src/lib/email/send.ts (platform transactional mail) and
 * from the Campaigns adapter (src/lib/integrations/channels/email.ts), both
 * untouched. Never throws: network errors come back as status 0.
 */

const API = "https://api.resend.com";

export type ResendEmail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  headers?: Record<string, string>;
};

export type ResendCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; retryAfter: number | null };

async function call<T>(
  apiKey: string,
  path: string,
  init: { method: "POST" | "DELETE"; body?: unknown; idempotencyKey?: string },
): Promise<ResendCallResult<T>> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      return {
        ok: false,
        status: res.status,
        message: typeof json.message === "string" ? json.message : `Resend ${res.status}`,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "Falha de rede", retryAfter: null };
  }
}

/** Up to 100 e-mails; `data[i]` answers `emails[i]`. The key dedupes retries for 24h. */
export function sendBatch(apiKey: string, emails: ResendEmail[], idempotencyKey: string) {
  return call<{ data?: { id: string }[] }>(apiKey, "/emails/batch", {
    method: "POST",
    body: emails,
    idempotencyKey,
  });
}

export function sendOne(apiKey: string, email: ResendEmail, idempotencyKey?: string) {
  return call<{ id?: string }>(apiKey, "/emails", { method: "POST", body: email, idempotencyKey });
}

export function createWebhook(apiKey: string, endpoint: string, events: readonly string[]) {
  return call<{ id?: string; signing_secret?: string }>(apiKey, "/webhooks", {
    method: "POST",
    body: { endpoint, events },
  });
}

export function deleteWebhook(apiKey: string, id: string) {
  return call<unknown>(apiKey, `/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}
```

- [ ] **Step 2: Implementar `connection.ts`**

```ts
import "server-only";
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";
import { createWebhook, deleteWebhook } from "./resend";
import { RESEND_WEBHOOK_EVENTS } from "./webhook";

/**
 * The client's own Resend account (Conexões → RESEND, fields apiKey +
 * fromEmail). The mass e-mail never falls back to the platform key.
 *
 * Raw Prisma with an explicit organizationId: this runs from the dispatcher
 * and the webhook (system context) as well as from actions, which pass
 * ctx.organizationId — every query filters by it.
 */

export type ResendConnection = {
  id: string;
  organizationId: string;
  apiKey: string;
  fromEmail: string;
  meta: Record<string, unknown>;
};

/** What we keep in IntegrationConnection.meta.emailWebhook. */
type EmailWebhookMeta = { id: string; secretEnc: string; keyHash: string; endpoint: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Short fingerprint of the API key: a changed key means re-registering. */
function keyHash(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

function readWebhookMeta(meta: unknown): EmailWebhookMeta | null {
  const w = asRecord(asRecord(meta).emailWebhook);
  const { id, secretEnc, keyHash: kh, endpoint } = w;
  return typeof id === "string" && typeof secretEnc === "string" && typeof kh === "string" && typeof endpoint === "string"
    ? { id, secretEnc, keyHash: kh, endpoint }
    : null;
}

/** The org's newest RESEND connection with usable credentials, or null. */
export async function getResendConnection(organizationId: string): Promise<ResendConnection | null> {
  const conn = await prisma.integrationConnection.findFirst({
    where: { organizationId, provider: "RESEND" },
    orderBy: { createdAt: "desc" },
    select: { id: true, organizationId: true, credentialsEnc: true, meta: true },
  });
  if (!conn) return null;
  try {
    const creds = decryptCredentials(conn.credentialsEnc);
    const apiKey = creds.apiKey?.trim();
    const fromEmail = creds.fromEmail?.trim();
    if (!apiKey || !fromEmail) return null;
    return { id: conn.id, organizationId: conn.organizationId, apiKey, fromEmail, meta: asRecord(conn.meta) };
  } catch {
    return null;
  }
}

/** Public URL Resend posts to, or null when the site can't receive webhooks
 * (http / localhost in dev — use an ngrok NEXT_PUBLIC_SITE_URL to test). */
export function webhookEndpoint(connectionId: string): string | null {
  let url: URL;
  try {
    url = new URL(env.NEXT_PUBLIC_SITE_URL);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
  return `${url.origin}/api/webhooks/resend/${connectionId}`;
}

/** True when the stored webhook matches the current key and endpoint. */
export function deliveryTrackingActive(conn: ResendConnection): boolean {
  const w = readWebhookMeta(conn.meta);
  return Boolean(w && w.keyHash === keyHash(conn.apiKey) && w.endpoint === webhookEndpoint(conn.id));
}

/** The Svix signing secret stored for a connection, decrypted. */
export function webhookSecret(meta: unknown): string | null {
  const w = readWebhookMeta(meta);
  if (!w) return null;
  try {
    return decryptCredentials(w.secretEnc).secret ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort: make the client's Resend account post delivery events to us.
 * Returns false (and sending still works, statuses just stop at SENT) when the
 * site has no public https URL or the key can't manage webhooks.
 */
export async function ensureResendWebhook(conn: ResendConnection): Promise<boolean> {
  if (deliveryTrackingActive(conn)) return true;
  const endpoint = webhookEndpoint(conn.id);
  if (!endpoint) return false;

  const created = await createWebhook(conn.apiKey, endpoint, RESEND_WEBHOOK_EVENTS);
  if (!created.ok || !created.data.id || !created.data.signing_secret) {
    console.warn("[email] Resend webhook not registered:", created.ok ? "response without id/secret" : created.message);
    return false;
  }

  const previous = readWebhookMeta(conn.meta);
  if (previous && previous.id !== created.data.id) {
    await deleteWebhook(conn.apiKey, previous.id); // best-effort; another account's id just 404s
  }

  const emailWebhook: EmailWebhookMeta = {
    id: created.data.id,
    secretEnc: encryptCredentials({ secret: created.data.signing_secret }),
    keyHash: keyHash(conn.apiKey),
    endpoint,
  };
  const meta = { ...conn.meta, emailWebhook };
  await prisma.integrationConnection.updateMany({
    where: { id: conn.id, organizationId: conn.organizationId },
    data: { meta: meta as Prisma.InputJsonValue },
  });
  conn.meta = meta;
  return true;
}
```

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run lint`
Esperado: PASS. As chamadas reais ao Resend são exercitadas no E2E da Task 10 (teste e envio) e da Task 13 (webhook).

- [ ] **Step 4: Commit**

```bash
git add src/lib/email-broadcast/resend.ts src/lib/email-broadcast/connection.ts
git commit -m "[E-mail] - Adiciona o cliente do Resend e a conexao do cliente" -m "Batch com Idempotency-Key, envio individual e registro automatico do webhook de entrega na conta do cliente." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Validações, tipos, DAL, resolução da audiência e cota

**Files:**
- Create: `src/lib/validations/email-broadcast.ts`
- Create: `src/lib/email-broadcast/types.ts`
- Create: `src/lib/email-broadcast/audience.ts`
- Create: `src/lib/queries/email-broadcasts.ts`
- Modify: `src/config/limits.ts`
- Modify: `docs/guia/04-modulos-e-permissoes.md` (seção de limites)

**Interfaces:**
- Consome: `mergeCandidates`, `AudienceStats`, `CandidateSource` e `normalizeEmail`/`isValidEmail` (Task 2); `getResendConnection` e `deliveryTrackingActive` (Task 5).
- Produz:
  - `audienceSelectionSchema`, `type AudienceSelection`, `EMPTY_AUDIENCE`
  - `broadcastDraftSchema`, `type BroadcastDraftInput` (= `z.input`)
  - `readAudience(value: unknown): AudienceSelection`
  - `readStats(value: unknown): AudienceStats`
  - `type PickedTarget = { kind: "contact" | "company"; id: string; name: string; email: string }`
  - `type CountedOption = { id: string; name: string; count: number }`
  - `type ComposerOptions = { contactCount: number; tags: { name: string; count: number }[]; contactFolders: CountedOption[]; companyCount: number; companyFolders: CountedOption[] }`
  - `type AudiencePreview = { stats: AudienceStats; invalidEmails: string[]; sample: { email: string; name: string | null; sources: CandidateSource[] }[] }`
  - `type ComposerDraft = { id: string | null; subject: string; html: string; fromName: string; replyTo: string; audience: AudienceSelection; picked: PickedTarget[] }`
  - `resolveAudience(organizationId, selection): Promise<ReturnType<typeof mergeCandidates>>`
  - DAL:
    - `monthStart(now?)`, `countEmailsSentThisMonth(orgId)`
    - `listEmailBroadcasts(orgId)`
    - `getEmailBroadcast(orgId, id)`
    - `type ReportFilter = "all" | "queued" | "sent" | "delivered" | "problems"`
    - `getEmailBroadcastReport(orgId, id, filter)`
    - `emailComposerOptions(orgId)`, `emailComposerData(orgId)`
    - `searchEmailTargets(orgId, q)`, `pickedTargets(orgId, contactIds, companyIds)`
  - `LIMITS.emailBroadcastQuotaPerMonth`

- [ ] **Step 1: Cota em `src/config/limits.ts`**

No tipo, depois de `dispatchQuotaPerMonth: number;`:

```ts
  /** Mass e-mails (submenu E-mail) per month — separate from Campaigns. */
  emailBroadcastQuotaPerMonth: number;
```

No objeto, depois de `dispatchQuotaPerMonth: 50_000,`:

```ts
  emailBroadcastQuotaPerMonth: 50_000,
```

- [ ] **Step 2: `src/lib/validations/email-broadcast.ts`**

```ts
import { z } from "zod";
import { isValidEmail, normalizeEmail } from "@/lib/email-broadcast/normalize";
import type { AudienceStats } from "@/lib/email-broadcast/audience-core";

const id = z.string().min(1).max(64);

/** Who receives a send: the UNION of every criterion. Stored as JSON on the draft. */
export const audienceSelectionSchema = z.object({
  allContacts: z.boolean().default(false),
  contactTags: z.array(z.string().min(1).max(100)).max(200).default([]),
  contactFolderIds: z.array(id).max(200).default([]),
  contactIds: z.array(id).max(1000).default([]),
  allCompanies: z.boolean().default(false),
  companyFolderIds: z.array(id).max(200).default([]),
  companyIds: z.array(id).max(1000).default([]),
  emails: z.array(z.string().max(320)).max(5000).default([]),
});

export type AudienceSelection = z.infer<typeof audienceSelectionSchema>;

export const EMPTY_AUDIENCE: AudienceSelection = {
  allContacts: false,
  contactTags: [],
  contactFolderIds: [],
  contactIds: [],
  allCompanies: false,
  companyFolderIds: [],
  companyIds: [],
  emails: [],
};

export const broadcastDraftSchema = z.object({
  subject: z.string().trim().max(200),
  html: z.string().max(200_000),
  fromName: z.string().trim().max(100),
  replyTo: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || isValidEmail(normalizeEmail(v)), "invalid_reply_to"),
  audience: audienceSelectionSchema,
});

export type BroadcastDraftInput = z.input<typeof broadcastDraftSchema>;

/** Stored `audience` JSON back into a selection (a broken row falls back to empty). */
export function readAudience(value: unknown): AudienceSelection {
  const parsed = audienceSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_AUDIENCE;
}

/** Stored `stats` JSON back into numbers (missing → 0). */
export function readStats(value: unknown): AudienceStats {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : 0);
  return { selected: n("selected"), invalid: n("invalid"), duplicates: n("duplicates"), suppressed: n("suppressed"), total: n("total") };
}
```

- [ ] **Step 3: `src/lib/email-broadcast/types.ts`**

```ts
import type { AudienceStats, CandidateSource } from "./audience-core";
import type { AudienceSelection } from "@/lib/validations/email-broadcast";

/** Shapes shared by the E-mail pages, actions and client components. Types only. */

export type PickedTarget = { kind: "contact" | "company"; id: string; name: string; email: string };

export type CountedOption = { id: string; name: string; count: number };

export type ComposerOptions = {
  contactCount: number;
  tags: { name: string; count: number }[];
  contactFolders: CountedOption[];
  companyCount: number;
  companyFolders: CountedOption[];
};

export type AudiencePreview = {
  stats: AudienceStats;
  invalidEmails: string[];
  sample: { email: string; name: string | null; sources: CandidateSource[] }[];
};

export type ComposerDraft = {
  id: string | null;
  subject: string;
  html: string;
  fromName: string;
  replyTo: string;
  audience: AudienceSelection;
  picked: PickedTarget[];
};
```

- [ ] **Step 4: `src/lib/email-broadcast/audience.ts`**

```ts
import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { normalizeEmail } from "./normalize";
import { mergeCandidates, type Candidate } from "./audience-core";
import type { AudienceSelection } from "@/lib/validations/email-broadcast";

/** Only rows whose e-mail at least looks like an address (skips null and ""). */
const HAS_EMAIL = { contains: "@" } as const;

/**
 * Resolve a selection into unique, sendable recipients. Contacts and companies
 * match ANY selected criterion (union). Blocked = the org's EmailSuppression
 * plus the e-mails of contacts with optedOut = true (read-only: this module
 * never writes Contact.optedOut).
 */
export async function resolveAudience(organizationId: string, sel: AudienceSelection) {
  const db = tenantDb(organizationId);

  const contactOr: Prisma.ContactWhereInput[] = [];
  if (sel.contactTags.length) contactOr.push({ tags: { hasSome: sel.contactTags } });
  if (sel.contactFolderIds.length) contactOr.push({ folderId: { in: sel.contactFolderIds } });
  if (sel.contactIds.length) contactOr.push({ id: { in: sel.contactIds } });
  const wantContacts = sel.allContacts || contactOr.length > 0;

  const companyOr: Prisma.CompanyWhereInput[] = [];
  if (sel.companyFolderIds.length) companyOr.push({ folderId: { in: sel.companyFolderIds } });
  if (sel.companyIds.length) companyOr.push({ id: { in: sel.companyIds } });
  const wantCompanies = sel.allCompanies || companyOr.length > 0;

  const [contacts, companies, suppressed, optedOut] = await Promise.all([
    wantContacts
      ? db.contact.findMany({
          where: sel.allContacts ? { email: HAS_EMAIL } : { email: HAS_EMAIL, OR: contactOr },
          select: { id: true, name: true, email: true, company: { select: { name: true } } },
        })
      : Promise.resolve([]),
    wantCompanies
      ? db.company.findMany({
          where: sel.allCompanies ? { email: HAS_EMAIL } : { email: HAS_EMAIL, OR: companyOr },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    db.emailSuppression.findMany({ select: { email: true } }),
    db.contact.findMany({ where: { optedOut: true, email: HAS_EMAIL }, select: { email: true } }),
  ]);

  const candidates: Candidate[] = [
    ...contacts.map((c) => ({
      email: c.email ?? "",
      source: "contact" as const,
      name: c.name,
      companyName: c.company?.name ?? null,
      contactId: c.id,
    })),
    ...companies.map((c) => ({
      email: c.email ?? "",
      source: "company" as const,
      name: c.name,
      companyName: c.name,
      companyId: c.id,
    })),
    ...sel.emails.map((email) => ({ email, source: "manual" as const })),
  ];

  const blocked = new Set<string>([
    ...suppressed.map((s) => s.email),
    ...optedOut.map((c) => normalizeEmail(c.email ?? "")),
  ]);

  return mergeCandidates(candidates, blocked);
}
```

- [ ] **Step 5: `src/lib/queries/email-broadcasts.ts`**

```ts
import "server-only";
import type { EmailRecipientStatus } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { LIMITS } from "@/config/limits";
import { getResendConnection } from "@/lib/email-broadcast/connection";
import type { ComposerOptions, PickedTarget } from "@/lib/email-broadcast/types";

const PROBLEM_STATUSES: EmailRecipientStatus[] = ["BOUNCED", "COMPLAINED", "FAILED"];
const HAS_EMAIL = { contains: "@" } as const;
/** A SENDING broadcast with no heartbeat for this long gets the "Resume" button. */
const STALE_MS = 2 * 60 * 1000;

export function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Addresses accepted by Resend this month (the E-mail quota; Campaigns has its own). */
export function countEmailsSentThisMonth(organizationId: string): Promise<number> {
  return tenantDb(organizationId).emailBroadcastRecipient.count({
    where: { sentAt: { gte: monthStart() } },
  });
}

export async function listEmailBroadcasts(organizationId: string) {
  const db = tenantDb(organizationId);
  const rows = await db.emailBroadcast.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, subject: true, status: true, pausedReason: true, startedAt: true, updatedAt: true },
  });
  if (rows.length === 0) return [];

  const grouped = await db.emailBroadcastRecipient.groupBy({
    by: ["broadcastId", "status"],
    where: { broadcastId: { in: rows.map((r) => r.id) } },
    _count: { _all: true },
  });
  const tally = new Map<string, { total: number; delivered: number; problems: number }>();
  for (const g of grouped) {
    const t = tally.get(g.broadcastId) ?? { total: 0, delivered: 0, problems: 0 };
    t.total += g._count._all;
    if (g.status === "DELIVERED") t.delivered += g._count._all;
    if (PROBLEM_STATUSES.includes(g.status)) t.problems += g._count._all;
    tally.set(g.broadcastId, t);
  }
  return rows.map((r) => ({ ...r, ...(tally.get(r.id) ?? { total: 0, delivered: 0, problems: 0 }) }));
}

export function getEmailBroadcast(organizationId: string, id: string) {
  return tenantDb(organizationId).emailBroadcast.findFirst({
    where: { id },
    select: {
      id: true,
      subject: true,
      html: true,
      fromName: true,
      replyTo: true,
      audience: true,
      stats: true,
      status: true,
      pausedReason: true,
      lastError: true,
      startedAt: true,
      finishedAt: true,
      lastDispatchAt: true,
    },
  });
}

export type ReportFilter = "all" | "queued" | "sent" | "delivered" | "problems";

const FILTER_STATUSES: Record<Exclude<ReportFilter, "all">, EmailRecipientStatus[]> = {
  queued: ["QUEUED"],
  sent: ["SENT"],
  delivered: ["DELIVERED"],
  problems: PROBLEM_STATUSES,
};

/** Status counts, the first 200 recipients for the filter, and whether a
 * stalled send may be resumed (computed here, not in the component). */
export async function getEmailBroadcastReport(organizationId: string, id: string, filter: ReportFilter) {
  const db = tenantDb(organizationId);
  const [grouped, recipients, b] = await Promise.all([
    db.emailBroadcastRecipient.groupBy({ by: ["status"], where: { broadcastId: id }, _count: { _all: true } }),
    db.emailBroadcastRecipient.findMany({
      where: { broadcastId: id, ...(filter === "all" ? {} : { status: { in: FILTER_STATUSES[filter] } }) },
      orderBy: { email: "asc" },
      take: 200,
      select: { id: true, email: true, name: true, sources: true, status: true, error: true, updatedAt: true },
    }),
    db.emailBroadcast.findFirst({ where: { id }, select: { status: true, startedAt: true, lastDispatchAt: true } }),
  ]);

  const counts: Record<EmailRecipientStatus, number> = {
    QUEUED: 0,
    SENT: 0,
    DELIVERED: 0,
    BOUNCED: 0,
    COMPLAINED: 0,
    FAILED: 0,
  };
  for (const g of grouped) counts[g.status] = g._count._all;

  const now = Date.now();
  const stalled =
    b?.status === "SENDING" &&
    !!b.startedAt &&
    now - b.startedAt.getTime() > STALE_MS &&
    (!b.lastDispatchAt || now - b.lastDispatchAt.getTime() > STALE_MS);

  return { counts, recipients, canResume: b?.status === "PAUSED" || stalled };
}

/** Chips of the recipient picker, each with how many addresses it holds. */
export async function emailComposerOptions(organizationId: string): Promise<ComposerOptions> {
  const db = tenantDb(organizationId);
  const [contacts, contactFolders, companyFolders, companyGroups] = await Promise.all([
    db.contact.findMany({ where: { email: HAS_EMAIL, optedOut: false }, select: { tags: true, folderId: true } }),
    db.contactFolder.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    db.companyFolder.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    db.company.groupBy({ by: ["folderId"], where: { email: HAS_EMAIL }, _count: { _all: true } }),
  ]);

  const tagCount = new Map<string, number>();
  const contactFolderCount = new Map<string, number>();
  for (const c of contacts) {
    for (const tag of c.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    if (c.folderId) contactFolderCount.set(c.folderId, (contactFolderCount.get(c.folderId) ?? 0) + 1);
  }
  const companyFolderCount = new Map<string, number>();
  for (const g of companyGroups) if (g.folderId) companyFolderCount.set(g.folderId, g._count._all);

  return {
    contactCount: contacts.length,
    tags: [...tagCount].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    contactFolders: contactFolders.map((f) => ({ ...f, count: contactFolderCount.get(f.id) ?? 0 })),
    companyCount: companyGroups.reduce((n, g) => n + g._count._all, 0),
    companyFolders: companyFolders.map((f) => ({ ...f, count: companyFolderCount.get(f.id) ?? 0 })),
  };
}

/** Everything the composer page needs besides the draft itself. */
export async function emailComposerData(organizationId: string) {
  const [options, conn, used] = await Promise.all([
    emailComposerOptions(organizationId),
    getResendConnection(organizationId),
    countEmailsSentThisMonth(organizationId),
  ]);
  return {
    options,
    fromEmail: conn?.fromEmail ?? null,
    quota: { used, limit: LIMITS.emailBroadcastQuotaPerMonth },
  };
}

/** Name/e-mail search for the "E-mails avulsos" field (contacts first). */
export async function searchEmailTargets(organizationId: string, q: string): Promise<PickedTarget[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const db = tenantDb(organizationId);
  const match = { contains: term, mode: "insensitive" as const };
  const [contacts, companies] = await Promise.all([
    db.contact.findMany({
      where: { email: HAS_EMAIL, OR: [{ name: match }, { email: match }] },
      orderBy: { name: "asc" },
      take: 6,
      select: { id: true, name: true, email: true },
    }),
    db.company.findMany({
      where: { email: HAS_EMAIL, OR: [{ name: match }, { email: match }] },
      orderBy: { name: "asc" },
      take: 4,
      select: { id: true, name: true, email: true },
    }),
  ]);
  return [
    ...contacts.map((c) => ({ kind: "contact" as const, id: c.id, name: c.name, email: c.email ?? "" })),
    ...companies.map((c) => ({ kind: "company" as const, id: c.id, name: c.name, email: c.email ?? "" })),
  ];
}

/** Chips for the contacts/companies a draft picked by search. */
export async function pickedTargets(
  organizationId: string,
  contactIds: string[],
  companyIds: string[],
): Promise<PickedTarget[]> {
  const db = tenantDb(organizationId);
  const [contacts, companies] = await Promise.all([
    contactIds.length
      ? db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    companyIds.length
      ? db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);
  return [
    ...contacts.map((c) => ({ kind: "contact" as const, id: c.id, name: c.name, email: c.email ?? "" })),
    ...companies.map((c) => ({ kind: "company" as const, id: c.id, name: c.name, email: c.email ?? "" })),
  ];
}
```

> Se o lint acusar `Date.now()` em `getEmailBroadcastReport`, ele está numa função da DAL e não num componente. Mantenha assim e não mova para o JSX.

- [ ] **Step 6: Guia 04, seção de limites**

Em `docs/guia/04-modulos-e-permissoes.md`, onde o guia descreve `src/config/limits.ts`, acrescente:
"`emailBroadcastQuotaPerMonth` (50.000): e-mails aceitos pelo Resend no mês no submenu E-mail. É
**separada** de `dispatchQuotaPerMonth` (Campanhas), e as duas não se somam."

- [ ] **Step 7: Verificar**

Run: `npm run typecheck && npm run lint && npm run check:email`
Esperado: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/config/limits.ts src/lib/validations/email-broadcast.ts src/lib/email-broadcast/types.ts src/lib/email-broadcast/audience.ts src/lib/queries/email-broadcasts.ts docs/guia/04-modulos-e-permissoes.md
git commit -m "[E-mail] - Adiciona a resolucao da audiencia, a DAL e a cota do E-mail" -m "Uniao de contatos, empresas e avulsos; bloqueados = lista de supressao + optedOut (so leitura). Cota propria de 50 mil/mes." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Menu, acesso, textos e a tela de lista

**Files:**
- Modify: `src/config/screens.ts`
- Modify: `src/config/modules.ts` (`marketing.screens`)
- Modify: `src/components/app/app-nav.tsx`
- Modify: `src/messages/pt.json`, `src/messages/en.json`
- Create: `src/app/[locale]/app/email/layout.tsx`
- Create: `src/app/[locale]/app/email/page.tsx`
- Create: `src/components/email/status-badge.tsx`
- Modify: `docs/guia/04-modulos-e-permissoes.md`

**Interfaces:**
- Consome:
  - `listEmailBroadcasts` e `countEmailsSentThisMonth` (Task 6);
  - `getResendConnection` e `deliveryTrackingActive` (Task 5);
  - `LIMITS.emailBroadcastQuotaPerMonth`.
- Produz:
  - a tela `"email"` em `GATEABLE_SCREENS`;
  - `StatusBadge({ status: string; label: string })`;
  - o namespace i18n `emailBroadcast` completo, usado pelas Tasks 8 a 11;
  - `app.nav.email`.

- [ ] **Step 1: Gating e menu**

`src/config/screens.ts`: em `GATEABLE_SCREENS`, depois de `"campaigns",`, adicione `"email",`.

`src/config/modules.ts`: no módulo `marketing`, troque
`screens: ["campaigns", "prospecting"],` por `screens: ["campaigns", "email", "prospecting"],`.

`src/components/app/app-nav.tsx`:
- no import do `lucide-react`, acrescente `Mail,`;
- no tipo `NavKey`, depois de `| "campaigns"`, acrescente `| "email"`;
- no grupo `comms`, depois do item de Campanhas, acrescente
  `{ href: "/app/email", key: "email", icon: Mail },`.

- [ ] **Step 2: Textos (pt e en, mesmas chaves)**

Em `src/messages/pt.json`, dentro de `app.nav`, depois de `"campaigns": "Campanhas",`, acrescente `"email": "E-mail",`. Em `en.json`, no mesmo lugar, acrescente `"email": "Email",`.

Em `pt.json`, acrescente o namespace de primeiro nível `emailBroadcast` (por exemplo, depois de `campaigns`):

```json
  "emailBroadcast": {
    "title": "E-mail",
    "subtitle": "Envie e-mails em massa para contatos e empresas pela sua conta do Resend.",
    "new": "Novo e-mail",
    "newTitle": "Novo e-mail",
    "editTitle": "Editar rascunho",
    "composerSubtitle": "Escreva a mensagem e escolha quem recebe. Cada endereço recebe uma vez só, mesmo que esteja em mais de um grupo.",
    "empty": "Nenhum envio ainda. Clique em “Novo e-mail” para começar.",
    "noSubject": "(sem assunto)",
    "editedAt": "Editado em {date}",
    "connection": {
      "active": "Resend conectado",
      "from": "Saindo como {email}",
      "tracking": "status de entrega ativo",
      "noTracking": "status de entrega indisponível",
      "manage": "Gerenciar em Conexões",
      "missingTitle": "Conecte sua conta do Resend",
      "missingBody": "Para enviar, cadastre em Conexões a chave da API do Resend e um remetente com domínio verificado.",
      "connect": "Conectar Resend"
    },
    "quota": { "label": "Enviados neste mês", "value": "{used} de {limit}" },
    "col": {
      "subject": "Assunto",
      "status": "Status",
      "recipients": "Destinatários",
      "delivered": "Entregues",
      "problems": "Problemas",
      "date": "Data"
    },
    "status": { "DRAFT": "Rascunho", "SENDING": "Enviando", "PAUSED": "Pausado", "DONE": "Concluído" },
    "paused": {
      "no_connection": "Envio pausado: a conexão do Resend não foi encontrada. Reconecte em Conexões e clique em “Retomar envio”.",
      "quota": "Envio pausado: a cota do mês acabou.",
      "provider_error": "Envio pausado: o Resend recusou o envio."
    },
    "message": "Mensagem",
    "fromName": "Nome do remetente",
    "fromEmail": "Endereço de envio",
    "replyTo": "Responder para",
    "optional": "(opcional)",
    "subject": "Assunto",
    "variablesHint": "Variáveis:",
    "body": "Corpo do e-mail",
    "bodyPlaceholder": "Escreva sua mensagem…",
    "varName": "Nome",
    "varCompany": "Empresa",
    "footerNotice": "Todo envio ganha um rodapé automático com o nome da empresa e o link “Não quero mais receber” (LGPD).",
    "emptyVarHint": "Endereços avulsos sem cadastro ficam com as variáveis vazias.",
    "sendTest": "Enviar teste para mim",
    "testTo": "O teste vai para {email}",
    "testSent": "Teste enviado para {email}",
    "recipients": "Destinatários",
    "recipientsHint": "Some grupos e endereços. A lista final soma tudo e remove repetidos.",
    "contacts": "Contatos do CRM",
    "allContacts": "Todos os contatos com e-mail",
    "byTag": "Por tag",
    "byFolder": "Por pasta",
    "companies": "Empresas",
    "allCompanies": "Todas as empresas com e-mail",
    "manual": "E-mails avulsos",
    "manualPlaceholder": "Busque um contato ou cole e-mails…",
    "manualHint": "Digite para buscar contatos e empresas pelo nome, ou cole uma lista separada por vírgula, ponto e vírgula ou quebra de linha.",
    "invalidChip": "inválido",
    "remove": "Remover {email}",
    "summary": {
      "title": "Resumo do envio",
      "selected": "Endereços nos grupos e avulsos",
      "duplicates": "Repetidos (mesmo e-mail em mais de um lugar)",
      "suppressed": "Descadastrados, bounce ou spam",
      "invalid": "Endereço inválido",
      "total": "Vão receber",
      "unique": "endereços únicos",
      "counting": "Calculando…",
      "quota": "Cota do mês",
      "viewList": "Ver lista de destinatários",
      "sampleNote": "Mostrando os primeiros {count}."
    },
    "saveDraft": "Salvar rascunho",
    "draftSaved": "Rascunho salvo",
    "reviewSend": "Revisar e enviar",
    "working": "Aguarde…",
    "confirmTitle": "Enviar para {count, plural, one {# endereço} other {# endereços}}?",
    "confirmBody": "Assunto: {subject}. Ficaram de fora {duplicates} repetidos, {suppressed} bloqueados e {invalid} inválidos. Depois de enviado não dá para cancelar; se o envio for interrompido, “Retomar envio” continua só para quem ainda não recebeu.",
    "confirmSend": "Enviar para {count}",
    "error": {
      "unauthorized": "Sua sessão expirou. Entre de novo.",
      "forbidden": "Você não tem acesso ao E-mail.",
      "invalid": "Preencha o assunto e o corpo do e-mail (e confira o “Responder para”).",
      "not_found": "Este envio não existe mais ou já foi iniciado.",
      "no_connection": "Conecte o Resend em Conexões antes de enviar.",
      "empty": "Nenhum destinatário selecionado.",
      "quota": "A cota do mês não comporta este envio.",
      "quotaDetail": "Este envio tem {total} endereços, mas restam {remaining} na cota do mês.",
      "provider": "O Resend recusou o envio.",
      "rate_limited": "Muitos testes seguidos. Espere um minuto.",
      "unknown": "Algo deu errado. Tente de novo."
    },
    "report": {
      "started": "Iniciado em {date}",
      "from": "De {from}",
      "viewEmail": "Ver e-mail enviado",
      "duplicate": "Duplicar",
      "resume": "Retomar envio",
      "processed": "{done} de {total} processados",
      "removed": "Ficaram fora deste envio: {duplicates} repetidos, {suppressed} bloqueados e {invalid} inválidos.",
      "noTracking": "Sem status de entrega: não foi possível registrar o webhook na conta do Resend. Os e-mails ficam como “Enviado”.",
      "showing": "Mostrando os primeiros {count}.",
      "counters": {
        "QUEUED": "Na fila",
        "SENT": "Enviados",
        "DELIVERED": "Entregues",
        "BOUNCED": "Bounce",
        "COMPLAINED": "Marcou spam",
        "FAILED": "Falhou"
      },
      "filter": {
        "all": "Todos",
        "queued": "Na fila",
        "sent": "Enviados",
        "delivered": "Entregues",
        "problems": "Problemas"
      },
      "col": { "recipient": "Destinatário", "source": "Veio de", "status": "Status", "updated": "Atualizado" },
      "source": { "contact": "Contato", "company": "Empresa", "manual": "Avulso" }
    }
  },
```

Em `en.json`, no mesmo lugar e com as **mesmas chaves**:

```json
  "emailBroadcast": {
    "title": "Email",
    "subtitle": "Send bulk emails to contacts and companies through your Resend account.",
    "new": "New email",
    "newTitle": "New email",
    "editTitle": "Edit draft",
    "composerSubtitle": "Write the message and choose who gets it. Each address receives it once, even if it is in more than one group.",
    "empty": "No sends yet. Click “New email” to start.",
    "noSubject": "(no subject)",
    "editedAt": "Edited {date}",
    "connection": {
      "active": "Resend connected",
      "from": "Sending as {email}",
      "tracking": "delivery status on",
      "noTracking": "delivery status unavailable",
      "manage": "Manage in Connections",
      "missingTitle": "Connect your Resend account",
      "missingBody": "To send, add your Resend API key and a sender on a verified domain in Connections.",
      "connect": "Connect Resend"
    },
    "quota": { "label": "Sent this month", "value": "{used} of {limit}" },
    "col": {
      "subject": "Subject",
      "status": "Status",
      "recipients": "Recipients",
      "delivered": "Delivered",
      "problems": "Problems",
      "date": "Date"
    },
    "status": { "DRAFT": "Draft", "SENDING": "Sending", "PAUSED": "Paused", "DONE": "Done" },
    "paused": {
      "no_connection": "Send paused: the Resend connection was not found. Reconnect it in Connections and click “Resume send”.",
      "quota": "Send paused: this month's quota ran out.",
      "provider_error": "Send paused: Resend rejected the send."
    },
    "message": "Message",
    "fromName": "Sender name",
    "fromEmail": "Sending address",
    "replyTo": "Reply to",
    "optional": "(optional)",
    "subject": "Subject",
    "variablesHint": "Variables:",
    "body": "Email body",
    "bodyPlaceholder": "Write your message…",
    "varName": "Name",
    "varCompany": "Company",
    "footerNotice": "Every send gets an automatic footer with the company name and a “Stop receiving these” link (LGPD).",
    "emptyVarHint": "Typed addresses with no record get empty variables.",
    "sendTest": "Send me a test",
    "testTo": "The test goes to {email}",
    "testSent": "Test sent to {email}",
    "recipients": "Recipients",
    "recipientsHint": "Add groups and addresses. The final list adds everything up and removes repeats.",
    "contacts": "CRM contacts",
    "allContacts": "All contacts with an email",
    "byTag": "By tag",
    "byFolder": "By folder",
    "companies": "Companies",
    "allCompanies": "All companies with an email",
    "manual": "Typed addresses",
    "manualPlaceholder": "Search a contact or paste emails…",
    "manualHint": "Type to search contacts and companies by name, or paste a list separated by commas, semicolons or line breaks.",
    "invalidChip": "invalid",
    "remove": "Remove {email}",
    "summary": {
      "title": "Send summary",
      "selected": "Addresses in groups and typed",
      "duplicates": "Repeats (same email in more than one place)",
      "suppressed": "Unsubscribed, bounced or spam",
      "invalid": "Invalid address",
      "total": "Will receive",
      "unique": "unique addresses",
      "counting": "Counting…",
      "quota": "Monthly quota",
      "viewList": "See recipient list",
      "sampleNote": "Showing the first {count}."
    },
    "saveDraft": "Save draft",
    "draftSaved": "Draft saved",
    "reviewSend": "Review and send",
    "working": "Please wait…",
    "confirmTitle": "Send to {count, plural, one {# address} other {# addresses}}?",
    "confirmBody": "Subject: {subject}. Left out: {duplicates} repeats, {suppressed} blocked and {invalid} invalid. Once sent it can't be canceled; if the send is interrupted, “Resume send” continues only for those who haven't received it.",
    "confirmSend": "Send to {count}",
    "error": {
      "unauthorized": "Your session expired. Sign in again.",
      "forbidden": "You don't have access to Email.",
      "invalid": "Fill in the subject and the email body (and check “Reply to”).",
      "not_found": "This send no longer exists or has already started.",
      "no_connection": "Connect Resend in Connections before sending.",
      "empty": "No recipients selected.",
      "quota": "This month's quota can't fit this send.",
      "quotaDetail": "This send has {total} addresses, but only {remaining} are left in this month's quota.",
      "provider": "Resend rejected the send.",
      "rate_limited": "Too many tests in a row. Wait a minute.",
      "unknown": "Something went wrong. Try again."
    },
    "report": {
      "started": "Started {date}",
      "from": "From {from}",
      "viewEmail": "View sent email",
      "duplicate": "Duplicate",
      "resume": "Resume send",
      "processed": "{done} of {total} processed",
      "removed": "Left out of this send: {duplicates} repeats, {suppressed} blocked and {invalid} invalid.",
      "noTracking": "No delivery status: the webhook could not be registered in the Resend account. Emails stay as “Sent”.",
      "showing": "Showing the first {count}.",
      "counters": {
        "QUEUED": "Queued",
        "SENT": "Sent",
        "DELIVERED": "Delivered",
        "BOUNCED": "Bounced",
        "COMPLAINED": "Marked spam",
        "FAILED": "Failed"
      },
      "filter": {
        "all": "All",
        "queued": "Queued",
        "sent": "Sent",
        "delivered": "Delivered",
        "problems": "Problems"
      },
      "col": { "recipient": "Recipient", "source": "Came from", "status": "Status", "updated": "Updated" },
      "source": { "contact": "Contact", "company": "Company", "manual": "Typed" }
    }
  },
```

Confira a paridade:

```bash
node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p+k+'.'):[p+k]);const a=new Set(f(require('./src/messages/pt.json'))),b=new Set(f(require('./src/messages/en.json')));console.log(a.size,b.size,[...a].filter(k=>!b.has(k)),[...b].filter(k=>!a.has(k)))"
```
Esperado: os dois números iguais e duas listas vazias `[] []`.

- [ ] **Step 3: `src/components/email/status-badge.tsx`**

```tsx
import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  QUEUED: "bg-muted text-muted-foreground",
  SENDING: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  SENT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PAUSED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  COMPLAINED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  DONE: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  DELIVERED: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  BOUNCED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

/** Status pill for broadcasts and recipients (label already translated). */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STYLES[status] ?? STYLES.DRAFT)}>
      {label}
    </span>
  );
}
```

- [ ] **Step 4: `src/app/[locale]/app/email/layout.tsx`**

```tsx
import { requireOrgContext } from "@/lib/tenant";
import { requireScreen, requireModule } from "@/lib/access";
import { resolveLocale } from "@/i18n/routing";

/** Screen-access guard for /app/email and its sub-routes. */
export default async function EmailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "email", locale);
  await requireModule(ctx, "marketing", locale);
  return <>{children}</>;
}
```

- [ ] **Step 5: `src/app/[locale]/app/email/page.tsx`**

```tsx
import { getFormatter, getTranslations } from "next-intl/server";
import { AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listEmailBroadcasts, countEmailsSentThisMonth } from "@/lib/queries/email-broadcasts";
import { getResendConnection, deliveryTrackingActive } from "@/lib/email-broadcast/connection";
import { StatusBadge } from "@/components/email/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { LIMITS } from "@/config/limits";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const format = await getFormatter();

  const [rows, conn, used] = await Promise.all([
    listEmailBroadcasts(ctx.organizationId),
    getResendConnection(ctx.organizationId),
    countEmailsSentThisMonth(ctx.organizationId),
  ]);
  const limit = LIMITS.emailBroadcastQuotaPerMonth;
  const pct = Math.min(100, (used / limit) * 100);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/app/email/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("new")}
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {conn ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4">
            <CheckCircle2 className="size-5 shrink-0 text-green-600" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t("connection.active")}</p>
              <p className="truncate text-sm text-muted-foreground">
                {t("connection.from", { email: conn.fromEmail })} ·{" "}
                {deliveryTrackingActive(conn) ? t("connection.tracking") : t("connection.noTracking")}
              </p>
            </div>
            <Link href="/app/connections" className="shrink-0 text-sm font-medium text-brand hover:underline">
              {t("connection.manage")}
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t("connection.missingTitle")}</p>
              <p className="text-sm">{t("connection.missingBody")}</p>
            </div>
            <Link href="/app/connections/new" className={buttonVariants({ size: "sm" })}>
              {t("connection.connect")}
            </Link>
          </div>
        )}
        <div className="flex flex-col justify-center gap-2 rounded-xl border border-border bg-card px-5 py-4">
          <div className="flex justify-between text-sm tabular-nums">
            <span className="text-muted-foreground">{t("quota.label")}</span>
            <span className="font-medium">
              {t("quota.value", { used: format.number(used), limit: format.number(limit) })}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("col.subject")}</th>
                <th className="px-5 py-3 font-medium">{t("col.status")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("col.recipients")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("col.delivered")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("col.problems")}</th>
                <th className="px-5 py-3 font-medium">{t("col.date")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isDraft = r.status === "DRAFT";
                const href = isDraft ? `/app/email/${r.id}/edit` : `/app/email/${r.id}`;
                const when = format.dateTime(r.startedAt ?? r.updatedAt, { dateStyle: "short", timeStyle: "short" });
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 font-medium">
                      <Link href={href} className="hover:underline">
                        {r.subject || t("noSubject")}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={r.status} label={t(`status.${r.status}`)} />
                    </td>
                    <td className="px-5 py-3 text-right">{isDraft ? "—" : format.number(r.total)}</td>
                    <td className="px-5 py-3 text-right">{isDraft ? "—" : format.number(r.delivered)}</td>
                    <td className="px-5 py-3 text-right">{isDraft ? "—" : format.number(r.problems)}</td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {isDraft ? t("editedAt", { date: when }) : when}
                    </td>
                    <td className="px-5 py-3 text-right" data-slot="row-actions" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

(A célula `row-actions` recebe o botão de apagar rascunho na Task 8.)

- [ ] **Step 6: Guia 04**

Em `docs/guia/04-modulos-e-permissoes.md`, na tabela/lista de módulos e telas, registre que o `marketing` agora tem as telas `campaigns`, `email` e `prospecting`. Anote também que a tela `email` precisa ser marcada nos modelos de acesso para que membros a vejam (owner e admin veem direto).

- [ ] **Step 7: Verificar**

Run: `npm run typecheck && npm run lint`
Esperado: PASS.

Com o `next dev` rodando em http://localhost:3000 e logado numa org com Marketing instalado:
- "E-mail" aparece em Comunicação, depois de Campanhas;
- `/app/email` mostra o card de conexão (aviso amarelo se não houver RESEND), a cota `0 de 50.000` e o estado vazio;
- Configurações → Acessos lista "E-mail" entre as telas.

- [ ] **Step 8: Commit**

```bash
git add src/config/screens.ts src/config/modules.ts src/components/app/app-nav.tsx src/messages/pt.json src/messages/en.json "src/app/[locale]/app/email" src/components/email/status-badge.tsx docs/guia/04-modulos-e-permissoes.md
git commit -m "[E-mail] - Adiciona o submenu E-mail com a lista de envios" -m "Tela email no modulo Marketing (gating por screens.ts/modules.ts), textos pt/en e card de conexao Resend e cota." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Actions de rascunho, prévia, busca e teste

**Files:**
- Create: `src/app/actions/email-broadcasts.ts`
- Modify: `src/app/[locale]/app/email/page.tsx` (botão de apagar rascunho)

**Interfaces:**
- Consome:
  - `broadcastDraftSchema`, `audienceSelectionSchema` e `BroadcastDraftInput` (Task 6);
  - `resolveAudience` e `searchEmailTargets` (DAL) (Task 6);
  - `composeEmail` (Task 3), `formatFrom` (Task 3);
  - `getResendConnection` e `sendOne` (Task 5);
  - `emailUnsubscribePageUrl` (Task 4).
- Produz (todas `async`, num arquivo `"use server"`):
  - `type EmailActionError`, `type EmailActionFail = { ok: false; error: EmailActionError; message?: string; remaining?: number; total?: number }`
  - `saveEmailDraft(id: string | null, input: BroadcastDraftInput): Promise<{ ok: true; id: string } | EmailActionFail>`
  - `deleteEmailDraft(id: string): Promise<{ ok: boolean }>`
  - `duplicateEmailBroadcast(id: string): Promise<{ ok: true; id: string } | EmailActionFail>`
  - `previewEmailAudience(selection: unknown): Promise<{ ok: true; preview: AudiencePreview } | EmailActionFail>`
  - `searchEmailTargets(q: string): Promise<PickedTarget[]>`
  - `sendEmailTest(input: BroadcastDraftInput): Promise<{ ok: true; to: string } | EmailActionFail>`

- [ ] **Step 1: Criar `src/app/actions/email-broadcasts.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { makeRateLimiter } from "@/lib/ratelimit";
import {
  audienceSelectionSchema,
  broadcastDraftSchema,
  type BroadcastDraftInput,
} from "@/lib/validations/email-broadcast";
import { normalizeEmail } from "@/lib/email-broadcast/normalize";
import { resolveAudience } from "@/lib/email-broadcast/audience";
import { composeEmail } from "@/lib/email-broadcast/compose";
import { formatFrom } from "@/lib/email-broadcast/render";
import { getResendConnection } from "@/lib/email-broadcast/connection";
import { sendOne } from "@/lib/email-broadcast/resend";
import { emailUnsubscribePageUrl } from "@/lib/email-broadcast/unsubscribe";
import { searchEmailTargets as searchTargets } from "@/lib/queries/email-broadcasts";
import type { AudiencePreview, PickedTarget } from "@/lib/email-broadcast/types";

export type EmailActionError =
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "no_connection"
  | "empty"
  | "quota"
  | "provider"
  | "rate_limited"
  | "unknown";

export type EmailActionFail = {
  ok: false;
  error: EmailActionError;
  message?: string;
  remaining?: number;
  total?: number;
};

type Gate = { ok: true; ctx: OrgContext } | EmailActionFail;

/** Session + the "email" screen + the Marketing module — the same gates as
 * the route layout, repeated because server actions are public endpoints. */
async function gate(): Promise<Gate> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: true, ctx };
}

function hasBody(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}

export async function saveEmailDraft(
  id: string | null,
  input: BroadcastDraftInput,
): Promise<{ ok: true; id: string } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = broadcastDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const data = {
    subject: parsed.data.subject,
    html: parsed.data.html,
    fromName: parsed.data.fromName || null,
    replyTo: parsed.data.replyTo ? normalizeEmail(parsed.data.replyTo) : null,
    audience: parsed.data.audience as Prisma.InputJsonValue,
  };
  try {
    const db = tenantDb(g.ctx.organizationId);
    if (!id) {
      const created = await db.emailBroadcast.create({
        data: { organizationId: g.ctx.organizationId, createdById: g.ctx.userId, ...data },
      });
      revalidatePath("/app/email");
      return { ok: true, id: created.id };
    }
    // Only drafts are editable; count 0 = not this org's, or already sending.
    const res = await db.emailBroadcast.updateMany({ where: { id, status: "DRAFT" }, data });
    if (res.count === 0) return { ok: false, error: "not_found" };
    revalidatePath("/app/email");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to save email draft", error);
    return { ok: false, error: "unknown" };
  }
}

/** Only drafts can be deleted: a started send is history and counts in the quota. */
export async function deleteEmailDraft(id: string): Promise<{ ok: boolean }> {
  const g = await gate();
  if (!g.ok) return { ok: false };
  try {
    const res = await tenantDb(g.ctx.organizationId).emailBroadcast.deleteMany({ where: { id, status: "DRAFT" } });
    revalidatePath("/app/email");
    return { ok: res.count > 0 };
  } catch (error) {
    console.error("Failed to delete email draft", error);
    return { ok: false };
  }
}

export async function duplicateEmailBroadcast(id: string): Promise<{ ok: true; id: string } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const db = tenantDb(g.ctx.organizationId);
    const src = await db.emailBroadcast.findFirst({
      where: { id },
      select: { subject: true, html: true, fromName: true, replyTo: true, audience: true },
    });
    if (!src) return { ok: false, error: "not_found" };
    const created = await db.emailBroadcast.create({
      data: {
        organizationId: g.ctx.organizationId,
        createdById: g.ctx.userId,
        subject: src.subject,
        html: src.html,
        fromName: src.fromName,
        replyTo: src.replyTo,
        audience: (src.audience ?? {}) as Prisma.InputJsonValue,
      },
    });
    revalidatePath("/app/email");
    return { ok: true, id: created.id };
  } catch (error) {
    console.error("Failed to duplicate email broadcast", error);
    return { ok: false, error: "unknown" };
  }
}

/** Live summary for the composer: counts + a sample of who will receive it. */
export async function previewEmailAudience(
  selection: unknown,
): Promise<{ ok: true; preview: AudiencePreview } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = audienceSelectionSchema.safeParse(selection);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const { recipients, stats, invalidEmails } = await resolveAudience(g.ctx.organizationId, parsed.data);
    return {
      ok: true,
      preview: {
        stats,
        invalidEmails: invalidEmails.slice(0, 50),
        sample: recipients.slice(0, 100).map((r) => ({ email: r.email, name: r.name, sources: r.sources })),
      },
    };
  } catch (error) {
    console.error("Failed to preview email audience", error);
    return { ok: false, error: "unknown" };
  }
}

export async function searchEmailTargets(q: string): Promise<PickedTarget[]> {
  const g = await gate();
  if (!g.ok) return [];
  try {
    return await searchTargets(g.ctx.organizationId, String(q).slice(0, 100));
  } catch (error) {
    console.error("Failed to search email targets", error);
    return [];
  }
}

/** One copy to the logged-in user, through the client's Resend. Not recorded,
 * not counted in the quota. Surfaces Resend errors (e.g. unverified domain). */
export async function sendEmailTest(input: BroadcastDraftInput): Promise<{ ok: true; to: string } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = broadcastDraftSchema.safeParse(input);
  if (!parsed.success || !parsed.data.subject || !hasBody(parsed.data.html)) return { ok: false, error: "invalid" };

  const limiter = makeRateLimiter("email-test", 10, 60);
  if (limiter && !(await limiter.limit(g.ctx.userId)).success) return { ok: false, error: "rate_limited" };

  const conn = await getResendConnection(g.ctx.organizationId);
  if (!conn) return { ok: false, error: "no_connection" };

  const composed = composeEmail({
    subject: `[Teste] ${parsed.data.subject}`,
    bodyHtml: parsed.data.html,
    vars: { nome: g.ctx.user.name, empresa: g.ctx.organization.name },
    orgName: g.ctx.organization.name,
    // A preview link: the page answers "invalid link", which is right for a test.
    unsubscribeUrl: emailUnsubscribePageUrl("teste"),
  });
  const res = await sendOne(conn.apiKey, {
    from: formatFrom(parsed.data.fromName, conn.fromEmail),
    to: [g.ctx.user.email],
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    ...(parsed.data.replyTo ? { reply_to: normalizeEmail(parsed.data.replyTo) } : {}),
  });
  return res.ok ? { ok: true, to: g.ctx.user.email } : { ok: false, error: "provider", message: res.message };
}
```

- [ ] **Step 2: Botão de apagar rascunho na lista**

Em `src/app/[locale]/app/email/page.tsx`:
- acrescente os imports
  `import { DeleteButton } from "@/components/crm/delete-button";` e
  `import { deleteEmailDraft } from "@/app/actions/email-broadcasts";`;
- troque `<td className="px-5 py-3 text-right" data-slot="row-actions" />` por:

```tsx
                    <td className="px-5 py-3 text-right">
                      {isDraft ? <DeleteButton action={deleteEmailDraft.bind(null, r.id)} /> : null}
                    </td>
```

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run lint && npm run build`
Esperado: PASS, e o build lista `/[locale]/app/email`.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/email-broadcasts.ts "src/app/[locale]/app/email/page.tsx"
git commit -m "[E-mail] - Adiciona as actions de rascunho, previa da audiencia e envio de teste" -m "Toda action repete o gating (tela email + modulo Marketing). Rascunho so edita/apaga em DRAFT." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Disparador, início/retomada do envio e job

**Files:**
- Create: `src/lib/email-broadcast/dispatch.ts`
- Modify: `src/app/actions/email-broadcasts.ts` (start/resume)
- Modify: `src/lib/jobs/index.ts`
- Modify: `src/config/audit.ts`, `src/messages/pt.json`, `src/messages/en.json` (rótulos de auditoria)

**Interfaces:**
- Consome:
  - `composeEmail` (Task 3), `formatFrom` (Task 3);
  - `getResendConnection` e `ensureResendWebhook` (Task 5), `sendBatch` e `sendOne` (Task 5);
  - `emailUnsubscribePageUrl` e `emailUnsubscribeOneClickUrl` (Task 4);
  - `resolveAudience`, `readAudience` e `countEmailsSentThisMonth`/`monthStart` (Task 6).
- Produz:
  - `BATCH_SIZE = 100`;
  - `runEmailBroadcast(broadcastId: string, opts?: { budgetMs?: number }): Promise<{ done: boolean }>`;
  - `kickEmailBroadcast(broadcastId: string): Promise<void>`;
  - as actions `startEmailBroadcast(id): Promise<{ ok: true } | EmailActionFail>` e `resumeEmailBroadcast(id): Promise<{ ok: true } | EmailActionFail>`;
  - o job `"email-broadcast"`.

- [ ] **Step 1: `src/lib/email-broadcast/dispatch.ts`**

```ts
import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import { LIMITS } from "@/config/limits";
import { monthStart } from "@/lib/queries/email-broadcasts";
import { composeEmail } from "./compose";
import { formatFrom } from "./render";
import { getResendConnection } from "./connection";
import { sendBatch, sendOne, type ResendEmail } from "./resend";
import { emailUnsubscribeOneClickUrl, emailUnsubscribePageUrl } from "./unsubscribe";

/**
 * Mass e-mail dispatcher. Runs as SYSTEM (raw Prisma, organizationId explicit
 * in every query). Recipients were materialized with a fixed batchNo, so each
 * batch has a stable Idempotency-Key and re-sending after a crash is deduped
 * by Resend (24h). A lease on `lastDispatchAt` keeps a single runner.
 */

export const BATCH_SIZE = 100;
const LEASE_MS = 90_000;
const PACE_MS = 150;
/** Per-job time budget in queue mode (the job re-enqueues itself after it). */
export const QUEUE_BUDGET_MS = 50_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Batch = { id: string; email: string; name: string | null; companyName: string | null }[];
type Outcome = { kind: "ok" } | { kind: "pause"; message: string };

/** Start (or continue) a SENDING broadcast in the background. */
export async function kickEmailBroadcast(broadcastId: string): Promise<void> {
  if (isQueueConfigured()) {
    await enqueue("email-broadcast", { broadcastId });
    return;
  }
  // No queue (production today): run after the response, in this process.
  after(() =>
    runEmailBroadcast(broadcastId)
      .then(() => undefined)
      .catch((e) => console.error("[email] dispatch failed", e)),
  );
}

async function takeLease(id: string, organizationId: string): Promise<boolean> {
  const res = await prisma.emailBroadcast.updateMany({
    where: {
      id,
      organizationId,
      status: "SENDING",
      OR: [{ lastDispatchAt: null }, { lastDispatchAt: { lt: new Date(Date.now() - LEASE_MS) } }],
    },
    data: { lastDispatchAt: new Date() },
  });
  return res.count === 1;
}

/**
 * Send queued batches until done, paused, or the time budget ends (queue
 * mode). Returns `{ done: false }` only when the budget ran out — the caller
 * re-enqueues; the lease is released first so the next run can take it.
 */
export async function runEmailBroadcast(
  broadcastId: string,
  opts: { budgetMs?: number } = {},
): Promise<{ done: boolean }> {
  const b = await prisma.emailBroadcast.findFirst({
    where: { id: broadcastId },
    select: { id: true, organizationId: true, status: true, subject: true, html: true, fromName: true, replyTo: true },
  });
  if (!b || b.status !== "SENDING") return { done: true };
  const org = b.organizationId;
  if (!(await takeLease(b.id, org))) return { done: true }; // another runner is alive

  const pause = (reason: "no_connection" | "quota" | "provider_error", message: string | null) =>
    prisma.emailBroadcast.updateMany({
      where: { id: b.id, organizationId: org, status: "SENDING" },
      data: { status: "PAUSED", pausedReason: reason, lastError: message?.slice(0, 500) ?? null, lastDispatchAt: null },
    });

  const conn = await getResendConnection(org);
  if (!conn) {
    await pause("no_connection", null);
    return { done: true };
  }
  const orgRow = await prisma.organization.findFirst({ where: { id: org }, select: { name: true } });
  const orgName = orgRow?.name ?? "";
  const from = formatFrom(b.fromName, conn.fromEmail);
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Number.POSITIVE_INFINITY;

  const toEmail = (r: Batch[number]): ResendEmail => {
    const composed = composeEmail({
      subject: b.subject,
      bodyHtml: b.html,
      vars: { nome: r.name ?? "", empresa: r.companyName ?? "" },
      orgName,
      unsubscribeUrl: emailUnsubscribePageUrl(r.id),
    });
    return {
      from,
      to: [r.email],
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
      ...(b.replyTo ? { reply_to: b.replyTo } : {}),
      headers: {
        "List-Unsubscribe": `<${emailUnsubscribeOneClickUrl(r.id)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  };

  const markSent = (rows: { id: string; providerId: string | null }[]) =>
    prisma.$transaction(
      rows.map((row) =>
        prisma.emailBroadcastRecipient.updateMany({
          where: { id: row.id, organizationId: org, status: "QUEUED" },
          data: { status: "SENT", providerMessageId: row.providerId, sentAt: new Date(), error: null },
        }),
      ),
    );

  /** Fallback when the batch as a whole is refused: one call per recipient. */
  const oneByOne = async (batch: Batch, batchNo: number): Promise<Outcome> => {
    for (const r of batch) {
      let res = await sendOne(conn.apiKey, toEmail(r), `eb-${b.id}-${batchNo}-${r.id}`);
      for (let tries = 0; !res.ok && res.status === 429 && tries < 5; tries++) {
        await sleep((res.retryAfter ?? 1) * 1000);
        res = await sendOne(conn.apiKey, toEmail(r), `eb-${b.id}-${batchNo}-${r.id}`);
      }
      if (res.ok) {
        await markSent([{ id: r.id, providerId: res.data.id ?? null }]);
      } else if (res.status === 401 || res.status === 403 || res.status === 0 || res.status >= 500) {
        return { kind: "pause", message: res.message };
      } else {
        await prisma.emailBroadcastRecipient.updateMany({
          where: { id: r.id, organizationId: org, status: "QUEUED" },
          data: { status: "FAILED", error: res.message.slice(0, 500) },
        });
      }
      await sleep(PACE_MS);
    }
    return { kind: "ok" };
  };

  const deliver = async (batch: Batch, batchNo: number): Promise<Outcome> => {
    const emails = batch.map(toEmail);
    for (let attempt = 0; ; attempt++) {
      const res = await sendBatch(conn.apiKey, emails, `eb-${b.id}-${batchNo}`);
      if (res.ok) {
        const ids = res.data.data ?? [];
        await markSent(batch.map((r, i) => ({ id: r.id, providerId: ids[i]?.id ?? null })));
        return { kind: "ok" };
      }
      if (res.status === 429 && attempt < 5) {
        await sleep((res.retryAfter ?? 1) * 1000);
        continue;
      }
      if ((res.status === 0 || res.status >= 500) && attempt < 3) {
        await sleep(1000 * 2 ** attempt); // same key: safe to retry
        continue;
      }
      // 400/409/422: a bad address or a changed batch — go one by one.
      if (res.status === 400 || res.status === 409 || res.status === 422) return oneByOne(batch, batchNo);
      return { kind: "pause", message: res.message };
    }
  };

  while (Date.now() < deadline) {
    const current = await prisma.emailBroadcast.findFirst({
      where: { id: b.id, organizationId: org },
      select: { status: true },
    });
    if (current?.status !== "SENDING") return { done: true };

    const next = await prisma.emailBroadcastRecipient.findFirst({
      where: { broadcastId: b.id, organizationId: org, status: "QUEUED" },
      orderBy: { batchNo: "asc" },
      select: { batchNo: true },
    });
    if (!next) {
      await prisma.emailBroadcast.updateMany({
        where: { id: b.id, organizationId: org, status: "SENDING" },
        data: { status: "DONE", finishedAt: new Date(), lastDispatchAt: null },
      });
      return { done: true };
    }

    const batch: Batch = await prisma.emailBroadcastRecipient.findMany({
      where: { broadcastId: b.id, organizationId: org, status: "QUEUED", batchNo: next.batchNo },
      orderBy: { email: "asc" },
      select: { id: true, email: true, name: true, companyName: true },
    });

    const sent = await prisma.emailBroadcastRecipient.count({
      where: { organizationId: org, sentAt: { gte: monthStart() } },
    });
    if (sent + batch.length > LIMITS.emailBroadcastQuotaPerMonth) {
      await pause("quota", null);
      return { done: true };
    }

    const outcome = await deliver(batch, next.batchNo);
    if (outcome.kind === "pause") {
      await pause("provider_error", outcome.message);
      return { done: true };
    }

    await prisma.emailBroadcast.updateMany({
      where: { id: b.id, organizationId: org },
      data: { lastDispatchAt: new Date() }, // heartbeat
    });
    await sleep(PACE_MS);
  }

  // Budget over (queue mode): release the lease so the re-enqueued job can take it.
  await prisma.emailBroadcast.updateMany({
    where: { id: b.id, organizationId: org, status: "SENDING" },
    data: { lastDispatchAt: null },
  });
  return { done: false };
}
```

- [ ] **Step 2: Registrar o job em `src/lib/jobs/index.ts`**

Import, junto dos outros:

```ts
import { QUEUE_BUDGET_MS, runEmailBroadcast } from "@/lib/email-broadcast/dispatch";
```

Entrada nova em `JOB_HANDLERS`, depois de `"whatsapp-media"`:

```ts
  /** Run a mass e-mail for up to ~50s, then re-enqueue until it's done. */
  "email-broadcast": async (payload) => {
    const broadcastId = String((payload as { broadcastId?: string })?.broadcastId ?? "");
    if (!broadcastId) return;
    const { done } = await runEmailBroadcast(broadcastId, { budgetMs: QUEUE_BUDGET_MS });
    if (!done && isQueueConfigured()) await enqueue("email-broadcast", { broadcastId });
  },
```

- [ ] **Step 3: Auditoria**

`src/config/audit.ts`:
- em `AUDIT_ACTIONS`, depois de `"campaign.started",`, acrescente `"email_broadcast.started",`;
- em `AUDIT_ENTITIES`, depois de `"Campaign",`, acrescente `"EmailBroadcast",`.

`pt.json`:
- em `audit.actions`, acrescente `"email_broadcast": { "started": "Iniciou um envio de e-mail em massa" },`;
- em `audit.entities`, acrescente `"EmailBroadcast": "Envio de e-mail",`.

`en.json`:
- em `audit.actions`, acrescente `"email_broadcast": { "started": "Started a bulk email send" },`;
- em `audit.entities`, acrescente `"EmailBroadcast": "Email send",`.

- [ ] **Step 4: Actions de início e retomada**

Em `src/app/actions/email-broadcasts.ts`, acrescente aos imports:

```ts
import { audit } from "@/lib/audit";
import { LIMITS } from "@/config/limits";
import { readAudience } from "@/lib/validations/email-broadcast";
import { ensureResendWebhook } from "@/lib/email-broadcast/connection";
import { BATCH_SIZE, kickEmailBroadcast } from "@/lib/email-broadcast/dispatch";
import { countEmailsSentThisMonth } from "@/lib/queries/email-broadcasts";
```

(Junte `readAudience` ao import já existente de `@/lib/validations/email-broadcast` e `ensureResendWebhook` ao de `connection`.)

E no fim do arquivo:

```ts
/**
 * DRAFT → SENDING: resolve the audience, check quota, materialize one row per
 * unique address (@@unique([broadcastId, email]) + skipDuplicates), then kick
 * the dispatcher. The DRAFT-only updateMany is the double-submit lock.
 */
export async function startEmailBroadcast(id: string): Promise<{ ok: true } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  const db = tenantDb(orgId);

  const b = await db.emailBroadcast.findFirst({
    where: { id },
    select: { id: true, status: true, subject: true, html: true, audience: true },
  });
  if (!b) return { ok: false, error: "not_found" };
  if (b.status !== "DRAFT") return { ok: false, error: "not_found" };
  if (!b.subject.trim() || !hasBody(b.html)) return { ok: false, error: "invalid" };

  const conn = await getResendConnection(orgId);
  if (!conn) return { ok: false, error: "no_connection" };

  const { recipients, stats } = await resolveAudience(orgId, readAudience(b.audience));
  if (recipients.length === 0) return { ok: false, error: "empty" };

  const remaining = LIMITS.emailBroadcastQuotaPerMonth - (await countEmailsSentThisMonth(orgId));
  if (recipients.length > remaining) {
    return { ok: false, error: "quota", remaining: Math.max(0, remaining), total: recipients.length };
  }

  await ensureResendWebhook(conn).catch((e) => {
    console.warn("[email] webhook setup failed", e);
    return false;
  });

  // Claim: only one request can move this draft forward. The fresh heartbeat
  // keeps a "Resume" click from starting a runner mid-materialization.
  const claimed = await db.emailBroadcast.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      status: "SENDING",
      stats: stats as Prisma.InputJsonValue,
      startedAt: new Date(),
      lastDispatchAt: new Date(),
      pausedReason: null,
      lastError: null,
    },
  });
  if (claimed.count === 0) return { ok: false, error: "not_found" };

  try {
    for (let i = 0; i < recipients.length; i += 1000) {
      await db.emailBroadcastRecipient.createMany({
        data: recipients.slice(i, i + 1000).map((r, j) => ({
          organizationId: orgId,
          broadcastId: id,
          email: r.email,
          name: r.name,
          companyName: r.companyName,
          sources: r.sources,
          contactId: r.contactId,
          companyId: r.companyId,
          batchNo: Math.floor((i + j) / BATCH_SIZE),
        })),
        skipDuplicates: true,
      });
    }
  } catch (error) {
    console.error("Failed to materialize email recipients", error);
    await db.emailBroadcastRecipient.deleteMany({ where: { broadcastId: id } });
    await db.emailBroadcast.updateMany({
      where: { id },
      data: { status: "DRAFT", startedAt: null, lastDispatchAt: null, stats: {} },
    });
    return { ok: false, error: "unknown" };
  }

  // Release the claim heartbeat so the dispatcher's lease can be taken now.
  await db.emailBroadcast.updateMany({ where: { id, status: "SENDING" }, data: { lastDispatchAt: null } });
  await audit(g.ctx, {
    action: "email_broadcast.started",
    entity: "EmailBroadcast",
    entityId: id,
    meta: { recipients: recipients.length },
  });
  await kickEmailBroadcast(id);
  revalidatePath("/app/email");
  revalidatePath(`/app/email/${id}`);
  return { ok: true };
}

/** PAUSED → SENDING (after the cause was fixed), or poke a stalled SENDING.
 * The dispatcher's lease guarantees a single runner either way. */
export async function resumeEmailBroadcast(id: string): Promise<{ ok: true } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const db = tenantDb(g.ctx.organizationId);
  const b = await db.emailBroadcast.findFirst({ where: { id }, select: { status: true } });
  if (!b) return { ok: false, error: "not_found" };

  if (b.status === "PAUSED") {
    if (!(await getResendConnection(g.ctx.organizationId))) return { ok: false, error: "no_connection" };
    const res = await db.emailBroadcast.updateMany({
      where: { id, status: "PAUSED" },
      data: { status: "SENDING", pausedReason: null, lastError: null, lastDispatchAt: null },
    });
    if (res.count === 0) return { ok: false, error: "not_found" };
  } else if (b.status !== "SENDING") {
    return { ok: false, error: "invalid" };
  }

  await kickEmailBroadcast(id);
  revalidatePath(`/app/email/${id}`);
  return { ok: true };
}
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm run lint && npm run build && npm run check:email`
Esperado: PASS. O envio real é exercitado na Task 10.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email-broadcast/dispatch.ts src/lib/jobs/index.ts src/app/actions/email-broadcasts.ts src/config/audit.ts src/messages/pt.json src/messages/en.json
git commit -m "[E-mail] - Adiciona o disparo em lotes com idempotencia e a retomada" -m "Lotes fixos de 100 com Idempotency-Key, fallback individual, lease por heartbeat, pausa por conexao/cota/erro e job email-broadcast." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Tela de composição (novo e editar)

**Files:**
- Create: `src/components/email/email-composer.tsx`
- Create: `src/components/email/recipient-picker.tsx`
- Create: `src/components/email/audience-summary.tsx`
- Create: `src/app/[locale]/app/email/new/page.tsx`
- Create: `src/app/[locale]/app/email/[id]/edit/page.tsx`

**Interfaces:**
- Consome:
  - as actions da Task 8 e `startEmailBroadcast` (Task 9);
  - `emailComposerData`, `getEmailBroadcast` e `pickedTargets` (Task 6);
  - `readAudience` e `EMPTY_AUDIENCE` (Task 6);
  - `RichTextEditor` de `@/components/proposals/rich-text-editor` (sem alteração);
  - `useConfirm` e `useToast`.
- Produz: `EmailComposer`, `RecipientPicker` e `AudienceSummary`.

- [ ] **Step 1: `src/components/email/audience-summary.tsx`**

```tsx
"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { AudiencePreview } from "@/lib/email-broadcast/types";

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={muted ? "flex justify-between gap-3 text-muted-foreground" : "flex justify-between gap-3"}>
      <dt>{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** The arithmetic of the send (selected − repeats − blocked − invalid = total) and the quota bar. */
export function AudienceSummary({
  preview,
  quota,
  children,
}: {
  preview: AudiencePreview | null;
  quota: { used: number; limit: number };
  children?: React.ReactNode;
}) {
  const t = useTranslations("emailBroadcast.summary");
  const format = useFormatter();
  const s = preview?.stats;
  const pct = Math.min(100, (quota.used / quota.limit) * 100);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      {s ? (
        <dl className="flex flex-col gap-2 text-sm tabular-nums">
          <Row label={t("selected")} value={format.number(s.selected)} />
          <Row muted label={`− ${t("duplicates")}`} value={format.number(s.duplicates)} />
          <Row muted label={`− ${t("suppressed")}`} value={format.number(s.suppressed)} />
          <Row muted label={`− ${t("invalid")}`} value={format.number(s.invalid)} />
          <div className="my-1 h-px bg-border" />
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-semibold">{t("total")}</dt>
            <dd className="text-2xl font-bold text-brand">
              {format.number(s.total)} <span className="text-sm font-medium text-muted-foreground">{t("unique")}</span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">{t("counting")}</p>
      )}

      {preview && preview.sample.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-brand">{t("viewList")}</summary>
          <ul className="mt-2 max-h-60 overflow-y-auto">
            {preview.sample.map((r) => (
              <li key={r.email} className="flex justify-between gap-3 py-1">
                <span className="truncate">{r.name ?? r.email}</span>
                {r.name ? <span className="truncate text-muted-foreground">{r.email}</span> : null}
              </li>
            ))}
          </ul>
          {s && s.total > preview.sample.length ? (
            <p className="mt-1 text-xs text-muted-foreground">{t("sampleNote", { count: preview.sample.length })}</p>
          ) : null}
        </details>
      ) : null}

      <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-3">
        <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
          <span>{t("quota")}</span>
          <span>
            {format.number(quota.used)} / {format.number(quota.limit)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: `src/components/email/recipient-picker.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Contact, Mail, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchEmailTargets } from "@/app/actions/email-broadcasts";
import { isValidEmail, normalizeEmail, parseEmailList } from "@/lib/email-broadcast/normalize";
import type { AudienceSelection } from "@/lib/validations/email-broadcast";
import type { ComposerOptions, PickedTarget } from "@/lib/email-broadcast/types";

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        on ? "border-brand bg-brand/10 font-medium text-brand" : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** Groups (contacts by tag/folder, companies by folder) + typed/searched addresses, all summed. */
export function RecipientPicker({
  options,
  audience,
  onAudienceChange,
  picked,
  onPickedChange,
}: {
  options: ComposerOptions;
  audience: AudienceSelection;
  onAudienceChange: (next: AudienceSelection) => void;
  picked: PickedTarget[];
  onPickedChange: (next: PickedTarget[]) => void;
}) {
  const t = useTranslations("emailBroadcast");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedTarget[]>([]);
  const set = (patch: Partial<AudienceSelection>) => onAudienceChange({ ...audience, ...patch });

  // Debounced search; state only changes inside the timeout.
  useEffect(() => {
    let active = true;
    const term = query.trim();
    const handle = setTimeout(async () => {
      const found = term.length >= 2 && !/[,;\s]/.test(term) ? await searchEmailTargets(term) : [];
      if (active) setResults(found);
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query]);

  function addEmails(text: string) {
    const parsed = parseEmailList(text);
    if (parsed.length === 0) return;
    const next = [...audience.emails];
    for (const email of parsed) if (!next.includes(email)) next.push(email);
    set({ emails: next });
    setQuery("");
  }

  function pick(target: PickedTarget) {
    if (!picked.some((p) => p.kind === target.kind && p.id === target.id)) onPickedChange([...picked, target]);
    if (target.kind === "contact") {
      if (!audience.contactIds.includes(target.id)) set({ contactIds: [...audience.contactIds, target.id] });
    } else if (!audience.companyIds.includes(target.id)) {
      set({ companyIds: [...audience.companyIds, target.id] });
    }
    setQuery("");
    setResults([]);
  }

  function unpick(target: PickedTarget) {
    onPickedChange(picked.filter((p) => !(p.kind === target.kind && p.id === target.id)));
    if (target.kind === "contact") set({ contactIds: audience.contactIds.filter((x) => x !== target.id) });
    else set({ companyIds: audience.companyIds.filter((x) => x !== target.id) });
  }

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold">{t("recipients")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("recipientsHint")}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Contact className="size-4 text-brand" />
          {t("contacts")}
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            checked={audience.allContacts}
            onChange={(e) => set({ allContacts: e.target.checked })}
          />
          <span className="flex-1">{t("allContacts")}</span>
          <span className="tabular-nums text-muted-foreground">{options.contactCount}</span>
        </label>
        {options.tags.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">{t("byTag")}</p>
            <div className="flex flex-wrap gap-2">
              {options.tags.map((tag) => (
                <Chip
                  key={tag.name}
                  on={audience.contactTags.includes(tag.name)}
                  onClick={() => set({ contactTags: toggle(audience.contactTags, tag.name) })}
                >
                  {tag.name} · {tag.count}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
        {options.contactFolders.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">{t("byFolder")}</p>
            <div className="flex flex-wrap gap-2">
              {options.contactFolders.map((f) => (
                <Chip
                  key={f.id}
                  on={audience.contactFolderIds.includes(f.id)}
                  onClick={() => set({ contactFolderIds: toggle(audience.contactFolderIds, f.id) })}
                >
                  {f.name} · {f.count}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <hr className="border-border" />

      <div className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-brand" />
          {t("companies")}
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            checked={audience.allCompanies}
            onChange={(e) => set({ allCompanies: e.target.checked })}
          />
          <span className="flex-1">{t("allCompanies")}</span>
          <span className="tabular-nums text-muted-foreground">{options.companyCount}</span>
        </label>
        {options.companyFolders.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">{t("byFolder")}</p>
            <div className="flex flex-wrap gap-2">
              {options.companyFolders.map((f) => (
                <Chip
                  key={f.id}
                  on={audience.companyFolderIds.includes(f.id)}
                  onClick={() => set({ companyFolderIds: toggle(audience.companyFolderIds, f.id) })}
                >
                  {f.name} · {f.count}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <hr className="border-border" />

      <div className="flex flex-col gap-2">
        <label htmlFor="manual-emails" className="flex items-center gap-2 text-sm font-semibold">
          <Mail className="size-4 text-brand" />
          {t("manual")}
        </label>
        <div className="relative">
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-card p-2 focus-within:border-brand">
            {picked.map((p) => (
              <span
                key={`${p.kind}:${p.id}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted py-1 pl-3 pr-1 text-sm"
              >
                {p.kind === "company" ? <Building2 className="size-3.5 shrink-0" /> : null}
                <span className="font-medium">{p.name}</span>
                <span className="truncate text-muted-foreground">{p.email}</span>
                <button
                  type="button"
                  aria-label={t("remove", { email: p.email })}
                  onClick={() => unpick(p)}
                  className="rounded-full p-0.5 hover:bg-background"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            {audience.emails.map((email) => {
              const valid = isValidEmail(normalizeEmail(email));
              return (
                <span
                  key={email}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-3 pr-1 text-sm",
                    valid
                      ? "bg-muted"
                      : "border border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
                  )}
                >
                  <span className="truncate">{email}</span>
                  {valid ? null : <span className="text-xs">{t("invalidChip")}</span>}
                  <button
                    type="button"
                    aria-label={t("remove", { email })}
                    onClick={() => set({ emails: audience.emails.filter((e) => e !== email) })}
                    className="rounded-full p-0.5 hover:bg-background"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              );
            })}
            <input
              id="manual-emails"
              value={query}
              placeholder={t("manualPlaceholder")}
              autoComplete="off"
              className="min-w-40 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === ",") && query.includes("@")) {
                  e.preventDefault();
                  addEmails(query);
                } else if (e.key === "Enter" && results[0]) {
                  e.preventDefault();
                  pick(results[0]);
                }
              }}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (text.includes("@")) {
                  e.preventDefault();
                  addEmails(text);
                }
              }}
              onBlur={() => {
                if (query.includes("@")) addEmails(query);
              }}
            />
          </div>
          {results.length > 0 ? (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
              {results.map((r) => (
                <li key={`${r.kind}:${r.id}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(r)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {r.kind === "company" ? (
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Contact className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-medium">{r.name}</span>
                    <span className="truncate text-muted-foreground">{r.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("manualHint")}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: `src/components/email/email-composer.tsx`**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { RichTextEditor } from "@/components/proposals/rich-text-editor";
import { RecipientPicker } from "@/components/email/recipient-picker";
import { AudienceSummary } from "@/components/email/audience-summary";
import {
  previewEmailAudience,
  saveEmailDraft,
  sendEmailTest,
  startEmailBroadcast,
  type EmailActionFail,
} from "@/app/actions/email-broadcasts";
import type { AudiencePreview, ComposerDraft, ComposerOptions } from "@/lib/email-broadcast/types";

/** New/edit screen of a mass e-mail: message on the left, recipients + summary on the right. */
export function EmailComposer({
  draft,
  options,
  fromEmail,
  userEmail,
  quota,
}: {
  draft: ComposerDraft;
  options: ComposerOptions;
  fromEmail: string | null;
  userEmail: string;
  quota: { used: number; limit: number };
}) {
  const t = useTranslations("emailBroadcast");
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [id, setId] = useState<string | null>(draft.id);
  const [fromName, setFromName] = useState(draft.fromName);
  const [replyTo, setReplyTo] = useState(draft.replyTo);
  const [subject, setSubject] = useState(draft.subject);
  const [html, setHtml] = useState(draft.html);
  const [audience, setAudience] = useState(draft.audience);
  const [picked, setPicked] = useState(draft.picked);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [busy, startBusy] = useTransition();
  const noConnection = !fromEmail;

  // Live summary, debounced; state only changes inside the timeout.
  useEffect(() => {
    let active = true;
    const handle = setTimeout(async () => {
      const r = await previewEmailAudience(audience);
      if (active && r.ok) setPreview(r.preview);
    }, 350);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [audience]);

  const payload = () => ({ subject, html, fromName, replyTo, audience });
  const errorText = (r: EmailActionFail) =>
    r.error === "quota"
      ? t("error.quotaDetail", { total: r.total ?? 0, remaining: r.remaining ?? 0 })
      : (r.message ?? t(`error.${r.error}`));

  async function save(): Promise<string | null> {
    const r = await saveEmailDraft(id, payload());
    if (!r.ok) {
      toast(errorText(r), { variant: "error" });
      return null;
    }
    setId(r.id);
    return r.id;
  }

  function onSaveDraft() {
    startBusy(async () => {
      const savedId = await save();
      if (!savedId) return;
      toast(t("draftSaved"));
      if (!draft.id) router.replace(`/app/email/${savedId}/edit`);
    });
  }

  function onTest() {
    startBusy(async () => {
      const r = await sendEmailTest(payload());
      if (r.ok) toast(t("testSent", { email: r.to }));
      else toast(errorText(r), { variant: "error" });
    });
  }

  function onSend() {
    startBusy(async () => {
      const savedId = await save();
      if (!savedId) return;
      const p = await previewEmailAudience(audience);
      if (!p.ok) {
        toast(errorText(p), { variant: "error" });
        return;
      }
      const s = p.preview.stats;
      if (s.total === 0) {
        toast(t("error.empty"), { variant: "error" });
        return;
      }
      const ok = await confirm({
        title: t("confirmTitle", { count: s.total }),
        description: t("confirmBody", {
          subject: subject || t("noSubject"),
          duplicates: s.duplicates,
          suppressed: s.suppressed,
          invalid: s.invalid,
        }),
        confirmLabel: t("confirmSend", { count: s.total }),
      });
      if (!ok) return;
      const r = await startEmailBroadcast(savedId);
      if (!r.ok) {
        toast(errorText(r), { variant: "error" });
        return;
      }
      router.push(`/app/email/${savedId}`);
    });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">{t("message")}</h2>
        {noConnection ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t("connection.missingBody")}{" "}
            <Link href="/app/connections/new" className="font-medium underline underline-offset-4">
              {t("connection.connect")}
            </Link>
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fromName">{t("fromName")}</Label>
            <Input id="fromName" value={fromName} maxLength={100} onChange={(e) => setFromName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fromEmail">{t("fromEmail")}</Label>
            <Input id="fromEmail" value={fromEmail ?? ""} readOnly placeholder={t("connection.missingTitle")} />
          </div>
        </div>
        <div>
          <Label htmlFor="replyTo">
            {t("replyTo")} <span className="font-normal text-muted-foreground">{t("optional")}</span>
          </Label>
          <Input id="replyTo" type="email" value={replyTo} maxLength={254} onChange={(e) => setReplyTo(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="subject">{t("subject")}</Label>
          <Input id="subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">
            {t("variablesHint")} <code>{"{{nome}}"}</code> <code>{"{{empresa}}"}</code>
          </p>
        </div>
        <div>
          {/* Not a <label>: the TipTap editor isn't a form control it could point at. */}
          <p className="mb-1.5 text-sm font-medium">{t("body")}</p>
          <RichTextEditor
            value={html}
            onChange={setHtml}
            placeholder={t("bodyPlaceholder")}
            minHeight="16rem"
            variables={[
              { token: "nome", label: t("varName") },
              { token: "empresa", label: t("varCompany") },
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("footerNotice")} {t("emptyVarHint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={onTest} disabled={busy || noConnection}>
            <Send className="size-4" />
            {t("sendTest")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("testTo", { email: userEmail })}</span>
        </div>
      </section>

      <div className="flex flex-col gap-6">
        <RecipientPicker
          options={options}
          audience={audience}
          onAudienceChange={setAudience}
          picked={picked}
          onPickedChange={setPicked}
        />
        <AudienceSummary preview={preview} quota={quota}>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" className="flex-1" onClick={onSaveDraft} disabled={busy}>
              {t("saveDraft")}
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={onSend}
              disabled={busy || noConnection || preview?.stats.total === 0}
            >
              {busy ? t("working") : t("reviewSend")}
            </Button>
          </div>
        </AudienceSummary>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Páginas**

`src/app/[locale]/app/email/new/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { emailComposerData } from "@/lib/queries/email-broadcasts";
import { EMPTY_AUDIENCE } from "@/lib/validations/email-broadcast";
import { EmailComposer } from "@/components/email/email-composer";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const data = await emailComposerData(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/app/email" className="hover:underline">
            {t("title")}
          </Link>{" "}
          / {t("newTitle")}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
        <p className="mt-1 text-muted-foreground">{t("composerSubtitle")}</p>
      </div>
      <EmailComposer
        draft={{
          id: null,
          subject: "",
          html: "",
          fromName: ctx.organization.name,
          replyTo: "",
          audience: EMPTY_AUDIENCE,
          picked: [],
        }}
        options={data.options}
        fromEmail={data.fromEmail}
        userEmail={ctx.user.email}
        quota={data.quota}
      />
    </div>
  );
}
```

`src/app/[locale]/app/email/[id]/edit/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { emailComposerData, getEmailBroadcast, pickedTargets } from "@/lib/queries/email-broadcasts";
import { readAudience } from "@/lib/validations/email-broadcast";
import { EmailComposer } from "@/components/email/email-composer";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditEmailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");

  const b = await getEmailBroadcast(ctx.organizationId, id);
  if (!b) notFound();
  if (b.status !== "DRAFT") redirect({ href: `/app/email/${id}`, locale });

  const audience = readAudience(b.audience);
  const [data, picked] = await Promise.all([
    emailComposerData(ctx.organizationId),
    pickedTargets(ctx.organizationId, audience.contactIds, audience.companyIds),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/app/email" className="hover:underline">
            {t("title")}
          </Link>{" "}
          / {t("editTitle")}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{b.subject || t("editTitle")}</h1>
        <p className="mt-1 text-muted-foreground">{t("composerSubtitle")}</p>
      </div>
      <EmailComposer
        draft={{
          id: b.id,
          subject: b.subject,
          html: b.html,
          fromName: b.fromName ?? "",
          replyTo: b.replyTo ?? "",
          audience,
          picked,
        }}
        options={data.options}
        fromEmail={data.fromEmail}
        userEmail={ctx.user.email}
        quota={data.quota}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verificar o build**

Run: `npm run typecheck && npm run lint && npm run build`
Esperado: PASS.

- [ ] **Step 6: E2E local (dedupe, teste, envio, duas abas, queda)**

Preparação, uma vez só:
- `npm run dev` em http://localhost:3000, logado numa org com Marketing instalado.
- Conexões → Nova → Resend: API key = `RESEND_API_KEY` do `.env`, remetente = `EMAIL_FROM`. É só para dev, não vai para produção.
- Crie o contato "Teste Dedupe" com e-mail `delivered+dedupe@resend.dev` e a tag `teste-email`.
- Crie a empresa "Empresa Dedupe" com e-mail ` DELIVERED+dedupe@resend.dev` (maiúsculas e espaço de propósito).

**Dedupe (Review Focus 1):** Novo e-mail com assunto `Teste {{nome}}`, corpo `Olá {{nome}} da {{empresa}}` e destinatários:
- a tag `teste-email`;
- a empresa "Empresa Dedupe" buscada pelo nome no campo de avulsos;
- colado `delivered+dedupe@resend.dev, delivered+avulso@resend.dev, bounced@resend.dev, maria@@exemplo`.

Esperado no resumo: selecionados 6, repetidos 2, bloqueados 0, inválidos 1, vão receber 3. O chip `maria@@exemplo` fica vermelho.

**Teste:** "Enviar teste para mim" → toast "Teste enviado para …" e o e-mail chega na caixa do usuário logado, com assunto `[Teste] Teste <seu nome>`.

**Envio:** "Revisar e enviar" → o diálogo diz "Enviar para 3 endereços?" → confirmar.
- O relatório abre com 3 linhas, e a de `delivered+dedupe@resend.dev` mostra "Contato + Empresa + Avulso".
- Em poucos segundos todas ficam "Enviado" e o status vira "Concluído".
- No SQL (`npm run db:studio` ou psql), esta consulta devolve **0 linhas**:
  `SELECT email, count(*) FROM email_broadcast_recipients WHERE "broadcastId" = '<id>' GROUP BY email HAVING count(*) > 1;`
- No painel do Resend (Emails), aparecem exatamente 3 e-mails desse envio.
- Se o Resend recusar o rótulo `+…` em endereço de teste, use só `delivered@resend.dev` e `bounced@resend.dev`; nesse caso o esperado passa a ser vão receber 2.

**Duas abas (Review Focus 3):**
- Duplique o envio (botão "Duplicar" no relatório) e abra `/app/email/<novo>/edit` em duas abas.
- Clique "Revisar e enviar" e confirme na aba 1, depois na aba 2.
- A aba 2 mostra "Este envio não existe mais ou já foi iniciado".
- A consulta SQL de duplicados continua com 0 linhas, e o total de linhas é 3.

**Queda simulada (Review Focus 2):** depois do envio concluído, simule "o Resend aceitou o lote 0, mas o banco não gravou":

```sql
UPDATE email_broadcast_recipients SET status = 'QUEUED', "providerMessageId" = NULL, "sentAt" = NULL WHERE "broadcastId" = '<id>' AND "batchNo" = 0;
UPDATE email_broadcasts SET status = 'SENDING', "finishedAt" = NULL, "lastDispatchAt" = NULL, "startedAt" = now() - interval '5 minutes' WHERE id = '<id>';
```

- Recarregue o relatório: "Retomar envio" aparece. Clique.
- Esperado: as linhas voltam a "Enviado" com o **mesmo** `providerMessageId` de antes (o Resend devolveu a resposta guardada pela `Idempotency-Key` `eb-<id>-0`).
- No painel do Resend continuam **3** e-mails desse envio, sem nenhum novo.
- Anote o `providerMessageId` antes do UPDATE para comparar.

- [ ] **Step 7: Commit**

```bash
git add src/components/email "src/app/[locale]/app/email/new" "src/app/[locale]/app/email/[id]/edit"
git commit -m "[E-mail] - Adiciona a tela de composicao com destinatarios e resumo ao vivo" -m "Editor TipTap das Propostas, grupos de contatos/empresas, avulsos com busca e colagem, envio de teste e confirmacao antes de enviar." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Relatório do envio

**Files:**
- Create: `src/app/[locale]/app/email/[id]/page.tsx`
- Create: `src/components/email/report-actions.tsx`
- Create: `src/components/email/auto-refresh.tsx`

**Interfaces:**
- Consome:
  - `getEmailBroadcast`, `getEmailBroadcastReport` e `ReportFilter` (Task 6);
  - `readStats` (Task 6);
  - `composeEmail` (Task 3);
  - `getResendConnection` e `deliveryTrackingActive` (Task 5);
  - `resumeEmailBroadcast` (Task 9), `duplicateEmailBroadcast` (Task 8);
  - `StatusBadge` (Task 7).
- Produz: `ReportActions({ id, canResume })` e `AutoRefresh({ active })`.

- [ ] **Step 1: `src/components/email/auto-refresh.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/** Re-render the server page every 5s while a send is running. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const handle = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(handle);
  }, [active, router]);
  return null;
}
```

- [ ] **Step 2: `src/components/email/report-actions.tsx`**

```tsx
"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Copy, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";
import { duplicateEmailBroadcast, resumeEmailBroadcast } from "@/app/actions/email-broadcasts";

export function ReportActions({ id, canResume }: { id: string; canResume: boolean }) {
  const t = useTranslations("emailBroadcast");
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      {canResume ? (
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await resumeEmailBroadcast(id);
              if (!r.ok) toast(r.message ?? t(`error.${r.error}`), { variant: "error" });
              router.refresh();
            })
          }
        >
          <Play className="size-4" />
          {t("report.resume")}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await duplicateEmailBroadcast(id);
            if (r.ok) router.push(`/app/email/${r.id}/edit`);
            else toast(t(`error.${r.error}`), { variant: "error" });
          })
        }
      >
        <Copy className="size-4" />
        {t("report.duplicate")}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: `src/app/[locale]/app/email/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import {
  getEmailBroadcast,
  getEmailBroadcastReport,
  type ReportFilter,
} from "@/lib/queries/email-broadcasts";
import { readStats } from "@/lib/validations/email-broadcast";
import { composeEmail } from "@/lib/email-broadcast/compose";
import { getResendConnection, deliveryTrackingActive } from "@/lib/email-broadcast/connection";
import { StatusBadge } from "@/components/email/status-badge";
import { ReportActions } from "@/components/email/report-actions";
import { AutoRefresh } from "@/components/email/auto-refresh";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FILTERS: ReportFilter[] = ["all", "queued", "sent", "delivered", "problems"];
const COUNTER_ORDER = ["QUEUED", "SENT", "DELIVERED", "BOUNCED", "COMPLAINED", "FAILED"] as const;
const BAR_COLORS: Record<(typeof COUNTER_ORDER)[number], string> = {
  QUEUED: "bg-transparent",
  SENT: "bg-blue-500",
  DELIVERED: "bg-green-600",
  BOUNCED: "bg-red-600",
  COMPLAINED: "bg-amber-600",
  FAILED: "bg-red-400",
};

export default async function EmailReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const format = await getFormatter();

  const b = await getEmailBroadcast(ctx.organizationId, id);
  if (!b) notFound();
  if (b.status === "DRAFT") redirect({ href: `/app/email/${id}/edit`, locale });

  const requested = (await searchParams).status ?? "all";
  const filter: ReportFilter = (FILTERS as string[]).includes(requested) ? (requested as ReportFilter) : "all";
  const [{ counts, recipients, canResume }, conn] = await Promise.all([
    getEmailBroadcastReport(ctx.organizationId, id, filter),
    getResendConnection(ctx.organizationId),
  ]);

  const total = COUNTER_ORDER.reduce((n, s) => n + counts[s], 0);
  const processed = total - counts.QUEUED;
  const stats = readStats(b.stats);
  const filterCount: Record<ReportFilter, number> = {
    all: total,
    queued: counts.QUEUED,
    sent: counts.SENT,
    delivered: counts.DELIVERED,
    problems: counts.BOUNCED + counts.COMPLAINED + counts.FAILED,
  };
  // Preview of what went out, with the tokens left visible.
  const preview = composeEmail({
    subject: b.subject,
    bodyHtml: b.html,
    vars: { nome: "{{nome}}", empresa: "{{empresa}}" },
    orgName: ctx.organization.name,
    unsubscribeUrl: "#",
  });

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={b.status === "SENDING"} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            <Link href="/app/email" className="hover:underline">
              {t("title")}
            </Link>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{b.subject || t("noSubject")}</h1>
            <StatusBadge status={b.status} label={t(`status.${b.status}`)} />
          </div>
          {b.startedAt ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("report.started", { date: format.dateTime(b.startedAt, { dateStyle: "short", timeStyle: "short" }) })}
            </p>
          ) : null}
        </div>
        <ReportActions id={b.id} canResume={canResume} />
      </div>

      {b.status === "PAUSED" && b.pausedReason ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {t(`paused.${b.pausedReason}`)}
          {b.lastError ? ` (${b.lastError})` : ""}
        </p>
      ) : null}
      {conn && !deliveryTrackingActive(conn) ? (
        <p className="text-sm text-muted-foreground">{t("report.noTracking")}</p>
      ) : null}

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <p className="font-semibold tabular-nums">{t("report.processed", { done: processed, total })}</p>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
          {COUNTER_ORDER.filter((s) => s !== "QUEUED").map((s) => (
            <div
              key={s}
              className={BAR_COLORS[s]}
              style={{ width: total ? `${(counts[s] / total) * 100}%` : "0%" }}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {COUNTER_ORDER.map((s) => (
            <div key={s} className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2">
              <span className="text-xs text-muted-foreground">{t(`report.counters.${s}`)}</span>
              <span className="text-xl font-bold tabular-nums">{format.number(counts[s])}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {t("report.removed", { duplicates: stats.duplicates, suppressed: stats.suppressed, invalid: stats.invalid })}
        </p>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <nav className="flex flex-wrap gap-2 border-b border-border p-3">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={f === "all" ? `/app/email/${id}` : `/app/email/${id}?status=${f}`}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium tabular-nums",
                f === filter ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`report.filter.${f}`)} · {format.number(filterCount[f])}
            </Link>
          ))}
        </nav>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("report.col.recipient")}</th>
                <th className="px-5 py-3 font-medium">{t("report.col.source")}</th>
                <th className="px-5 py-3 font-medium">{t("report.col.status")}</th>
                <th className="px-5 py-3 font-medium">{t("report.col.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium">{r.name ?? r.email}</div>
                    {r.name ? <div className="text-xs text-muted-foreground">{r.email}</div> : null}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {r.sources.map((s) => t(`report.source.${s}`)).join(" + ")}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={r.status} label={t(`report.counters.${r.status}`)} />
                    {r.error ? <div className="mt-1 max-w-sm text-xs text-red-600">{r.error}</div> : null}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {format.dateTime(r.updatedAt, { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recipients.length === 200 ? (
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            {t("report.showing", { count: 200 })}
          </p>
        ) : null}
      </section>

      <details className="rounded-xl border border-border bg-card p-5">
        <summary className="cursor-pointer text-sm font-medium text-brand">{t("report.viewEmail")}</summary>
        <iframe
          title={t("report.viewEmail")}
          srcDoc={preview.html}
          sandbox=""
          className="mt-4 h-[600px] w-full rounded-lg border border-border bg-white"
        />
      </details>
    </div>
  );
}
```

- [ ] **Step 2b: Verificar**

Run: `npm run typecheck && npm run lint && npm run build`
Esperado: PASS.

No navegador, abra o relatório do envio da Task 10:
- os contadores somam o total;
- os filtros mudam a tabela e mantêm a contagem;
- "Ver e-mail enviado" mostra o e-mail com `{{nome}}` visível e o rodapé;
- durante um envio novo, a página se atualiza sozinha a cada 5 s;
- com o envio pausado (`UPDATE email_broadcasts SET status='PAUSED', "pausedReason"='quota' WHERE id='<id>'`), aparecem o aviso amarelo e o botão "Retomar envio".

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/app/email/[id]/page.tsx" src/components/email/report-actions.tsx src/components/email/auto-refresh.tsx
git commit -m "[E-mail] - Adiciona o relatorio do envio com retomada e duplicacao" -m "Progresso, contadores por status, filtros, origem deduplicada por destinatario e previa do e-mail enviado." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Descadastro (página, um clique e lista de bloqueio)

**Files:**
- Create: `src/lib/email-broadcast/suppression.ts`
- Create: `src/app/actions/email-unsubscribe.ts`
- Create: `src/components/email/email-unsubscribe-form.tsx`
- Create: `src/app/[locale]/email-unsubscribe/[recipientId]/[sig]/page.tsx`
- Create: `src/app/api/email/unsubscribe/[recipientId]/[sig]/route.ts`
- Modify: `src/messages/pt.json`, `src/messages/en.json` (namespace `emailUnsubscribe`)
- Modify: `docs/guia/05-rotas-e-jobs.md`

**Interfaces:**
- Consome: `verifyEmailUnsubscribeSig` (Task 4), `normalizeEmail` (Task 2).
- Produz:
  - `suppressEmail(organizationId, email, reason, recipientId?)`;
  - `unsubscribeRecipient(recipientId): Promise<{ ok: boolean }>`;
  - a action pública `confirmEmailUnsubscribe(recipientId, sig)`;
  - a rota POST de descadastro em um clique.

- [ ] **Step 1: `src/lib/email-broadcast/suppression.ts`**

```ts
import "server-only";
import type { EmailSuppressionReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "./normalize";

/**
 * Write side of the suppression list. System context (raw Prisma) because the
 * callers have no session — the unsubscribe link (HMAC-authorized) and the
 * Resend webhook (Svix-authorized) — so organizationId always comes from the
 * authorized recipient/connection row. createMany+skipDuplicates instead of
 * upsert: idempotent and inside the tenant-safe operation set.
 */
export async function suppressEmail(
  organizationId: string,
  email: string,
  reason: EmailSuppressionReason,
  recipientId?: string,
): Promise<void> {
  await prisma.emailSuppression.createMany({
    data: [{ organizationId, email: normalizeEmail(email), reason, recipientId: recipientId ?? null }],
    skipDuplicates: true,
  });
}

/** Block the address of one recipient row for its org. Never touches Contact.optedOut. */
export async function unsubscribeRecipient(recipientId: string): Promise<{ ok: boolean }> {
  const r = await prisma.emailBroadcastRecipient.findFirst({
    where: { id: recipientId },
    select: { organizationId: true, email: true },
  });
  if (!r) return { ok: false };
  await suppressEmail(r.organizationId, r.email, "UNSUBSCRIBED", recipientId);
  return { ok: true };
}
```

- [ ] **Step 2: Action pública e formulário**

`src/app/actions/email-unsubscribe.ts`:

```ts
"use server";

import { verifyEmailUnsubscribeSig } from "@/lib/email-broadcast/unsubscribe";
import { unsubscribeRecipient } from "@/lib/email-broadcast/suppression";

/**
 * Public on purpose (no session): the HMAC in the link authorizes blocking
 * that one recipient's address for the org that sent it.
 */
export async function confirmEmailUnsubscribe(recipientId: string, sig: string): Promise<{ ok: boolean }> {
  if (!verifyEmailUnsubscribeSig(String(recipientId), String(sig))) return { ok: false };
  try {
    return await unsubscribeRecipient(recipientId);
  } catch (error) {
    console.error("Failed to unsubscribe email recipient", error);
    return { ok: false };
  }
}
```

`src/components/email/email-unsubscribe-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmEmailUnsubscribe } from "@/app/actions/email-unsubscribe";

/** The click is the consent: link scanners only GET the page, they don't press this. */
export function EmailUnsubscribeForm({ recipientId, sig }: { recipientId: string; sig: string }) {
  const t = useTranslations("emailUnsubscribe");
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <p className="inline-flex items-center gap-2 text-green-600">
        <CheckCircle2 className="size-5" />
        {t("done")}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await confirmEmailUnsubscribe(recipientId, sig);
            if (r.ok) setDone(true);
            else setFailed(true);
          })
        }
      >
        {pending ? t("processing") : t("confirm")}
      </Button>
      {failed ? <p className="text-sm text-red-600">{t("failed")}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: Página `src/app/[locale]/email-unsubscribe/[recipientId]/[sig]/page.tsx`**

```tsx
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { verifyEmailUnsubscribeSig } from "@/lib/email-broadcast/unsubscribe";
import { EmailUnsubscribeForm } from "@/components/email/email-unsubscribe-form";
import { Logo } from "@/components/layout/logo";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function EmailUnsubscribePage({
  params,
}: {
  params: Promise<{ locale: string; recipientId: string; sig: string }>;
}) {
  const { locale: rawLocale, recipientId, sig } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("emailUnsubscribe");

  // Public page, no session: only after the HMAC checks out do we read which
  // org sent it (system context, row authorized by the signature).
  const valid = verifyEmailUnsubscribeSig(recipientId, sig);
  const recipient = valid
    ? await prisma.emailBroadcastRecipient.findFirst({
        where: { id: recipientId },
        select: { organizationId: true },
      })
    : null;
  const org = recipient
    ? await prisma.organization.findFirst({ where: { id: recipient.organizationId }, select: { name: true } })
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Logo className="text-xl" />
        {recipient ? (
          <>
            <h1 className="mt-4 text-lg font-semibold">{t("title")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("body", { org: org?.name ?? "" })}</p>
            <div className="mt-6 flex justify-center">
              <EmailUnsubscribeForm recipientId={recipientId} sig={sig} />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold">{t("invalidTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("invalidBody")}</p>
          </>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Rota one-click `src/app/api/email/unsubscribe/[recipientId]/[sig]/route.ts`**

```ts
import type { NextRequest } from "next/server";
import { verifyEmailUnsubscribeSig } from "@/lib/email-broadcast/unsubscribe";
import { unsubscribeRecipient } from "@/lib/email-broadcast/suppression";

export const runtime = "nodejs";

/**
 * RFC 8058 one-click unsubscribe (the List-Unsubscribe-Post header Gmail and
 * Yahoo require for bulk mail). PUBLIC ON PURPOSE: the HMAC in the path is
 * the authorization — it's checked first, before any read. POST only, so a
 * link preview (GET) never unsubscribes; idempotent.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ recipientId: string; sig: string }> },
) {
  const { recipientId, sig } = await params;
  if (!verifyEmailUnsubscribeSig(recipientId, sig)) {
    return new Response("Invalid link", { status: 403 });
  }
  try {
    const r = await unsubscribeRecipient(recipientId);
    return r.ok ? new Response(null, { status: 200 }) : new Response("Not found", { status: 404 });
  } catch (error) {
    console.error("[email] one-click unsubscribe failed", error);
    return new Response("error", { status: 500 });
  }
}
```

- [ ] **Step 5: Textos**

`pt.json`, namespace de primeiro nível novo:

```json
  "emailUnsubscribe": {
    "title": "Descadastrar",
    "body": "Confirme para não receber mais e-mails em massa de {org}.",
    "confirm": "Confirmar descadastro",
    "processing": "Processando…",
    "done": "Pronto. Você não vai mais receber estes e-mails.",
    "failed": "Não foi possível concluir. Tente de novo.",
    "invalidTitle": "Link inválido",
    "invalidBody": "Este link de descadastro é inválido."
  },
```

`en.json`:

```json
  "emailUnsubscribe": {
    "title": "Unsubscribe",
    "body": "Confirm to stop receiving bulk emails from {org}.",
    "confirm": "Confirm unsubscribe",
    "processing": "Processing…",
    "done": "Done. You won't receive these emails anymore.",
    "failed": "Could not complete. Try again.",
    "invalidTitle": "Invalid link",
    "invalidBody": "This unsubscribe link is invalid."
  },
```

Rode de novo o one-liner de paridade da Task 7. Esperado: `[] []`.

- [ ] **Step 6: Guia 05**

Em `docs/guia/05-rotas-e-jobs.md`, na tabela "Os quatro jeitos de autenticar uma rota":
- acrescente a linha
  `| Destinatário de e-mail em massa (link) | HMAC do id do destinatário no caminho → verifyEmailUnsubscribeSig | src/lib/email-broadcast/unsubscribe.ts |`;
- ajuste o título para "Os jeitos de autenticar uma rota neste repo".

Depois da tabela, acrescente um parágrafo: `/api/email/unsubscribe/[recipientId]/[sig]` é **pública de propósito** (RFC 8058); a assinatura é a primeira checagem, só aceita POST, e a server action `confirmEmailUnsubscribe` segue o mesmo padrão (server actions também são endpoints públicos).

- [ ] **Step 7: Verificar (Review Focus 4)**

Run: `npm run typecheck && npm run lint && npm run build`
Esperado: PASS.

Com o `next dev` rodando, pegue um `id` de destinatário do envio da Task 10 e calcule a assinatura:

```bash
node --env-file=.env -e "const c=require('crypto');console.log(c.createHmac('sha256',process.env.SESSION_SECRET).update('email-broadcast-unsub:'+process.argv[1]).digest('hex'))" <recipientId>
```

- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/email-unsubscribe/<id>/<sig>` → `200`. Nenhuma linha nova em `email_suppressions`, porque o GET não descadastra.
- `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/email/unsubscribe/<id>/errado` → `403`.
- `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/email/unsubscribe/<id>/<sig>` → `200`, com uma linha em `email_suppressions` (`UNSUBSCRIBED`). Repetir devolve `200`, e continua uma linha só.
- Abra a página no navegador e clique "Confirmar descadastro" → "Pronto…".
- Num rascunho novo com esse endereço, o resumo mostra "Descadastrados, bounce ou spam: 1".
- Confira que `contacts."optedOut"` do contato **não** mudou.

- [ ] **Step 8: Commit**

```bash
git add src/lib/email-broadcast/suppression.ts src/app/actions/email-unsubscribe.ts src/components/email/email-unsubscribe-form.tsx "src/app/[locale]/email-unsubscribe" "src/app/api/email" src/messages/pt.json src/messages/en.json docs/guia/05-rotas-e-jobs.md
git commit -m "[E-mail] - Adiciona o descadastro por link e por um clique" -m "Pagina com confirmacao (GET nao descadastra), POST RFC 8058 assinado por HMAC e lista de bloqueio propria; Contact.optedOut intocado." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Webhook de entrega do Resend

**Files:**
- Create: `src/app/api/webhooks/resend/[connectionId]/route.ts`
- Modify: `docs/guia/05-rotas-e-jobs.md`

**Interfaces:**
- Consome:
  - `webhookSecret` (Task 5);
  - `verifySvixSignature`, `parseResendEvent`, `TRANSITIONS` e `suppressionFor` (Task 4);
  - `suppressEmail` (Task 12).
- Produz: a rota `POST /api/webhooks/resend/{connectionId}`.

- [ ] **Step 1: Criar a rota**

```ts
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { webhookSecret } from "@/lib/email-broadcast/connection";
import { parseResendEvent, suppressionFor, TRANSITIONS, verifySvixSignature } from "@/lib/email-broadcast/webhook";
import { suppressEmail } from "@/lib/email-broadcast/suppression";

export const runtime = "nodejs";

/**
 * Delivery events for the mass e-mail, posted by the CLIENT's Resend account
 * (registered by ensureResendWebhook). Authorization: the Svix signature with
 * the per-connection secret, checked before anything else is trusted. The
 * connection row gives the org; every write filters by it. Separate from the
 * generic /api/webhooks/[provider] sink (Campaigns), which stays untouched.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const body = await req.text();

  const conn = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, provider: "RESEND" },
    select: { id: true, organizationId: true, meta: true },
  });
  if (!conn) return new Response("Unknown connection", { status: 404 });

  const secret = webhookSecret(conn.meta);
  const svixId = req.headers.get("svix-id");
  if (
    !secret ||
    !verifySvixSignature({
      secret,
      id: svixId,
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
      body,
    })
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const dedupeKey = `RESEND:${svixId}`;
  try {
    await prisma.webhookEvent.create({
      data: {
        organizationId: conn.organizationId,
        provider: "RESEND",
        eventType: String((payload as { type?: unknown })?.type ?? "unknown"),
        dedupeKey,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ ok: true, duplicate: true }); // Svix retry of an event we already have
    }
    console.error("[webhook:resend] failed to store event", error);
    return new Response("error", { status: 500 });
  }

  const event = parseResendEvent(payload);
  if (event) {
    try {
      const t = TRANSITIONS[event.type];
      await prisma.emailBroadcastRecipient.updateMany({
        where: { organizationId: conn.organizationId, providerMessageId: event.emailId, status: { in: t.from } },
        data: { status: t.to, ...(event.message ? { error: event.message.slice(0, 500) } : {}) },
      });
      const reason = suppressionFor(event);
      if (reason) {
        const r = await prisma.emailBroadcastRecipient.findFirst({
          where: { organizationId: conn.organizationId, providerMessageId: event.emailId },
          select: { id: true, email: true },
        });
        // An email_id from outside this module (same Resend account) matches nothing: ignored.
        if (r) await suppressEmail(conn.organizationId, r.email, reason, r.id);
      }
      await prisma.webhookEvent.updateMany({ where: { dedupeKey }, data: { processedAt: new Date() } });
    } catch (error) {
      // Best-effort: a 500 here would make Svix retry an event we already stored.
      console.error("[webhook:resend] failed to apply event", error);
    }
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Guia 05**

Na mesma tabela, acrescente a linha
`| Resend (webhook do e-mail em massa) | assinatura Svix com segredo por conexão → verifySvixSignature | src/app/api/webhooks/resend/[connectionId]/route.ts |`.
Anote também que o registro do webhook na conta do cliente é automático (`ensureResendWebhook`) e que em dev só funciona com `NEXT_PUBLIC_SITE_URL` https (ngrok).

- [ ] **Step 3: Verificar (Review Focus 5)**

Run: `npm run typecheck && npm run lint && npm run build`
Esperado: PASS.

Em dev o registro automático é pulado (localhost), então grave um segredo de teste na conexão RESEND local. Crie **fora do repositório** um arquivo `%TEMP%\resend-e2e.mjs`:

```js
// Usage:
//   node --env-file=.env %TEMP%\resend-e2e.mjs secret
//   node --env-file=.env %TEMP%\resend-e2e.mjs sign <providerMessageId> <type> [svixId]
import crypto from "node:crypto";
const SECRET = "whsec_" + Buffer.from("local-e2e-secret").toString("base64");
const [mode, emailId, type = "email.delivered", svixId = "msg_" + Date.now()] = process.argv.slice(2);
if (mode === "secret") {
  const key = Buffer.from(process.env.INTEGRATION_ENC_KEY, "hex");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ secret: SECRET }), "utf8"), c.final()]);
  console.log([iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":"));
} else {
  const ts = String(Math.floor(Date.now() / 1000));
  const data = { email_id: emailId };
  if (type === "email.bounced") data.bounce = { type: "Permanent", subType: "General", message: "Caixa inexistente" };
  const body = JSON.stringify({ type, data });
  const sig = "v1," + crypto.createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`${svixId}.${ts}.${body}`).digest("base64");
  console.log(`curl -s -w " %{http_code}" -X POST http://localhost:3000/api/webhooks/resend/CONN -H "svix-id: ${svixId}" -H "svix-timestamp: ${ts}" -H "svix-signature: ${sig}" -H "content-type: application/json" -d '${body}'`);
}
```

1. `node --env-file=.env %TEMP%\resend-e2e.mjs secret` → copie a saída (`<enc>`) e rode no SQL:
   `UPDATE integration_connections SET meta = jsonb_set(coalesce(meta::jsonb,'{}'), '{emailWebhook}', jsonb_build_object('id','local','secretEnc','<enc>','keyHash','x','endpoint','x')) WHERE id = '<connId>';`
2. Sem headers: `curl -s -w " %{http_code}" -X POST http://localhost:3000/api/webhooks/resend/<connId> -d '{}'` → `401`.
3. Conexão desconhecida: troque `<connId>` por `nao-existe` → `404`.
4. Pegue o `providerMessageId` de um destinatário "Enviado" e rode `node %TEMP%\resend-e2e.mjs sign <providerMessageId> email.delivered evt_1`. Troque `CONN` por `<connId>` no comando impresso e execute → `{"ok":true} 200`. O destinatário vira "Entregue".
5. Rode **o mesmo** comando de novo (mesmo `evt_1` e timestamp) → `{"ok":true,"duplicate":true} 200`.
6. `sign <outro providerMessageId> email.bounced evt_2` → `200`. O destinatário vira "Bounce" com "Caixa inexistente" e o endereço entra em `email_suppressions` como `BOUNCED`.
7. `sign id-que-nao-existe email.delivered evt_3` → `200`, sem nenhuma linha alterada.
8. Limpe o teste: `UPDATE integration_connections SET meta = meta::jsonb - 'emailWebhook' WHERE id = '<connId>';`

**Opcional, com ngrok:**
- Suba o ngrok, ponha a URL https em `NEXT_PUBLIC_SITE_URL` e reinicie o `next dev`.
- Envie para `delivered@resend.dev` e `complained@resend.dev`.
- A lista mostra "status de entrega ativo", e o relatório recebe "Entregue" e "Marcou spam" de verdade.
- **Depois apague** o webhook criado na conta Resend usada (painel → Webhooks).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/webhooks/resend" docs/guia/05-rotas-e-jobs.md
git commit -m "[E-mail] - Adiciona o webhook de entrega do Resend com assinatura Svix" -m "Entregue/bounce/spam/falha atualizam o destinatario so para frente; bounce permanente e spam entram na lista de bloqueio. Rota separada do webhook generico de Campanhas." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Documentação final e verificação completa

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md` (contagem de chaves i18n)
- Modify: `docs/guia/04-modulos-e-permissoes.md` (contagem de chaves i18n)

- [ ] **Step 1: Contagem de chaves e paridade**

Run o one-liner de paridade da Task 7.
Esperado: os dois números iguais (2641 + as chaves novas) e `[] []`.

Atualize "2641" para o número novo em `CLAUDE.md` ("chaves (N hoje)") e em `docs/guia/04-modulos-e-permissoes.md` ("**N chaves-folha cada um**").

- [ ] **Step 2: README**

- Na tabela de stack, a linha do Resend passa a ser: "**Resend**: transacional da plataforma (verificação, convites, reset) e, com a **chave de cada cliente**, o submenu E-mail (envio em massa)".
- Na seção de integrações, acrescente um item curto:
  - **E-mail em massa:** `src/lib/email-broadcast/` e as tabelas `email_broadcasts`, `email_broadcast_recipients` e `email_suppressions`.
  - Um destinatário por endereço por envio, garantido por `@@unique`.
  - Lotes de 100 com `Idempotency-Key`; sem QStash, roda em `after()` e tem o botão "Retomar envio".
  - O webhook de entrega é registrado sozinho na conta do cliente: `/api/webhooks/resend/[connectionId]`, com assinatura Svix.
  - O descadastro é próprio (`/email-unsubscribe/...` e o one-click `/api/email/unsubscribe/...`) e **não** altera `Contact.optedOut`.
  - O spec está em `docs/superpowers/specs/2026-10-06-email-em-massa-design.md`.
- No runbook (§8), antes do merge desta branch: aplicar no Supabase o SQL de `prisma/migrations/<timestamp>_email_broadcasts/migration.sql` (só `CREATE`). A Hostinger não roda migrations.

- [ ] **Step 3: As cinco checagens + a do módulo**

Run: `npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node && npm run check:email`
Esperado: tudo PASS. `check:isolation` termina em `✅` com 12 asserções; `check:email` com `18 checks passed`.

- [ ] **Step 4: Campanhas intocada**

Run: `git diff main --stat -- src/lib/dispatch.ts src/lib/integrations src/app/api/webhooks/[provider] src/app/actions/campaigns.ts src/app/actions/unsubscribe.ts src/lib/queries/campaigns.ts src/lib/validations/campaign.ts src/components/campaigns "src/app/[locale]/app/campaigns" src/lib/unsubscribe.ts "src/app/[locale]/unsubscribe"`
Esperado: **saída vazia**.

E `git diff main -- prisma/schema.prisma` tem só linhas `+` no bloco "Mass e-mail".

- [ ] **Step 5: Smoke final no navegador**

Com o `next dev` limpo (reinicie), refaça rapidamente o roteiro:
1. Lista.
2. Novo e-mail com dedupe.
3. Teste.
4. Envio.
5. Relatório.
6. Descadastro.
7. Novo rascunho excluindo o descadastrado.

Abra também `/app/campaigns` e crie uma campanha de rascunho para confirmar que nada mudou ali.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/guia/04-modulos-e-permissoes.md
git commit -m "[Docs] - Documenta o submenu E-mail no README e atualiza a contagem de i18n" -m "Inclui o passo de aplicar a migration no Supabase antes do merge." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Parar e reportar**

Não faça push nem PR. Reporte ao usuário:
- o que passou;
- o que ficou pendente (E2E com ngrok, se não rodou);
- o lembrete de aplicar a migration no Supabase antes do merge.

Pergunte como ele quer integrar a branch (skill `superpowers:finishing-a-development-branch`).

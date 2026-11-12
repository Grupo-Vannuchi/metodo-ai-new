# Assinaturas no E-mail em massa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada empresa cadastra assinaturas de e-mail ("Texto e imagens" ou "Imagem pronta"), marca uma como padrão e escolhe uma em cada envio de Comunicação → E-mail.

**Architecture:**
- **Regras puras** (`src/lib/email-broadcast/signature.ts`) validam e montam o HTML e o texto da assinatura. A tela, as actions, o composer e o envio usam essas mesmas regras.
- **Dados:**
  - uma tabela nova, `email_signatures`, por empresa;
  - o rascunho guarda `signatureId`;
  - ao iniciar o envio, o servidor congela `signatureHtml` e `signatureText` no próprio envio, e o despachante só lê essa cópia.
- **Telas:** a aba "Assinaturas" dentro do E-mail (lista + formulário) e a seção "Assinatura" no composer.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma 6 + PostgreSQL (Docker local, Supabase em produção), next-intl 4, zod 3, TipTap (`RichTextEditor`), tsx.

**Spec:** [docs/superpowers/specs/2026-10-13-email-assinaturas-design.md](../specs/2026-10-13-email-assinaturas-design.md). Protótipo: https://claude.ai/artifact/A9rEUB6c9PQctSoFRhvgwK.

## Global Constraints

- **Campanhas, e-mail transacional e Propostas não mudam.** Arquivos proibidos:
  - `src/lib/dispatch.ts`, `src/lib/integrations/**`, `src/lib/email/**`;
  - `src/components/campaigns/**`;
  - `src/components/proposals/rich-text-editor.tsx` e `src/lib/proposals/sanitize.ts` (só importados, nunca alterados).
- **Multi-tenant (guia 03):**
  - em request de usuário, use `tenantDb(orgId)`; por id, `findFirst` + `updateMany`/`deleteMany` com checagem de `count`;
  - nunca use `findUnique`/`update`/`delete`/`upsert` em tabela de negócio;
  - o despachante é contexto de sistema: Prisma cru, com `organizationId` explícito.
- **Banco local = Docker** (`docker compose up -d postgres`, container `metodoai-db`). Nunca o Postgres portátil.
- **Nunca** rode `prisma migrate dev`, `migrate reset` ou `db push`. A migration só entra pelo procedimento da Task 2.
- **i18n:**
  - `src/messages/pt.json` e `en.json` com as mesmas chaves, sem `{{` dentro de mensagem;
  - hoje são **2822** chaves de cada lado e o plano acrescenta 75, então o fim é **2897**;
  - a contagem fica no CLAUDE.md e no guia 04 (Task 8).
- **Env:** só via `src/lib/env.ts`.
- **Números fixos (da spec):**
  - `MAX_SIGNATURES = 20`, `MAX_SIGNATURE_NAME = 60`;
  - `MAX_SIGNATURE_HTML = 50_000`, `MAX_SIGNATURE_LINE = 200` (texto acima e texto alternativo);
  - margem da assinatura no e-mail: `margin-top:24px`.
- **Regras de produto:**
  - as assinaturas são da empresa, e qualquer pessoa com acesso à tela E-mail cria, edita e exclui;
  - só uma padrão por empresa;
  - a assinatura não usa variáveis (`{{nome}}`/`{{empresa}}`);
  - o despachante nunca lê `email_signatures`.
- **HTML na tela:** só use `dangerouslySetInnerHTML` com HTML que veio do servidor passando por `sanitizeHtml` (o `previewHtml`), ou com a saída de `renderSignature` no modo IMAGE, que já sai escapada. O HTML do modo TEXT é sanitizado ao salvar.
- **Commits:** `[E-mail] - Verbo + tarefa`, corpo curto, última linha exatamente `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feature/email-assinaturas` (já criada a partir da `main`). **Sem push.**
- Comentários de código em inglês; textos de tela em pt-BR e en; docs em pt-BR.
- **Servidor de dev:** pare qualquer `next dev` antes de `npm run build`. Se precisar subir, use a porta 3000 (`npx next dev --webpack`) e **nunca** um segundo servidor em outra porta.
- **Ambiente:**
  - Node 20: nenhuma API mais nova;
  - Windows: código-fonte ASCII nas regras puras; caracteres especiais em testes via `String.fromCharCode`.
- **Envio real pelo Resend** (Task 8) só com autorização explícita do usuário.

## Review Focus

1. **Assinatura excluída com o composer aberto** → salvar ou enviar devolve `signature_missing`, e o e-mail nunca sai sem a assinatura que a pessoa viu. Cobertura: checagem em `saveEmailDraft` e em `startEmailBroadcast` (Task 4); Task 8, passo 6.
2. **Assinatura editada depois de um envio começar** → o envio em andamento e os envios feitos não mudam. Cobertura: o despachante só lê `signatureHtml`/`signatureText` (Task 4, o revisor confere no diff); Task 8, passo 4.
3. **Empresa B manda o `signatureId` de uma assinatura da empresa A** (action chamada à mão) → `signature_missing`, porque a busca usa `tenantDb` da empresa B. Cobertura: `getEmailSignature` via `tenantDb` (Task 3) e o uso em `saveEmailDraft`/`startEmailBroadcast` (Task 4); asserção nova no `check:isolation` (Task 2).
4. **HTML malicioso salvo por uma chamada direta à action** → sai limpo na lista, na prévia do composer e no e-mail. Cobertura: `sanitizeHtml` ao salvar (Task 3) e de novo em `composeSignature`/`composeEmail` (Tasks 3 e 4).
5. **Marcar como padrão quando já existe uma padrão** → só a nova fica com o selo. Cobertura: `makeDefault` (Task 3); Task 8, passo 8.

---

### Task 1: Regras puras da assinatura

**Files:**
- Create: `src/lib/email-broadcast/signature.ts`
- Modify: `scripts/check-email-broadcast.ts`

**Interfaces:**
- Consome (já existem):
  - `escapeHtml`, `htmlToText` e `hasEmailContent` de `./render`;
  - `safeImageSrc` e `safeClickHref` de `./image-links`.
- Produz (exportados de `src/lib/email-broadcast/signature.ts`):
  - `MAX_SIGNATURES = 20`, `MAX_SIGNATURE_NAME = 60`, `MAX_SIGNATURE_HTML = 50_000`, `MAX_SIGNATURE_LINE = 200`;
  - `type SignatureKind = "TEXT" | "IMAGE"`;
  - `type SignatureContent = { kind: "TEXT"; html: string } | { kind: "IMAGE"; imageUrl: string; imageAlt: string; imageHref: string | null; introText: string | null }`;
  - `type SignatureProblem = "html_empty" | "html_too_long" | "image_required" | "image_url" | "alt_required" | "line_too_long" | "href"`;
  - `type SignatureFormFields = { kind: SignatureKind; html: string; imageUrl: string; imageAlt: string; imageHref: string; introText: string }`;
  - `type SignatureRow = { kind: SignatureKind; html: string; imageUrl: string | null; imageAlt: string | null; imageHref: string | null; introText: string | null }`;
  - `signatureImageSrc(raw: string): string | null`;
  - `signatureProblem(content: SignatureContent): SignatureProblem | null`;
  - `renderSignature(content: SignatureContent): { html: string; text: string }`;
  - `signatureContentFromForm(fields: SignatureFormFields): SignatureContent`;
  - `signatureContentOf(row: SignatureRow): SignatureContent`.

- [ ] **Step 1: Escrever as verificações que falham**

Em `scripts/check-email-broadcast.ts`, depois do último `import` do topo, acrescente:

```ts
import {
  renderSignature,
  signatureContentFromForm,
  signatureContentOf,
  signatureImageSrc,
  signatureProblem,
} from "../src/lib/email-broadcast/signature";
```

E logo antes da última linha (`console.log(\`\n✅ email-broadcast: ...`), acrescente:

```ts
// --- signatures --------------------------------------------------------------
const IMG = "https://cdn.exemplo.com/assinatura.png";

check("renderSignature TEXT passes the html and derives the text part", () => {
  const r = renderSignature({ kind: "TEXT", html: "<p><strong>Ana</strong></p><p>(11) 3000-0000</p>" });
  assert.equal(r.html, "<p><strong>Ana</strong></p><p>(11) 3000-0000</p>");
  assert.equal(r.text, "Ana\n(11) 3000-0000");
});

check("renderSignature IMAGE builds intro + linked image and escapes everything", () => {
  const r = renderSignature({
    kind: "IMAGE",
    imageUrl: IMG,
    imageAlt: 'Ana "Diretora" <Comercial> & cia',
    imageHref: "www.suaempresa.com.br",
    introText: "Atenciosamente,",
  });
  assert.equal(
    r.html,
    '<p>Atenciosamente,</p><a href="https://www.suaempresa.com.br/"><img src="https://cdn.exemplo.com/assinatura.png" alt="Ana &quot;Diretora&quot; &lt;Comercial&gt; &amp; cia"></a>',
  );
  assert.equal(r.text, 'Atenciosamente,\nAna "Diretora" <Comercial> & cia\nhttps://www.suaempresa.com.br/');
});

check("renderSignature IMAGE without intro or link is just the image", () => {
  const r = renderSignature({ kind: "IMAGE", imageUrl: IMG, imageAlt: "Ana", imageHref: null, introText: null });
  assert.equal(r.html, '<img src="https://cdn.exemplo.com/assinatura.png" alt="Ana">');
  assert.equal(r.text, "Ana");
});

check("signatureImageSrc takes https or the app's own local media route only", () => {
  assert.equal(signatureImageSrc(IMG), IMG);
  assert.equal(signatureImageSrc("http://localhost:3000/api/media/email/x.png"), "http://localhost:3000/api/media/email/x.png");
  assert.equal(signatureImageSrc("http://evil.example/x.png"), null);
  assert.equal(signatureImageSrc("javascript:alert(1)"), null);
  assert.equal(signatureImageSrc(""), null);
});

check("signatureProblem flags what blocks a save", () => {
  assert.equal(signatureProblem({ kind: "TEXT", html: "<p>Ana</p>" }), null);
  assert.equal(signatureProblem({ kind: "TEXT", html: "<p></p>" }), "html_empty");
  assert.equal(signatureProblem({ kind: "TEXT", html: `<p>${"a".repeat(50_000)}</p>` }), "html_too_long");
  const ok = { kind: "IMAGE" as const, imageUrl: IMG, imageAlt: "Ana", imageHref: null, introText: null };
  assert.equal(signatureProblem(ok), null);
  assert.equal(signatureProblem({ ...ok, imageUrl: "" }), "image_required");
  assert.equal(signatureProblem({ ...ok, imageUrl: "http://evil.example/x.png" }), "image_url");
  assert.equal(signatureProblem({ ...ok, imageAlt: "  " }), "alt_required");
  assert.equal(signatureProblem({ ...ok, imageAlt: "a".repeat(201) }), "line_too_long");
  assert.equal(signatureProblem({ ...ok, introText: "a".repeat(201) }), "line_too_long");
  assert.equal(signatureProblem({ ...ok, imageHref: "javascript:alert(1)" }), "href");
});

check("signatureContentFromForm trims and keeps only the chosen kind", () => {
  const base = { html: "<p>x</p>", imageUrl: ` ${IMG} `, imageAlt: " Ana ", imageHref: "  ", introText: "" };
  assert.deepEqual(signatureContentFromForm({ kind: "TEXT", ...base }), { kind: "TEXT", html: "<p>x</p>" });
  assert.deepEqual(signatureContentFromForm({ kind: "IMAGE", ...base }), {
    kind: "IMAGE",
    imageUrl: IMG,
    imageAlt: "Ana",
    imageHref: null,
    introText: null,
  });
});

check("signatureContentOf reads a stored row", () => {
  const row = { kind: "IMAGE" as const, html: "", imageUrl: IMG, imageAlt: "Ana", imageHref: null, introText: "Oi" };
  assert.deepEqual(signatureContentOf(row), { kind: "IMAGE", imageUrl: IMG, imageAlt: "Ana", imageHref: null, introText: "Oi" });
  assert.deepEqual(signatureContentOf({ ...row, kind: "TEXT", html: "<p>a</p>" }), { kind: "TEXT", html: "<p>a</p>" });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run check:email`
Esperado: FAIL com `Cannot find module '../src/lib/email-broadcast/signature'`.

- [ ] **Step 3: Implementar `signature.ts`**

Crie `src/lib/email-broadcast/signature.ts`:

```ts
/**
 * E-mail signature rules (spec 2026-10-13). Pure and free of `server-only`:
 * the signature form, the actions, the composer pages, the start of a send and
 * scripts/check-email-broadcast.ts all use it. The HTML built here is
 * sanitized on the server (compose.ts) before it is shown or sent.
 */
import { escapeHtml, hasEmailContent, htmlToText } from "./render";
import { safeClickHref, safeImageSrc } from "./image-links";

export const MAX_SIGNATURES = 20;
export const MAX_SIGNATURE_NAME = 60;
export const MAX_SIGNATURE_HTML = 50_000;
/** Intro text and alt text of an image signature. */
export const MAX_SIGNATURE_LINE = 200;

export type SignatureKind = "TEXT" | "IMAGE";

export type SignatureContent =
  | { kind: "TEXT"; html: string }
  | { kind: "IMAGE"; imageUrl: string; imageAlt: string; imageHref: string | null; introText: string | null };

export type SignatureProblem =
  | "html_empty"
  | "html_too_long"
  | "image_required"
  | "image_url"
  | "alt_required"
  | "line_too_long"
  | "href";

/** What the form edits (every field a string; the unused kind's are ignored). */
export type SignatureFormFields = {
  kind: SignatureKind;
  html: string;
  imageUrl: string;
  imageAlt: string;
  imageHref: string;
  introText: string;
};

/** The columns of an email_signatures row this module reads. */
export type SignatureRow = {
  kind: SignatureKind;
  html: string;
  imageUrl: string | null;
  imageAlt: string | null;
  imageHref: string | null;
  introText: string | null;
};

/** Image source of a signature: https, or this app's own local-disk media
 * route (dev storage serves /api/media/ over plain http). */
export function signatureImageSrc(raw: string): string | null {
  const https = safeImageSrc(raw);
  if (https) return https;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" && url.pathname.startsWith("/api/media/") ? url.href : null;
  } catch {
    return null;
  }
}

/** First reason the content can't be saved, or null. */
export function signatureProblem(content: SignatureContent): SignatureProblem | null {
  if (content.kind === "TEXT") {
    if (!hasEmailContent(content.html)) return "html_empty";
    return content.html.length > MAX_SIGNATURE_HTML ? "html_too_long" : null;
  }
  if (!content.imageUrl.trim()) return "image_required";
  if (!signatureImageSrc(content.imageUrl)) return "image_url";
  if (!content.imageAlt.trim()) return "alt_required";
  if (content.imageAlt.length > MAX_SIGNATURE_LINE || (content.introText ?? "").length > MAX_SIGNATURE_LINE) {
    return "line_too_long";
  }
  if (content.imageHref && !safeClickHref(content.imageHref)) return "href";
  return null;
}

/** HTML (to be sanitized by the caller) and plain-text part of a signature. */
export function renderSignature(content: SignatureContent): { html: string; text: string } {
  if (content.kind === "TEXT") {
    return { html: content.html, text: htmlToText(content.html).trim() };
  }
  const src = signatureImageSrc(content.imageUrl) ?? "";
  const href = content.imageHref ? safeClickHref(content.imageHref) : null;
  const intro = content.introText?.trim() || null;
  const alt = content.imageAlt.trim();
  const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  const html = `${intro ? `<p>${escapeHtml(intro)}</p>` : ""}${href ? `<a href="${escapeHtml(href)}">${img}</a>` : img}`;
  const text = [intro, alt, href].filter((line): line is string => Boolean(line)).join("\n");
  return { html, text };
}

/** Form fields → content: trimmed, empty optionals become null. */
export function signatureContentFromForm(fields: SignatureFormFields): SignatureContent {
  if (fields.kind === "TEXT") return { kind: "TEXT", html: fields.html };
  return {
    kind: "IMAGE",
    imageUrl: fields.imageUrl.trim(),
    imageAlt: fields.imageAlt.trim(),
    imageHref: fields.imageHref.trim() || null,
    introText: fields.introText.trim() || null,
  };
}

/** A stored row → content. */
export function signatureContentOf(row: SignatureRow): SignatureContent {
  if (row.kind === "IMAGE") {
    return {
      kind: "IMAGE",
      imageUrl: row.imageUrl ?? "",
      imageAlt: row.imageAlt ?? "",
      imageHref: row.imageHref,
      introText: row.introText,
    };
  }
  return { kind: "TEXT", html: row.html };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run check:email`
Esperado: PASS, com as 7 verificações novas listadas e o total no fim.

Se a primeira verificação falhar por espaços ou quebra de linha no `text`, compare com a saída real de `htmlToText` e **reporte**. Não altere a verificação.

Run: `npm run typecheck && npm run lint`
Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email-broadcast/signature.ts scripts/check-email-broadcast.ts
git commit -m "[E-mail] - Adiciona as regras puras das assinaturas" -m "Valida e monta a assinatura de texto ou de imagem (HTML escapado e versao so-texto); coberto no check:email." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Banco (tabela de assinaturas e cópia no envio)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261013120000_email_signatures/migration.sql` (gerado)
- Modify: `src/lib/tenant-db.ts`
- Modify: `scripts/check-isolation.ts`
- Modify: `docs/guia/03-multi-tenancy.md`

**Interfaces:**
- Produz:
  - o enum Prisma `EmailSignatureKind` (`TEXT`, `IMAGE`);
  - o model `emailSignature` (`id`, `organizationId`, `name`, `kind`, `html`, `imageUrl`, `imageAlt`, `imageHref`, `introText`, `isDefault`, `createdAt`, `updatedAt`);
  - em `emailBroadcast`: `signatureId: string | null`, `signatureHtml: string | null`, `signatureText: string | null`.

- [ ] **Step 1: Banco local do Docker de pé**

Run: `docker ps --format '{{.Names}} {{.Status}}'`. Esperado: `metodoai-db` com `(healthy)`.
- Se o daemon não responder, abra `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`, espere `docker info` responder e rode `docker compose up -d postgres`.

- [ ] **Step 2: Escrever o teste que falha (isolamento)**

Em `scripts/check-isolation.ts`, logo antes de `console.log("\n✅ Tenant isolation: all checks passed.");`:

```ts
    // 13) E-mail signatures are per org.
    await prisma.emailSignature.create({
      data: { organizationId: orgA.id, name: "ISO", kind: "TEXT", html: "<p>A</p>" },
    });
    const signaturesB = await prisma.emailSignature.findMany({
      where: { organizationId: orgB.id },
    });
    assert(signaturesB.length === 0, "e-mail signatures scoped to org B exclude org A's signature");
```

No `finally`, logo antes de `await prisma.taskBoardColumn.deleteMany(`:

```ts
    await prisma.emailSignature.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
```

Run: `npm run typecheck`
Esperado: FAIL com `Property 'emailSignature' does not exist`.

- [ ] **Step 3: Schema**

Em `prisma/schema.prisma`, no `model EmailBroadcast`, logo depois da linha `attachments    Json                 @default("[]")` (e do comentário `///` dela), acrescente:

```prisma
  /// Signature chosen in the composer (null = none). Deleting it nulls this.
  signatureId    String?
  signature      EmailSignature?      @relation(fields: [signatureId], references: [id], onDelete: SetNull)
  /// Frozen copy taken when the send starts (sanitized HTML + text part); the
  /// dispatcher only ever reads these, never email_signatures.
  signatureHtml  String?              @db.Text
  signatureText  String?              @db.Text
```

Logo depois do bloco `model EmailSenderDomain { ... }`, acrescente:

```prisma
enum EmailSignatureKind {
  TEXT
  IMAGE
}

/// A reusable e-mail signature of ONE organization (spec 2026-10-13). Anyone
/// with the E-mail screen manages them; at most one isDefault per org (set by
/// the actions).
model EmailSignature {
  id             String             @id @default(cuid())
  organizationId String
  name           String
  kind           EmailSignatureKind @default(TEXT)
  /// TEXT: editor HTML, sanitized on save and again whenever it is rendered.
  html           String             @default("") @db.Text
  /// IMAGE fields (null for TEXT).
  imageUrl       String?
  imageAlt       String?
  imageHref      String?
  introText      String?
  isDefault      Boolean            @default(false)
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  broadcasts EmailBroadcast[]

  @@index([organizationId])
  @@map("email_signatures")
}
```

- [ ] **Step 4: Gerar e aplicar a migration (sem `migrate dev`)**

```bash
mkdir -p prisma/migrations/20261013120000_email_signatures
git show origin/main:prisma/schema.prisma > "$TEMP/schema-main.prisma"
npx prisma migrate diff --from-schema-datamodel "$TEMP/schema-main.prisma" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261013120000_email_signatures/migration.sql
```

Abra o SQL. Ele deve ter **só**:
- `CREATE TYPE "EmailSignatureKind" AS ENUM ('TEXT', 'IMAGE');`
- `ALTER TABLE "email_broadcasts" ADD COLUMN "signatureHtml" TEXT, ADD COLUMN "signatureId" TEXT, ADD COLUMN "signatureText" TEXT;` (a ordem das colunas pode variar);
- `CREATE TABLE "email_signatures" (...)`;
- `CREATE INDEX "email_signatures_organizationId_idx"`;
- `ALTER TABLE "email_broadcasts" ADD CONSTRAINT "email_broadcasts_signatureId_fkey" ... ON DELETE SET NULL ON UPDATE CASCADE;`

Se houver qualquer outra coisa, pare e reporte. Depois:

```bash
npx prisma db execute --file prisma/migrations/20261013120000_email_signatures/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20261013120000_email_signatures
npx prisma generate
```

Em `src/lib/tenant-db.ts`, no fim de `TENANT_MODELS`, depois de `"EmailSenderDomain",`, acrescente `"EmailSignature",`.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run typecheck && npm run check:isolation`
Esperado: PASS, terminando em `✅ Tenant isolation: all checks passed.`, com a asserção nova listada.

- [ ] **Step 6: Guia 03**

Em `docs/guia/03-multi-tenancy.md`:
- troque `**76 hoje**` por `**77 hoje**`;
- troque `domínio de envio e coluna do quadro de tarefas) e roda **15 asserções**` por `domínio de envio, coluna do quadro de tarefas e assinatura de e-mail) e roda **16 asserções**`.

Confira as contagens:
- `node -e "const s=require('fs').readFileSync('src/lib/tenant-db.ts','utf8');const m=s.match(/TENANT_MODELS[\s\S]*?\]\)/)[0];console.log((m.match(/\"[A-Za-z]+\"/g)||[]).length)"` → 77;
- `grep -c "    assert(" scripts/check-isolation.ts` → 16.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261013120000_email_signatures src/lib/tenant-db.ts scripts/check-isolation.ts docs/guia/03-multi-tenancy.md
git commit -m "[E-mail] - Adiciona a tabela de assinaturas e a copia da assinatura no envio" -m "Migration aditiva: email_signatures (por empresa) e signatureId/signatureHtml/signatureText em email_broadcasts (FK SET NULL); isolamento coberto." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Servidor das assinaturas (montagem, consultas, validação e actions)

**Files:**
- Modify: `src/lib/email-broadcast/compose.ts` (só acrescenta `composeSignature`)
- Modify: `src/lib/email-broadcast/types.ts`
- Create: `src/lib/queries/email-signatures.ts`
- Create: `src/lib/validations/email-signature.ts`
- Create: `src/app/actions/email-signatures.ts`

**Interfaces:**
- Consome:
  - da Task 1: `renderSignature`, `signatureContentOf`, `signatureContentFromForm`, `signatureProblem`, `MAX_SIGNATURES`, `type SignatureContent`, `type SignatureProblem`;
  - da Task 2: o model `emailSignature`.
- Produz:
  - `composeSignature(content: SignatureContent): { html: string; text: string }` e `type ComposedSignature = { html: string; text: string }` em `compose.ts`;
  - `type SignatureOption = { id: string; name: string; kind: "TEXT" | "IMAGE"; isDefault: boolean; updatedAt: string; previewHtml: string }` em `types.ts`;
  - em `src/lib/queries/email-signatures.ts`: `listEmailSignatures(orgId)`, `getEmailSignature(orgId, id)` (cada linha com `id, name, kind, html, imageUrl, imageAlt, imageHref, introText, isDefault, updatedAt`) e `listSignatureOptions(orgId): Promise<SignatureOption[]>`;
  - `emailSignatureSchema` e `type EmailSignatureInput` em `src/lib/validations/email-signature.ts`;
  - em `src/app/actions/email-signatures.ts`:
    - `type SignatureActionError = "unauthorized" | "forbidden" | "invalid" | "not_found" | "limit" | "unknown" | SignatureProblem`;
    - `saveEmailSignature(id: string | null, input: EmailSignatureInput): Promise<{ ok: true; id: string } | { ok: false; error: SignatureActionError }>`;
    - `deleteEmailSignature(id)` e `setDefaultEmailSignature(id)`: `Promise<{ ok: true } | { ok: false; error: SignatureActionError }>`.

- [ ] **Step 1: `composeSignature`**

Em `src/lib/email-broadcast/compose.ts`:
- acrescente o import `import { renderSignature, type SignatureContent } from "./signature";`;
- logo depois de `export type ComposedEmail = ...`, acrescente:

```ts
export type ComposedSignature = { html: string; text: string };

/**
 * A signature as it is shown and sent: rendered, run through the same
 * allowlist sanitizer as the body, with e-mail-safe images. This is the value
 * frozen on a send when it starts (spec 2026-10-13 §6).
 */
export function composeSignature(content: SignatureContent): ComposedSignature {
  const rendered = renderSignature(content);
  return { html: prepareEmailImages(sanitizeHtml(rendered.html)), text: rendered.text };
}
```

- [ ] **Step 2: Tipo da opção**

Em `src/lib/email-broadcast/types.ts`, no fim do arquivo:

```ts
/** A signature as the composer and the Assinaturas tab show it; previewHtml
 * is server-sanitized (composeSignature). */
export type SignatureOption = {
  id: string;
  name: string;
  kind: "TEXT" | "IMAGE";
  isDefault: boolean;
  updatedAt: string;
  previewHtml: string;
};
```

- [ ] **Step 3: Consultas**

Crie `src/lib/queries/email-signatures.ts`:

```ts
import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { composeSignature } from "@/lib/email-broadcast/compose";
import { signatureContentOf } from "@/lib/email-broadcast/signature";
import type { SignatureOption } from "@/lib/email-broadcast/types";

const SIGNATURE_SELECT = {
  id: true,
  name: true,
  kind: true,
  html: true,
  imageUrl: true,
  imageAlt: true,
  imageHref: true,
  introText: true,
  isDefault: true,
  updatedAt: true,
} as const;

/** The org's signatures, the default first, then by name. */
export function listEmailSignatures(organizationId: string) {
  return tenantDb(organizationId).emailSignature.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: SIGNATURE_SELECT,
  });
}

export function getEmailSignature(organizationId: string, id: string) {
  return tenantDb(organizationId).emailSignature.findFirst({ where: { id }, select: SIGNATURE_SELECT });
}

/** Signatures with their sent-as preview (sanitized here, on the server). */
export async function listSignatureOptions(organizationId: string): Promise<SignatureOption[]> {
  const rows = await listEmailSignatures(organizationId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    isDefault: r.isDefault,
    updatedAt: r.updatedAt.toISOString(),
    previewHtml: composeSignature(signatureContentOf(r)).html,
  }));
}
```

- [ ] **Step 4: Validação**

Crie `src/lib/validations/email-signature.ts`:

```ts
import { z } from "zod";
import { MAX_SIGNATURE_HTML, MAX_SIGNATURE_LINE, MAX_SIGNATURE_NAME } from "@/lib/email-broadcast/signature";

/** Signature form payload; signatureProblem (signature.ts) checks the content. */
export const emailSignatureSchema = z.object({
  name: z.string().trim().min(1).max(MAX_SIGNATURE_NAME),
  kind: z.enum(["TEXT", "IMAGE"]),
  html: z.string().max(MAX_SIGNATURE_HTML).default(""),
  imageUrl: z.string().trim().max(2000).default(""),
  imageAlt: z.string().trim().max(MAX_SIGNATURE_LINE).default(""),
  imageHref: z.string().trim().max(2000).default(""),
  introText: z.string().trim().max(MAX_SIGNATURE_LINE).default(""),
  isDefault: z.boolean().default(false),
});

export type EmailSignatureInput = z.input<typeof emailSignatureSchema>;
```

- [ ] **Step 5: Actions**

Crie `src/app/actions/email-signatures.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { sanitizeHtml } from "@/lib/proposals/sanitize";
import { emailSignatureSchema, type EmailSignatureInput } from "@/lib/validations/email-signature";
import {
  MAX_SIGNATURES,
  signatureContentFromForm,
  signatureProblem,
  type SignatureProblem,
} from "@/lib/email-broadcast/signature";

export type SignatureActionError =
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "limit"
  | "unknown"
  | SignatureProblem;

type Fail = { ok: false; error: SignatureActionError };
type Gate = { ok: true; ctx: OrgContext } | Fail;

/** Session + the "email" screen + the Marketing module — the same gates as the
 * E-mail route layout, repeated because server actions are public endpoints. */
async function gate(): Promise<Gate> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: true, ctx };
}

/** Make `id` the org's only default signature. */
async function makeDefault(organizationId: string, id: string): Promise<void> {
  const db = tenantDb(organizationId);
  await db.emailSignature.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
  await db.emailSignature.updateMany({ where: { id }, data: { isDefault: true } });
}

export async function saveEmailSignature(
  id: string | null,
  input: EmailSignatureInput,
): Promise<{ ok: true; id: string } | Fail> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = emailSignatureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const f = parsed.data;
  const content = signatureContentFromForm(f);
  const problem = signatureProblem(content);
  if (problem) return { ok: false, error: problem };

  const orgId = g.ctx.organizationId;
  const db = tenantDb(orgId);
  // Only the chosen kind's fields are kept; TEXT html is stored sanitized.
  const data =
    content.kind === "TEXT"
      ? { name: f.name, kind: "TEXT" as const, html: sanitizeHtml(content.html), imageUrl: null, imageAlt: null, imageHref: null, introText: null }
      : {
          name: f.name,
          kind: "IMAGE" as const,
          html: "",
          imageUrl: content.imageUrl,
          imageAlt: content.imageAlt,
          imageHref: content.imageHref,
          introText: content.introText,
        };
  try {
    let savedId: string;
    if (!id) {
      const count = await db.emailSignature.count({ where: { organizationId: orgId } });
      if (count >= MAX_SIGNATURES) return { ok: false, error: "limit" };
      const created = await db.emailSignature.create({ data: { organizationId: orgId, ...data } });
      savedId = created.id;
    } else {
      const res = await db.emailSignature.updateMany({ where: { id }, data });
      if (res.count === 0) return { ok: false, error: "not_found" };
      savedId = id;
    }
    if (f.isDefault) await makeDefault(orgId, savedId);
    else await db.emailSignature.updateMany({ where: { id: savedId }, data: { isDefault: false } });
    revalidatePath("/app/email/signatures");
    return { ok: true, id: savedId };
  } catch (error) {
    console.error("Failed to save email signature", error);
    return { ok: false, error: "unknown" };
  }
}

/** Drafts that chose it fall back to "no signature" (FK SET NULL); sends that
 * already started keep their frozen copy. */
export async function deleteEmailSignature(id: string): Promise<{ ok: true } | Fail> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const res = await tenantDb(g.ctx.organizationId).emailSignature.deleteMany({ where: { id } });
    if (res.count === 0) return { ok: false, error: "not_found" };
    revalidatePath("/app/email/signatures");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete email signature", error);
    return { ok: false, error: "unknown" };
  }
}

export async function setDefaultEmailSignature(id: string): Promise<{ ok: true } | Fail> {
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    const found = await tenantDb(orgId).emailSignature.findFirst({ where: { id }, select: { id: true } });
    if (!found) return { ok: false, error: "not_found" };
    await makeDefault(orgId, id);
    revalidatePath("/app/email/signatures");
    return { ok: true };
  } catch (error) {
    console.error("Failed to set the default email signature", error);
    return { ok: false, error: "unknown" };
  }
}
```

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm run lint && npm run check:email && npm run check:isolation`
Esperado: PASS em todos.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email-broadcast/compose.ts src/lib/email-broadcast/types.ts src/lib/queries/email-signatures.ts src/lib/validations/email-signature.ts src/app/actions/email-signatures.ts
git commit -m "[E-mail] - Adiciona o servidor das assinaturas" -m "composeSignature (sanitiza e prepara as imagens), consultas por empresa, validacao e actions de salvar, excluir e definir padrao (uma padrao por empresa)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Assinatura no envio (rascunho, início e despachante)

**Files:**
- Modify: `src/lib/email-broadcast/compose.ts` (`composeEmail`)
- Modify: `src/lib/email-broadcast/dispatch.ts`
- Modify: `src/lib/validations/email-broadcast.ts`
- Modify: `src/app/actions/email-broadcasts.ts`
- Modify: `src/lib/queries/email-broadcasts.ts` (`getEmailBroadcast`)
- Modify: `src/lib/email-broadcast/types.ts` (`ComposerDraft`)
- Modify: `src/app/[locale]/app/email/new/page.tsx`, `src/app/[locale]/app/email/[id]/edit/page.tsx`, `src/app/[locale]/app/email/[id]/page.tsx`
- Modify: `src/components/email/email-composer.tsx` (só o `payload`)
- Modify: `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consome:
  - da Task 1: `signatureContentOf`;
  - da Task 3: `composeSignature`, `type ComposedSignature`, `getEmailSignature`.
- Produz:
  - `composeEmail({ ..., signature?: ComposedSignature | null })`;
  - `broadcastDraftSchema.signatureId: string | null` (default `null`);
  - `EmailActionError` com `"signature_missing"`;
  - `ComposerDraft.signatureId: string | null`;
  - `getEmailBroadcast` devolve `signatureId`, `signatureHtml` e `signatureText`.

- [ ] **Step 1: Escrever o teste que falha (tipos)**

Em `src/lib/email-broadcast/types.ts`, no `ComposerDraft`, depois de `attachments: EmailAttachment[];`:

```ts
  signatureId: string | null;
```

Run: `npm run typecheck`
Esperado: FAIL nas páginas `new` e `[id]/edit` (`Property 'signatureId' is missing`).

- [ ] **Step 2: `composeEmail` com assinatura**

Em `src/lib/email-broadcast/compose.ts`, troque a função `composeEmail` inteira por:

```ts
export function composeEmail(input: {
  subject: string;
  bodyHtml: string;
  vars: TemplateVars;
  orgName: string;
  unsubscribeUrl: string;
  /** Frozen copy from the send (already prepared by composeSignature); it is
   * only re-sanitized here, never re-run through prepareEmailImages. */
  signature?: ComposedSignature | null;
}): ComposedEmail {
  const body = fillHtmlVars(prepareEmailImages(sanitizeHtml(input.bodyHtml)), input.vars);
  const signatureHtml = input.signature?.html ? sanitizeHtml(input.signature.html) : "";
  const html = signatureHtml ? `${body}<div style="margin-top:24px">${signatureHtml}</div>` : body;
  const bodyText = htmlToText(body);
  const text = input.signature?.text ? `${bodyText}\n\n${input.signature.text}` : bodyText;
  return {
    subject: fillTextVars(input.subject, input.vars),
    html: buildEmailDocument({ bodyHtml: html, orgName: input.orgName, unsubscribeUrl: input.unsubscribeUrl }),
    text: `${text}\n\n--\nVocê recebeu este e-mail de ${input.orgName}. Para não receber mais: ${input.unsubscribeUrl}`,
  };
}
```

- [ ] **Step 3: Despachante lê só a cópia**

Em `src/lib/email-broadcast/dispatch.ts`:

1. No `select` de `runEmailBroadcast`, depois de `attachments: true,`, acrescente:

```ts
      signatureHtml: true,
      signatureText: true,
```

2. Logo antes de `const toEmail = (r: Batch[number]): ResendEmail => {`, acrescente:

```ts
    // The signature frozen when the send started; email_signatures is never read here.
    const signature = b.signatureHtml ? { html: b.signatureHtml, text: b.signatureText ?? "" } : null;
```

3. Dentro de `toEmail`, na chamada `composeEmail({ ... })`, depois de `unsubscribeUrl: emailUnsubscribePageUrl(r.id),`, acrescente `signature,`.

- [ ] **Step 4: Validação e query**

Em `src/lib/validations/email-broadcast.ts`, em `broadcastDraftSchema`, depois da linha de `attachments`:

```ts
  signatureId: z.string().min(1).max(64).nullable().default(null),
```

Em `src/lib/queries/email-broadcasts.ts`, no `select` de `getEmailBroadcast`, depois de `attachments: true,`:

```ts
      signatureId: true,
      signatureHtml: true,
      signatureText: true,
```

- [ ] **Step 5: Actions do envio**

Em `src/app/actions/email-broadcasts.ts`:

1. Imports:

```ts
import { composeSignature } from "@/lib/email-broadcast/compose";
import { signatureContentOf } from "@/lib/email-broadcast/signature";
import { getEmailSignature } from "@/lib/queries/email-signatures";
```

2. Em `EmailActionError`, depois de `| "attachments_invalid"`, acrescente `| "signature_missing"`.

3. Em `saveEmailDraft`, logo depois do bloco do `checkAttachments` (o `if` que devolve `attachments_invalid`):

```ts
  // The signature must still exist in THIS org (deleted with the composer open,
  // or another org's id sent by hand → refuse instead of saving it).
  if (parsed.data.signatureId && !(await getEmailSignature(g.ctx.organizationId, parsed.data.signatureId))) {
    return { ok: false, error: "signature_missing" };
  }
```

   e, no objeto `data`, depois de `attachments: parsed.data.attachments as Prisma.InputJsonValue,`:

```ts
    signatureId: parsed.data.signatureId,
```

4. Em `duplicateEmailBroadcast`:
   - no `select`, acrescente `signatureId: true`;
   - no `data` do `create`, depois da linha de `attachments`, acrescente `signatureId: src.signatureId,`.

5. Em `startEmailBroadcast`:
   - no `select`, acrescente `signatureId: true`;
   - logo depois do bloco que devolve `attachments_invalid`, acrescente:

```ts
  // Freeze the chosen signature on the send: later edits or deletes never
  // change what this send delivers (spec 2026-10-13 §6).
  let signature: { html: string; text: string } | null = null;
  let signatureName: string | null = null;
  if (b.signatureId) {
    const row = await getEmailSignature(orgId, b.signatureId);
    if (!row) return { ok: false, error: "signature_missing" };
    signature = composeSignature(signatureContentOf(row));
    signatureName = row.name;
  }
```

   - no `data` do `updateMany` que passa para `SENDING` (o que tem `status: "SENDING"`), depois de `lastError: null,`, acrescente:

```ts
      signatureHtml: signature?.html ?? null,
      signatureText: signature?.text ?? null,
```

   - no `audit(...)`, troque `meta: { recipients: recipients.length, fromEmail: b.fromEmail, attachments: attachments.length },` por:

```ts
    meta: { recipients: recipients.length, fromEmail: b.fromEmail, attachments: attachments.length, signature: signatureName },
```

- [ ] **Step 6: Páginas e composer**

Em `src/app/[locale]/app/email/new/page.tsx`, no `draft={{ ... }}`, depois de `attachments: [],`, acrescente `signatureId: null,`. A Task 7 troca pelo id da padrão.

Em `src/app/[locale]/app/email/[id]/edit/page.tsx`, no `draft={{ ... }}`, depois de `attachments: readAttachments(b.attachments),`, acrescente `signatureId: b.signatureId,`.

Em `src/app/[locale]/app/email/[id]/page.tsx`, na chamada `composeEmail({ ... })` da prévia, depois de `unsubscribeUrl: "#",`, acrescente:

```ts
    signature: b.signatureHtml ? { html: b.signatureHtml, text: b.signatureText ?? "" } : null,
```

Em `src/components/email/email-composer.tsx`:
- depois de `const [uploading, setUploading] = useState(false);`, acrescente `const [signatureId] = useState(draft.signatureId);`;
- troque `const payload = () => ({ subject, html, fromName, fromEmail, replyTo, audience, attachments });` por:

```ts
  const payload = () => ({ subject, html, fromName, fromEmail, replyTo, audience, attachments, signatureId });
```

  A Task 7 troca esse `useState` pela versão com setter.

- [ ] **Step 7: Texto do erro**

Em `src/messages/pt.json`, logo depois de `"attachments_invalid": "Os anexos deste envio são inválidos. Remova e anexe de novo.",`:

```json
      "signature_missing": "A assinatura escolhida foi excluída. Escolha outra.",
```

Em `src/messages/en.json`, logo depois de `"attachments_invalid": "This send's attachments are invalid. Remove them and attach again.",`:

```json
      "signature_missing": "The chosen signature was deleted. Pick another one.",
```

- [ ] **Step 8: Verificar**

Run: `npm run typecheck && npm run lint && npm run check:email && npm run check:isolation`
Esperado: PASS.

Paridade de i18n:

```bash
node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p+k+'.'):[p+k]);const a=new Set(f(require('./src/messages/pt.json'))),b=new Set(f(require('./src/messages/en.json')));console.log(a.size,b.size,[...a].filter(k=>!b.has(k)).concat([...b].filter(k=>!a.has(k))))"
```

Esperado: `2823 2823 []`.

Confira no diff:
- `dispatch.ts` não importa nada de assinatura além de ler as duas colunas;
- um envio sem `signatureId` grava `signatureHtml`/`signatureText` como `null`;
- nada mudou no lote nem nos anexos.

- [ ] **Step 9: Commit**

```bash
git add src/lib/email-broadcast/compose.ts src/lib/email-broadcast/dispatch.ts src/lib/validations/email-broadcast.ts src/app/actions/email-broadcasts.ts src/lib/queries/email-broadcasts.ts src/lib/email-broadcast/types.ts "src/app/[locale]/app/email/new/page.tsx" "src/app/[locale]/app/email/[id]/edit/page.tsx" "src/app/[locale]/app/email/[id]/page.tsx" src/components/email/email-composer.tsx src/messages/pt.json src/messages/en.json
git commit -m "[E-mail] - Congela a assinatura no envio e envia com ela" -m "O rascunho guarda signatureId (conferido na empresa); o inicio grava signatureHtml/signatureText e o despachante so le essa copia; signature_missing quando a assinatura sumiu." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Aba Assinaturas (abas do E-mail, lista e cartões)

**Files:**
- Create: `src/components/email/email-tabs.tsx`
- Create: `src/components/email/signature-card.tsx`
- Create: `src/app/[locale]/app/email/signatures/page.tsx`
- Modify: `src/app/[locale]/app/email/page.tsx`
- Modify: `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consome:
  - da Task 1: `MAX_SIGNATURES`;
  - da Task 3: `listSignatureOptions`, `deleteEmailSignature`, `setDefaultEmailSignature`, `type SignatureOption`.
- Produz:
  - `EmailTabs({ active: "sends" | "signatures" })`, um server component assíncrono;
  - `SignatureCard({ signature: SignatureOption })`;
  - as chaves i18n `emailBroadcast.tabs.*`, `emailBroadcast.signatures.*` (sem `form`) e `emailBroadcast.signatures.errors.*`.

- [ ] **Step 1: Textos**

Em `src/messages/pt.json`, o bloco `emailBroadcast.attachments` termina em:

```json
      "errorUpload": "Não foi possível anexar {file}. Tente de novo."
    },
```

Logo depois desse `},`, acrescente:

```json
    "tabs": {
      "label": "Seções do E-mail",
      "sends": "Envios",
      "signatures": "Assinaturas"
    },
    "signatures": {
      "title": "Assinaturas",
      "intro": "As assinaturas são da empresa e aparecem para todos que usam o E-mail. A padrão já vem escolhida em cada e-mail novo.",
      "new": "Nova assinatura",
      "newHint": "Uma por equipe, por pessoa ou por tipo de envio.",
      "emptyTitle": "Nenhuma assinatura ainda",
      "emptyBody": "Crie uma assinatura com texto e logo, ou use uma imagem pronta.",
      "createFirst": "Criar a primeira assinatura",
      "limit": "Limite de 20 assinaturas por empresa. Exclua uma para criar outra.",
      "kindText": "Texto",
      "kindImage": "Imagem",
      "default": "Padrão",
      "setDefault": "Definir como padrão",
      "edit": "Editar",
      "delete": "Excluir",
      "updatedAt": "Atualizada em {date}",
      "deleteTitle": "Excluir a assinatura “{name}”?",
      "deleteBody": "Rascunhos que usam esta assinatura ficam sem assinatura. Envios já feitos não mudam.",
      "deleteConfirm": "Excluir",
      "deleted": "Assinatura excluída.",
      "defaultSet": "Assinatura padrão atualizada.",
      "errors": {
        "unauthorized": "Sua sessão expirou. Entre de novo.",
        "forbidden": "Você não tem acesso ao E-mail.",
        "invalid": "Confira os campos: o nome é obrigatório e tem até 60 caracteres.",
        "not_found": "Esta assinatura não existe mais.",
        "limit": "Limite de 20 assinaturas por empresa. Exclua uma para criar outra.",
        "html_empty": "Escreva o conteúdo da assinatura.",
        "html_too_long": "A assinatura passou do tamanho máximo. Use menos texto ou imagens menores.",
        "image_required": "Envie a imagem da assinatura ou cole o link dela.",
        "image_url": "Use um link https:// direto para a imagem.",
        "alt_required": "Preencha o texto alternativo.",
        "line_too_long": "O texto acima da imagem e o texto alternativo têm até 200 caracteres.",
        "href": "Link de destino inválido. Use um endereço como https://suaempresa.com.br.",
        "unknown": "Algo deu errado. Tente de novo."
      }
    },
```

Em `src/messages/en.json`, logo depois do `},` que fecha `emailBroadcast.attachments` (a linha anterior é `"errorUpload": "Couldn't attach {file}. Try again."`):

```json
    "tabs": {
      "label": "Email sections",
      "sends": "Sends",
      "signatures": "Signatures"
    },
    "signatures": {
      "title": "Signatures",
      "intro": "Signatures belong to the company and show up for everyone who uses Email. The default one comes selected in every new email.",
      "new": "New signature",
      "newHint": "One per team, per person or per kind of send.",
      "emptyTitle": "No signatures yet",
      "emptyBody": "Create a signature with text and a logo, or use a ready-made image.",
      "createFirst": "Create the first signature",
      "limit": "Limit of 20 signatures per company. Delete one to create another.",
      "kindText": "Text",
      "kindImage": "Image",
      "default": "Default",
      "setDefault": "Set as default",
      "edit": "Edit",
      "delete": "Delete",
      "updatedAt": "Updated on {date}",
      "deleteTitle": "Delete the signature “{name}”?",
      "deleteBody": "Drafts using this signature will have no signature. Sends already made don't change.",
      "deleteConfirm": "Delete",
      "deleted": "Signature deleted.",
      "defaultSet": "Default signature updated.",
      "errors": {
        "unauthorized": "Your session expired. Sign in again.",
        "forbidden": "You don't have access to Email.",
        "invalid": "Check the fields: the name is required and up to 60 characters.",
        "not_found": "This signature no longer exists.",
        "limit": "Limit of 20 signatures per company. Delete one to create another.",
        "html_empty": "Write the signature content.",
        "html_too_long": "The signature is over the maximum size. Use less text or smaller images.",
        "image_required": "Upload the signature image or paste its link.",
        "image_url": "Use a direct https:// link to the image.",
        "alt_required": "Fill in the alternative text.",
        "line_too_long": "The text above the image and the alternative text are up to 200 characters.",
        "href": "Invalid destination link. Use an address like https://yourcompany.com.",
        "unknown": "Something went wrong. Try again."
      }
    },
```

Paridade (o comando do Step 8 da Task 4). Esperado: `2859 2859 []`.

- [ ] **Step 2: Abas**

Crie `src/components/email/email-tabs.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "sends", href: "/app/email" },
  { key: "signatures", href: "/app/email/signatures" },
] as const;

/** Envios | Assinaturas navigation of the E-mail screen (spec 2026-10-13 §4.1). */
export async function EmailTabs({ active }: { active: "sends" | "signatures" }) {
  const t = await getTranslations("emailBroadcast.tabs");
  return (
    <nav aria-label={t("label")} className="flex gap-1 border-b border-border">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            active === tab.key
              ? "border-brand text-brand"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
```

Em `src/app/[locale]/app/email/page.tsx`:
- acrescente o import `import { EmailTabs } from "@/components/email/email-tabs";`;
- troque:

```tsx
          {t("new")}
        </Link>
      </div>
```

  por:

```tsx
          {t("new")}
        </Link>
      </div>

      <EmailTabs active="sends" />
```

- [ ] **Step 3: Cartão**

Crie `src/components/email/signature-card.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteEmailSignature, setDefaultEmailSignature } from "@/app/actions/email-signatures";
import type { SignatureOption } from "@/lib/email-broadcast/types";

/** One signature of the Assinaturas tab (spec 2026-10-13 §4.2). previewHtml
 * was sanitized on the server. */
export function SignatureCard({ signature }: { signature: SignatureOption }) {
  const t = useTranslations("emailBroadcast.signatures");
  const format = useFormatter();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [busy, start] = useTransition();

  const onDelete = () =>
    start(async () => {
      const ok = await confirm({
        title: t("deleteTitle", { name: signature.name }),
        description: t("deleteBody"),
        confirmLabel: t("deleteConfirm"),
        variant: "danger",
      });
      if (!ok) return;
      try {
        const r = await deleteEmailSignature(signature.id);
        if (!r.ok) {
          toast(t(`errors.${r.error}`), { variant: "error" });
          return;
        }
        toast(t("deleted"));
        router.refresh();
      } catch {
        toast(t("errors.unknown"), { variant: "error" });
      }
    });

  const onSetDefault = () =>
    start(async () => {
      try {
        const r = await setDefaultEmailSignature(signature.id);
        if (!r.ok) {
          toast(t(`errors.${r.error}`), { variant: "error" });
          return;
        }
        toast(t("defaultSet"));
        router.refresh();
      } catch {
        toast(t("errors.unknown"), { variant: "error" });
      }
    });

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate font-semibold">{signature.name}</h2>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {signature.kind === "IMAGE" ? t("kindImage") : t("kindText")}
          </span>
        </div>
        {signature.isDefault ? (
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
            {t("default")}
          </span>
        ) : (
          <button
            type="button"
            onClick={onSetDefault}
            disabled={busy}
            className="text-xs font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-60"
          >
            {t("setDefault")}
          </button>
        )}
      </div>
      <div
        className="max-h-48 overflow-hidden rounded-lg border border-border bg-white p-4 text-sm text-neutral-900"
        dangerouslySetInnerHTML={{ __html: signature.previewHtml }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t("updatedAt", { date: format.dateTime(new Date(signature.updatedAt), { dateStyle: "short" }) })}
        </span>
        <div className="flex gap-2">
          <Link href={`/app/email/signatures/${signature.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("edit")}
          </Link>
          <Button type="button" variant="outline" size="sm" onClick={onDelete} disabled={busy} className="text-red-600">
            {t("delete")}
          </Button>
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Página da lista**

Crie `src/app/[locale]/app/email/signatures/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listSignatureOptions } from "@/lib/queries/email-signatures";
import { MAX_SIGNATURES } from "@/lib/email-broadcast/signature";
import { EmailTabs } from "@/components/email/email-tabs";
import { SignatureCard } from "@/components/email/signature-card";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** E-mail → Assinaturas (spec 2026-10-13 §4.2). The E-mail layout already
 * requires the "email" screen and the Marketing module. */
export default async function EmailSignaturesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const signatures = await listSignatureOptions(ctx.organizationId);
  const atLimit = signatures.length >= MAX_SIGNATURES;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        {!atLimit ? (
          <Link href="/app/email/signatures/new" className={buttonVariants()}>
            <Plus className="size-4" />
            {t("signatures.new")}
          </Link>
        ) : null}
      </div>

      <EmailTabs active="signatures" />

      <p className="max-w-3xl text-sm text-muted-foreground">{t("signatures.intro")}</p>
      {atLimit ? (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t("signatures.limit")}
        </p>
      ) : null}

      {signatures.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="font-semibold">{t("signatures.emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("signatures.emptyBody")}</p>
          <Link href="/app/email/signatures/new" className={buttonVariants()}>
            <Plus className="size-4" />
            {t("signatures.createFirst")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {signatures.map((s) => (
            <SignatureCard key={s.id} signature={s} />
          ))}
          {!atLimit ? (
            <Link
              href="/app/email/signatures/new"
              className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-6 text-center text-muted-foreground transition-colors hover:border-brand hover:text-brand"
            >
              <Plus className="size-6" />
              <span className="text-sm font-semibold">{t("signatures.new")}</span>
              <span className="text-sm">{t("signatures.newHint")}</span>
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm run lint && npm run check:email`
Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/components/email/email-tabs.tsx src/components/email/signature-card.tsx "src/app/[locale]/app/email/signatures/page.tsx" "src/app/[locale]/app/email/page.tsx" src/messages/pt.json src/messages/en.json
git commit -m "[E-mail] - Adiciona a aba Assinaturas com a lista de assinaturas" -m "Abas Envios/Assinaturas, cartoes com previa sanitizada no servidor, padrao, editar, excluir com confirmacao e limite de 20." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Formulário de assinatura (criar e editar)

**Files:**
- Create: `src/components/email/use-email-image-support.ts`
- Modify: `src/components/email/email-composer.tsx` (passa a usar o hook)
- Create: `src/components/email/signature-form.tsx`
- Create: `src/app/[locale]/app/email/signatures/new/page.tsx`
- Create: `src/app/[locale]/app/email/signatures/[id]/edit/page.tsx`
- Modify: `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consome:
  - da Task 1: `MAX_SIGNATURES`, `MAX_SIGNATURE_LINE`, `MAX_SIGNATURE_NAME`, `renderSignature`, `signatureContentFromForm`, `signatureImageSrc`, `signatureProblem`, `type SignatureFormFields`;
  - da Task 3: `listEmailSignatures`, `getEmailSignature`, `saveEmailSignature`.
- Produz:
  - `useEmailImageSupport(): EditorImageSupport`;
  - `type SignatureFormInitial = SignatureFormFields & { id: string | null; name: string; isDefault: boolean }`;
  - `SignatureForm({ initial })`;
  - as chaves `emailBroadcast.signatures.form.*`.

- [ ] **Step 1: Textos do formulário**

Em `src/messages/pt.json`, dentro de `emailBroadcast.signatures` (criado na Task 5), logo depois da linha `"defaultSet": "Assinatura padrão atualizada.",` (e antes do `"errors": {` que vem em seguida), acrescente:

```json
      "form": {
        "newTitle": "Nova assinatura",
        "editTitle": "Editar assinatura",
        "name": "Nome da assinatura",
        "nameHint": "Só aparece para a sua equipe, na hora de escolher. O destinatário não vê.",
        "kind": "Tipo de assinatura",
        "kindText": "Texto e imagens",
        "kindImage": "Imagem pronta",
        "content": "Conteúdo",
        "contentHint": "Logo pelo botão Imagem: PNG, JPG, GIF ou WEBP até 5 MB, ou um link https.",
        "image": "Imagem da assinatura",
        "imageUpload": "Enviar imagem",
        "imageReplace": "Trocar imagem",
        "imageRemove": "Remover",
        "imageLink": "ou cole o link da imagem (https://…)",
        "imageHint": "PNG, JPG, GIF ou WEBP até 5 MB. Largura ideal: 600 px; no celular a imagem se ajusta à tela.",
        "intro": "Texto acima da imagem",
        "introPlaceholder": "Atenciosamente,",
        "href": "Link ao clicar na imagem",
        "hrefPlaceholder": "https://www.suaempresa.com.br",
        "alt": "Texto alternativo",
        "altHint": "Aparece quando o programa de e-mail bloqueia imagens (comum no Outlook). Coloque nome e telefone.",
        "optional": "(opcional)",
        "isDefault": "Usar como padrão",
        "isDefaultHint": "Já vem escolhida em cada e-mail novo. Dá para trocar ou tirar no e-mail.",
        "preview": "Prévia no e-mail",
        "previewNote": "A assinatura entra depois do corpo e antes do aviso de descadastro, que o sistema sempre coloca.",
        "previewEmpty": "A prévia aparece aqui.",
        "save": "Salvar assinatura",
        "saving": "Salvando…",
        "cancel": "Cancelar",
        "saved": "Assinatura salva."
      },
```

Em `src/messages/en.json`, logo depois da linha `"defaultSet": "Default signature updated.",` (dentro de `emailBroadcast.signatures`):

```json
      "form": {
        "newTitle": "New signature",
        "editTitle": "Edit signature",
        "name": "Signature name",
        "nameHint": "Only your team sees it, when choosing. The recipient doesn't.",
        "kind": "Signature type",
        "kindText": "Text and images",
        "kindImage": "Ready-made image",
        "content": "Content",
        "contentHint": "Logo through the Image button: PNG, JPG, GIF or WEBP up to 5 MB, or an https link.",
        "image": "Signature image",
        "imageUpload": "Upload image",
        "imageReplace": "Replace image",
        "imageRemove": "Remove",
        "imageLink": "or paste the image link (https://…)",
        "imageHint": "PNG, JPG, GIF or WEBP up to 5 MB. Ideal width: 600 px; on phones the image fits the screen.",
        "intro": "Text above the image",
        "introPlaceholder": "Best regards,",
        "href": "Link when clicking the image",
        "hrefPlaceholder": "https://www.yourcompany.com",
        "alt": "Alternative text",
        "altHint": "Shown when the email app blocks images (common in Outlook). Include name and phone.",
        "optional": "(optional)",
        "isDefault": "Use as default",
        "isDefaultHint": "Comes selected in every new email. It can be changed or removed in the email.",
        "preview": "Preview in the email",
        "previewNote": "The signature goes after the body and before the unsubscribe notice, which the system always adds.",
        "previewEmpty": "The preview shows up here.",
        "save": "Save signature",
        "saving": "Saving…",
        "cancel": "Cancel",
        "saved": "Signature saved."
      },
```

Paridade. Esperado: `2890 2890 []`.

- [ ] **Step 2: Hook de imagens (sai do composer)**

Crie `src/components/email/use-email-image-support.ts`:

```ts
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import type { EditorImageSupport } from "@/components/proposals/rich-text-editor";
import { safeClickHref, safeImageSrc } from "@/lib/email-broadcast/image-links";

/**
 * Image support for the E-mail editors (body and signatures): upload goes to
 * /api/email/image (same gates as the E-mail screen); pasted links are
 * validated client-side and again by the server sanitizer.
 */
export function useEmailImageSupport(): EditorImageSupport {
  const t = useTranslations("emailBroadcast");
  const toast = useToast();
  return useMemo<EditorImageSupport>(
    () => ({
      upload: async (file) => {
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch("/api/email/image", { method: "POST", body: form });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
          if (res.ok && data.ok && data.url) return data.url;
          const key = data.error === "size" ? "image.tooLarge" : data.error === "type" ? "image.badType" : "image.uploadError";
          toast(t(key), { variant: "error" });
        } catch (error) {
          console.error("[email-image] upload failed", error);
          toast(t("image.uploadError"), { variant: "error" });
        }
        return null;
      },
      validateSrc: safeImageSrc,
      validateHref: safeClickHref,
      labels: {
        button: t("image.button"),
        title: t("image.title"),
        upload: t("image.upload"),
        uploading: t("image.uploading"),
        uploaded: t("image.uploaded"),
        orLink: t("image.orLink"),
        linkPlaceholder: t("image.linkPlaceholder"),
        href: t("image.href"),
        hrefPlaceholder: t("image.hrefPlaceholder"),
        alt: t("image.alt"),
        altPlaceholder: t("image.altPlaceholder"),
        insert: t("image.insert"),
        cancel: t("image.cancel"),
        invalidSrc: t("image.invalidSrc"),
        invalidHref: t("image.invalidHref"),
      },
    }),
    [t, toast],
  );
}
```

Em `src/components/email/email-composer.tsx`:
- **apague** o bloco inteiro que começa em `// Image support for the body editor:` e termina no `);` do `useMemo<EditorImageSupport>(...)` (com o `[t, toast],`);
- no lugar dele, escreva `const imageSupport = useEmailImageSupport();`;
- acrescente o import `import { useEmailImageSupport } from "@/components/email/use-email-image-support";`;
- remova os imports que ficaram sem uso:
  - `useMemo` do `import { ... } from "react"`;
  - `type EditorImageSupport` do import do `rich-text-editor` (que fica só `import { RichTextEditor } from "@/components/proposals/rich-text-editor";`);
  - a linha `import { safeClickHref, safeImageSrc } from "@/lib/email-broadcast/image-links";`.

Run: `npm run typecheck && npm run lint`
Esperado: sem erros, e o composer continua igual na tela.

- [ ] **Step 3: Formulário**

Crie `src/components/email/signature-form.tsx`:

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { RichTextEditor } from "@/components/proposals/rich-text-editor";
import { useEmailImageSupport } from "@/components/email/use-email-image-support";
import {
  MAX_SIGNATURE_LINE,
  MAX_SIGNATURE_NAME,
  renderSignature,
  signatureContentFromForm,
  signatureImageSrc,
  signatureProblem,
  type SignatureFormFields,
  type SignatureKind,
} from "@/lib/email-broadcast/signature";
import { saveEmailSignature } from "@/app/actions/email-signatures";
import { cn } from "@/lib/utils";

export type SignatureFormInitial = SignatureFormFields & { id: string | null; name: string; isDefault: boolean };

/**
 * Create/edit form of an e-mail signature (spec 2026-10-13 §4.3). The preview
 * uses the same renderSignature as the send. TEXT html is either the stored
 * (sanitized-on-save) value or TipTap output; IMAGE html is fully escaped.
 */
export function SignatureForm({ initial }: { initial: SignatureFormInitial }) {
  const t = useTranslations("emailBroadcast.signatures");
  const ti = useTranslations("emailBroadcast.image");
  const toast = useToast();
  const router = useRouter();
  const images = useEmailImageSupport();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [kind, setKind] = useState<SignatureKind>(initial.kind);
  const [html, setHtml] = useState(initial.html);
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);
  const [imageAlt, setImageAlt] = useState(initial.imageAlt);
  const [imageHref, setImageHref] = useState(initial.imageHref);
  const [introText, setIntroText] = useState(initial.introText);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [uploading, setUploading] = useState(false);
  const [busy, start] = useTransition();

  const fields: SignatureFormFields = { kind, html, imageUrl, imageAlt, imageHref, introText };
  const content = signatureContentFromForm(fields);
  const validImage = signatureImageSrc(imageUrl) !== null;
  const showPreview = kind === "TEXT" ? html.trim() !== "" : validImage;
  const previewHtml = showPreview ? renderSignature(content).html : "";

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await images.upload(file);
      if (url) setImageUrl(url);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function onSave() {
    if (!name.trim()) {
      toast(t("errors.invalid"), { variant: "error" });
      return;
    }
    const problem = signatureProblem(content);
    if (problem) {
      toast(t(`errors.${problem}`), { variant: "error" });
      return;
    }
    start(async () => {
      try {
        const r = await saveEmailSignature(initial.id, { name, ...fields, isDefault });
        if (!r.ok) {
          toast(t(`errors.${r.error}`), { variant: "error" });
          return;
        }
        toast(t("form.saved"));
        router.push("/app/email/signatures");
        router.refresh();
      } catch {
        toast(t("errors.unknown"), { variant: "error" });
      }
    });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
        <div>
          <Label htmlFor="sigName">{t("form.name")}</Label>
          <Input id="sigName" value={name} maxLength={MAX_SIGNATURE_NAME} onChange={(e) => setName(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">{t("form.nameHint")}</p>
        </div>

        <div>
          <p id="sigKind" className="mb-1.5 text-sm font-medium">
            {t("form.kind")}
          </p>
          <div role="group" aria-labelledby="sigKind" className="inline-flex gap-1 rounded-lg bg-muted p-1">
            {(["TEXT", "IMAGE"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  kind === k ? "bg-card text-brand shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "TEXT" ? t("form.kindText") : t("form.kindImage")}
              </button>
            ))}
          </div>
        </div>

        {kind === "TEXT" ? (
          <div>
            {/* Not a <label>: the TipTap editor isn't a form control it could point at. */}
            <p className="mb-1.5 text-sm font-medium">{t("form.content")}</p>
            <RichTextEditor value={html} onChange={setHtml} minHeight="8rem" images={images} />
            <p className="mt-1 text-xs text-muted-foreground">{t("form.contentHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("form.image")}</p>
              {validImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt={imageAlt}
                  className="mb-2 max-h-40 max-w-full rounded-lg border border-border bg-white object-contain"
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => void onPickImage(e.target.files?.[0])}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  {uploading ? ti("uploading") : imageUrl ? t("form.imageReplace") : t("form.imageUpload")}
                </Button>
                {imageUrl ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl("")}>
                    {t("form.imageRemove")}
                  </Button>
                ) : null}
              </div>
              <Input
                className="mt-2"
                value={imageUrl}
                aria-label={t("form.image")}
                placeholder={t("form.imageLink")}
                onChange={(e) => setImageUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("form.imageHint")}</p>
            </div>
            <div>
              <Label htmlFor="sigIntro">
                {t("form.intro")} <span className="font-normal text-muted-foreground">{t("form.optional")}</span>
              </Label>
              <Input
                id="sigIntro"
                value={introText}
                maxLength={MAX_SIGNATURE_LINE}
                placeholder={t("form.introPlaceholder")}
                onChange={(e) => setIntroText(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sigHref">
                {t("form.href")} <span className="font-normal text-muted-foreground">{t("form.optional")}</span>
              </Label>
              <Input
                id="sigHref"
                value={imageHref}
                placeholder={t("form.hrefPlaceholder")}
                onChange={(e) => setImageHref(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sigAlt">{t("form.alt")}</Label>
              <Input id="sigAlt" value={imageAlt} maxLength={MAX_SIGNATURE_LINE} onChange={(e) => setImageAlt(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">{t("form.altHint")}</p>
            </div>
          </div>
        )}

        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          <span>
            <span className="font-medium">{t("form.isDefault")}</span>
            <br />
            <span className="text-muted-foreground">{t("form.isDefaultHint")}</span>
          </span>
        </label>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Link href="/app/email/signatures" className={buttonVariants({ variant: "outline" })}>
            {t("form.cancel")}
          </Link>
          <Button type="button" onClick={onSave} disabled={busy || uploading}>
            {busy ? t("form.saving") : t("form.save")}
          </Button>
        </div>
      </section>

      <section aria-labelledby="sigPreview" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6">
        <h2 id="sigPreview" className="text-sm font-semibold">
          {t("form.preview")}
        </h2>
        <div className="rounded-lg border border-border bg-white p-5 text-sm text-neutral-900">
          {previewHtml ? (
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <p className="text-neutral-500">{t("form.previewEmpty")}</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("form.previewNote")}</p>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Páginas de criar e editar**

Crie `src/app/[locale]/app/email/signatures/new/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listEmailSignatures } from "@/lib/queries/email-signatures";
import { MAX_SIGNATURES } from "@/lib/email-broadcast/signature";
import { SignatureForm } from "@/components/email/signature-form";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewEmailSignaturePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const existing = await listEmailSignatures(ctx.organizationId);
  if (existing.length >= MAX_SIGNATURES) redirect({ href: "/app/email/signatures", locale });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/app/email" className="hover:underline">
            {t("title")}
          </Link>{" "}
          /{" "}
          <Link href="/app/email/signatures" className="hover:underline">
            {t("signatures.title")}
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("signatures.form.newTitle")}</h1>
      </div>
      <SignatureForm
        initial={{
          id: null,
          name: "",
          kind: "TEXT",
          html: "",
          imageUrl: "",
          imageAlt: "",
          imageHref: "",
          introText: "",
          // The company's first default comes pre-checked.
          isDefault: !existing.some((s) => s.isDefault),
        }}
      />
    </div>
  );
}
```

Crie `src/app/[locale]/app/email/signatures/[id]/edit/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { getEmailSignature } from "@/lib/queries/email-signatures";
import { SignatureForm } from "@/components/email/signature-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditEmailSignaturePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const s = await getEmailSignature(ctx.organizationId, id);
  if (!s) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/app/email" className="hover:underline">
            {t("title")}
          </Link>{" "}
          /{" "}
          <Link href="/app/email/signatures" className="hover:underline">
            {t("signatures.title")}
          </Link>{" "}
          / {s.name}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("signatures.form.editTitle")}</h1>
      </div>
      <SignatureForm
        initial={{
          id: s.id,
          name: s.name,
          kind: s.kind,
          html: s.html,
          imageUrl: s.imageUrl ?? "",
          imageAlt: s.imageAlt ?? "",
          imageHref: s.imageHref ?? "",
          introText: s.introText ?? "",
          isDefault: s.isDefault,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm run lint && npm run check:email`
Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/components/email/use-email-image-support.ts src/components/email/email-composer.tsx src/components/email/signature-form.tsx "src/app/[locale]/app/email/signatures/new/page.tsx" "src/app/[locale]/app/email/signatures/[id]/edit/page.tsx" src/messages/pt.json src/messages/en.json
git commit -m "[E-mail] - Adiciona o formulario de assinatura (texto ou imagem pronta)" -m "Editor do corpo ou imagem com texto acima, link e texto alternativo; previa pela mesma montagem do envio; suporte a imagens extraido para um hook compartilhado com o composer." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Seção Assinatura no composer

**Files:**
- Modify: `src/lib/queries/email-broadcasts.ts` (`emailComposerData`)
- Modify: `src/components/email/email-composer.tsx`
- Modify: `src/app/[locale]/app/email/new/page.tsx`, `src/app/[locale]/app/email/[id]/edit/page.tsx`
- Modify: `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consome:
  - da Task 3: `listSignatureOptions`, `type SignatureOption`;
  - da Task 4: `ComposerDraft.signatureId` e o `useState` provisório do composer.
- Produz:
  - `emailComposerData(orgId)` devolve também `signatures: SignatureOption[]`;
  - o `EmailComposer` ganha a prop `signatures: SignatureOption[]`;
  - as chaves `emailBroadcast.signature.*`.

- [ ] **Step 1: Textos**

Em `src/messages/pt.json`, logo depois do `},` que fecha `emailBroadcast.tabs` (criado na Task 5):

```json
    "signature": {
      "title": "Assinatura",
      "manage": "Gerenciar assinaturas",
      "defaultOption": "{name} (padrão)",
      "noSignature": "Sem assinatura",
      "noneChosen": "Este e-mail vai sem assinatura. O aviso de descadastro continua no rodapé.",
      "none": "Nenhuma assinatura cadastrada.",
      "create": "Criar assinatura"
    },
```

Em `src/messages/en.json`, no mesmo lugar:

```json
    "signature": {
      "title": "Signature",
      "manage": "Manage signatures",
      "defaultOption": "{name} (default)",
      "noSignature": "No signature",
      "noneChosen": "This email goes without a signature. The unsubscribe notice stays in the footer.",
      "none": "No signatures yet.",
      "create": "Create signature"
    },
```

Paridade. Esperado: `2897 2897 []`.

- [ ] **Step 2: Dados do composer**

Em `src/lib/queries/email-broadcasts.ts`:
- acrescente o import `import { listSignatureOptions } from "@/lib/queries/email-signatures";`;
- troque a função `emailComposerData` inteira por:

```ts
export async function emailComposerData(organizationId: string) {
  const [options, allowedDomains, used, signatures] = await Promise.all([
    emailComposerOptions(organizationId),
    listSenderDomains(organizationId),
    countEmailsSentThisMonth(organizationId),
    listSignatureOptions(organizationId),
  ]);
  return {
    options,
    allowedDomains,
    quota: { used, limit: LIMITS.emailBroadcastQuotaPerMonth },
    signatures,
  };
}
```

- [ ] **Step 3: Páginas**

Em `src/app/[locale]/app/email/new/page.tsx`:
- no `draft={{ ... }}`, troque `signatureId: null,` (da Task 4) por `signatureId: data.signatures.find((s) => s.isDefault)?.id ?? null,`;
- no `<EmailComposer ... />`, depois de `quota={data.quota}`, acrescente `signatures={data.signatures}`.

Em `src/app/[locale]/app/email/[id]/edit/page.tsx`, no `<EmailComposer ... />`, depois de `quota={data.quota}`, acrescente `signatures={data.signatures}`.

- [ ] **Step 4: Composer**

Em `src/components/email/email-composer.tsx`:

1. Imports:
   - troque `import { useRouter } from "@/i18n/navigation";` por `import { Link, useRouter } from "@/i18n/navigation";`;
   - na linha de `import type { AudiencePreview, ComposerDraft, ComposerOptions } from "@/lib/email-broadcast/types";`, acrescente `SignatureOption`.

2. Props. Troque:

```tsx
export function EmailComposer({
  draft,
  options,
  allowedDomains,
  quota,
}: {
  draft: ComposerDraft;
  options: ComposerOptions;
  allowedDomains: string[];
  quota: { used: number; limit: number };
}) {
```

   por:

```tsx
export function EmailComposer({
  draft,
  options,
  allowedDomains,
  quota,
  signatures,
}: {
  draft: ComposerDraft;
  options: ComposerOptions;
  allowedDomains: string[];
  quota: { used: number; limit: number };
  signatures: SignatureOption[];
}) {
```

3. Estado. Troque `const [signatureId] = useState(draft.signatureId);` (da Task 4) por:

```tsx
  const [signatureId, setSignatureId] = useState<string | null>(draft.signatureId);
  const chosenSignature = signatures.find((s) => s.id === signatureId) ?? null;
```

4. Seção na tela. Troque:

```tsx
        <EmailAttachments value={attachments} onChange={setAttachments} onUploadingChange={setUploading} />
      </section>
```

   por:

```tsx
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="signature" className="mb-0">
              {t("signature.title")}
            </Label>
            <Link href="/app/email/signatures" className="text-sm font-medium text-brand hover:underline">
              {t("signature.manage")}
            </Link>
          </div>
          {signatures.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("signature.none")}{" "}
              <Link href="/app/email/signatures/new" className="font-medium text-brand hover:underline">
                {t("signature.create")}
              </Link>
            </p>
          ) : (
            <>
              <select
                id="signature"
                value={signatureId ?? ""}
                onChange={(e) => setSignatureId(e.target.value || null)}
                className="w-full max-w-sm rounded-lg border border-border bg-card px-4 py-2.5 text-sm focus-visible:border-brand focus-visible:outline-none"
              >
                {signatures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.isDefault ? t("signature.defaultOption", { name: s.name }) : s.name}
                  </option>
                ))}
                <option value="">{t("signature.noSignature")}</option>
              </select>
              {chosenSignature ? (
                <div
                  className="max-h-56 overflow-auto rounded-lg border border-border bg-white p-4 text-sm text-neutral-900"
                  dangerouslySetInnerHTML={{ __html: chosenSignature.previewHtml }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">{t("signature.noneChosen")}</p>
              )}
            </>
          )}
        </div>
        <EmailAttachments value={attachments} onChange={setAttachments} onUploadingChange={setUploading} />
      </section>
```

   O `previewHtml` vem do servidor já sanitizado (`listSignatureOptions` → `composeSignature`).

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm run lint && npm run check:email`
Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/email-broadcasts.ts src/components/email/email-composer.tsx "src/app/[locale]/app/email/new/page.tsx" "src/app/[locale]/app/email/[id]/edit/page.tsx" src/messages/pt.json src/messages/en.json
git commit -m "[E-mail] - Adiciona a escolha de assinatura no composer" -m "Select com as assinaturas da empresa e Sem assinatura, padrao pre-escolhida em e-mail novo, previa sanitizada no servidor e atalho para gerenciar." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Documentação, verificação completa e teste de ponta a ponta

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md` (contagem de chaves)
- Modify: `docs/guia/04-modulos-e-permissoes.md` (contagem de chaves)

**Interfaces:**
- Consome: tudo das Tasks 1–7.

- [ ] **Step 1: README**

No parágrafo `- **E-mail em massa (submenu E-mail):** ...` do `README.md`, logo antes de `Specs:`, acrescente:

```markdown
Assinaturas: aba E-mail → Assinaturas (`/app/email/signatures`). São da empresa e têm dois tipos: "Texto e imagens" (o editor do corpo) ou "Imagem pronta" (imagem, texto acima, link e texto alternativo obrigatório). Cada empresa tem no máximo uma padrão e no máximo 20 assinaturas, e quem tem acesso ao E-mail gerencia. O rascunho guarda `signatureId`. Ao iniciar o envio, a assinatura é montada e sanitizada (`composeSignature`) e congelada em `signatureHtml`/`signatureText` no próprio envio: o despachante só lê essa cópia, e editar ou excluir a assinatura não muda envios feitos. Tabela `email_signatures`; regras puras em `src/lib/email-broadcast/signature.ts`.
```

No mesmo parágrafo, troque `, e, para os anexos, \`docs/superpowers/specs/2026-10-09-email-anexos-design.md\`.` por:

```markdown
, para os anexos, `docs/superpowers/specs/2026-10-09-email-anexos-design.md`, e, para as assinaturas, `docs/superpowers/specs/2026-10-13-email-assinaturas-design.md`.
```

Na seção de migrations do runbook (§8), logo depois da linha que começa com `**Antes do merge da branch \`feature/email-anexos\`:**`, acrescente:

```markdown
**Antes do merge da branch `feature/email-assinaturas`:** aplicar no Supabase `prisma/migrations/20261013120000_email_signatures/migration.sql` com `npx prisma db execute --file prisma/migrations/20261013120000_email_signatures/migration.sql --schema prisma/schema.prisma` e depois `npx prisma migrate resolve --applied 20261013120000_email_signatures`. Ela só adiciona: o enum, a tabela `email_signatures` e as colunas `signatureId`/`signatureHtml`/`signatureText` em `email_broadcasts`. **Não** use `migrate deploy`.
```

- [ ] **Step 2: Contagem de chaves**

Rode o comando de paridade. Esperado: `2897 2897 []`.
- Em `CLAUDE.md`, troque `chaves (2822 hoje)` por `chaves (2897 hoje)`.
- Em `docs/guia/04-modulos-e-permissoes.md`, troque `**2822 chaves-folha cada um**` por `**2897 chaves-folha cada um**`.

- [ ] **Step 3: As cinco validações e o check:email**

Pare o `next dev`, se estiver rodando. Depois:

Run: `npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node && npm run check:email`
Esperado: PASS em todos.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md docs/guia/04-modulos-e-permissoes.md
git commit -m "[E-mail] - Documenta as assinaturas de e-mail" -m "README: assinaturas, copia congelada no envio e a migration antes do merge; contagem de chaves i18n atualizada." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Teste de ponta a ponta (com autorização do usuário para envios reais)**

**Preparação:**
1. Suba `npx next dev --webpack` na porta 3000.
2. Use o Chrome de teste isolado (headless, `--remote-debugging-port=9333`, perfil temporário) com `activate_tab()`, como no teste dos anexos.
3. Libere `resend.dev` para a empresa local (`npm run email:dominio -- add resend.dev <slug>`) e remova ao terminar.

**Passos:**
1. Criar uma assinatura "Texto e imagens" (com um logo enviado) e uma "Imagem pronta" (imagem, texto acima, link, texto alternativo). A de texto fica como padrão.
2. Num e-mail novo, a padrão já vem escolhida. Trocar para a de imagem e ver a prévia mudar.
3. Enviar para `delivered@resend.dev`. Esperado: a prévia "Ver e-mail enviado" mostra a assinatura, e `signatureHtml` está preenchido no banco.
4. Editar a assinatura depois do envio. Esperado: a prévia do envio feito não muda.
5. Excluir a assinatura usada por um rascunho. Esperado: o rascunho abre com "Sem assinatura".
6. Com o composer aberto, excluir a assinatura escolhida por outra aba e clicar em enviar. Esperado: o aviso "A assinatura escolhida foi excluída. Escolha outra.", e nada é enviado.
7. Um envio sem assinatura continua igual: lote de 100 (`sentAt` idêntico entre os destinatários), rodapé e anexos.
8. Marcar outra assinatura como padrão. Esperado: a anterior perde o selo.

Se algum passo falhar, use superpowers:systematic-debugging antes de corrigir.

- [ ] **Step 6: Entrega**

Não faça push. Informe ao usuário:
- os commits;
- a migration a aplicar no Supabase antes do merge;
- o teste de produção: criar uma assinatura de imagem e mandar um envio pequeno para um e-mail próprio, conferindo no Gmail e no Outlook.

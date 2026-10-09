# Anexos no E-mail em massa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Em Comunicação → E-mail, permitir anexar até 10 arquivos (10 MB no total, tipos de uma lista fechada) a um envio em massa. Os mesmos anexos vão para todos os destinatários.

**Architecture:**
- **Regras puras** num arquivo só (`src/lib/email-broadcast/attachments.ts`), usado pela tela, pela rota, pelas actions, pelo despachante e pelo `check:email`.
- **Upload:** cada arquivo sobe por `POST /api/email/attachment` para o storage, na chave `email-attachments/<orgId>/<uuid>-<nome>`. O envio guarda só `{ key, filename, size }` numa coluna JSON nova, `email_broadcasts.attachments`. O servidor confere que toda chave é da pasta da empresa.
- **Envio:** com anexo, o despachante lê os arquivos uma vez por execução (`readMedia`) e manda um e-mail por chamada pelo caminho `oneByOne`, que já existe. O `/emails/batch` do Resend não aceita anexos. Sem anexo, nada muda.

**Tech Stack:** Next.js 16, Prisma 6 + PostgreSQL (Docker local, Supabase em produção), next-intl 4, zod 3, tsx, API REST do Resend, Supabase Storage (REST).

**Spec:** [docs/superpowers/specs/2026-10-09-email-anexos-design.md](../specs/2026-10-09-email-anexos-design.md). Ela complementa as specs de 2026-10-06 e 2026-10-08 do E-mail.

## Global Constraints

- **Campanhas e e-mail transacional não mudam.** Arquivos proibidos:
  - `src/lib/dispatch.ts`, `src/lib/integrations/**`, `src/lib/email/**`;
  - `src/app/actions/campaigns.ts`, `src/components/campaigns/**`, `src/app/[locale]/app/campaigns/**`;
  - `src/components/proposals/rich-text-editor.tsx`.
- **Multi-tenant (guia 03):**
  - em request de usuário, use `tenantDb(orgId)`; por id, `findFirst` + `updateMany`/`deleteMany` com checagem de `count`;
  - nunca use `findUnique`/`update`/`delete`/`upsert` em tabela de negócio;
  - o despachante é contexto de sistema: Prisma cru, com `organizationId` explícito.
- **Banco local = Docker** (`docker compose up -d postgres`, container `metodoai-db`). **Nunca** o Postgres portátil (`pg.cmd`).
- **Nunca** rode `prisma migrate dev`, `migrate reset` ou `db push`. A migration só entra pelo procedimento da Task 2.
- **i18n:**
  - `src/messages/pt.json` e `en.json` com as mesmas chaves, sem `{{` dentro de mensagem;
  - hoje são 2806 chaves de cada lado e o plano acrescenta 16, então o fim é **2822**;
  - a contagem fica no CLAUDE.md e no guia 04 (Task 6).
- **Env:** só via `src/lib/env.ts`, nunca `process.env` no código da app.
- **Rotas `/api/*`:** a autenticação é a primeira coisa do handler (guia 05).
- **Números e nomes fixos (copiados da spec):**
  - `MAX_ATTACHMENTS = 10`;
  - `MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024`, que vale também por arquivo;
  - nome do arquivo: até 150 caracteres;
  - chave: `email-attachments/<orgId>/<uuid>-<stem>.<ext>`, com `stem` ASCII `[A-Za-z0-9._-]` de até 60 caracteres (`arquivo` se ficar vazio);
  - extensões aceitas: `pdf doc docx odt rtf txt xls xlsx ods csv ppt pptx odp jpg jpeg png gif webp`;
  - tempo limite por chamada com anexo: `ATTACHMENT_TIMEOUT_MS = 60_000`;
  - estimativa: 0,5 s por e-mail; abaixo de 60 s vira "menos de 1 minuto";
  - `PACE_MS` continua 500.
- **Commits:** `[E-mail] - Verbo + tarefa`, com corpo curto e última linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feature/email-anexos`. **Sem push.**
- Comentários de código em inglês. Textos de tela em pt-BR e en, docs em pt-BR.
- **Servidor de dev:**
  - pare qualquer `next dev` antes de `npm run build`;
  - para rota de API nova, suba com `npx next dev --webpack` na porta 3000;
  - **nunca** suba um segundo servidor em outra porta.
- Node 20: nenhuma API mais nova.
- **Envio real pelo Resend** (Task 6) só com autorização explícita do usuário na hora.

## Review Focus

1. **Nome com acento** (`Catálogo de Preços.pdf`) → chega com o mesmo nome no Gmail e no Outlook. Cobertura: Task 6, passo de envio real com esse nome.
2. **Clicar em "Salvar rascunho" ou "Revisar e enviar" com um arquivo ainda subindo** → os botões estão desabilitados, e o rascunho nunca é salvo sem o anexo. Cobertura: Task 5 (o `uploading` desabilita os botões) e Task 6, passo manual com um arquivo grande.
3. **Envio sem anexo depois da mudança** → continua em lotes de 100, uma chamada `/emails/batch` por lote. Cobertura: Task 4 (o `files ? oneByOne : deliver`); o revisor confere no diff. Task 6, passo de regressão.
4. **Arquivo apagado do storage entre o rascunho e o envio** → o envio pausa com `attachment_unavailable` e o nome do arquivo, e nenhum e-mail sai. Cobertura: Task 4 (a leitura acontece antes do primeiro lote) e Task 6, passo de apagar o arquivo de `.media/`.
5. **Servidor reiniciado no meio de um envio com anexo** → "Retomar envio" continua sem duplicar ninguém (mesma chave de idempotência por destinatário). Cobertura: Task 4 (a chave `eb-<id>-<batchNo>-<recipientId>` não muda) e Task 6, passo de interromper e retomar.

---

### Task 1: Regras puras dos anexos

**Files:**
- Create: `src/lib/email-broadcast/attachments.ts`
- Modify: `scripts/check-email-broadcast.ts`

**Interfaces:**
- Produz (todas exportadas de `src/lib/email-broadcast/attachments.ts`):
  - `MAX_ATTACHMENTS: 10`, `MAX_ATTACHMENTS_BYTES: number` (10485760);
  - `ATTACHMENT_TYPES: Readonly<Record<string, string>>`, `ATTACHMENT_ACCEPT: string` (`".pdf,.doc,..."`);
  - `type EmailAttachment = { key: string; filename: string; size: number }`;
  - `type AttachmentProblem = "count" | "type" | "total" | "key"`;
  - `attachmentExtension(filename: string): string | null`;
  - `attachmentContentType(filename: string): string | null`;
  - `cleanAttachmentName(raw: string): string | null`;
  - `attachmentStorageKey(orgId: string, uuid: string, filename: string): string`;
  - `isAttachmentKeyOf(orgId: string, key: string): boolean`;
  - `checkAttachments(orgId: string, list: readonly EmailAttachment[]): AttachmentProblem | null`;
  - `attachmentAddProblem(current: readonly EmailAttachment[], file: { name: string; size: number }): "count" | "type" | "total" | null`;
  - `parseAttachments(value: unknown): EmailAttachment[] | null` (null = JSON quebrado);
  - `readAttachments(value: unknown): EmailAttachment[]` (quebrado vira `[]`);
  - `estimateAttachmentSendMinutes(total: number): number` (0 = menos de 1 minuto);
  - `attachmentSizeParts(bytes: number): { value: number; unit: "KB" | "MB" }`.

- [ ] **Step 1: Escrever as verificações que falham**

Em `scripts/check-email-broadcast.ts`, logo depois do último `import` (o de `../src/lib/email-broadcast/sender-domain`), acrescente:

```ts
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_BYTES,
  attachmentAddProblem,
  attachmentContentType,
  attachmentExtension,
  attachmentSizeParts,
  attachmentStorageKey,
  checkAttachments,
  cleanAttachmentName,
  estimateAttachmentSendMinutes,
  isAttachmentKeyOf,
  parseAttachments,
  readAttachments,
  type EmailAttachment,
} from "../src/lib/email-broadcast/attachments";
```

E logo antes da última linha (`console.log(\`\n✅ email-broadcast: ...`), acrescente:

```ts
// --- attachments -------------------------------------------------------------
const ORG = "cmorg1234567890abcdefghij";
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const att = (filename: string, size = 1000, org = ORG): EmailAttachment => ({
  key: attachmentStorageKey(org, UUID, filename),
  filename,
  size,
});

check("attachmentExtension accepts the closed list, any case, and rejects the rest", () => {
  assert.equal(attachmentExtension("Proposta.PDF"), "pdf");
  assert.equal(attachmentExtension("planilha.Xlsx"), "xlsx");
  assert.equal(attachmentExtension("foto.jpeg"), "jpeg");
  for (const bad of [
    "pacote.zip",
    "setup.exe",
    "macro.docm",
    "script.js",
    "semextensao",
    ".pdf",
    "fim.",
    "arquivo.pdf.exe",
    "x.constructor",
  ]) {
    assert.equal(attachmentExtension(bad), null, bad);
  }
});

check("attachmentContentType comes from the extension, never the browser", () => {
  assert.equal(attachmentContentType("a.PDF"), "application/pdf");
  assert.equal(attachmentContentType("b.csv"), "text/csv");
  assert.equal(attachmentContentType("c.zip"), null);
  assert.ok(ATTACHMENT_ACCEPT.split(",").includes(".docx"));
  assert.ok(!ATTACHMENT_ACCEPT.split(",").includes(".zip"));
});

check("cleanAttachmentName keeps accents, drops paths and control chars, caps at 150", () => {
  assert.equal(cleanAttachmentName("Catálogo Outubro.pdf"), "Catálogo Outubro.pdf");
  assert.equal(cleanAttachmentName("C:\\Users\\ana\\Proposta.docx"), "Proposta.docx");
  assert.equal(cleanAttachmentName("../../etc/relatorio.txt"), "relatorio.txt");
  assert.equal(cleanAttachmentName("  nome\u0007 com\tespaço .pdf "), "nome com espaço .pdf");
  const long = cleanAttachmentName(`${"a".repeat(200)}.PDF`);
  assert.equal(long?.length, 150);
  assert.ok(long?.endsWith(".PDF"));
  assert.equal(cleanAttachmentName("pacote.zip"), null);
  assert.equal(cleanAttachmentName("   "), null);
});

check("attachmentStorageKey is ASCII-only, inside the org folder, and keeps the extension", () => {
  const key = attachmentStorageKey(ORG, UUID, "Catálogo de Preços (out).PDF");
  assert.equal(key, `email-attachments/${ORG}/${UUID}-Catalogo_de_Precos_out.pdf`);
  assert.ok(isAttachmentKeyOf(ORG, key));
  assert.equal(attachmentStorageKey(ORG, UUID, "###.pdf"), `email-attachments/${ORG}/${UUID}-arquivo.pdf`);
});

check("isAttachmentKeyOf only accepts this org's keys in the route's format", () => {
  const key = attachmentStorageKey(ORG, UUID, "a.pdf");
  assert.equal(isAttachmentKeyOf(ORG, key), true);
  assert.equal(isAttachmentKeyOf("outraorg", key), false);
  for (const bad of [
    `email-attachments/${ORG}/../outra/${UUID}-a.pdf`,
    `email-attachments/${ORG}/${UUID}-a.zip`,
    `email-attachments/${ORG}/nao-e-uuid-a.pdf`,
    `email/${ORG}/${UUID}-a.pdf`,
    `https://evil.example/${UUID}-a.pdf`,
    `email-attachments/${ORG}/sub/${UUID}-a.pdf`,
  ]) {
    assert.equal(isAttachmentKeyOf(ORG, bad), false, bad);
  }
  assert.equal(isAttachmentKeyOf("", `email-attachments//${UUID}-a.pdf`), false);
});

check("checkAttachments enforces count, type, key and the 10 MB total", () => {
  assert.equal(checkAttachments(ORG, []), null);
  assert.equal(checkAttachments(ORG, [att("a.pdf"), att("b.png")]), null);
  assert.equal(checkAttachments(ORG, Array.from({ length: 10 }, (_, i) => att(`f${i}.pdf`))), null);
  assert.equal(checkAttachments(ORG, Array.from({ length: 11 }, (_, i) => att(`f${i}.pdf`))), "count");
  assert.equal(checkAttachments(ORG, [{ ...att("a.pdf"), filename: "a.zip" }]), "type");
  assert.equal(checkAttachments(ORG, [{ ...att("a.pdf"), filename: "../a.pdf" }]), "type");
  assert.equal(checkAttachments(ORG, [att("a.pdf", 1000, "outraorg")]), "key");
  assert.equal(checkAttachments(ORG, [att("a.pdf", MAX_ATTACHMENTS_BYTES)]), null);
  assert.equal(checkAttachments(ORG, [att("a.pdf", MAX_ATTACHMENTS_BYTES), att("b.pdf", 1)]), "total");
});

check("attachmentAddProblem pre-checks a file before upload", () => {
  assert.equal(attachmentAddProblem([], { name: "a.pdf", size: 5 }), null);
  assert.equal(attachmentAddProblem([], { name: "a.zip", size: 5 }), "type");
  assert.equal(attachmentAddProblem([att("a.pdf", MAX_ATTACHMENTS_BYTES - 10)], { name: "b.pdf", size: 10 }), null);
  assert.equal(attachmentAddProblem([att("a.pdf", MAX_ATTACHMENTS_BYTES - 10)], { name: "b.pdf", size: 11 }), "total");
  assert.equal(attachmentAddProblem([], { name: "grande.pdf", size: MAX_ATTACHMENTS_BYTES + 1 }), "total");
  const ten = Array.from({ length: 10 }, (_, i) => att(`f${i}.pdf`, 1));
  assert.equal(attachmentAddProblem(ten, { name: "x.pdf", size: 1 }), "count");
});

check("parseAttachments returns null on broken JSON; readAttachments falls back to []", () => {
  const ok = [att("a.pdf")];
  assert.deepEqual(parseAttachments(ok), ok);
  assert.deepEqual(parseAttachments([]), []);
  assert.deepEqual(parseAttachments([{ ...ok[0], extra: true }]), ok);
  for (const bad of [
    null,
    "x",
    {},
    [{ key: "k", filename: "a.pdf" }],
    [{ key: "k", filename: "a.pdf", size: 1.5 }],
    [{ key: "k", filename: "a.pdf", size: 0 }],
    [ok[0], 7],
  ]) {
    assert.equal(parseAttachments(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(readAttachments([{ key: 1 }]), []);
  assert.deepEqual(readAttachments(ok), ok);
});

check("estimateAttachmentSendMinutes: ~2 e-mails/s, 0 means under a minute", () => {
  assert.equal(estimateAttachmentSendMinutes(0), 0);
  assert.equal(estimateAttachmentSendMinutes(1), 0);
  assert.equal(estimateAttachmentSendMinutes(119), 0);
  assert.equal(estimateAttachmentSendMinutes(120), 1);
  assert.equal(estimateAttachmentSendMinutes(179), 1);
  assert.equal(estimateAttachmentSendMinutes(180), 2);
  assert.equal(estimateAttachmentSendMinutes(1000), 8);
});

check("attachmentSizeParts shows KB under 1 MB and MB above", () => {
  assert.deepEqual(attachmentSizeParts(0), { value: 0, unit: "KB" });
  assert.deepEqual(attachmentSizeParts(1), { value: 1, unit: "KB" });
  assert.deepEqual(attachmentSizeParts(512 * 1024), { value: 512, unit: "KB" });
  assert.deepEqual(attachmentSizeParts(1024 * 1024), { value: 1, unit: "MB" });
  assert.deepEqual(attachmentSizeParts(4.25 * 1024 * 1024), { value: 4.3, unit: "MB" });
  assert.deepEqual(attachmentSizeParts(MAX_ATTACHMENTS_BYTES), { value: 10, unit: "MB" });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run check:email`
Esperado: FAIL com `Cannot find module '../src/lib/email-broadcast/attachments'`.

- [ ] **Step 3: Implementar `attachments.ts`**

Crie `src/lib/email-broadcast/attachments.ts`:

```ts
/**
 * Attachment rules of the mass e-mail (spec 2026-10-09). Pure and free of
 * `server-only`: the composer, the upload route, the actions, the dispatcher
 * and scripts/check-email-broadcast.ts all use it.
 */

export const MAX_ATTACHMENTS = 10;
/** Total of all attachments of one send (also the cap for a single file). */
export const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
const MAX_NAME = 150;
const MAX_STEM = 60;
/** One e-mail per call at PACE_MS (dispatch.ts) = ~2 e-mails/s. */
const SECONDS_PER_EMAIL = 0.5;

/** Allowed extensions → the content type sent to Resend. Never the browser's MIME. */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/** `accept` attribute of the composer's file input. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export type EmailAttachment = { key: string; filename: string; size: number };

export type AttachmentProblem = "count" | "type" | "total" | "key";

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_TAIL_RE = new RegExp(`^${UUID_RE}-[A-Za-z0-9._-]{1,${MAX_STEM}}\\.[a-z0-9]{1,5}$`);

/** Allowed extension of `filename` in lowercase, or null. Needs a name before the dot. */
export function attachmentExtension(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, ext) ? ext : null;
}

export function attachmentContentType(filename: string): string | null {
  const ext = attachmentExtension(filename);
  return ext ? ATTACHMENT_TYPES[ext] : null;
}

/** Display/e-mail name: last path segment, whitespace collapsed, control chars
 * dropped, capped at 150 keeping the extension. Null when nothing valid is left. */
export function cleanAttachmentName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const name = Array.from(base.replace(/\s+/g, " "))
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  if (!attachmentExtension(name)) return null;
  if (name.length <= MAX_NAME) return name;
  const suffix = name.slice(name.lastIndexOf("."));
  return `${name.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`;
}

/** Storage key of an uploaded attachment: ASCII-only, inside the org's folder. */
export function attachmentStorageKey(orgId: string, uuid: string, filename: string): string {
  const ext = attachmentExtension(filename) ?? "bin";
  const dot = filename.lastIndexOf(".");
  const stem =
    filename
      .slice(0, dot > 0 ? dot : filename.length)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, MAX_STEM) || "arquivo";
  return `email-attachments/${orgId}/${uuid}-${stem}.${ext}`;
}

/** The isolation lock: a key is only usable by the org whose folder it is in,
 * in exactly the format the upload route generates. */
export function isAttachmentKeyOf(orgId: string, key: string): boolean {
  const prefix = `email-attachments/${orgId}/`;
  if (!orgId || !key.startsWith(prefix)) return false;
  const tail = key.slice(prefix.length);
  return KEY_TAIL_RE.test(tail) && attachmentExtension(tail) !== null;
}

/** First problem of a send's attachment list, or null when it is valid. */
export function checkAttachments(orgId: string, list: readonly EmailAttachment[]): AttachmentProblem | null {
  if (list.length > MAX_ATTACHMENTS) return "count";
  let total = 0;
  for (const a of list) {
    if (cleanAttachmentName(a.filename) !== a.filename) return "type";
    if (!isAttachmentKeyOf(orgId, a.key)) return "key";
    total += a.size;
  }
  return total > MAX_ATTACHMENTS_BYTES ? "total" : null;
}

/** Composer pre-check before uploading `file` next to `current` (the server checks again). */
export function attachmentAddProblem(
  current: readonly EmailAttachment[],
  file: { name: string; size: number },
): "count" | "type" | "total" | null {
  if (current.length >= MAX_ATTACHMENTS) return "count";
  if (!cleanAttachmentName(file.name)) return "type";
  const used = current.reduce((n, a) => n + a.size, 0);
  return used + file.size > MAX_ATTACHMENTS_BYTES ? "total" : null;
}

/** Stored `attachments` JSON back into a list; null when it is broken. The
 * dispatcher treats null as invalid: a send must never go out without its files. */
export function parseAttachments(value: unknown): EmailAttachment[] | null {
  if (!Array.isArray(value)) return null;
  const out: EmailAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { key, filename, size } = item as Record<string, unknown>;
    if (typeof key !== "string" || typeof filename !== "string") return null;
    if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return null;
    out.push({ key, filename, size });
  }
  return out;
}

/** For screens: a broken value shows as no attachments. */
export function readAttachments(value: unknown): EmailAttachment[] {
  return parseAttachments(value) ?? [];
}

/** Rough send time with attachments, in whole minutes; 0 = under a minute. */
export function estimateAttachmentSendMinutes(total: number): number {
  const seconds = total * SECONDS_PER_EMAIL;
  return seconds < 60 ? 0 : Math.max(1, Math.round(seconds / 60));
}

/** Size split for display: KB under 1 MB, MB (one decimal) above. */
export function attachmentSizeParts(bytes: number): { value: number; unit: "KB" | "MB" } {
  if (bytes < 1024 * 1024) return { value: bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024)), unit: "KB" };
  return { value: Math.round((bytes / (1024 * 1024)) * 10) / 10, unit: "MB" };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run check:email`
Esperado: PASS, terminando em `✅ email-broadcast: N checks passed.`, com as 11 verificações novas listadas.

Run: `npm run typecheck && npm run lint`
Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email-broadcast/attachments.ts scripts/check-email-broadcast.ts
git commit -m "[E-mail] - Adiciona as regras puras dos anexos" -m "Lista fechada de tipos, 10 arquivos e 10 MB, chave por empresa, nome limpo e estimativa de tempo; cobertas no check:email." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Banco e servidor (coluna, validação, actions e páginas)

**Files:**
- Modify: `prisma/schema.prisma` (model `EmailBroadcast`)
- Create: `prisma/migrations/20261009120000_email_broadcast_attachments/migration.sql` (gerado)
- Modify: `src/lib/validations/email-broadcast.ts`
- Modify: `src/app/actions/email-broadcasts.ts`
- Modify: `src/lib/queries/email-broadcasts.ts` (`getEmailBroadcast`)
- Modify: `src/lib/email-broadcast/types.ts`
- Modify: `src/app/[locale]/app/email/new/page.tsx`, `src/app/[locale]/app/email/[id]/edit/page.tsx`
- Modify: `src/components/email/email-composer.tsx` (só o `payload`)
- Modify: `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consome da Task 1: `checkAttachments`, `parseAttachments`, `readAttachments`, `MAX_ATTACHMENTS`, `type EmailAttachment`.
- Produz:
  - `emailBroadcast.attachments: Prisma.JsonValue` (default `[]`);
  - `emailAttachmentSchema` (zod) e `attachments` em `broadcastDraftSchema`, opcional na entrada (`default([])`);
  - `EmailActionError` com `"attachments_invalid"`;
  - `ComposerDraft.attachments: EmailAttachment[]`;
  - `getEmailBroadcast(...)` devolve também `attachments`.

- [ ] **Step 1: Banco local do Docker de pé**

Run: `docker ps --format '{{.Names}} {{.Status}}'`. Esperado: `metodoai-db` com `(healthy)`.
- Se o daemon não responder, abra `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`, espere `docker info` responder e rode `docker compose up -d postgres`.
- Se `%LOCALAPPDATA%\metodoai-dev\pg.cmd status` mostrar o portátil rodando, rode `pg.cmd stop`.

- [ ] **Step 2: Escrever o teste que falha (tipos)**

Em `src/lib/email-broadcast/types.ts`, acrescente o import no topo, depois dos imports existentes:

```ts
import type { EmailAttachment } from "./attachments";
```

E em `ComposerDraft`, depois de `picked: PickedTarget[];`:

```ts
  attachments: EmailAttachment[];
```

Em `src/app/[locale]/app/email/[id]/edit/page.tsx`:
- acrescente o import `import { readAttachments } from "@/lib/email-broadcast/attachments";`;
- no objeto `draft={{ ... }}`, depois de `picked,`, acrescente `attachments: readAttachments(b.attachments),`.

Em `src/app/[locale]/app/email/new/page.tsx`, no objeto `draft={{ ... }}`, depois de `picked: [],`, acrescente `attachments: [],`.

Run: `npm run typecheck`
Esperado: FAIL com `Property 'attachments' does not exist` na página de edição, porque o model ainda não tem a coluna.

- [ ] **Step 3: Schema**

Em `model EmailBroadcast` de `prisma/schema.prisma`, logo depois da linha `audience       Json                 @default("{}")`:

```prisma
  /// EmailAttachment[] (src/lib/email-broadcast/attachments.ts): { key, filename, size }.
  attachments    Json                 @default("[]")
```

- [ ] **Step 4: Gerar e aplicar a migration (sem `migrate dev`)**

```bash
mkdir -p prisma/migrations/20261009120000_email_broadcast_attachments
git show origin/main:prisma/schema.prisma > "$TEMP/schema-main.prisma"
npx prisma migrate diff --from-schema-datamodel "$TEMP/schema-main.prisma" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261009120000_email_broadcast_attachments/migration.sql
```

Abra o SQL. Ele deve ter **só** este comando (os comentários do Prisma podem aparecer):

```sql
ALTER TABLE "email_broadcasts" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]';
```

Se houver qualquer outra coisa, pare e reporte. Depois:

```bash
npx prisma db execute --file prisma/migrations/20261009120000_email_broadcast_attachments/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20261009120000_email_broadcast_attachments
npx prisma generate
```

- [ ] **Step 5: Query e validação**

Em `src/lib/queries/email-broadcasts.ts`, no `select` de `getEmailBroadcast`, depois de `audience: true,`, acrescente `attachments: true,`.

Em `src/lib/validations/email-broadcast.ts`:
- acrescente o import `import { MAX_ATTACHMENTS } from "@/lib/email-broadcast/attachments";` depois do import de `normalize`;
- antes de `export const broadcastDraftSchema`, acrescente:

```ts
/** One uploaded attachment as the composer sends it back; the server checks
 * the key, name and total again with checkAttachments. */
export const emailAttachmentSchema = z.object({
  key: z.string().min(1).max(300),
  filename: z.string().min(1).max(150),
  size: z.number().int().positive(),
});
```

- em `broadcastDraftSchema`, depois de `audience: audienceSelectionSchema,`:

```ts
  attachments: z.array(emailAttachmentSchema).max(MAX_ATTACHMENTS).default([]),
```

- [ ] **Step 6: Actions**

Em `src/app/actions/email-broadcasts.ts`:

1. Acrescente o import:

```ts
import { checkAttachments, parseAttachments } from "@/lib/email-broadcast/attachments";
```

2. Em `EmailActionError`, depois de `| "from_missing"`, acrescente `| "attachments_invalid"`.

3. Em `saveEmailDraft`, troque:

```ts
  const parsed = broadcastDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
```

por:

```ts
  const parsed = broadcastDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  // Keys must be this org's uploads: the dispatcher reads files by key only.
  if (checkAttachments(g.ctx.organizationId, parsed.data.attachments)) {
    return { ok: false, error: "attachments_invalid" };
  }
```

e, no objeto `data` logo abaixo, depois de `audience: parsed.data.audience as Prisma.InputJsonValue,`:

```ts
    attachments: parsed.data.attachments as Prisma.InputJsonValue,
```

4. Em `duplicateEmailBroadcast`:
   - no `select`, acrescente `attachments: true`, ficando `select: { subject: true, html: true, fromName: true, fromEmail: true, replyTo: true, audience: true, attachments: true },`;
   - no `data` do `create`, depois de `audience: (src.audience ?? {}) as Prisma.InputJsonValue,`, acrescente:

```ts
        attachments: (src.attachments ?? []) as Prisma.InputJsonValue,
```

5. Em `startEmailBroadcast`:
   - no `select`, acrescente `attachments: true`, ficando `select: { id: true, status: true, subject: true, html: true, audience: true, fromEmail: true, attachments: true },`;
   - logo depois do bloco `if (!isSenderAllowed(b.fromEmail, await listSenderDomains(orgId))) { ... }`, acrescente:

```ts
  const attachments = parseAttachments(b.attachments);
  if (!attachments || checkAttachments(orgId, attachments)) {
    return { ok: false, error: "attachments_invalid" };
  }
```

   - no `audit(...)`, troque `meta: { recipients: recipients.length, fromEmail: b.fromEmail },` por `meta: { recipients: recipients.length, fromEmail: b.fromEmail, attachments: attachments.length },`.

- [ ] **Step 7: Composer mantém os anexos ao salvar**

Em `src/components/email/email-composer.tsx`:
- depois de `const [picked, setPicked] = useState(draft.picked);`, acrescente `const [attachments] = useState(draft.attachments);`;
- troque `const payload = () => ({ subject, html, fromName, fromEmail, replyTo, audience });` por `const payload = () => ({ subject, html, fromName, fromEmail, replyTo, audience, attachments });`.

A Task 5 troca esse `useState` pela versão com setter.

- [ ] **Step 8: Texto do erro novo**

Em `src/messages/pt.json`, dentro de `emailBroadcast.error`, logo depois da linha `"from_required": "Preencha o endereço de envio.",`:

```json
      "attachments_invalid": "Os anexos deste envio são inválidos. Remova e anexe de novo.",
```

Em `src/messages/en.json`, logo depois de `"from_required": "Fill in the sending address.",`:

```json
      "attachments_invalid": "This send's attachments are invalid. Remove them and attach again.",
```

- [ ] **Step 9: Rodar e confirmar que passa**

Run: `npm run typecheck && npm run lint && npm run check:email && npm run check:isolation`
Esperado: PASS em todos; `check:isolation` termina em `✅ Tenant isolation: all checks passed.`.

Paridade de i18n:

```bash
node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p+k+'.'):[p+k]);const a=new Set(f(require('./src/messages/pt.json'))),b=new Set(f(require('./src/messages/en.json')));console.log(a.size,b.size,[...a].filter(k=>!b.has(k)).concat([...b].filter(k=>!a.has(k))))"
```

Esperado: `2807 2807 []`.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261009120000_email_broadcast_attachments src/lib/validations/email-broadcast.ts src/app/actions/email-broadcasts.ts src/lib/queries/email-broadcasts.ts src/lib/email-broadcast/types.ts "src/app/[locale]/app/email/new/page.tsx" "src/app/[locale]/app/email/[id]/edit/page.tsx" src/components/email/email-composer.tsx src/messages/pt.json src/messages/en.json
git commit -m "[E-mail] - Guarda os anexos no envio e valida no servidor" -m "Coluna attachments (migration aditiva); salvar, duplicar e iniciar conferem chave da empresa, tipo, quantidade e total." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Leitura do storage e rota de upload

**Files:**
- Modify: `src/lib/storage/blob.ts`
- Create: `src/app/api/email/attachment/route.ts`

**Interfaces:**
- Consome da Task 1: `attachmentContentType`, `attachmentStorageKey`, `cleanAttachmentName`, `MAX_ATTACHMENTS_BYTES`.
- Produz:
  - `readMedia(pathname: string): Promise<Buffer>`;
  - `mediaReadable(): boolean`;
  - `POST /api/email/attachment`, que recebe o campo `file` (multipart) e responde:
    - `200 { ok: true, attachment: { key, filename, size } }`;
    - `400 { ok: false, error: "invalid" | "type" | "size" }`;
    - `401`/`403` (texto);
    - `503 { ok: false, error: "storage" }`;
    - `500 { ok: false, error: "unknown" }`.

- [ ] **Step 1: `readMedia` e `mediaReadable`**

Em `src/lib/storage/blob.ts`, logo depois da função `putMedia` (antes de `deleteMedia`), acrescente:

```ts
/** Whether readMedia works with the active backend (Supabase or local disk). */
export function mediaReadable(): boolean {
  return supabaseEnabled() || !blobEnabled();
}

/**
 * Read stored bytes back by the pathname given to putMedia. Supabase is read
 * through the authenticated API (no public URL involved); local disk stays
 * inside .media/. Vercel Blob is not supported: its names get a random suffix,
 * so the pathname alone can't find the object.
 */
export async function readMedia(pathname: string): Promise<Buffer> {
  if (supabaseEnabled()) {
    const res = await fetch(
      `${env.SUPABASE_URL}/storage/v1/object/authenticated/${SUPABASE_BUCKET}/${pathname}`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) throw new Error(`Supabase read failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (blobEnabled()) throw new Error("readMedia is not supported on Vercel Blob");
  const file = path.resolve(LOCAL_DIR, pathname);
  if (!file.startsWith(LOCAL_DIR + path.sep)) throw new Error("Invalid media path");
  return fs.readFile(file);
}
```

- [ ] **Step 2: A rota**

Crie `src/app/api/email/attachment/route.ts`:

```ts
import { randomUUID } from "crypto";
import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { mediaReadable, putMedia } from "@/lib/storage/blob";
import {
  MAX_ATTACHMENTS_BYTES,
  attachmentContentType,
  attachmentStorageKey,
  cleanAttachmentName,
} from "@/lib/email-broadcast/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload ONE attachment for a mass e-mail. Same gates as the E-mail screen
 * (session + "email" screen + Marketing module), checked before reading the
 * body. The type comes from the extension (never the browser's MIME) and the
 * size is measured here. Returns the storage KEY: the dispatcher reads
 * attachments by key, never by a client-supplied URL.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!mediaReadable()) return Response.json({ ok: false, error: "storage" }, { status: 503 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    /* ignore */
  }
  if (!file || file.size === 0) return Response.json({ ok: false, error: "invalid" }, { status: 400 });

  const filename = cleanAttachmentName(file.name);
  const contentType = filename ? attachmentContentType(filename) : null;
  if (!filename || !contentType) return Response.json({ ok: false, error: "type" }, { status: 400 });
  if (file.size > MAX_ATTACHMENTS_BYTES) return Response.json({ ok: false, error: "size" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = attachmentStorageKey(ctx.organizationId, randomUUID(), filename);
  try {
    await putMedia(key, buffer, contentType);
    return Response.json({ ok: true, attachment: { key, filename, size: buffer.byteLength } });
  } catch (error) {
    console.error("[email-attachment] upload failed", error);
    return Response.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verificar tipos e lint**

Run: `npm run typecheck && npm run lint`
Esperado: sem erros.

- [ ] **Step 4: Verificar que a rota nasce fechada**

Pare qualquer `next dev` que esteja rodando e suba de novo na porta 3000: `npx next dev --webpack` (em segundo plano). Espere `Ready`.

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/email/attachment`
Esperado: `401`.

O caminho logado é testado na Task 6, pelo navegador.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/blob.ts src/app/api/email/attachment/route.ts
git commit -m "[E-mail] - Adiciona o upload de anexos e a leitura do storage" -m "Rota /api/email/attachment com o gating da tela, tipo pela extensao e chave na pasta da empresa; readMedia le o Supabase pela API autenticada ou o disco local." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Envio com anexos (despachante)

**Files:**
- Modify: `src/lib/email-broadcast/resend.ts`
- Modify: `src/lib/email-broadcast/dispatch.ts`
- Modify: `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consome:
  - da Task 1: `attachmentContentType`, `checkAttachments`, `parseAttachments`, `MAX_ATTACHMENTS_BYTES`;
  - da Task 2: `emailBroadcast.attachments`;
  - da Task 3: `readMedia`.
- Produz:
  - `type ResendAttachment = { filename: string; content: string; content_type: string }`;
  - `ResendEmail.attachments?: ResendAttachment[]`;
  - `sendOne(apiKey, email, idempotencyKey?, timeoutMs?)`;
  - os `pausedReason` novos `"attachment_unavailable"` (com `lastError` = nome do arquivo) e `"attachment_invalid"`.

- [ ] **Step 1: Cliente do Resend**

Em `src/lib/email-broadcast/resend.ts`:

1. Antes de `export type ResendEmail = {`, acrescente:

```ts
/** `content` is base64; the type comes from the extension (attachments.ts). */
export type ResendAttachment = { filename: string; content: string; content_type: string };
```

2. Em `ResendEmail`, depois de `headers?: Record<string, string>;`, acrescente:

```ts
  attachments?: ResendAttachment[];
```

3. Na assinatura de `call`, troque `init: { method: "POST" | "DELETE"; body?: unknown; idempotencyKey?: string },` por:

```ts
  init: { method: "POST" | "DELETE"; body?: unknown; idempotencyKey?: string; timeoutMs?: number },
```

   e troque `signal: AbortSignal.timeout(30_000),` por `signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),`.

4. Troque a função `sendOne` inteira por:

```ts
export function sendOne(apiKey: string, email: ResendEmail, idempotencyKey?: string, timeoutMs?: number) {
  return call<{ id?: string }>(apiKey, "/emails", { method: "POST", body: email, idempotencyKey, timeoutMs });
}
```

- [ ] **Step 2: Despachante**

Em `src/lib/email-broadcast/dispatch.ts`, faça estas trocas, cada uma exatamente como abaixo.

1. Imports. Troque:

```ts
import { platformResendKey } from "./platform";
import { isSenderAllowed } from "./sender-domain";
import { sendBatch, sendOne, type ResendEmail } from "./resend";
```

por:

```ts
import { readMedia } from "@/lib/storage/blob";
import { platformResendKey } from "./platform";
import { isSenderAllowed } from "./sender-domain";
import { MAX_ATTACHMENTS_BYTES, attachmentContentType, checkAttachments, parseAttachments } from "./attachments";
import { sendBatch, sendOne, type ResendAttachment, type ResendEmail } from "./resend";
```

2. Constante. Logo depois de `export const QUEUE_BUDGET_MS = 50_000;`, acrescente:

```ts
/** Per-call timeout when the e-mail carries attachments (up to ~13.3 MB of base64). */
const ATTACHMENT_TIMEOUT_MS = 60_000;
```

3. Tipo `Outcome`. Troque `type Outcome = { kind: "ok" } | { kind: "pause"; message: string };` por:

```ts
type Outcome = { kind: "ok" } | { kind: "pause"; message: string } | { kind: "budget" };
```

4. Leitura do envio. Em `runEmailBroadcast`, troque:

```ts
    select: { id: true, organizationId: true, status: true, subject: true, html: true, fromName: true, fromEmail: true, replyTo: true },
```

por:

```ts
    select: {
      id: true,
      organizationId: true,
      status: true,
      subject: true,
      html: true,
      fromName: true,
      fromEmail: true,
      replyTo: true,
      attachments: true,
    },
```

5. Motivos de pausa. Troque:

```ts
    reason: "no_connection" | "quota" | "provider_error" | "domain_not_allowed" | "from_missing",
```

por:

```ts
    reason:
      | "no_connection"
      | "quota"
      | "provider_error"
      | "domain_not_allowed"
      | "from_missing"
      | "attachment_unavailable"
      | "attachment_invalid",
```

6. Carregar os anexos. Logo depois da linha `const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Number.POSITIVE_INFINITY;`, acrescente:

```ts
    // Attachments are read once per run, before any batch: a send never goes
    // out without its files (spec 2026-10-09 §8).
    const attachments = parseAttachments(b.attachments);
    if (!attachments || checkAttachments(org, attachments)) {
      await pause("attachment_invalid", null);
      return { done: true };
    }
    let files: ResendAttachment[] | null = null;
    if (attachments.length > 0) {
      const loaded: ResendAttachment[] = [];
      let bytes = 0;
      for (const a of attachments) {
        let data: Buffer;
        try {
          data = await readMedia(a.key);
        } catch (e) {
          console.error("[email] attachment read failed", a.key, e);
          await pause("attachment_unavailable", a.filename);
          return { done: true };
        }
        bytes += data.byteLength;
        loaded.push({
          filename: a.filename,
          content: data.toString("base64"),
          content_type: attachmentContentType(a.filename) ?? "application/octet-stream",
        });
      }
      // The sizes saved with the draft come from the client; the real bytes decide.
      if (bytes > MAX_ATTACHMENTS_BYTES) {
        await pause("attachment_invalid", null);
        return { done: true };
      }
      files = loaded;
      await beat();
    }
```

7. Anexos em cada e-mail. Em `toEmail`, troque:

```ts
        headers: {
          "List-Unsubscribe": `<${emailUnsubscribeOneClickUrl(r.id)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
```

por:

```ts
        headers: {
          "List-Unsubscribe": `<${emailUnsubscribeOneClickUrl(r.id)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        ...(files ? { attachments: files } : {}),
      };
```

8. Orçamento e tempo limite no `oneByOne`. Troque:

```ts
      for (const r of batch) {
        const key = `eb-${b.id}-${batchNo}-${r.id}`;
        const counters: Counters = { rate: 0, server: 0, conflict: 0 };
        for (;;) {
          const res = await sendOne(apiKey, toEmail(r), key);
```

por:

```ts
      for (const r of batch) {
        // Stop between recipients when the run's budget is over (queue mode);
        // the rest of the batch stays QUEUED for the next run.
        if (Date.now() >= deadline) return { kind: "budget" };
        const key = `eb-${b.id}-${batchNo}-${r.id}`;
        const counters: Counters = { rate: 0, server: 0, conflict: 0 };
        for (;;) {
          const res = await sendOne(apiKey, toEmail(r), key, files ? ATTACHMENT_TIMEOUT_MS : undefined);
```

9. Escolha do caminho no laço principal. Troque:

```ts
      const outcome = await deliver(batch, next.batchNo);
      if (outcome.kind === "pause") {
        await pause("provider_error", outcome.message);
        return { done: true };
      }
```

por:

```ts
      // /emails/batch doesn't take attachments: with files, one call per recipient.
      const outcome = files ? await oneByOne(batch, next.batchNo) : await deliver(batch, next.batchNo);
      if (outcome.kind === "pause") {
        await pause("provider_error", outcome.message);
        return { done: true };
      }
      if (outcome.kind === "budget") break;
```

O `break` cai no bloco que já existe depois do `while` ("Budget over"), que libera o lease e devolve `{ done: false }`.

- [ ] **Step 3: Textos das pausas novas**

Em `src/messages/pt.json`, dentro de `emailBroadcast.paused`, a última linha é a do `"from_missing": "Envio pausado: este envio foi criado antes...duplique-o (o novo envio vai para toda a lista)."`. Acrescente uma vírgula no fim dela e, logo abaixo:

```json
      "attachment_unavailable": "Envio pausado: um anexo não pôde ser carregado. Tente retomar; se continuar, duplique o envio e anexe o arquivo de novo.",
      "attachment_invalid": "Envio pausado: os anexos deste envio passam do limite ou estão inválidos. Duplique o envio e anexe os arquivos de novo."
```

Em `src/messages/en.json`, a última linha de `emailBroadcast.paused` é a do `"from_missing": "Send paused: this send was created before...(the new send goes to the whole list)."`. Acrescente a vírgula e, logo abaixo:

```json
      "attachment_unavailable": "Send paused: an attachment couldn't be loaded. Try resuming; if it keeps failing, duplicate the send and attach the file again.",
      "attachment_invalid": "Send paused: this send's attachments go over the limit or are invalid. Duplicate the send and attach the files again."
```

A página do envio já mostra `paused.<motivo>` seguido de `(lastError)`, então o nome do arquivo aparece sem mudar a página.

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm run lint && npm run check:email`
Esperado: sem erros.

Paridade de i18n (o comando do Step 9 da Task 2). Esperado: `2809 2809 []`.

Confira no diff de `dispatch.ts`:
- o envio sem anexo continua chamando `deliver` (lote);
- a chave `eb-${b.id}-${batchNo}-${r.id}` não mudou;
- nenhum `sendOne`/`sendBatch` acontece antes da leitura dos anexos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email-broadcast/resend.ts src/lib/email-broadcast/dispatch.ts src/messages/pt.json src/messages/en.json
git commit -m "[E-mail] - Envia os anexos um por um no despachante" -m "Anexos lidos uma vez por execucao e conferidos pelos bytes reais; com anexo cada destinatario vira uma chamada (o lote do Resend nao aceita anexos), com 60 s de limite e orcamento conferido entre destinatarios." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Tela (seção Anexos, confirmação e página do envio)

**Files:**
- Create: `src/components/email/email-attachments.tsx`
- Modify: `src/components/email/email-composer.tsx`
- Modify: `src/app/[locale]/app/email/[id]/page.tsx`
- Modify: `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consome:
  - da Task 1: `ATTACHMENT_ACCEPT`, `MAX_ATTACHMENTS`, `MAX_ATTACHMENTS_BYTES`, `attachmentAddProblem`, `attachmentSizeParts`, `estimateAttachmentSendMinutes`, `readAttachments`, `type EmailAttachment`;
  - da Task 3: `POST /api/email/attachment`.
- Produz:
  - `EmailAttachments({ value, onChange, onUploadingChange })`;
  - as chaves i18n `emailBroadcast.attachments.*`, `confirmAttachments`, `confirmAttachmentsQuick` e `report.attachments`.

- [ ] **Step 1: Textos**

Em `src/messages/pt.json`, o bloco `emailBroadcast.image` termina em:

```json
      "uploadError": "Não foi possível enviar a imagem. Tente de novo."
    },
```

Logo depois desse `},`, acrescente:

```json
    "attachments": {
      "title": "Anexos",
      "add": "Adicionar arquivos",
      "counter": "{count, plural, one {# arquivo} other {# arquivos}} · {used} de {max}",
      "notice": "E-mails com anexo saem um por um, cerca de 2 por segundo.",
      "uploading": "Enviando {file}…",
      "remove": "Remover {file}",
      "errorType": "O arquivo {file} não é aceito. Use PDF, Word, Excel, PowerPoint, OpenDocument, TXT, CSV ou imagem.",
      "errorTotal": "{file} passa do limite de 10 MB somando todos os anexos.",
      "errorCount": "No máximo {max} arquivos por envio.",
      "errorUpload": "Não foi possível anexar {file}. Tente de novo."
    },
```

Logo depois de `"confirmSend": "Enviar para {count}",`:

```json
    "confirmAttachments": "Com anexos, o envio leva cerca de {minutes, plural, one {# minuto} other {# minutos}}.",
    "confirmAttachmentsQuick": "Com anexos, o envio leva menos de 1 minuto.",
```

Dentro de `emailBroadcast.report`, logo depois de `"showing": "Mostrando os primeiros {count}.",`:

```json
      "attachments": "Anexos",
```

Em `src/messages/en.json`, nos mesmos lugares. Depois do `},` que fecha `image` (`"uploadError": "Couldn't upload the image. Try again."`):

```json
    "attachments": {
      "title": "Attachments",
      "add": "Add files",
      "counter": "{count, plural, one {# file} other {# files}} · {used} of {max}",
      "notice": "Emails with attachments go out one by one, about 2 per second.",
      "uploading": "Uploading {file}…",
      "remove": "Remove {file}",
      "errorType": "The file {file} isn't accepted. Use PDF, Word, Excel, PowerPoint, OpenDocument, TXT, CSV or an image.",
      "errorTotal": "{file} goes over the 10 MB limit for all attachments together.",
      "errorCount": "At most {max} files per send.",
      "errorUpload": "Couldn't attach {file}. Try again."
    },
```

Depois de `"confirmSend": "Send to {count}",`:

```json
    "confirmAttachments": "With attachments, sending takes about {minutes, plural, one {# minute} other {# minutes}}.",
    "confirmAttachmentsQuick": "With attachments, sending takes less than a minute.",
```

Depois de `"showing": "Showing the first {count}.",`:

```json
      "attachments": "Attachments",
```

Paridade de i18n (o comando do Step 9 da Task 2). Esperado: `2822 2822 []`.

- [ ] **Step 2: Componente da seção**

Crie `src/components/email/email-attachments.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_BYTES,
  attachmentAddProblem,
  attachmentSizeParts,
  type EmailAttachment,
} from "@/lib/email-broadcast/attachments";

const PROBLEM_KEY = { count: "errorCount", type: "errorType", total: "errorTotal" } as const;

/**
 * "Anexos" section of the composer (spec 2026-10-09 §6). Files are checked
 * with the server's rules, then uploaded one request at a time, in order.
 * While uploading, the parent disables save/send and removal is blocked, so
 * the list built here can't race an edit.
 */
export function EmailAttachments({
  value,
  onChange,
  onUploadingChange,
}: {
  value: EmailAttachment[];
  onChange: (next: EmailAttachment[]) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const t = useTranslations("emailBroadcast.attachments");
  const format = useFormatter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const size = (bytes: number) => {
    const { value: n, unit } = attachmentSizeParts(bytes);
    return `${format.number(n, { maximumFractionDigits: 1 })} ${unit}`;
  };

  async function upload(file: File): Promise<EmailAttachment | null> {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/email/attachment", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        attachment?: EmailAttachment;
        error?: string;
      };
      if (res.ok && data.ok && data.attachment) return data.attachment;
      const key = data.error === "type" ? "errorType" : data.error === "size" ? "errorTotal" : "errorUpload";
      toast(t(key, { file: file.name }), { variant: "error" });
    } catch (error) {
      console.error("[email-attachment] upload failed", error);
      toast(t("errorUpload", { file: file.name }), { variant: "error" });
    }
    return null;
  }

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    if (input.current) input.current.value = "";
    let list = value;
    onUploadingChange(true);
    try {
      for (const file of picked) {
        const problem = attachmentAddProblem(list, file);
        if (problem) {
          toast(t(PROBLEM_KEY[problem], { file: file.name, max: MAX_ATTACHMENTS }), { variant: "error" });
          continue;
        }
        setUploading(file.name);
        const added = await upload(file);
        if (added) {
          list = [...list, added];
          onChange(list);
        }
      }
    } finally {
      setUploading(null);
      onUploadingChange(false);
    }
  }

  const used = value.reduce((n, a) => n + a.size, 0);

  return (
    <div>
      {/* Not a <label>: the hidden file input is driven by the button below. */}
      <p className="mb-1.5 text-sm font-medium">{t("title")}</p>
      {value.length > 0 ? (
        <ul className="mb-2 flex flex-col divide-y divide-border rounded-lg border border-border">
          {value.map((a) => (
            <li key={a.key} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{a.filename}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{size(a.size)}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.key !== a.key))}
                disabled={uploading !== null}
                aria-label={t("remove", { file: a.filename })}
                className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {uploading ? <p className="mb-2 text-xs text-muted-foreground">{t("uploading", { file: uploading })}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(e) => void onPick(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => input.current?.click()}
          disabled={uploading !== null || value.length >= MAX_ATTACHMENTS}
        >
          {t("add")}
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {t("counter", { count: value.length, used: size(used), max: size(MAX_ATTACHMENTS_BYTES) })}
        </span>
      </div>
      {value.length > 0 ? <p className="mt-2 text-xs text-muted-foreground">{t("notice")}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: Composer**

Em `src/components/email/email-composer.tsx`:

1. Imports. Depois de `import { AudienceSummary } from "@/components/email/audience-summary";`, acrescente:

```ts
import { EmailAttachments } from "@/components/email/email-attachments";
import { estimateAttachmentSendMinutes } from "@/lib/email-broadcast/attachments";
```

2. Estado. Troque `const [attachments] = useState(draft.attachments);` (da Task 2) por:

```ts
  const [attachments, setAttachments] = useState(draft.attachments);
  const [uploading, setUploading] = useState(false);
```

3. Frase na confirmação. Em `onSend`, troque:

```ts
      const ok = await confirm({
        title: t("confirmTitle", { count: s.total }),
        description: t("confirmBody", {
          subject: subject || t("noSubject"),
          duplicates: s.duplicates,
          suppressed: s.suppressed,
          invalid: s.invalid,
        }),
```

por:

```ts
      const minutes = estimateAttachmentSendMinutes(s.total);
      const timing =
        attachments.length === 0
          ? ""
          : ` ${minutes === 0 ? t("confirmAttachmentsQuick") : t("confirmAttachments", { minutes })}`;
      const ok = await confirm({
        title: t("confirmTitle", { count: s.total }),
        description:
          t("confirmBody", {
            subject: subject || t("noSubject"),
            duplicates: s.duplicates,
            suppressed: s.suppressed,
            invalid: s.invalid,
          }) + timing,
```

4. Seção na tela. Troque:

```tsx
          <p className="mt-2 text-xs text-muted-foreground">
            {t("footerNotice")} {t("emptyVarHint")}
          </p>
        </div>
      </section>
```

por:

```tsx
          <p className="mt-2 text-xs text-muted-foreground">
            {t("footerNotice")} {t("emptyVarHint")}
          </p>
        </div>
        <EmailAttachments value={attachments} onChange={setAttachments} onUploadingChange={setUploading} />
      </section>
```

5. Botões desabilitados enquanto sobe. Troque `onClick={onSaveDraft} disabled={busy}>` por `onClick={onSaveDraft} disabled={busy || uploading}>`, e `disabled={busy || fromProblem || preview?.stats.total === 0}` por `disabled={busy || uploading || fromProblem || preview?.stats.total === 0}`.

- [ ] **Step 4: Página do envio**

Em `src/app/[locale]/app/email/[id]/page.tsx`:

1. Import. Depois de `import { readStats } from "@/lib/validations/email-broadcast";`:

```ts
import { attachmentSizeParts, readAttachments } from "@/lib/email-broadcast/attachments";
```

2. Logo depois de `const stats = readStats(b.stats);`:

```ts
  const attachments = readAttachments(b.attachments);
  const sizeLabel = (bytes: number) => {
    const { value, unit } = attachmentSizeParts(bytes);
    return `${format.number(value, { maximumFractionDigits: 1 })} ${unit}`;
  };
```

3. A seção dos contadores termina com o parágrafo `report.removed` e o `</section>`. Troque:

```tsx
        <p className="text-sm text-muted-foreground">
          {t("report.removed", { duplicates: stats.duplicates, suppressed: stats.suppressed, invalid: stats.invalid })}
        </p>
      </section>
```

por:

```tsx
        <p className="text-sm text-muted-foreground">
          {t("report.removed", { duplicates: stats.duplicates, suppressed: stats.suppressed, invalid: stats.invalid })}
        </p>
      </section>

      {attachments.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 text-sm font-semibold">{t("report.attachments")}</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {attachments.map((a) => (
              <li key={a.key} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{a.filename}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{sizeLabel(a.size)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm run lint && npm run check:email`
Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/components/email/email-attachments.tsx src/components/email/email-composer.tsx "src/app/[locale]/app/email/[id]/page.tsx" src/messages/pt.json src/messages/en.json
git commit -m "[E-mail] - Adiciona a secao Anexos no composer e na pagina do envio" -m "Upload um por vez com as regras do servidor, contador de 10 MB, aviso do envio um por um, tempo estimado na confirmacao e botoes travados enquanto sobe." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Documentação, verificação completa e teste de ponta a ponta

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md` (contagem de chaves)
- Modify: `docs/guia/04-modulos-e-permissoes.md` (contagem de chaves)

**Interfaces:**
- Consome: tudo das Tasks 1–5.

- [ ] **Step 1: README**

No parágrafo `- **E-mail em massa (submenu E-mail):** ...` do `README.md`, logo antes de `Specs: \`docs/superpowers/specs/2026-10-06-email-em-massa-design.md\``, acrescente:

```markdown
Anexos: até 10 arquivos e 10 MB por envio, com os tipos da lista fechada em `src/lib/email-broadcast/attachments.ts`. Sobem por `/api/email/attachment` (mesmo gating da tela) para o storage, na pasta `email-attachments/<org>/`. O envio guarda só as chaves, na coluna `attachments`, e o servidor confere que são da empresa. Com anexo, o despachante lê os arquivos uma vez por execução (`readMedia`) e manda um e-mail por chamada, porque o `/emails/batch` do Resend não aceita anexos; o ritmo fica em ~2 e-mails/s, e a confirmação mostra o tempo estimado. Se um arquivo não puder ser lido, o envio pausa (`attachment_unavailable`) sem mandar nada.
```

No mesmo parágrafo, troque `e, para a conta da plataforma e os domínios, \`docs/superpowers/specs/2026-10-08-email-dominios-plataforma-design.md\`.` por:

```markdown
, para a conta da plataforma e os domínios, `docs/superpowers/specs/2026-10-08-email-dominios-plataforma-design.md`, e, para os anexos, `docs/superpowers/specs/2026-10-09-email-anexos-design.md`.
```

Na seção de migrations do runbook (§8), logo depois da linha que começa com `**Antes do merge da branch \`feature/email-em-massa\`:**`, acrescente:

```markdown
**Antes do merge da branch `feature/email-anexos`:** aplicar no Supabase o SQL de `prisma/migrations/20261009120000_email_broadcast_attachments/migration.sql` (só adiciona a coluna `attachments` com default `[]`, nada destrutivo).
```

- [ ] **Step 2: Contagem de chaves**

Rode o comando de paridade (Step 9 da Task 2). Esperado: `2822 2822 []`.
- Em `CLAUDE.md`, troque `chaves (2806 hoje)` por `chaves (2822 hoje)`.
- Em `docs/guia/04-modulos-e-permissoes.md`, troque `**2806 chaves-folha cada um**` por `**2822 chaves-folha cada um**`.

- [ ] **Step 3: As cinco validações e o check:email**

Pare o `next dev`, se estiver rodando. Depois:

Run: `npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node && npm run check:email`
Esperado: PASS em todos.

- [ ] **Step 4: Commit da documentação**

```bash
git add README.md CLAUDE.md docs/guia/04-modulos-e-permissoes.md
git commit -m "[E-mail] - Documenta os anexos do envio em massa" -m "README: anexos, rota de upload, envio um por um e a migration antes do merge; contagem de chaves i18n atualizada." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Preparar o teste local**

1. Suba o servidor de novo: `npx next dev --webpack` na porta 3000.
2. Domínio de teste local: o `resend.dev` do Resend aceita `onboarding@resend.dev` como remetente. Libere-o para a empresa local (o slug sai de `npm run db:studio` ou do seed):

```bash
npm run email:dominio -- add resend.dev <slug-da-empresa-local>
```

3. **Pare e peça autorização ao usuário** antes de qualquer envio real. Os envios abaixo usam a chave real do `.env`. Destinatários:
   - `delivered@resend.dev`;
   - o e-mail do dono da conta Resend, que o usuário informa. O `resend.dev` só entrega no endereço do dono.

- [ ] **Step 6: Teste de ponta a ponta (com o usuário, no navegador em `http://localhost:3000`)**

1. **Anexos de verdade:**
   - novo e-mail com remetente `onboarding@resend.dev`;
   - anexar `Catálogo de Preços.pdf`, uma imagem `.png` e um `.docx` pequenos;
   - enviar para os dois destinatários.

   Esperado:
   - a confirmação mostra "Com anexos, o envio leva menos de 1 minuto.";
   - no e-mail recebido, os três anexos abrem, e o PDF mantém o nome com acento.
2. **Recusas:** tentar anexar `.zip`, `.exe`, 11 arquivos e um conjunto acima de 10 MB. Cada um mostra o motivo, e nada entra na lista.
3. **Botões travados:** anexar um arquivo de ~8 MB e, enquanto aparece "Enviando…", tentar "Salvar rascunho". O botão está desabilitado.
4. **Rascunho e Duplicar:**
   - salvar, recarregar a página e ver os anexos de volta;
   - na página de um envio feito, ver a seção "Anexos";
   - clicar em "Duplicar" e ver os anexos no rascunho novo.
5. **Arquivo sumido:**
   - num rascunho com anexo, apague o arquivo em `.media/email-attachments/<org>/`;
   - mande para `delivered@resend.dev`.

   Esperado: o envio pausa com "um anexo não pôde ser carregado (nome-do-arquivo)", e o painel do Resend não mostra nenhum e-mail desse envio.
6. **Interromper e retomar:**
   - envio com anexo para uns 20 endereços `delivered+N@resend.dev`;
   - pare o `next dev` no meio;
   - suba de novo e clique em "Retomar envio".

   Esperado: no painel do Resend, um e-mail por endereço, sem repetidos.
7. **Regressão sem anexo:** envio sem anexo para `delivered@resend.dev`. Esperado: o log do servidor e o painel do Resend mostram a chamada de lote (`/emails/batch`), como antes.

Anote o resultado de cada item. Se algum falhar, use superpowers:systematic-debugging antes de corrigir.

- [ ] **Step 7: Limpeza do teste local**

```bash
npm run email:dominio -- remove resend.dev
```

- [ ] **Step 8: Entrega**

Não faça push. Informe ao usuário:
- a branch e os commits;
- a migration a aplicar no Supabase antes do merge (README §8);
- os dois testes de produção depois do merge: subir um arquivo perto de 10 MB, porque não se sabe se a Hostinger aceita esse tamanho numa requisição, e fazer um envio pequeno com anexo para um e-mail próprio.

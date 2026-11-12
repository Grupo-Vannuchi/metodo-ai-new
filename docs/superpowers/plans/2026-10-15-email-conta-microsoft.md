# Envio pela conta Microsoft — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada empresa conecta uma caixa Microsoft (Outlook pessoal ou Microsoft 365) e envia por ela os e-mails em massa de Comunicação → E-mail, com o mesmo formulário de hoje, escolhendo o canal numa tela antes do formulário.

**Architecture:**
- **Regras puras** em `src/lib/email-broadcast/microsoft/core.ts` (tipo de conta, limite diário, caminho de envio, decisão sobre falhas do Graph) e `src/lib/email-broadcast/failure-reason.ts` (motivos em português). As duas ficam cobertas pelo `check:email`.
- **Conexão:**
  - rotas `/api/email/microsoft/connect` e `/callback`, com OAuth (`arctic`, tenant `common`);
  - a conta da empresa fica na tabela nova `email_sender_accounts`, com as credenciais criptografadas (`INTEGRATION_ENC_KEY`);
  - a renovação do token é serializada por empresa.
- **Envio:**
  - o despachante de hoje ganha um ramo `MICROSOFT`, que monta o e-mail em MIME (`nodemailer` só como montador);
  - se o MIME cabe em uma chamada, vai por `POST /me/sendMail`; senão, vai por rascunho + anexos + envio (exige `Mail.ReadWrite`);
  - cada destinatário é reservado (`SENDING`) antes da chamada, e o que sobrar numa queda vira `UNCERTAIN`, sem reenvio.
- **Telas:** escolha do canal em `/app/email/new`, formulário com remetente fixo, confirmação com a estimativa do dia, motivo em vermelho na lista e no relatório (nos dois canais).

**Tech Stack:** Next.js 16 (App Router, server actions, route handlers), Prisma 6 + PostgreSQL (Docker local, Supabase em produção), next-intl 4, zod 3, arctic 3.7, nodemailer 10 (só `MailComposer`), Microsoft Graph v1.0, tsx.

**Spec:** [docs/superpowers/specs/2026-10-15-email-conta-microsoft-design.md](../specs/2026-10-15-email-conta-microsoft-design.md). Protótipo: https://claude.ai/artifact/NgWfGXj81uUMR2v1hXXaC6.

## Global Constraints

- **Campanhas, e-mail transacional, login social e Propostas não mudam.** Arquivos proibidos:
  - `src/lib/dispatch.ts`, `src/lib/email/**`, `src/components/campaigns/**`;
  - `src/lib/oauth/**` e `src/app/api/auth/**` (o "Entrar com Microsoft" usa outro app e outras variáveis);
  - `src/lib/integrations/**` só é **importado** (`crypto.ts`), nunca alterado;
  - `src/components/proposals/rich-text-editor.tsx` e `src/lib/proposals/sanitize.ts` só importados.
- **Multi-tenant (guia 03):**
  - em request de usuário, use `tenantDb(orgId)`; por id, `findFirst` + `updateMany`/`deleteMany`;
  - nunca use `findUnique`/`update`/`delete`/`upsert` em tabela de negócio;
  - o despachante e o token são contexto de sistema: Prisma cru, com `organizationId` explícito em toda consulta.
- **Banco local = Docker** (`docker compose up -d postgres`, container `metodoai-db`). Nunca o Postgres portátil.
- **Nunca** rode `prisma migrate dev`, `migrate reset` ou `db push`. A migration só entra pelo procedimento da Task 3.
- **i18n:**
  - `src/messages/pt.json` e `en.json` com as mesmas chaves, sem `{{` dentro de mensagem;
  - hoje são **2915** chaves de cada lado;
  - a contagem final é calculada na Task 11 com o comando de paridade e gravada no CLAUDE.md e no guia 04.
- **Env:** só via `src/lib/env.ts`. Variáveis novas: `MICROSOFT_MAIL_CLIENT_ID` e `MICROSOFT_MAIL_CLIENT_SECRET`. Elas já estão no `.env` local, e **o valor nunca é impresso** em log, terminal ou commit.
- **Números fixos (da spec):**
  - `LIMITS.microsoftDailyPersonal = 300`, `LIMITS.microsoftDailyWork = 10_000`;
  - `MICROSOFT_PACE_MS = 2_100`;
  - `MICROSOFT_DIRECT_MAX_BASE64 = 3_900_000`, `MICROSOFT_DIRECT_MAX_FILE_BYTES = 2_200_000`;
  - `UPLOAD_SESSION_MIN_BYTES = 3 * 1024 * 1024`, `UPLOAD_CHUNK_BYTES = 320 * 1024 * 12`;
  - tenant das contas pessoais: `9188040d-6c67-4c5b-b112-36a304b66dad`;
  - escopos: `openid profile email offline_access User.Read Mail.Send Mail.ReadWrite`;
  - retorno: `/api/email/microsoft/callback`;
  - cookies `ms_mail_state`, `ms_mail_verifier`, `ms_mail_org`, todos com 10 minutos.
- **Regras de produto:**
  - uma conta de envio por empresa (garantida por `@unique` no banco), usada por quem tem a tela E-mail;
  - o Resend continua igual;
  - no limite diário, o envio pausa e espera "Retomar envio";
  - anexos até 10 MB;
  - todos os e-mails pela Microsoft ficam em "Itens enviados";
  - envios pela Microsoft não contam na cota mensal da plataforma;
  - **ninguém recebe duas vezes**: chamada de envio que estoura o tempo vira `UNCERTAIN`, nunca é repetida.
- **Dependências novas:** `nodemailer@10.1.1` e `@types/nodemailer@8.0.2` (dev). O `check:node` precisa continuar passando.
- **Commits:**
  - formato `[E-mail] - Verbo + tarefa`, com corpo curto;
  - a última linha é exatamente `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - branch `feature/email-conta-microsoft` (já criada, com a spec); **sem push**.
- Comentários de código em inglês; textos de tela em pt-BR e en; docs em pt-BR.
- **Servidor de dev:**
  - pare qualquer `next dev` antes de `npm run build`;
  - depois de `prisma generate`, reinicie o `next dev`, sempre na porta 3000 (`npx next dev --webpack -p 3000`) e nunca um segundo servidor.
- **Ambiente:**
  - Node 20: nenhuma API mais nova;
  - Windows: código-fonte ASCII nas regras puras; caracteres especiais em testes via `String.fromCharCode`.
- **Envio real pela Microsoft** (Task 11) só com autorização explícita do usuário e só para endereços que ele indicar.

## Review Focus

1. **O processo cai no meio de um envio** (deploy, restart do Passenger) com um destinatário já entregue à Microsoft mas ainda não confirmado → ele não pode receber de novo. Cobertura:
   - a reserva `QUEUED → SENDING` antes da chamada e a virada `SENDING → UNCERTAIN` no início de cada execução (Task 7);
   - Task 11, passo 7 (simulado no banco).
2. **O token vence no meio de um envio longo** → renova sozinho, sem pausar. Cobertura:
   - margem de 5 min e renovação forçada no 401 (Tasks 4 e 7);
   - Task 11, passo 6 (`expiresAt` forçado no passado).
3. **A conta é desconectada ou trocada com um envio rodando** → o envio pausa com `no_sender_account`, e "Retomar envio" passa a usar a conta conectada. Cobertura:
   - releitura da conta a cada e-mail (Task 7);
   - re-apontamento em `resumeEmailBroadcast` (Task 8);
   - Task 11, passo 8.
4. **A empresa B usa a conta da empresa A** (action chamada à mão, rascunho com canal `MICROSOFT` sem conta) → `sender_account_missing`. Cobertura:
   - `tenantDb` nas actions (Task 8);
   - caso novo no `check:isolation` (Task 3).
5. **Anexos grandes** (8 MB) → vão pelo caminho de rascunho, chegam inteiros, e o rascunho não fica sobrando na caixa. Cobertura:
   - `microsoftSendPath`/`uploadRanges` no `check:email` (Task 1);
   - `sendMicrosoftMail` apaga o rascunho na falha (Task 6);
   - Task 11, passo 5.

---

### Task 1: Regras puras do canal Microsoft

**Files:**
- Create: `src/lib/email-broadcast/microsoft/core.ts`
- Modify: `src/config/limits.ts`, `docs/guia/04-modulos-e-permissoes.md`, `scripts/check-email-broadcast.ts`

**Interfaces:**
- Consome: `LIMITS` de `@/config/limits`.
- Produz (exportados de `src/lib/email-broadcast/microsoft/core.ts`):
  - `MICROSOFT_CONSUMER_TENANT_ID: string`;
  - `type MicrosoftAccountKind = "personal" | "work"`, `accountKindFromTid(tid: unknown): MicrosoftAccountKind`;
  - `microsoftDailyLimit(kind: string): number`, `remainingToday(limit: number, usedLast24h: number): number`;
  - `sentLast24hWhere(accountId: string, now: Date)`, o `where` do Prisma das saídas das últimas 24 h;
  - `MICROSOFT_PACE_MS`, `microsoftSendMinutes(count: number): number`;
  - `MICROSOFT_DIRECT_MAX_BASE64`, `MICROSOFT_DIRECT_MAX_FILE_BYTES`, `microsoftSendPath(fileBytes: number, mimeBase64Length: number | null): "direct" | "draft"`;
  - `UPLOAD_SESSION_MIN_BYTES`, `UPLOAD_CHUNK_BYTES`, `attachmentUploadMode(size: number): "inline" | "session"`, `uploadRanges(total: number, chunk?: number): { start: number; end: number }[]`;
  - `type GraphFailureAction = "refresh" | "retry" | "uncertain" | "recipient" | "daily_limit" | "blocked" | "reconnect" | "pause"`, `graphFailureAction(status: number, code: string | null, attempt: number, stage: "prepare" | "send"): GraphFailureAction`;
  - `type MicrosoftConnectError = "cancelled" | "admin_required" | "not_configured" | "failed"`, `microsoftConsentError(error: string, description: string): MicrosoftConnectError`;
  - `joinSiteUrl(base: string, path: string): string`.

- [ ] **Step 1: Limites novos em `src/config/limits.ts`**

No tipo de `LIMITS`, depois de `emailBroadcastQuotaPerMonth`, acrescente:

```ts
  /** Estimated e-mails per 24 h through a personal Microsoft mailbox (Outlook.com). */
  microsoftDailyPersonal: number;
  /** Estimated recipients per 24 h through a Microsoft 365 mailbox. */
  microsoftDailyWork: number;
```

E no objeto, depois de `emailBroadcastQuotaPerMonth: 50_000,`:

```ts
  microsoftDailyPersonal: 300,
  microsoftDailyWork: 10_000,
```

No guia 04, na lista de [src/config/limits.ts](../../src/config/limits.ts) (por volta da linha 88), acrescente depois de `emailBroadcastQuotaPerMonth` (50.000): "`microsoftDailyPersonal` (300) e `microsoftDailyWork` (10.000): estimativa de saídas por 24 h de uma caixa Microsoft conectada (Outlook pessoal e Microsoft 365). A Microsoft não informa o restante; o envio pausa no estimado ou na recusa real."

- [ ] **Step 2: Escrever os testes (falham)**

Em `scripts/check-email-broadcast.ts`, acrescente aos imports:

```ts
import {
  MICROSOFT_CONSUMER_TENANT_ID,
  UPLOAD_CHUNK_BYTES,
  accountKindFromTid,
  attachmentUploadMode,
  graphFailureAction,
  joinSiteUrl,
  microsoftConsentError,
  microsoftDailyLimit,
  microsoftSendMinutes,
  microsoftSendPath,
  remainingToday,
  sentLast24hWhere,
  uploadRanges,
} from "../src/lib/email-broadcast/microsoft/core";
```

E, antes de `async function checkAsync`, um bloco novo:

```ts
// --- Microsoft channel ---------------------------------------------------------
check("accountKindFromTid tells a personal account from Microsoft 365", () => {
  assert.equal(accountKindFromTid(MICROSOFT_CONSUMER_TENANT_ID), "personal");
  assert.equal(accountKindFromTid(MICROSOFT_CONSUMER_TENANT_ID.toUpperCase()), "personal");
  assert.equal(accountKindFromTid("3a6f5659-ec46-4740-b69c-8eb97d2dd677"), "work");
  assert.equal(accountKindFromTid(undefined), "work");
});

check("microsoftDailyLimit and remainingToday", () => {
  assert.equal(microsoftDailyLimit("personal"), 300);
  assert.equal(microsoftDailyLimit("work"), 10_000);
  assert.equal(microsoftDailyLimit("anything"), 10_000);
  assert.equal(remainingToday(300, 120), 180);
  assert.equal(remainingToday(300, 300), 0);
  assert.equal(remainingToday(300, 450), 0);
  assert.equal(remainingToday(300, -5), 300);
});

check("sentLast24hWhere counts SENT, SENDING and UNCERTAIN of one account since 24 h ago", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const w = sentLast24hWhere("acc1", now);
  assert.deepEqual(w.status.in, ["SENT", "SENDING", "UNCERTAIN"]);
  assert.equal(w.sentAt.gte.toISOString(), "2026-10-14T12:00:00.000Z");
  assert.deepEqual(w.broadcast, { senderAccountId: "acc1" });
});

check("microsoftSendMinutes rounds up at ~28 per minute", () => {
  assert.equal(microsoftSendMinutes(0), 1);
  assert.equal(microsoftSendMinutes(28), 1);
  assert.equal(microsoftSendMinutes(29), 2);
  assert.equal(microsoftSendMinutes(300), 11);
});

check("microsoftSendPath goes direct only when the request fits", () => {
  assert.equal(microsoftSendPath(0, null), "direct");
  assert.equal(microsoftSendPath(0, 3_900_000), "direct");
  assert.equal(microsoftSendPath(0, 3_900_001), "draft");
  assert.equal(microsoftSendPath(2_200_000, 3_000_000), "direct");
  assert.equal(microsoftSendPath(2_200_001, null), "draft");
});

check("attachmentUploadMode and uploadRanges follow Graph's 3 MB / 320 KiB rules", () => {
  assert.equal(attachmentUploadMode(3 * 1024 * 1024 - 1), "inline");
  assert.equal(attachmentUploadMode(3 * 1024 * 1024), "session");
  assert.equal(UPLOAD_CHUNK_BYTES % (320 * 1024), 0);
  assert.ok(UPLOAD_CHUNK_BYTES < 4 * 1024 * 1024);
  assert.deepEqual(uploadRanges(10, 4), [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 8, end: 9 },
  ]);
  assert.deepEqual(uploadRanges(8, 4), [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
  ]);
  assert.deepEqual(uploadRanges(0, 4), []);
});

check("graphFailureAction maps Graph answers to dispatcher moves", () => {
  assert.equal(graphFailureAction(401, "InvalidAuthenticationToken", 0, "send"), "refresh");
  assert.equal(graphFailureAction(401, null, 1, "send"), "reconnect");
  assert.equal(graphFailureAction(403, "ErrorAccessDenied", 0, "prepare"), "reconnect");
  assert.equal(graphFailureAction(403, "ErrorMessageSubmissionBlocked", 0, "send"), "blocked");
  assert.equal(graphFailureAction(403, "SomethingElse", 0, "send"), "pause");
  assert.equal(graphFailureAction(400, "ErrorExceededMessageLimit", 0, "send"), "daily_limit");
  assert.equal(graphFailureAction(429, null, 0, "send"), "retry");
  assert.equal(graphFailureAction(429, null, 5, "send"), "pause");
  assert.equal(graphFailureAction(503, null, 2, "send"), "retry");
  assert.equal(graphFailureAction(503, null, 3, "send"), "pause");
  assert.equal(graphFailureAction(0, null, 0, "send"), "uncertain");
  assert.equal(graphFailureAction(504, null, 0, "send"), "uncertain");
  assert.equal(graphFailureAction(0, null, 0, "prepare"), "retry");
  assert.equal(graphFailureAction(0, null, 3, "prepare"), "pause");
  assert.equal(graphFailureAction(413, null, 0, "prepare"), "pause");
  assert.equal(graphFailureAction(400, "ErrorMessageSizeExceeded", 0, "send"), "pause");
  assert.equal(graphFailureAction(400, "ErrorInvalidRecipients", 0, "send"), "recipient");
});

check("microsoftConsentError reads the provider's error", () => {
  assert.equal(microsoftConsentError("access_denied", "AADSTS65004: User declined to consent"), "cancelled");
  assert.equal(microsoftConsentError("access_denied", "AADSTS90094: admin approval required"), "admin_required");
  assert.equal(microsoftConsentError("consent_required", "AADSTS65001: needs consent"), "admin_required");
  assert.equal(microsoftConsentError("server_error", ""), "failed");
});

check("joinSiteUrl never doubles the slash", () => {
  assert.equal(
    joinSiteUrl("https://metodotia.com/", "/api/email/microsoft/callback"),
    "https://metodotia.com/api/email/microsoft/callback",
  );
  assert.equal(joinSiteUrl("https://metodotia.com", "api/x"), "https://metodotia.com/api/x");
  assert.equal(joinSiteUrl("http://localhost:3000//", "/api/x"), "http://localhost:3000/api/x");
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run check:email`
Expected: FAIL com "Cannot find module '../src/lib/email-broadcast/microsoft/core'".

- [ ] **Step 4: Implementar `src/lib/email-broadcast/microsoft/core.ts`**

```ts
/**
 * Pure rules of the "send through the company's Microsoft mailbox" channel
 * (spec 2026-10-15). No server imports, so check:email and the composer can
 * import it.
 */
import { LIMITS } from "@/config/limits";

/** Tenant id Microsoft puts in the id token of personal accounts (outlook.com, hotmail.com, live.com). */
export const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

export type MicrosoftAccountKind = "personal" | "work";

/** Personal account vs. Microsoft 365, from the id token's `tid` claim. */
export function accountKindFromTid(tid: unknown): MicrosoftAccountKind {
  return typeof tid === "string" && tid.toLowerCase() === MICROSOFT_CONSUMER_TENANT_ID ? "personal" : "work";
}

/** Estimated sends per 24 h for a mailbox kind (Microsoft doesn't expose the real figure). */
export function microsoftDailyLimit(kind: string): number {
  return kind === "personal" ? LIMITS.microsoftDailyPersonal : LIMITS.microsoftDailyWork;
}

/** What is left of the estimated daily limit (never negative). */
export function remainingToday(limit: number, usedLast24h: number): number {
  return Math.max(0, limit - Math.max(0, usedLast24h));
}

/**
 * Prisma `where` (EmailBroadcastRecipient) for the e-mails that left — or may
 * have left — one Microsoft mailbox in the last 24 h. `sentAt` is stamped when
 * a recipient is reserved, so SENDING and UNCERTAIN count too.
 */
export function sentLast24hWhere(accountId: string, now: Date) {
  return {
    status: { in: ["SENT", "SENDING", "UNCERTAIN"] as ("SENT" | "SENDING" | "UNCERTAIN")[] },
    sentAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    broadcast: { senderAccountId: accountId },
  };
}

/** One e-mail every 2.1 s per mailbox: ~28 per minute, under Exchange's 30. */
export const MICROSOFT_PACE_MS = 2_100;

/** Minutes the dispatcher needs for `count` e-mails at MICROSOFT_PACE_MS (at least 1). */
export function microsoftSendMinutes(count: number): number {
  return Math.max(1, Math.ceil((Math.max(0, count) * MICROSOFT_PACE_MS) / 60_000));
}

/** Graph refuses requests over ~4 MB (413): a direct send's base64 MIME stays under this. */
export const MICROSOFT_DIRECT_MAX_BASE64 = 3_900_000;
/** Above this many raw attachment bytes the double base64 can't fit: skip building the full MIME. */
export const MICROSOFT_DIRECT_MAX_FILE_BYTES = 2_200_000;

/** "direct" = one POST /me/sendMail; "draft" = draft + attachments + send (needs Mail.ReadWrite). */
export function microsoftSendPath(fileBytes: number, mimeBase64Length: number | null): "direct" | "draft" {
  if (fileBytes > MICROSOFT_DIRECT_MAX_FILE_BYTES) return "draft";
  if (mimeBase64Length !== null && mimeBase64Length > MICROSOFT_DIRECT_MAX_BASE64) return "draft";
  return "direct";
}

/** Graph: a file under 3 MB goes in one POST; from 3 MB on, through an upload session. */
export const UPLOAD_SESSION_MIN_BYTES = 3 * 1024 * 1024;
/** Upload-session chunk: a multiple of 320 KiB, under the 4 MB per PUT. */
export const UPLOAD_CHUNK_BYTES = 320 * 1024 * 12;

export function attachmentUploadMode(size: number): "inline" | "session" {
  return size < UPLOAD_SESSION_MIN_BYTES ? "inline" : "session";
}

/** Inclusive byte ranges covering `total` bytes, `chunk` bytes at a time. */
export function uploadRanges(total: number, chunk: number = UPLOAD_CHUNK_BYTES): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (let start = 0; start < total; start += chunk) {
    ranges.push({ start, end: Math.min(total, start + chunk) - 1 });
  }
  return ranges;
}

export type GraphFailureAction =
  | "refresh"
  | "retry"
  | "uncertain"
  | "recipient"
  | "daily_limit"
  | "blocked"
  | "reconnect"
  | "pause";

const DAILY_LIMIT_CODES = new Set(["ErrorExceededMessageLimit", "ErrorQuotaExceeded", "ErrorSubmissionQuotaExceeded"]);
const BLOCKED_CODES = new Set([
  "ErrorMessageSubmissionBlocked",
  "ErrorAccountSuspend",
  "ErrorAccountDisabled",
  "MailboxNotEnabledForRESTAPI",
]);
const DENIED_CODES = new Set([
  "ErrorAccessDenied",
  "AccessDenied",
  "Authorization_RequestDenied",
  "ErrorInsufficientPermissionsInAccessToken",
]);

/**
 * What the Microsoft dispatcher does with a failed Graph call. `stage` "send"
 * is the call that hands the e-mail over (sendMail, or the draft's send): a
 * timeout there may have gone through, so it is never retried ("uncertain").
 * `attempt` counts earlier retries of this same e-mail.
 */
export function graphFailureAction(
  status: number,
  code: string | null,
  attempt: number,
  stage: "prepare" | "send",
): GraphFailureAction {
  if (code && DAILY_LIMIT_CODES.has(code)) return "daily_limit";
  if (code && BLOCKED_CODES.has(code)) return "blocked";
  if (status === 401) return attempt < 1 ? "refresh" : "reconnect";
  if (status === 403) return code && DENIED_CODES.has(code) ? "reconnect" : "pause";
  if (status === 413 || code === "ErrorMessageSizeExceeded") return "pause";
  if (status === 0 || status === 504) return stage === "send" ? "uncertain" : attempt < 3 ? "retry" : "pause";
  if (status === 429) return attempt < 5 ? "retry" : "pause";
  if (status >= 500) return attempt < 3 ? "retry" : "pause";
  if (status >= 400) return "recipient";
  return "pause";
}

export type MicrosoftConnectError = "cancelled" | "admin_required" | "not_configured" | "failed";

/** The OAuth callback's `error` + `error_description` as a screen message key. */
export function microsoftConsentError(error: string, description: string): MicrosoftConnectError {
  if (error === "consent_required" || /AADSTS(90094|90095|65001)/.test(description)) return "admin_required";
  if (error === "access_denied") return "cancelled";
  return "failed";
}

/** Site URL + path with exactly one slash between (prod's NEXT_PUBLIC_SITE_URL ends in "/"). */
export function joinSiteUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run check:email`
Expected: PASS, com as checagens novas listadas e "✅ email-broadcast: N checks passed.".

- [ ] **Step 6: Typecheck e commit**

Run: `npm run typecheck`
Expected: sem erros.

```bash
git add src/lib/email-broadcast/microsoft/core.ts src/config/limits.ts docs/guia/04-modulos-e-permissoes.md scripts/check-email-broadcast.ts
git commit -m "[E-mail] - Adiciona as regras puras do envio pela conta Microsoft" -m "Tipo de conta, limite diario estimado, caminho de envio (direto ou rascunho), decisao sobre falhas do Graph e retorno sem barra dupla, cobertos pelo check:email." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Motivos de falha em português (regras puras)

**Files:**
- Create: `src/lib/email-broadcast/failure-reason.ts`
- Modify: `scripts/check-email-broadcast.ts`

**Interfaces:**
- Produz (exportados de `src/lib/email-broadcast/failure-reason.ts`):
  - `PAUSED_REASONS`, `type PausedReason`, `pausedReasonKey(reason: string | null | undefined): PausedReason`;
  - `INTERRUPTED_ERROR = "interrupted"`;
  - `microsoftRecipientError(code: string | null, message: string): string`, que grava `"ms:<code>|<mensagem>"` com até 500 caracteres;
  - `type RecipientFailureKey = "invalid_address" | "message_too_large" | "interrupted" | "generic"`;
  - `recipientFailure(error: string | null | undefined): { key: RecipientFailureKey; technical: string } | null`;
  - `type ListReason = { kind: "paused"; reason: PausedReason } | { kind: "problems"; failed: number; uncertain: number } | null`;
  - `listReason(input: { status: string; pausedReason: string | null; problems: number; uncertain: number }): ListReason`.

- [ ] **Step 1: Escrever os testes (falham)**

Em `scripts/check-email-broadcast.ts`, acrescente o import:

```ts
import {
  INTERRUPTED_ERROR,
  listReason,
  microsoftRecipientError,
  pausedReasonKey,
  recipientFailure,
} from "../src/lib/email-broadcast/failure-reason";
```

E, logo depois do bloco "Microsoft channel" da Task 1:

```ts
// --- failure reasons -----------------------------------------------------------
check("pausedReasonKey keeps known reasons and folds the rest into provider_error", () => {
  assert.equal(pausedReasonKey("daily_limit"), "daily_limit");
  assert.equal(pausedReasonKey("quota"), "quota");
  assert.equal(pausedReasonKey("something_new"), "provider_error");
  assert.equal(pausedReasonKey(null), "provider_error");
});

check("microsoftRecipientError stores code and message, capped at 500", () => {
  assert.equal(microsoftRecipientError("ErrorInvalidRecipients", "bad"), "ms:ErrorInvalidRecipients|bad");
  assert.equal(microsoftRecipientError(null, "x"), "ms:unknown|x");
  assert.equal(microsoftRecipientError("C", "y".repeat(600)).length, 500);
});

check("recipientFailure translates stored errors and keeps the technical text", () => {
  assert.equal(recipientFailure(null), null);
  assert.equal(recipientFailure(""), null);
  assert.deepEqual(recipientFailure(INTERRUPTED_ERROR), { key: "interrupted", technical: "interrupted" });
  assert.deepEqual(recipientFailure("ms:ErrorInvalidRecipients|At least one recipient is not valid."), {
    key: "invalid_address",
    technical: "ErrorInvalidRecipients: At least one recipient is not valid.",
  });
  assert.deepEqual(recipientFailure("ms:ErrorMessageSizeExceeded|too big"), {
    key: "message_too_large",
    technical: "ErrorMessageSizeExceeded: too big",
  });
  assert.deepEqual(recipientFailure("ms:Weird|x"), { key: "generic", technical: "Weird: x" });
  assert.equal(recipientFailure("Invalid `to` field. The email address needs to follow...")?.key, "invalid_address");
  assert.deepEqual(recipientFailure("Resend 500"), { key: "generic", technical: "Resend 500" });
});

check("listReason picks the red line of the sends list", () => {
  assert.deepEqual(listReason({ status: "PAUSED", pausedReason: "daily_limit", problems: 0, uncertain: 0 }), {
    kind: "paused",
    reason: "daily_limit",
  });
  assert.deepEqual(listReason({ status: "PAUSED", pausedReason: null, problems: 3, uncertain: 0 }), {
    kind: "paused",
    reason: "provider_error",
  });
  assert.deepEqual(listReason({ status: "DONE", pausedReason: null, problems: 12, uncertain: 1 }), {
    kind: "problems",
    failed: 12,
    uncertain: 1,
  });
  assert.equal(listReason({ status: "DONE", pausedReason: null, problems: 0, uncertain: 0 }), null);
  assert.equal(listReason({ status: "DRAFT", pausedReason: null, problems: 0, uncertain: 0 }), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run check:email`
Expected: FAIL com "Cannot find module '../src/lib/email-broadcast/failure-reason'".

- [ ] **Step 3: Implementar `src/lib/email-broadcast/failure-reason.ts`**

```ts
/**
 * Why a send paused or a recipient failed, as an i18n key plus the technical
 * text (spec 2026-10-15 §6.5). Pure: the sends list, the report and
 * check:email share it. Both channels (platform and Microsoft) use it.
 */

export const PAUSED_REASONS = [
  "no_connection",
  "quota",
  "provider_error",
  "domain_not_allowed",
  "from_missing",
  "attachment_unavailable",
  "attachment_invalid",
  "daily_limit",
  "reconnect",
  "no_sender_account",
  "account_blocked",
] as const;
export type PausedReason = (typeof PAUSED_REASONS)[number];

/** A stored pausedReason narrowed to a known key ("provider_error" for anything else). */
export function pausedReasonKey(reason: string | null | undefined): PausedReason {
  return (PAUSED_REASONS as readonly string[]).includes(reason ?? "") ? (reason as PausedReason) : "provider_error";
}

/** Stored as `error` on a recipient left UNCERTAIN by an interrupted run. */
export const INTERRUPTED_ERROR = "interrupted";
const MS_PREFIX = "ms:";

/** How a Graph failure is stored on a recipient: "ms:<code>|<message>", 500 chars max. */
export function microsoftRecipientError(code: string | null, message: string): string {
  return `${MS_PREFIX}${code ?? "unknown"}|${message}`.slice(0, 500);
}

export type RecipientFailureKey = "invalid_address" | "message_too_large" | "interrupted" | "generic";

const INVALID_ADDRESS_CODES = new Set(["ErrorInvalidRecipients", "ErrorInvalidRecipientsPartial", "ErrorInvalidEmailAddress"]);

/** The translated reason of a recipient's stored error (null = no error). */
export function recipientFailure(
  error: string | null | undefined,
): { key: RecipientFailureKey; technical: string } | null {
  if (!error) return null;
  if (error === INTERRUPTED_ERROR) return { key: "interrupted", technical: error };
  if (error.startsWith(MS_PREFIX)) {
    const bar = error.indexOf("|");
    const code = bar === -1 ? error.slice(MS_PREFIX.length) : error.slice(MS_PREFIX.length, bar);
    const message = bar === -1 ? "" : error.slice(bar + 1);
    const technical = message ? `${code}: ${message}` : code;
    if (INVALID_ADDRESS_CODES.has(code)) return { key: "invalid_address", technical };
    if (code === "ErrorMessageSizeExceeded") return { key: "message_too_large", technical };
    return { key: "generic", technical };
  }
  // Resend: free text from its API.
  const lower = error.toLowerCase();
  if (lower.includes("invalid") && (lower.includes("`to`") || lower.includes("email address") || lower.includes("recipient"))) {
    return { key: "invalid_address", technical: error };
  }
  return { key: "generic", technical: error };
}

export type ListReason =
  | { kind: "paused"; reason: PausedReason }
  | { kind: "problems"; failed: number; uncertain: number }
  | null;

/** The red line under a send's status in the sends list (null = nothing to say). */
export function listReason(input: {
  status: string;
  pausedReason: string | null;
  problems: number;
  uncertain: number;
}): ListReason {
  if (input.status === "PAUSED") return { kind: "paused", reason: pausedReasonKey(input.pausedReason) };
  if ((input.status === "DONE" || input.status === "SENDING") && (input.problems > 0 || input.uncertain > 0)) {
    return { kind: "problems", failed: input.problems, uncertain: input.uncertain };
  }
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run check:email`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email-broadcast/failure-reason.ts scripts/check-email-broadcast.ts
git commit -m "[E-mail] - Traduz os motivos de pausa e de falha dos envios" -m "Regras puras usadas pela lista e pelo relatorio, nos dois canais, cobertas pelo check:email." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Banco (conta de envio, canal do envio e status novos)

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/tenant-db.ts`, `scripts/check-isolation.ts`, `src/lib/queries/email-broadcasts.ts`, `src/components/email/status-badge.tsx`, `src/messages/pt.json`, `src/messages/en.json`, `docs/guia/03-multi-tenancy.md`
- Create: `prisma/migrations/20261015120000_email_sender_accounts/migration.sql`

**Interfaces:**
- Produz (Prisma):
  - os enums `EmailChannel { PLATFORM MICROSOFT }`, `EmailSenderProvider { MICROSOFT }` e `EmailSenderAccountStatus { ACTIVE NEEDS_RECONNECT }`;
  - o model `EmailSenderAccount` (tabela `email_sender_accounts`);
  - `EmailBroadcast.channel`, `EmailBroadcast.senderAccountId` e a relação `senderAccount`;
  - `EmailRecipientStatus` ganha `SENDING` e `UNCERTAIN`.

- [ ] **Step 1: Schema**

Em `prisma/schema.prisma`, no `enum EmailRecipientStatus`, depois de `FAILED`:

```prisma
  /// Reserved by the Microsoft dispatcher right before calling Graph.
  SENDING
  /// The run stopped between the reservation and Graph's answer: never resent.
  UNCERTAIN
```

Logo depois desse enum, acrescente:

```prisma
enum EmailChannel {
  PLATFORM
  MICROSOFT
}

enum EmailSenderProvider {
  MICROSOFT
}

enum EmailSenderAccountStatus {
  ACTIVE
  NEEDS_RECONNECT
}
```

No `model EmailBroadcast`, depois de `signatureText`:

```prisma
  /// PLATFORM = the platform's Resend account; MICROSOFT = the org's connected mailbox (spec 2026-10-15).
  channel         EmailChannel         @default(PLATFORM)
  /// The mailbox a MICROSOFT send goes out from (set when it starts or resumes).
  senderAccountId String?
  senderAccount   EmailSenderAccount?  @relation(fields: [senderAccountId], references: [id], onDelete: SetNull)
```

E, no fim do mesmo model, junto dos outros índices: `@@index([senderAccountId])`.

Depois do `model EmailSignature`, acrescente:

```prisma
/// The company's own mailbox for mass e-mail (spec 2026-10-15). One per org.
model EmailSenderAccount {
  id             String                   @id @default(cuid())
  organizationId String                   @unique
  provider       EmailSenderProvider
  /// Mailbox address, lowercase.
  email          String
  displayName    String?
  /// "personal" | "work" — sets the estimated daily limit (microsoft/core.ts).
  accountKind    String
  /// encryptCredentials({ accessToken, refreshToken, expiresAt }); never leaves the server.
  credentials    String                   @db.Text
  status         EmailSenderAccountStatus @default(ACTIVE)
  /// Last technical error of a token renewal.
  lastError      String?
  connectedById  String
  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt

  broadcasts EmailBroadcast[]

  @@map("email_sender_accounts")
}
```

- [ ] **Step 2: Gerar o SQL da migration**

```bash
git show origin/main:prisma/schema.prisma > "$TMP/schema-main.prisma"
npx prisma migrate diff --from-schema-datamodel "$TMP/schema-main.prisma" --to-schema-datamodel prisma/schema.prisma --script
```

`$TMP` é a pasta de rascunho da sessão. Grave a saída, sem as linhas `warn`, em `prisma/migrations/20261015120000_email_sender_accounts/migration.sql`. Ela deve conter, em alguma ordem:
- `ALTER TYPE "EmailRecipientStatus" ADD VALUE 'SENDING';` e o mesmo para `'UNCERTAIN'`;
- `CREATE TYPE` dos três enums novos;
- `ALTER TABLE "email_broadcasts" ADD COLUMN "channel" "EmailChannel" NOT NULL DEFAULT 'PLATFORM', ADD COLUMN "senderAccountId" TEXT;`;
- `CREATE TABLE "email_sender_accounts"`;
- os índices `email_sender_accounts_organizationId_key` (unique) e `email_broadcasts_senderAccountId_idx`;
- a FK `email_broadcasts_senderAccountId_fkey` com `ON DELETE SET NULL`.

Se aparecer qualquer outra mudança (drift do schema), pare e reporte, sem gravar.

- [ ] **Step 3: Aplicar no banco local e gerar o client**

```bash
npx prisma db execute --file prisma/migrations/20261015120000_email_sender_accounts/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20261015120000_email_sender_accounts --schema prisma/schema.prisma
npx prisma generate
```

Expected: "Script executed successfully", "marked as applied" e "Generated Prisma Client". Reinicie o `next dev`, se estiver rodando.

- [ ] **Step 4: Isolamento**

Em `src/lib/tenant-db.ts`, acrescente `"EmailSenderAccount",` depois de `"EmailSignature",` em `TENANT_MODELS`.

Em `scripts/check-isolation.ts`, depois do bloco "13) E-mail signatures are per org.":

```ts
    // 14) Microsoft sending accounts are per org.
    await prisma.emailSenderAccount.create({
      data: {
        organizationId: orgA.id,
        provider: "MICROSOFT",
        email: "iso@a.test",
        accountKind: "work",
        credentials: "x",
        connectedById: "iso",
      },
    });
    const accountsB = await prisma.emailSenderAccount.findMany({
      where: { organizationId: orgB.id },
    });
    assert(accountsB.length === 0, "e-mail sender accounts scoped to org B exclude org A's account");
```

E na limpeza, **antes** de `emailBroadcast.deleteMany`:

```ts
    await prisma.emailSenderAccount.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
```

No guia 03, na lista de modelos com isolamento (ou no trecho que cita `EmailSignature`), acrescente `EmailSenderAccount` (conta Microsoft de envio, uma por empresa).

- [ ] **Step 5: Ligar os status novos**

Em `src/lib/queries/email-broadcasts.ts`, em `getEmailBroadcastReport`, o objeto `counts` passa a ser:

```ts
  const counts: Record<EmailRecipientStatus, number> = {
    QUEUED: 0,
    SENDING: 0,
    SENT: 0,
    DELIVERED: 0,
    BOUNCED: 0,
    COMPLAINED: 0,
    FAILED: 0,
    UNCERTAIN: 0,
  };
```

Em `src/components/email/status-badge.tsx`, no `STYLES`, acrescente:

```ts
  UNCERTAIN: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
```

`SENDING` já existe (é o mesmo estilo do envio "Enviando").

Em `emailBroadcast.report.counters`, acrescente:
- `pt.json`: `"SENDING": "Enviando"`, `"UNCERTAIN": "Situação incerta"`;
- `en.json`: `"SENDING": "Sending"`, `"UNCERTAIN": "Uncertain"`.

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm run check:isolation && npm run check:email`
Expected: tudo passa; o isolamento mostra "e-mail sender accounts scoped to org B exclude org A's account".

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261015120000_email_sender_accounts src/lib/tenant-db.ts scripts/check-isolation.ts src/lib/queries/email-broadcasts.ts src/components/email/status-badge.tsx src/messages/pt.json src/messages/en.json docs/guia/03-multi-tenancy.md
git commit -m "[E-mail] - Cria a conta de envio Microsoft e o canal do envio no banco" -m "Tabela email_sender_accounts (uma por empresa), channel e senderAccountId em email_broadcasts, status SENDING e UNCERTAIN. Migration aditiva, aplicada localmente com db execute + migrate resolve." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Servidor da conta (config, token, Graph básico, consultas, desconectar, auditoria)

**Files:**
- Modify: `src/lib/env.ts`, `.env.example`, `src/config/audit.ts`, `src/messages/pt.json`, `src/messages/en.json`, `src/lib/email-broadcast/types.ts`
- Create:
  - `src/lib/email-broadcast/microsoft/oauth.ts`, `token.ts`, `accounts.ts` e `graph.ts`;
  - `src/lib/queries/email-sender-accounts.ts`;
  - `src/app/actions/email-sender-accounts.ts`

**Interfaces:**
- Consome: `joinSiteUrl`, `microsoftDailyLimit`, `remainingToday`, `sentLast24hWhere`, `type MicrosoftAccountKind` (Task 1).
- Produz:
  - `oauth.ts`:
    - `MICROSOFT_MAIL_SCOPES: string[]`;
    - `MS_MAIL_STATE_COOKIE = "ms_mail_state"`, `MS_MAIL_VERIFIER_COOKIE = "ms_mail_verifier"`, `MS_MAIL_ORG_COOKIE = "ms_mail_org"`;
    - `microsoftMailConfigured(): boolean`, `microsoftMailCallbackUrl(): string`, `microsoftMailClient(): MicrosoftEntraId`.
  - `token.ts`:
    - `type MicrosoftCredentials = { accessToken: string; refreshToken: string; expiresAt: string }`;
    - `sealMicrosoftCredentials(c: MicrosoftCredentials): string`;
    - `type TokenResult = { ok: true; accessToken: string } | { ok: false; reason: "reconnect" | "temporary"; message: string }`;
    - `getMicrosoftAccessToken(organizationId: string, accountId: string, opts?: { force?: boolean }): Promise<TokenResult>`;
    - `markNeedsReconnect(organizationId: string, accountId: string, message: string): Promise<void>`.
  - `accounts.ts`: `saveMicrosoftAccount(organizationId: string, userId: string, input: { email: string; displayName: string | null; accountKind: MicrosoftAccountKind; credentials: MicrosoftCredentials }): Promise<{ id: string; replaced: boolean }>`.
  - `graph.ts`:
    - `type GraphFailure = { ok: false; status: number; code: string | null; message: string; retryAfter: number | null }`;
    - `type GraphResult<T> = { ok: true; status: number; data: T; location: string | null } | GraphFailure`;
    - `graphCall<T>(url, init)`, de uso interno (a Task 6 acrescenta as funções de envio no mesmo arquivo);
    - `graphMe(token: string): Promise<{ ok: true; email: string; displayName: string | null } | { ok: false; message: string }>`.
  - `types.ts`: `type SenderAccountView = { id: string; email: string; displayName: string | null; accountKind: "personal" | "work"; status: "ACTIVE" | "NEEDS_RECONNECT"; dailyLimit: number; sentLast24h: number; remaining: number }`.
  - `queries/email-sender-accounts.ts`: `getSenderAccountView(organizationId: string): Promise<SenderAccountView | null>`.
  - `actions/email-sender-accounts.ts`: `disconnectMicrosoftAccount(): Promise<{ ok: true } | { ok: false; error: "unauthorized" | "forbidden" | "not_found" | "unknown" }>`.
  - Auditoria: as ações `email_sender.connected`, `email_sender.replaced` e `email_sender.disconnected`, e a entidade `EmailSenderAccount`.

- [ ] **Step 1: Variáveis**

Em `src/lib/env.ts`, no `serverSchema`, logo depois de `MICROSOFT_TENANT_ID`:

```ts
  // Mass e-mail through the company's own Microsoft mailbox (spec 2026-10-15):
  // the "MetodoIA" Entra app (any tenant + personal accounts), delegated
  // Mail.Send + Mail.ReadWrite. Separate from the sign-in app above. Optional:
  // without both, the "Pela conta Microsoft" option doesn't show up.
  MICROSOFT_MAIL_CLIENT_ID: z.string().optional(),
  MICROSOFT_MAIL_CLIENT_SECRET: z.string().optional(),
```

Em `.env.example`, logo depois de `MICROSOFT_CLIENT_SECRET=""`:

```
# Envio de e-mail em massa pela caixa Microsoft da empresa (app "MetodoIA" no Entra).
MICROSOFT_MAIL_CLIENT_ID=""
MICROSOFT_MAIL_CLIENT_SECRET=""
```

- [ ] **Step 2: `src/lib/email-broadcast/microsoft/oauth.ts`**

```ts
import "server-only";
import { MicrosoftEntraId } from "arctic";
import { env } from "@/lib/env";
import { joinSiteUrl } from "./core";

/** Delegated scopes asked when a company connects its mailbox (spec 2026-10-15 §5.1). */
export const MICROSOFT_MAIL_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Send",
  "Mail.ReadWrite",
];

/** Round-trip cookies of the connect flow (10 min). */
export const MS_MAIL_STATE_COOKIE = "ms_mail_state";
export const MS_MAIL_VERIFIER_COOKIE = "ms_mail_verifier";
export const MS_MAIL_ORG_COOKIE = "ms_mail_org";

export function microsoftMailConfigured(): boolean {
  return Boolean(env.MICROSOFT_MAIL_CLIENT_ID && env.MICROSOFT_MAIL_CLIENT_SECRET);
}

/** Registered in the app as a Web redirect URI, without the double slash. */
export function microsoftMailCallbackUrl(): string {
  return joinSiteUrl(env.NEXT_PUBLIC_SITE_URL, "/api/email/microsoft/callback");
}

/** "common": personal Microsoft accounts and any Microsoft 365 tenant. */
export function microsoftMailClient(): MicrosoftEntraId {
  return new MicrosoftEntraId(
    "common",
    env.MICROSOFT_MAIL_CLIENT_ID as string,
    env.MICROSOFT_MAIL_CLIENT_SECRET as string,
    microsoftMailCallbackUrl(),
  );
}
```

- [ ] **Step 3: `src/lib/email-broadcast/microsoft/token.ts`**

```ts
import "server-only";
import { OAuth2RequestError } from "arctic";
import { prisma } from "@/lib/prisma";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";
import { MICROSOFT_MAIL_SCOPES, microsoftMailClient } from "./oauth";

export type MicrosoftCredentials = { accessToken: string; refreshToken: string; expiresAt: string };

export function sealMicrosoftCredentials(c: MicrosoftCredentials): string {
  return encryptCredentials({ accessToken: c.accessToken, refreshToken: c.refreshToken, expiresAt: c.expiresAt });
}

function openCredentials(sealed: string): MicrosoftCredentials | null {
  try {
    const c = decryptCredentials(sealed);
    return c.accessToken && c.refreshToken && c.expiresAt
      ? { accessToken: c.accessToken, refreshToken: c.refreshToken, expiresAt: c.expiresAt }
      : null;
  } catch {
    return null;
  }
}

export type TokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "reconnect" | "temporary"; message: string };

/** Renew when the access token ends within this. */
const SKEW_MS = 5 * 60 * 1000;
/** Refusals that only a new consent fixes (revoked access, password change, expired app secret). */
const RECONNECT_CODES = new Set(["invalid_grant", "invalid_client", "interaction_required", "consent_required"]);

export async function markNeedsReconnect(organizationId: string, accountId: string, message: string): Promise<void> {
  await prisma.emailSenderAccount.updateMany({
    where: { id: accountId, organizationId },
    data: { status: "NEEDS_RECONNECT", lastError: message.slice(0, 500) },
  });
}

/**
 * A usable Graph access token for the org's mailbox. Renews it when it ends
 * within 5 minutes (or when `force`d after a 401), under a per-org advisory
 * lock so two sends never spend the same rotating refresh token. A refusal
 * that needs a new consent marks the account NEEDS_RECONNECT. System context:
 * organizationId is explicit in every query.
 */
export async function getMicrosoftAccessToken(
  organizationId: string,
  accountId: string,
  opts: { force?: boolean } = {},
): Promise<TokenResult> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<TokenResult> => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`email_sender:${organizationId}`}))`;
        const row = await tx.emailSenderAccount.findFirst({
          where: { id: accountId, organizationId },
          select: { credentials: true, status: true },
        });
        if (!row || row.status !== "ACTIVE") return { ok: false, reason: "reconnect", message: "account missing or disconnected" };
        const creds = openCredentials(row.credentials);
        if (!creds) {
          await tx.emailSenderAccount.updateMany({
            where: { id: accountId, organizationId },
            data: { status: "NEEDS_RECONNECT", lastError: "unreadable credentials" },
          });
          return { ok: false, reason: "reconnect", message: "unreadable credentials" };
        }
        if (!opts.force && new Date(creds.expiresAt).getTime() - Date.now() > SKEW_MS) {
          return { ok: true, accessToken: creds.accessToken };
        }
        try {
          const tokens = await microsoftMailClient().refreshAccessToken(creds.refreshToken, MICROSOFT_MAIL_SCOPES);
          const next: MicrosoftCredentials = {
            accessToken: tokens.accessToken(),
            refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : creds.refreshToken,
            expiresAt: tokens.accessTokenExpiresAt().toISOString(),
          };
          await tx.emailSenderAccount.updateMany({
            where: { id: accountId, organizationId },
            data: { credentials: sealMicrosoftCredentials(next), lastError: null },
          });
          return { ok: true, accessToken: next.accessToken };
        } catch (e) {
          if (e instanceof OAuth2RequestError && RECONNECT_CODES.has(e.code)) {
            const message = `${e.code}: ${e.description ?? ""}`.slice(0, 500);
            await tx.emailSenderAccount.updateMany({
              where: { id: accountId, organizationId },
              data: { status: "NEEDS_RECONNECT", lastError: message },
            });
            return { ok: false, reason: "reconnect", message };
          }
          return { ok: false, reason: "temporary", message: e instanceof Error ? e.message : "token refresh failed" };
        }
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    return { ok: false, reason: "temporary", message: e instanceof Error ? e.message : "token error" };
  }
}
```

- [ ] **Step 4: `src/lib/email-broadcast/microsoft/graph.ts` (base + `/me`)**

```ts
import "server-only";

/**
 * Minimal Microsoft Graph client for the mass e-mail's Microsoft channel.
 * Never throws: a network error or timeout comes back as status 0. Tokens are
 * passed in by the caller and never logged.
 */
const GRAPH = "https://graph.microsoft.com/v1.0";

export type GraphFailure = { ok: false; status: number; code: string | null; message: string; retryAfter: number | null };
export type GraphResult<T> = { ok: true; status: number; data: T; location: string | null } | GraphFailure;

export async function graphCall<T>(
  url: string,
  init: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    token?: string;
    body?: string | Uint8Array;
    contentType?: string;
    contentRange?: string;
    timeoutMs?: number;
  },
): Promise<GraphResult<T>> {
  try {
    const headers: Record<string, string> = {};
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.contentType) headers["Content-Type"] = init.contentType;
    if (init.contentRange) headers["Content-Range"] = init.contentRange;
    const res = await fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
    const text = await res.text().catch(() => "");
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = {};
      }
    }
    if (!res.ok) {
      const err = (json.error && typeof json.error === "object" ? json.error : {}) as Record<string, unknown>;
      const retryAfter = Number(res.headers.get("retry-after"));
      return {
        ok: false,
        status: res.status,
        code: typeof err.code === "string" ? err.code : null,
        message: typeof err.message === "string" ? err.message : `Graph ${res.status}`,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      };
    }
    return { ok: true, status: res.status, data: json as T, location: res.headers.get("location") };
  } catch (e) {
    return { ok: false, status: 0, code: null, message: e instanceof Error ? e.message : "network error", retryAfter: null };
  }
}

/** The connected mailbox's address and name (personal accounts may only have userPrincipalName). */
export async function graphMe(
  token: string,
): Promise<{ ok: true; email: string; displayName: string | null } | { ok: false; message: string }> {
  const r = await graphCall<{ mail?: string | null; userPrincipalName?: string | null; displayName?: string | null }>(
    `${GRAPH}/me?$select=mail,userPrincipalName,displayName`,
    { method: "GET", token },
  );
  if (!r.ok) return { ok: false, message: r.message };
  const email = (r.data.mail || r.data.userPrincipalName || "").trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, message: "no e-mail address on the account" };
  return { ok: true, email, displayName: r.data.displayName?.trim() || null };
}

export { GRAPH };
```

- [ ] **Step 5: `src/lib/email-broadcast/microsoft/accounts.ts`**

```ts
import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import type { MicrosoftAccountKind } from "./core";
import { sealMicrosoftCredentials, type MicrosoftCredentials } from "./token";

/**
 * Save the mailbox a company just connected. The same mailbox again keeps the
 * row (same id: its sends and 24 h count carry on); a different mailbox
 * replaces it with a new row, so sends tied to the old one lose their
 * senderAccountId (FK SET NULL) and pause until resumed (spec §5.1).
 */
export async function saveMicrosoftAccount(
  organizationId: string,
  userId: string,
  input: { email: string; displayName: string | null; accountKind: MicrosoftAccountKind; credentials: MicrosoftCredentials },
): Promise<{ id: string; replaced: boolean }> {
  const email = input.email.trim().toLowerCase();
  const data = {
    email,
    displayName: input.displayName,
    accountKind: input.accountKind,
    credentials: sealMicrosoftCredentials(input.credentials),
    status: "ACTIVE" as const,
    lastError: null,
    connectedById: userId,
  };
  return tenantDb(organizationId).$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`email_sender:${organizationId}`}))`;
      const current = await tx.emailSenderAccount.findFirst({
        where: { organizationId },
        select: { id: true, email: true },
      });
      if (current && current.email === email) {
        await tx.emailSenderAccount.updateMany({ where: { id: current.id, organizationId }, data });
        return { id: current.id, replaced: false };
      }
      if (current) await tx.emailSenderAccount.deleteMany({ where: { id: current.id, organizationId } });
      const created = await tx.emailSenderAccount.create({
        data: { organizationId, provider: "MICROSOFT", ...data },
        select: { id: true },
      });
      return { id: created.id, replaced: Boolean(current) };
    },
    { timeout: 20_000 },
  );
}
```

- [ ] **Step 6: Tipo e consulta da conta**

Em `src/lib/email-broadcast/types.ts`, acrescente:

```ts
/** The org's Microsoft sending account as the screens show it (no credentials). */
export type SenderAccountView = {
  id: string;
  email: string;
  displayName: string | null;
  accountKind: "personal" | "work";
  status: "ACTIVE" | "NEEDS_RECONNECT";
  dailyLimit: number;
  sentLast24h: number;
  remaining: number;
};
```

Crie `src/lib/queries/email-sender-accounts.ts`:

```ts
import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { microsoftDailyLimit, remainingToday, sentLast24hWhere } from "@/lib/email-broadcast/microsoft/core";
import type { SenderAccountView } from "@/lib/email-broadcast/types";

/** The org's connected Microsoft mailbox with today's estimate, or null. */
export async function getSenderAccountView(organizationId: string): Promise<SenderAccountView | null> {
  const db = tenantDb(organizationId);
  const row = await db.emailSenderAccount.findFirst({
    select: { id: true, email: true, displayName: true, accountKind: true, status: true },
  });
  if (!row) return null;
  const sentLast24h = await db.emailBroadcastRecipient.count({ where: sentLast24hWhere(row.id, new Date()) });
  const dailyLimit = microsoftDailyLimit(row.accountKind);
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    accountKind: row.accountKind === "personal" ? "personal" : "work",
    status: row.status,
    dailyLimit,
    sentLast24h,
    remaining: remainingToday(dailyLimit, sentLast24h),
  };
}
```

- [ ] **Step 7: Action de desconectar e auditoria**

Em `src/config/audit.ts`, em `AUDIT_ACTIONS`, depois de `"email_broadcast.started",`:

```ts
  "email_sender.connected",
  "email_sender.replaced",
  "email_sender.disconnected",
```

E em `AUDIT_ENTITIES`, depois de `"EmailBroadcast",`: `"EmailSenderAccount",`.

i18n de auditoria, em `audit.actions` e `audit.entities`:
- `pt.json`:
  - `"email_sender": { "connected": "Conectou a conta Microsoft de envio", "replaced": "Trocou a conta Microsoft de envio", "disconnected": "Desconectou a conta Microsoft de envio" }`;
  - entidade `"EmailSenderAccount": "Conta de envio de e-mail"`.
- `en.json`:
  - `"email_sender": { "connected": "Connected the Microsoft sending account", "replaced": "Replaced the Microsoft sending account", "disconnected": "Disconnected the Microsoft sending account" }`;
  - entidade `"EmailSenderAccount": "E-mail sending account"`.

Crie `src/app/actions/email-sender-accounts.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { audit } from "@/lib/audit";

export type SenderAccountActionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "forbidden" | "not_found" | "unknown" };

/**
 * Disconnect the org's Microsoft mailbox (spec §5.3). The row goes away, so
 * sends tied to it lose senderAccountId (FK SET NULL) and the dispatcher
 * pauses them at their next e-mail with "no_sender_account".
 */
export async function disconnectMicrosoftAccount(): Promise<SenderAccountActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) return { ok: false, error: "forbidden" };
  try {
    const db = tenantDb(ctx.organizationId);
    const row = await db.emailSenderAccount.findFirst({ select: { id: true, email: true } });
    if (!row) return { ok: false, error: "not_found" };
    await db.emailSenderAccount.deleteMany({ where: { id: row.id } });
    await audit(ctx, {
      action: "email_sender.disconnected",
      entity: "EmailSenderAccount",
      entityId: row.id,
      meta: { email: row.email },
    });
    revalidatePath("/app/email");
    return { ok: true };
  } catch (error) {
    console.error("Failed to disconnect the Microsoft account", error);
    return { ok: false, error: "unknown" };
  }
}
```

- [ ] **Step 8: Verificar e commit**

Run: `npm run typecheck && npx eslint src scripts && npm run check:email`
Expected: sem erros (os avisos de lint conhecidos continuam os mesmos).

```bash
git add src/lib/env.ts .env.example src/config/audit.ts src/messages/pt.json src/messages/en.json src/lib/email-broadcast/types.ts src/lib/email-broadcast/microsoft src/lib/queries/email-sender-accounts.ts src/app/actions/email-sender-accounts.ts
git commit -m "[E-mail] - Adiciona o servidor da conta Microsoft de envio" -m "Config do app, token com renovacao serializada por empresa, leitura de /me, gravacao da conta, consulta com a estimativa do dia, desconectar e auditoria." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rotas de conectar e de retorno

**Files:**
- Create: `src/app/api/email/microsoft/connect/route.ts`, `src/app/api/email/microsoft/callback/route.ts`
- Modify: `docs/guia/05-rotas-e-jobs.md`

**Interfaces:**
- Consome:
  - `MICROSOFT_MAIL_SCOPES`, `MS_MAIL_*_COOKIE`, `microsoftMailClient`, `microsoftMailConfigured` (Task 4);
  - `graphMe` e `saveMicrosoftAccount` (Task 4);
  - `accountKindFromTid`, `microsoftConsentError` e `joinSiteUrl` (Task 1).
- Produz: os endpoints `GET /api/email/microsoft/connect` e `GET /api/email/microsoft/callback`. Os dois voltam para `/app/email/new` com `?microsoft=connected` ou com `?microsoft_error=cancelled|admin_required|not_configured|failed`.

- [ ] **Step 1: `src/app/api/email/microsoft/connect/route.ts`**

```ts
import { NextResponse } from "next/server";
import { generateCodeVerifier, generateState } from "arctic";
import { env } from "@/lib/env";
import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { joinSiteUrl } from "@/lib/email-broadcast/microsoft/core";
import {
  MICROSOFT_MAIL_SCOPES,
  MS_MAIL_ORG_COOKIE,
  MS_MAIL_STATE_COOKIE,
  MS_MAIL_VERIFIER_COOKIE,
  microsoftMailClient,
  microsoftMailConfigured,
} from "@/lib/email-broadcast/microsoft/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 10,
};

/**
 * Start connecting the org's Microsoft mailbox (spec 2026-10-15 §5.1). Same
 * gates as the E-mail screen, checked first. The state, the PKCE verifier and
 * the org go in short cookies the callback checks.
 */
export async function GET() {
  const site = env.NEXT_PUBLIC_SITE_URL;
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(joinSiteUrl(site, "/login"));
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!microsoftMailConfigured()) {
    return NextResponse.redirect(joinSiteUrl(site, "/app/email/new?microsoft_error=not_configured"));
  }

  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = microsoftMailClient().createAuthorizationURL(state, verifier, MICROSOFT_MAIL_SCOPES);
  url.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(url);
  res.cookies.set(MS_MAIL_STATE_COOKIE, state, COOKIE_OPTS);
  res.cookies.set(MS_MAIL_VERIFIER_COOKIE, verifier, COOKIE_OPTS);
  res.cookies.set(MS_MAIL_ORG_COOKIE, ctx.organizationId, COOKIE_OPTS);
  return res;
}
```

- [ ] **Step 2: `src/app/api/email/microsoft/callback/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { decodeIdToken } from "arctic";
import { env } from "@/lib/env";
import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { audit } from "@/lib/audit";
import { accountKindFromTid, joinSiteUrl, microsoftConsentError } from "@/lib/email-broadcast/microsoft/core";
import {
  MS_MAIL_ORG_COOKIE,
  MS_MAIL_STATE_COOKIE,
  MS_MAIL_VERIFIER_COOKIE,
  microsoftMailClient,
  microsoftMailConfigured,
} from "@/lib/email-broadcast/microsoft/oauth";
import { graphMe } from "@/lib/email-broadcast/microsoft/graph";
import { saveMicrosoftAccount } from "@/lib/email-broadcast/microsoft/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Microsoft's redirect back after the consent (spec §5.1): check the session,
 * the state, the PKCE verifier and that the same org started the flow, then
 * save the mailbox. Tokens never reach the browser or the logs.
 */
export async function GET(req: NextRequest) {
  const site = env.NEXT_PUBLIC_SITE_URL;
  const back = (query: string) => {
    const res = NextResponse.redirect(joinSiteUrl(site, `/app/email/new?${query}`));
    res.cookies.delete(MS_MAIL_STATE_COOKIE);
    res.cookies.delete(MS_MAIL_VERIFIER_COOKIE);
    res.cookies.delete(MS_MAIL_ORG_COOKIE);
    return res;
  };

  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(joinSiteUrl(site, "/login"));
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!microsoftMailConfigured()) return back("microsoft_error=not_configured");

  const params = req.nextUrl.searchParams;
  const providerError = params.get("error");
  if (providerError) {
    return back(`microsoft_error=${microsoftConsentError(providerError, params.get("error_description") ?? "")}`);
  }

  const code = params.get("code");
  const state = params.get("state");
  const storedState = req.cookies.get(MS_MAIL_STATE_COOKIE)?.value;
  const verifier = req.cookies.get(MS_MAIL_VERIFIER_COOKIE)?.value;
  const startedOrg = req.cookies.get(MS_MAIL_ORG_COOKIE)?.value;
  if (!code || !state || !storedState || state !== storedState || !verifier || startedOrg !== ctx.organizationId) {
    console.error("[email-microsoft] callback state mismatch", {
      hasCode: Boolean(code),
      stateMatches: Boolean(state) && state === storedState,
      hasVerifier: Boolean(verifier),
      sameOrg: startedOrg === ctx.organizationId,
    });
    return back("microsoft_error=failed");
  }

  try {
    const tokens = await microsoftMailClient().validateAuthorizationCode(code, verifier);
    if (!tokens.hasRefreshToken()) return back("microsoft_error=failed");
    const claims = decodeIdToken(tokens.idToken()) as { tid?: unknown };
    const me = await graphMe(tokens.accessToken());
    if (!me.ok) {
      console.error("[email-microsoft] /me failed", me.message);
      return back("microsoft_error=failed");
    }
    const kind = accountKindFromTid(claims.tid);
    const saved = await saveMicrosoftAccount(ctx.organizationId, ctx.userId, {
      email: me.email,
      displayName: me.displayName,
      accountKind: kind,
      credentials: {
        accessToken: tokens.accessToken(),
        refreshToken: tokens.refreshToken(),
        expiresAt: tokens.accessTokenExpiresAt().toISOString(),
      },
    });
    await audit(ctx, {
      action: saved.replaced ? "email_sender.replaced" : "email_sender.connected",
      entity: "EmailSenderAccount",
      entityId: saved.id,
      meta: { email: me.email, kind },
    });
    return back("microsoft=connected");
  } catch (error) {
    console.error("[email-microsoft] callback failed", error instanceof Error ? error.message : "unknown error");
    return back("microsoft_error=failed");
  }
}
```

- [ ] **Step 3: Guia 05**

Na tabela "Os jeitos de autenticar uma rota neste repo", acrescente a linha:

```markdown
| Usuário logado conectando a caixa Microsoft do E-mail | sessão (`getOrgContext()`) + tela `email` + módulo `marketing`; o retorno confere `state`, verificador PKCE e empresa nos cookies `ms_mail_*` (10 min) | [src/app/api/email/microsoft/](../../src/app/api/email/microsoft/) |
```

E um parágrafo depois da tabela: "`/api/email/microsoft/connect` e `/callback` (spec 2026-10-15) só redirecionam. O endereço de retorno cadastrado no app do Azure é `${NEXT_PUBLIC_SITE_URL}/api/email/microsoft/callback`, montado por `joinSiteUrl` sem barra dupla. As credenciais vão criptografadas para `email_sender_accounts` e nunca para o navegador ou para o log."

- [ ] **Step 4: Verificar e commit**

Run: `npm run typecheck && npx eslint src scripts`
Expected: sem erros.

```bash
git add src/app/api/email/microsoft docs/guia/05-rotas-e-jobs.md
git commit -m "[E-mail] - Adiciona as rotas de conectar a conta Microsoft" -m "connect gera state/PKCE e leva a Microsoft; callback confere sessao, state, verificador e empresa, le /me e grava a conta. Guia 05 atualizado." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Montagem do MIME e envio pelo Graph

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/lib/email-broadcast/microsoft/graph.ts`, `scripts/check-email-broadcast.ts`, `docs/guia/06-antes-de-commitar.md`
- Create: `src/lib/email-broadcast/microsoft/mime.ts`, `src/lib/email-broadcast/microsoft/send.ts`

**Interfaces:**
- Consome: `graphCall`, `GRAPH` e `GraphFailure` (Task 4); `attachmentUploadMode`, `microsoftSendPath` e `uploadRanges` (Task 1).
- Produz:
  - `mime.ts` (sem `server-only`):
    - `type MimeFile = { filename: string; contentType: string; data: Buffer }`;
    - `type MimeMail = { from: { name: string | null; address: string }; to: string; replyTo: string | null; subject: string; html: string; text: string; headers: Record<string, string>; attachments: MimeFile[] }`;
    - `buildMime(mail: MimeMail): Promise<Buffer>`.
  - `graph.ts`: `graphSendMime`, `graphCreateMimeDraft`, `graphAddAttachment`, `graphUploadAttachment`, `graphSendDraft` e `graphDeleteMessage`.
  - `send.ts`:
    - `type MicrosoftSendOutcome = { ok: true } | (GraphFailure & { stage: "prepare" | "send" })`;
    - `sendMicrosoftMail(token: string, mail: Omit<MimeMail, "attachments">, files: MimeFile[]): Promise<MicrosoftSendOutcome>`.

- [ ] **Step 1: Dependência**

```bash
npm install nodemailer@10.1.1
npm install -D @types/nodemailer@8.0.2
npm run check:node
```

Expected: o `check:node` passa ("a arvore inteira cabe em 20.x"). Se a rede falhar, repita o `npm install`.

- [ ] **Step 2: Escrever os testes do MIME (falham)**

Em `scripts/check-email-broadcast.ts`, acrescente o import:

```ts
import { buildMime } from "../src/lib/email-broadcast/microsoft/mime";
```

E dentro de `main()`, antes do `console.log` final:

```ts
  await checkAsync("buildMime encodes accents and keeps the unsubscribe headers and both parts", async () => {
    const acc = String.fromCharCode(0xe7, 0xe3); // the two accented letters of "çã"
    const mime = (
      await buildMime({
        from: { name: `Loja Solu${acc}o`, address: "contato@loja.com" },
        to: "ana@x.com",
        replyTo: "resp@loja.com",
        subject: `Promo${acc}o de outubro`,
        html: "<p>Oi</p>",
        text: "Oi",
        headers: {
          "List-Unsubscribe": "<https://metodotia.com/api/email/unsubscribe/r1/sig>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        attachments: [{ filename: `cat${acc}logo.pdf`, contentType: "application/pdf", data: Buffer.from("PDFDATA") }],
      })
    ).toString("utf8");
    assert.match(mime, /^Subject: =\?UTF-8\?/m);
    assert.match(mime, /^From: =\?UTF-8\?.+<contato@loja\.com>/m);
    assert.match(mime, /^To: ana@x\.com/m);
    assert.match(mime, /^Reply-To: resp@loja\.com/m);
    assert.match(mime, /^List-Unsubscribe: <https:\/\/metodotia\.com\/api\/email\/unsubscribe\/r1\/sig>/m);
    assert.match(mime, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click/m);
    assert.match(mime, /multipart\/alternative/);
    assert.match(mime, /Content-Type: text\/html/);
    assert.match(mime, /Content-Type: text\/plain/);
    assert.match(mime, /Content-Disposition: attachment/);
    assert.ok(mime.includes(Buffer.from("PDFDATA").toString("base64")));
    assert.ok(!mime.includes(`cat${acc}logo.pdf`), "a non-ASCII file name is encoded");
  });

  await checkAsync("buildMime without attachments or reply-to has no mixed part", async () => {
    const mime = (
      await buildMime({
        from: { name: null, address: "a@b.com" },
        to: "c@d.com",
        replyTo: null,
        subject: "Oi",
        html: "<p>Oi</p>",
        text: "Oi",
        headers: {},
        attachments: [],
      })
    ).toString("utf8");
    assert.match(mime, /^From: a@b\.com/m);
    assert.ok(!/multipart\/mixed/.test(mime));
    assert.ok(!/^Reply-To:/m.test(mime));
  });
```

Run: `npm run check:email`
Expected: FAIL com "Cannot find module '../src/lib/email-broadcast/microsoft/mime'".

- [ ] **Step 3: `src/lib/email-broadcast/microsoft/mime.ts`**

```ts
/**
 * RFC 5322 messages for Graph's MIME endpoints (sendMail and draft creation).
 * nodemailer is used ONLY as a message builder — nothing goes out over SMTP.
 * No server-only import, so check:email can test it.
 */
import MailComposer from "nodemailer/lib/mail-composer";

export type MimeFile = { filename: string; contentType: string; data: Buffer };

export type MimeMail = {
  from: { name: string | null; address: string };
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  attachments: MimeFile[];
};

/** Non-ASCII names, subjects and file names are encoded by nodemailer. */
export function buildMime(mail: MimeMail): Promise<Buffer> {
  const composer = new MailComposer({
    from: mail.from.name ? { name: mail.from.name, address: mail.from.address } : mail.from.address,
    to: mail.to,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    headers: mail.headers,
    attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.data, contentType: a.contentType })),
  });
  return composer.compile().build();
}
```

Run: `npm run check:email`
Expected: PASS. Se o TypeScript reclamar do import default, use `import MailComposer = require("nodemailer/lib/mail-composer");`, que é a forma que os tipos documentam, e rode de novo.

- [ ] **Step 4: Funções de envio em `graph.ts`**

Acrescente ao fim de `src/lib/email-broadcast/microsoft/graph.ts` (o `import type { MimeFile }` vai no topo, junto do `import "server-only"`):

```ts
import type { MimeFile } from "./mime";
import { uploadRanges } from "./core";

const msg = (id: string) => `${GRAPH}/me/messages/${encodeURIComponent(id)}`;

/** POST /me/sendMail with a base64 MIME body: 202, saved to Sent Items. */
export function graphSendMime(token: string, mimeBase64: string) {
  return graphCall<Record<string, never>>(`${GRAPH}/me/sendMail`, {
    method: "POST",
    token,
    body: mimeBase64,
    contentType: "text/plain",
    timeoutMs: 60_000,
  });
}

/** POST /me/messages with a base64 MIME body: creates a draft (needs Mail.ReadWrite). */
export function graphCreateMimeDraft(token: string, mimeBase64: string) {
  return graphCall<{ id?: string }>(`${GRAPH}/me/messages`, {
    method: "POST",
    token,
    body: mimeBase64,
    contentType: "text/plain",
    timeoutMs: 60_000,
  });
}

/** A file under 3 MB, in one POST. */
export function graphAddAttachment(token: string, messageId: string, file: MimeFile) {
  return graphCall<{ id?: string }>(`${msg(messageId)}/attachments`, {
    method: "POST",
    token,
    contentType: "application/json",
    body: JSON.stringify({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: file.filename,
      contentType: file.contentType,
      contentBytes: file.data.toString("base64"),
    }),
    timeoutMs: 60_000,
  });
}

/** A file from 3 MB on, through an upload session (chunks of UPLOAD_CHUNK_BYTES, in order). */
export async function graphUploadAttachment(token: string, messageId: string, file: MimeFile): Promise<GraphResult<unknown>> {
  const session = await graphCall<{ uploadUrl?: string }>(`${msg(messageId)}/attachments/createUploadSession`, {
    method: "POST",
    token,
    contentType: "application/json",
    body: JSON.stringify({
      AttachmentItem: { attachmentType: "file", name: file.filename, size: file.data.byteLength, contentType: file.contentType },
    }),
  });
  if (!session.ok) return session;
  const uploadUrl = session.data.uploadUrl;
  if (!uploadUrl) return { ok: false, status: 502, code: null, message: "upload session without url", retryAfter: null };
  let last: GraphResult<unknown> = session;
  for (const { start, end } of uploadRanges(file.data.byteLength)) {
    // Pre-authenticated URL: no Authorization header (Graph docs).
    last = await graphCall<unknown>(uploadUrl, {
      method: "PUT",
      body: file.data.subarray(start, end + 1),
      contentType: "application/octet-stream",
      contentRange: `bytes ${start}-${end}/${file.data.byteLength}`,
      timeoutMs: 120_000,
    });
    if (!last.ok) return last;
  }
  return last;
}

/** Send a prepared draft: 202, saved to Sent Items. Empty body = Content-Length 0. */
export function graphSendDraft(token: string, messageId: string) {
  return graphCall<Record<string, never>>(`${msg(messageId)}/send`, { method: "POST", token, body: "", timeoutMs: 60_000 });
}

export function graphDeleteMessage(token: string, messageId: string) {
  return graphCall<Record<string, never>>(msg(messageId), { method: "DELETE", token });
}
```

- [ ] **Step 5: `src/lib/email-broadcast/microsoft/send.ts`**

```ts
import "server-only";
import { attachmentUploadMode, microsoftSendPath } from "./core";
import { buildMime, type MimeFile, type MimeMail } from "./mime";
import {
  graphAddAttachment,
  graphCreateMimeDraft,
  graphDeleteMessage,
  graphSendDraft,
  graphSendMime,
  graphUploadAttachment,
  type GraphFailure,
} from "./graph";

export type MicrosoftSendOutcome = { ok: true } | (GraphFailure & { stage: "prepare" | "send" });

/**
 * One e-mail out of the connected mailbox (spec §6.1): a single sendMail when
 * the base64 MIME fits, else a MIME draft without the files, each file
 * attached (POST under 3 MB, upload session above), then the draft's send. A
 * failure before the send deletes the draft. A timeout ON the send keeps it
 * (it may have gone out). Never throws.
 */
export async function sendMicrosoftMail(
  token: string,
  mail: Omit<MimeMail, "attachments">,
  files: MimeFile[],
): Promise<MicrosoftSendOutcome> {
  try {
    const fileBytes = files.reduce((n, f) => n + f.data.byteLength, 0);
    if (microsoftSendPath(fileBytes, null) === "direct") {
      const b64 = (await buildMime({ ...mail, attachments: files })).toString("base64");
      if (microsoftSendPath(fileBytes, b64.length) === "direct") {
        const r = await graphSendMime(token, b64);
        return r.ok ? { ok: true } : { ...r, stage: "send" };
      }
    }

    const draft = await graphCreateMimeDraft(token, (await buildMime({ ...mail, attachments: [] })).toString("base64"));
    if (!draft.ok) return { ...draft, stage: "prepare" };
    const id = draft.data.id;
    if (!id) return { ok: false, status: 502, code: null, message: "draft without id", retryAfter: null, stage: "prepare" };

    for (const f of files) {
      const r =
        attachmentUploadMode(f.data.byteLength) === "inline"
          ? await graphAddAttachment(token, id, f)
          : await graphUploadAttachment(token, id, f);
      if (!r.ok) {
        await graphDeleteMessage(token, id);
        return { ...r, stage: "prepare" };
      }
    }

    const sent = await graphSendDraft(token, id);
    if (sent.ok) return { ok: true };
    if (sent.status !== 0 && sent.status !== 504) await graphDeleteMessage(token, id);
    return { ...sent, stage: "send" };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      code: null,
      message: e instanceof Error ? e.message : "could not build the e-mail",
      retryAfter: null,
      stage: "prepare",
    };
  }
}
```

- [ ] **Step 6: Guia 06**

No parágrafo do `check:email`, acrescente à lista do que ele cobre: "as regras do envio pela conta Microsoft (tipo de conta, limite diário, caminho direto ou rascunho, faixas do upload, decisão sobre falhas do Graph), a montagem do MIME e os motivos de falha em português". Na seção `check:node`, registre que `nodemailer` (só usado como montador de MIME) exige Node ≥ 20.

- [ ] **Step 7: Verificar e commit**

Run: `npm run typecheck && npx eslint src scripts && npm run check:email && npm run check:node`
Expected: tudo passa.

```bash
git add package.json package-lock.json src/lib/email-broadcast/microsoft scripts/check-email-broadcast.ts docs/guia/06-antes-de-commitar.md
git commit -m "[E-mail] - Monta o MIME e envia pelo Microsoft Graph" -m "nodemailer so como montador; envio direto por sendMail quando cabe em 3,9 MB, senao rascunho + anexos (POST ou sessao de upload) + envio, apagando o rascunho na falha." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Despachante com o canal Microsoft

**Files:**
- Create: `src/lib/email-broadcast/microsoft/deliver.ts`
- Modify: `src/lib/email-broadcast/dispatch.ts`

**Interfaces:**
- Consome:
  - `getMicrosoftAccessToken`, `markNeedsReconnect` (Task 4) e `sendMicrosoftMail` (Task 6);
  - `MICROSOFT_PACE_MS`, `graphFailureAction`, `microsoftDailyLimit`, `remainingToday` e `sentLast24hWhere` (Task 1);
  - `INTERRUPTED_ERROR` e `microsoftRecipientError` (Task 2);
  - `MimeFile` e `MimeMail` (Task 6).
- Produz:
  - `type MicrosoftPauseReason = "daily_limit" | "reconnect" | "no_sender_account" | "account_blocked" | "provider_error"`;
  - `type MicrosoftRun`;
  - `runMicrosoftBroadcast(run: MicrosoftRun): Promise<{ done: boolean }>`.

- [ ] **Step 1: `src/lib/email-broadcast/microsoft/deliver.ts`**

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { INTERRUPTED_ERROR, microsoftRecipientError } from "../failure-reason";
import { MICROSOFT_PACE_MS, graphFailureAction, microsoftDailyLimit, remainingToday, sentLast24hWhere } from "./core";
import type { MimeFile, MimeMail } from "./mime";
import { sendMicrosoftMail } from "./send";
import { getMicrosoftAccessToken, markNeedsReconnect } from "./token";

export type MicrosoftPauseReason = "daily_limit" | "reconnect" | "no_sender_account" | "account_blocked" | "provider_error";
type Recipient = { id: string; email: string; name: string | null; companyName: string | null };

/** What the platform dispatcher hands over: identity, lease helpers and the per-recipient content. */
export type MicrosoftRun = {
  broadcastId: string;
  organizationId: string;
  fromName: string | null;
  fromEmail: string;
  replyTo: string | null;
  deadline: number;
  files: MimeFile[];
  compose: (r: Recipient) => Pick<MimeMail, "subject" | "html" | "text" | "headers">;
  beat: () => Promise<void>;
  wait: (seconds: number | null) => Promise<void>;
  pause: (reason: MicrosoftPauseReason, message: string | null) => Promise<unknown>;
  finish: () => Promise<void>;
  /** Lease cutoff: sends with a heartbeat after it are running right now. */
  activeSince: () => Date;
};

const MAX_PACE_FACTOR = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Microsoft channel of the mass e-mail dispatcher (spec §6). One recipient at
 * a time: re-read the account, check today's estimate, reserve the recipient
 * (QUEUED → SENDING, sentAt stamped), hand it to Graph, then SENT / FAILED /
 * UNCERTAIN. A recipient still SENDING when a run starts was cut mid-call:
 * it becomes UNCERTAIN and is never resent. System context: organizationId
 * explicit everywhere.
 */
export async function runMicrosoftBroadcast(run: MicrosoftRun): Promise<{ done: boolean }> {
  const org = run.organizationId;
  await prisma.emailBroadcastRecipient.updateMany({
    where: { broadcastId: run.broadcastId, organizationId: org, status: "SENDING" },
    data: { status: "UNCERTAIN", error: INTERRUPTED_ERROR },
  });

  let streak = 0;
  let tokenFailures = 0;
  while (Date.now() < run.deadline) {
    const current = await prisma.emailBroadcast.findFirst({
      where: { id: run.broadcastId, organizationId: org },
      select: { status: true, senderAccountId: true },
    });
    if (current?.status !== "SENDING") return { done: true };
    const account = current.senderAccountId
      ? await prisma.emailSenderAccount.findFirst({
          where: { id: current.senderAccountId, organizationId: org },
          select: { id: true, status: true, accountKind: true },
        })
      : null;
    if (!account) {
      await run.pause("no_sender_account", null);
      return { done: true };
    }
    if (account.status !== "ACTIVE") {
      await run.pause("reconnect", null);
      return { done: true };
    }

    const used = await prisma.emailBroadcastRecipient.count({
      where: { organizationId: org, ...sentLast24hWhere(account.id, new Date()) },
    });
    if (remainingToday(microsoftDailyLimit(account.accountKind), used) <= 0) {
      await run.pause("daily_limit", null);
      return { done: true };
    }

    const r = await prisma.emailBroadcastRecipient.findFirst({
      where: { broadcastId: run.broadcastId, organizationId: org, status: "QUEUED" },
      orderBy: [{ batchNo: "asc" }, { email: "asc" }],
      select: { id: true, email: true, name: true, companyName: true },
    });
    if (!r) {
      await run.finish();
      return { done: true };
    }

    let token = await getMicrosoftAccessToken(org, account.id);
    if (!token.ok) {
      if (token.reason === "reconnect") {
        await run.pause("reconnect", token.message);
        return { done: true };
      }
      tokenFailures++;
      if (tokenFailures >= 3) {
        await run.pause("provider_error", token.message);
        return { done: true };
      }
      await run.wait(2 ** tokenFailures);
      continue;
    }
    tokenFailures = 0;

    // Owner-checked heartbeat, then the reservation: from here on this
    // recipient is never sent twice.
    await run.beat();
    const claimed = await prisma.emailBroadcastRecipient.updateMany({
      where: { id: r.id, organizationId: org, status: "QUEUED" },
      data: { status: "SENDING", sentAt: new Date(), error: null },
    });
    if (claimed.count !== 1) continue;
    const release = () =>
      prisma.emailBroadcastRecipient.updateMany({
        where: { id: r.id, organizationId: org, status: "SENDING" },
        data: { status: "QUEUED", sentAt: null },
      });
    const settle = (data: { status: "SENT" | "FAILED" | "UNCERTAIN"; error: string | null; sentAt?: null }) =>
      prisma.emailBroadcastRecipient.updateMany({
        where: { id: r.id, organizationId: org, status: "SENDING" },
        data,
      });

    const mail = {
      from: { name: run.fromName, address: run.fromEmail },
      to: r.email,
      replyTo: run.replyTo,
      ...run.compose(r),
    };
    let attempt = 0;
    let refreshed = false;
    for (;;) {
      const res = await sendMicrosoftMail(token.accessToken, mail, run.files);
      if (res.ok) {
        await settle({ status: "SENT", error: null });
        streak = 0;
        break;
      }
      const action = graphFailureAction(res.status, res.code, attempt, res.stage);
      if (action === "refresh" && !refreshed) {
        refreshed = true;
        const again = await getMicrosoftAccessToken(org, account.id, { force: true });
        if (again.ok) {
          token = again;
          attempt++;
          continue;
        }
        await release();
        await run.pause("reconnect", again.message);
        return { done: true };
      }
      if (action === "retry") {
        attempt++;
        await run.wait(res.retryAfter ?? 2 ** attempt);
        continue;
      }
      if (action === "uncertain") {
        await settle({ status: "UNCERTAIN", error: INTERRUPTED_ERROR });
        break;
      }
      if (action === "recipient") {
        await settle({ status: "FAILED", error: microsoftRecipientError(res.code, res.message), sentAt: null });
        streak++;
        if (streak >= 3) {
          await run.pause("provider_error", `3 consecutive failures (${res.status}): ${res.message}`);
          return { done: true };
        }
        break;
      }
      await release();
      if (action === "daily_limit") await run.pause("daily_limit", res.message);
      else if (action === "blocked") await run.pause("account_blocked", res.message);
      else if (action === "reconnect" || action === "refresh") {
        await markNeedsReconnect(org, account.id, res.message);
        await run.pause("reconnect", res.message);
      } else await run.pause("provider_error", res.message);
      return { done: true };
    }

    await run.beat();
    const running = await prisma.emailBroadcast.count({
      where: {
        organizationId: org,
        status: "SENDING",
        channel: "MICROSOFT",
        senderAccountId: account.id,
        lastDispatchAt: { gte: run.activeSince() },
      },
    });
    await sleep(MICROSOFT_PACE_MS * Math.min(Math.max(1, running), MAX_PACE_FACTOR));
  }
  return { done: false };
}
```

- [ ] **Step 2: Ligar o ramo no despachante (`src/lib/email-broadcast/dispatch.ts`)**

1. Imports: acrescente

```ts
import type { MimeFile } from "./microsoft/mime";
import { runMicrosoftBroadcast } from "./microsoft/deliver";
```

2. No `select` de `runEmailBroadcast`, acrescente `channel: true,` e `senderAccountId: true,`.

3. `activeSends` passa a contar só a plataforma:

```ts
  const activeSends = () =>
    prisma.emailBroadcast.count({
      where: { status: "SENDING", channel: "PLATFORM", lastDispatchAt: { gte: new Date(Date.now() - LEASE_MS) } },
    });
```

4. O tipo de `reason` em `pause` ganha `| "daily_limit" | "reconnect" | "no_sender_account" | "account_blocked"`.

5. O começo do `try` (do `platformResendKey()` até o carregamento dos anexos) fica assim:

```ts
  try {
    const microsoft = b.channel === "MICROSOFT";
    const apiKey = platformResendKey();
    if (!microsoft && !apiKey) {
      await pause("no_connection", null);
      return { done: true };
    }
    if (!b.fromEmail) {
      await pause("from_missing", null);
      return { done: true };
    }
    const orgRow = await prisma.organization.findFirst({ where: { id: org }, select: { name: true } });
    const orgName = orgRow?.name ?? "";
    const from = formatFrom(b.fromName, b.fromEmail);

    // Attachments are read once per run, before any e-mail: a send never goes
    // out without its files (spec 2026-10-09 §8). Raw bytes serve both
    // channels; Resend gets base64.
    const attachments = parseAttachments(b.attachments);
    if (!attachments || checkAttachments(org, attachments)) {
      await pause("attachment_invalid", null);
      return { done: true };
    }
    const raw: MimeFile[] = [];
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
      // The sizes saved with the draft come from the client; the real bytes
      // decide, checked before encoding so a forged list never piles up in memory.
      bytes += data.byteLength;
      if (bytes > MAX_ATTACHMENTS_BYTES || data.byteLength !== a.size) {
        await pause("attachment_invalid", a.filename);
        return { done: true };
      }
      raw.push({ filename: a.filename, contentType: attachmentContentType(a.filename) ?? "application/octet-stream", data });
      await beat();
    }
    const files: ResendAttachment[] | null = raw.length
      ? raw.map((f) => ({ filename: f.filename, content: f.data.toString("base64"), content_type: f.contentType }))
      : null;
    // After the (possibly slow) file reads, so they don't eat the queue budget.
    const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Number.POSITIVE_INFINITY;

    // The signature frozen when the send started; email_signatures is never read here.
    const signature = b.signatureHtml ? { html: b.signatureHtml, text: b.signatureText ?? "" } : null;
    const composeFor = (r: Batch[number]) => {
      const composed = composeEmail({
        subject: b.subject,
        bodyHtml: b.html,
        vars: { nome: r.name ?? "", empresa: r.companyName ?? "" },
        orgName,
        unsubscribeUrl: emailUnsubscribePageUrl(r.id),
        signature,
      });
      return {
        subject: composed.subject,
        html: composed.html,
        text: composed.text,
        headers: {
          "List-Unsubscribe": `<${emailUnsubscribeOneClickUrl(r.id)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    };

    if (microsoft) {
      const outcome = await runMicrosoftBroadcast({
        broadcastId: b.id,
        organizationId: org,
        fromName: b.fromName,
        fromEmail: b.fromEmail,
        replyTo: b.replyTo,
        deadline,
        files: raw,
        compose: composeFor,
        beat,
        wait,
        pause,
        finish: async () => {
          await prisma.emailBroadcast.updateMany({
            where: { id: b.id, organizationId: org, status: "SENDING", lastDispatchAt: stamp },
            data: { status: "DONE", finishedAt: new Date(), lastDispatchAt: null },
          });
        },
        activeSince: () => new Date(Date.now() - LEASE_MS),
      });
      if (outcome.done) return outcome;
    } else {
      const key = apiKey as string;
```

6. Dentro do `else`, o código da plataforma que já existe continua, com estes ajustes:
   - `toEmail` usa `composeFor`:

```ts
      const toEmail = (r: Batch[number]): ResendEmail => {
        const c = composeFor(r);
        return {
          from,
          to: [r.email],
          subject: c.subject,
          html: c.html,
          text: c.text,
          ...(b.replyTo ? { reply_to: b.replyTo } : {}),
          headers: c.headers,
          ...(files ? { attachments: files } : {}),
        };
      };
```

   - `markSent`, `oneByOne`, `deliver` e o `while` continuam iguais, trocando `apiKey` por `key` nas chamadas `sendOne`/`sendBatch`;
   - a checagem de cota mensal passa a contar só a plataforma:

```ts
        const sent = await prisma.emailBroadcastRecipient.count({
          where: { organizationId: org, sentAt: { gte: monthStart() }, broadcast: { channel: "PLATFORM" } },
        });
```

   - feche o `else` com `}` logo depois do `while`, **antes** do bloco "Budget over (queue mode)", que fica comum aos dois canais.

- [ ] **Step 3: Verificar e commit**

Run: `npm run typecheck && npx eslint src scripts && npm run check:email`
Expected: sem erros. O revisor confere no diff:
- o caminho da plataforma ficou idêntico, só com a troca para `composeFor`, `key`, cota e `activeSends` por canal;
- no canal Microsoft, nenhuma chamada ao Graph acontece sem a reserva `SENDING`.

```bash
git add src/lib/email-broadcast/microsoft/deliver.ts src/lib/email-broadcast/dispatch.ts
git commit -m "[E-mail] - Envia pela conta Microsoft no despachante" -m "Ramo MICROSOFT: reserva cada destinatario antes da chamada, SENDING que sobra vira UNCERTAIN, limite diario estimado, renovacao no 401, pausas por motivo e ritmo de ~28/min por caixa. A plataforma so passa a contar cota e ritmo dos proprios envios." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Actions e consultas com o canal

**Files:**
- Modify: `src/lib/validations/email-broadcast.ts`, `src/lib/email-broadcast/types.ts`, `src/app/actions/email-broadcasts.ts`, `src/lib/queries/email-broadcasts.ts`

**Interfaces:**
- Consome: `getSenderAccountView` (Task 4) e `microsoftMailConfigured` (Task 4).
- Produz:
  - `broadcastDraftSchema` ganha `channel: "PLATFORM" | "MICROSOFT"` (padrão `PLATFORM`);
  - `ComposerDraft` ganha `channel: "PLATFORM" | "MICROSOFT"`;
  - `EmailActionError` ganha `"sender_account_missing" | "sender_account_reconnect"`;
  - `ReportFilter` ganha `"uncertain"`;
  - `listEmailBroadcasts` passa a devolver também `channel`, `fromEmail` e `uncertain`;
  - `getEmailBroadcast` passa a devolver também `channel` e `senderAccountId`;
  - `emailComposerData` passa a devolver também `microsoft: SenderAccountView | null` e `microsoftConfigured: boolean`.

- [ ] **Step 1: Validação e tipo do rascunho**

Em `broadcastDraftSchema`, depois de `signatureId`:

```ts
  channel: z.enum(["PLATFORM", "MICROSOFT"]).default("PLATFORM"),
```

Em `ComposerDraft` (`types.ts`), acrescente `channel: "PLATFORM" | "MICROSOFT";`.

- [ ] **Step 2: `saveEmailDraft` e `duplicateEmailBroadcast`**

Em `saveEmailDraft`, o objeto `data` passa a ser:

```ts
  const microsoft = parsed.data.channel === "MICROSOFT";
  const data = {
    subject: parsed.data.subject,
    html: parsed.data.html,
    channel: parsed.data.channel,
    // The Microsoft sender comes from the connected account when the send starts.
    fromName: microsoft ? null : parsed.data.fromName || null,
    fromEmail: microsoft ? null : parsed.data.fromEmail ? normalizeEmail(parsed.data.fromEmail) : null,
    replyTo: parsed.data.replyTo ? normalizeEmail(parsed.data.replyTo) : null,
    audience: parsed.data.audience as Prisma.InputJsonValue,
    attachments: parsed.data.attachments as Prisma.InputJsonValue,
    signatureId: parsed.data.signatureId,
  };
```

Em `duplicateEmailBroadcast`:
- acrescente `channel: true` ao `select`;
- no `create`, use `channel: src.channel`;
- use `fromName: src.channel === "MICROSOFT" ? null : src.fromName` e `fromEmail: src.channel === "MICROSOFT" ? null : src.fromEmail`.

- [ ] **Step 3: `startEmailBroadcast` com o canal**

1. `EmailActionError` ganha `| "sender_account_missing" | "sender_account_reconnect"`.
2. No `select` do envio, acrescente `channel: true`.
3. Troque o trecho de `if (!platformResendKey())` até o `isSenderAllowed` por:

```ts
  const microsoft = b.channel === "MICROSOFT";
  let account: { id: string; email: string; displayName: string | null } | null = null;
  if (microsoft) {
    const row = await db.emailSenderAccount.findFirst({ select: { id: true, email: true, displayName: true, status: true } });
    if (!row) return { ok: false, error: "sender_account_missing" };
    if (row.status !== "ACTIVE") return { ok: false, error: "sender_account_reconnect" };
    account = row;
  } else {
    if (!platformResendKey()) return { ok: false, error: "no_connection" };
    if (!b.fromEmail) return { ok: false, error: "from_required" };
    // Server-side gate: the composer checks too, but only this decides.
    if (!isSenderAllowed(b.fromEmail, await listSenderDomains(orgId))) {
      return { ok: false, error: "domain_not_allowed" };
    }
  }
```

4. A checagem de cota mensal (`queued` + `remaining`) só roda quando `!microsoft`. Embrulhe o bloco em `if (!microsoft) { … }` e acrescente `broadcast: { status: { in: ["SENDING", "PAUSED"] }, channel: "PLATFORM" }` no `count` de `queued`.
5. No `updateMany` de claim, acrescente ao `data`:

```ts
      ...(account ? { senderAccountId: account.id, fromEmail: account.email, fromName: account.displayName } : {}),
```

6. Na auditoria, `meta` passa a ser:

```ts
    meta: {
      recipients: recipients.length,
      channel: b.channel,
      fromEmail: account ? account.email : b.fromEmail,
      attachments: attachments.length,
      signature: signatureName,
    },
```

- [ ] **Step 4: `resumeEmailBroadcast` com o canal**

Troque o `select` por `{ status: true, fromEmail: true, channel: true }` e o bloco `if (b.status === "PAUSED") { … }` por:

```ts
  if (b.status === "PAUSED") {
    let repoint = {};
    if (b.channel === "MICROSOFT") {
      const account = await db.emailSenderAccount.findFirst({ select: { id: true, email: true, displayName: true, status: true } });
      if (!account) return { ok: false, error: "sender_account_missing" };
      if (account.status !== "ACTIVE") return { ok: false, error: "sender_account_reconnect" };
      // Resumes through the account connected now (it may have been switched).
      repoint = { senderAccountId: account.id, fromEmail: account.email, fromName: account.displayName };
    } else {
      if (!platformResendKey()) return { ok: false, error: "no_connection" };
      if (!b.fromEmail) return { ok: false, error: "from_missing" };
      if (!isSenderAllowed(b.fromEmail, await listSenderDomains(g.ctx.organizationId))) {
        return { ok: false, error: "domain_not_allowed" };
      }
    }
    const res = await db.emailBroadcast.updateMany({
      where: { id, status: "PAUSED" },
      data: { status: "SENDING", pausedReason: null, lastError: null, lastDispatchAt: null, ...repoint },
    });
    if (res.count === 0) return { ok: false, error: "not_found" };
  } else if (b.status !== "SENDING") {
    return { ok: false, error: "invalid" };
  }
```

- [ ] **Step 5: Consultas**

Em `src/lib/queries/email-broadcasts.ts`:

1. Imports: `import { getSenderAccountView } from "@/lib/queries/email-sender-accounts";` e `import { microsoftMailConfigured } from "@/lib/email-broadcast/microsoft/oauth";`.
2. `countEmailsSentThisMonth`: o `where` passa a ser `{ sentAt: { gte: monthStart() }, broadcast: { channel: "PLATFORM" } }`. Atualize o comentário: "Addresses accepted by Resend this month (platform channel only)".
3. `listEmailBroadcasts`:
   - acrescente `channel: true, fromEmail: true` ao `select`;
   - o `tally` ganha `uncertain` (`if (g.status === "UNCERTAIN") t.uncertain += g._count._all;`, com valor inicial `{ total: 0, delivered: 0, problems: 0, uncertain: 0 }`, inclusive no fallback do `map`).
4. `getEmailBroadcast`: acrescente `channel: true, senderAccountId: true` ao `select`.
5. `ReportFilter` vira `"all" | "queued" | "sent" | "delivered" | "problems" | "uncertain"`. `FILTER_STATUSES` passa a ser:

```ts
const FILTER_STATUSES: Record<Exclude<ReportFilter, "all">, EmailRecipientStatus[]> = {
  queued: ["QUEUED", "SENDING"],
  sent: ["SENT"],
  delivered: ["DELIVERED"],
  problems: PROBLEM_STATUSES,
  uncertain: ["UNCERTAIN"],
};
```

6. `emailComposerData`: acrescente `getSenderAccountView(organizationId)` ao `Promise.all` e devolva `microsoft` e `microsoftConfigured: microsoftMailConfigured()`.

- [ ] **Step 6: Verificar e commit**

Run: `npm run typecheck`
Expected: só aparecem erros nas páginas e no composer que ainda não passam `channel`/`microsoft`. Se for o caso, acrescente `channel: "PLATFORM"` ao `draft` em `src/app/[locale]/app/email/new/page.tsx` e `channel: b.channel` em `src/app/[locale]/app/email/[id]/edit/page.tsx`; o resto fica para a Task 9. Depois rode de novo até não haver erro.

```bash
git add src/lib/validations/email-broadcast.ts src/lib/email-broadcast/types.ts src/app/actions/email-broadcasts.ts src/lib/queries/email-broadcasts.ts "src/app/[locale]/app/email/new/page.tsx" "src/app/[locale]/app/email/[id]/edit/page.tsx"
git commit -m "[E-mail] - Leva o canal Microsoft para as actions e consultas" -m "Rascunho guarda o canal; iniciar exige conta ativa e congela o remetente dela; retomar re-aponta para a conta conectada; cota mensal so conta a plataforma; consultas trazem canal, remetente e situacao incerta." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Tela de escolha do canal e formulário

**Files:**
- Create: `src/components/email/channel-choice.tsx`
- Modify:
  - `src/app/[locale]/app/email/new/page.tsx` e `src/app/[locale]/app/email/[id]/edit/page.tsx`;
  - `src/components/email/email-composer.tsx`;
  - `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consome:
  - `SenderAccountView` (Task 4), `disconnectMicrosoftAccount` (Task 4) e `microsoftSendMinutes` (Task 1);
  - `emailComposerData` com `microsoft` e `microsoftConfigured` (Task 8).
- Produz:
  - `ChannelChoice({ account, quotaLimit, connected, error })`;
  - `EmailComposer` ganha a prop `microsoft: SenderAccountView | null`. O canal vem de `draft.channel`.

- [ ] **Step 1: Textos (pt e en)**

Acrescente em `emailBroadcast` (pt / en):

| Chave | pt | en |
|---|---|---|
| `channel.title` | Por onde este e-mail vai sair? | Where should this e-mail go out from? |
| `channel.platformTitle` | Pela plataforma | Through the platform |
| `channel.platformBody` | Sai pelo MétodoAI com um endereço de um domínio liberado para a empresa. É o envio de sempre. | Goes out through MétodoAI from an address on a domain enabled for your company. The usual way. |
| `channel.platformPoint1` | Você digita o nome e o endereço de envio | You type the sender name and address |
| `channel.platformPoint2` | Até {limit} e-mails por mês | Up to {limit} e-mails a month |
| `channel.platformPoint3` | Relatório com entregues e devolvidos | Report with delivered and bounced |
| `channel.platformContinue` | Continuar pela plataforma | Continue through the platform |
| `channel.microsoftTitle` | Pela conta Microsoft | Through the Microsoft account |
| `channel.microsoftBody` | Sai da caixa Outlook ou Microsoft 365 da empresa. As respostas chegam nessa caixa e cada e-mail fica salvo em Itens enviados. | Goes out from the company's Outlook or Microsoft 365 mailbox. Replies land there and every e-mail is saved in Sent Items. |
| `channel.noneTitle` | Nenhuma conta conectada | No account connected |
| `channel.noneBody` | Você entra na Microsoft e autoriza o envio em nome da caixa. Cada empresa tem uma conta de envio. | You sign in to Microsoft and allow sending on the mailbox's behalf. Each company has one sending account. |
| `channel.consentNote` | A Microsoft vai pedir permissão para ler e escrever e-mails: o MétodoAI só usa isso para montar e-mails com anexos grandes, nunca para ler a sua caixa. | Microsoft will ask for permission to read and write e-mail: MétodoAI only uses it to build e-mails with large attachments, never to read your mailbox. |
| `channel.connect` | Conectar conta Microsoft | Connect Microsoft account |
| `channel.connected` | Conectada | Connected |
| `channel.kindPersonal` | Outlook pessoal | Personal Outlook |
| `channel.kindWork` | Microsoft 365 | Microsoft 365 |
| `channel.dailyLimit` | Cerca de {count} e-mails por dia | About {count} e-mails a day |
| `channel.sent24h` | {count} enviados nas últimas 24 h | {count} sent in the last 24 h |
| `channel.use` | Usar esta conta | Use this account |
| `channel.switch` | Trocar conta | Switch account |
| `channel.switchConfirm` | Entrar na Microsoft com outra caixa? Ela substitui {email} nesta empresa, e envios pausados passam a sair por ela quando forem retomados. | Sign in to Microsoft with another mailbox? It replaces {email} for this company, and paused sends go out from it when resumed. |
| `channel.switchConfirmLabel` | Entrar com outra conta | Sign in with another account |
| `channel.disconnect` | Desconectar | Disconnect |
| `channel.disconnectConfirm` | Desconectar {email}? O MétodoAI deixa de enviar por esta caixa, e envios em andamento por ela ficam pausados até uma conta ser conectada de novo. Para tirar o acesso também do lado da Microsoft, remova o app nas configurações de privacidade da sua conta Microsoft. | Disconnect {email}? MétodoAI stops sending from this mailbox, and sends in progress through it pause until an account is connected again. To revoke access on Microsoft's side too, remove the app in your Microsoft account's privacy settings. |
| `channel.disconnected` | Conta Microsoft desconectada. | Microsoft account disconnected. |
| `channel.reconnectTitle` | A conta {email} precisa ser reconectada | The account {email} needs to be reconnected |
| `channel.reconnectBody` | A Microsoft recusou o acesso (senha trocada ou acesso revogado). Os envios por esta conta estão pausados até reconectar. | Microsoft refused access (password changed or access revoked). Sends through this account are paused until you reconnect. |
| `channel.reconnect` | Reconectar | Reconnect |
| `channel.connectedToast` | Conta Microsoft conectada. | Microsoft account connected. |
| `channel.error.cancelled` | A conexão com a Microsoft foi cancelada. | Connecting to Microsoft was cancelled. |
| `channel.error.admin_required` | Esta empresa no Microsoft 365 exige que o administrador dela aprove o app antes. Peça ao responsável pela TI. | This Microsoft 365 organization requires its administrator to approve the app first. Ask your IT admin. |
| `channel.error.not_configured` | O envio pela conta Microsoft não está configurado. Fale com o suporte. | Sending through a Microsoft account isn't set up. Contact support. |
| `channel.error.failed` | Não foi possível conectar a conta Microsoft. Tente de novo. | Couldn't connect the Microsoft account. Try again. |
| `fromMicrosoft` | De | From |
| `microsoftChip` | conta Microsoft | Microsoft account |
| `fromMicrosoftHint` | O nome e o endereço vêm da conta conectada. As respostas chegam nessa caixa. | The name and address come from the connected account. Replies land in that mailbox. |
| `switchChannel` | Trocar canal | Change channel |
| `microsoftMissing` | Não há uma conta Microsoft ativa nesta empresa. Conecte ou reconecte em Novo e-mail antes de enviar. | There's no active Microsoft account for this company. Connect or reconnect it in New e-mail before sending. |
| `confirmMicrosoftPartial` | {now} dos {total} destinatários recebem agora. Esta conta envia cerca de {limit} por dia, e {sent} já saíram nas últimas 24 h. Ao chegar no limite, o envio pausa e espera você clicar em “Retomar envio”. | {now} of the {total} recipients get it now. This account sends about {limit} a day, and {sent} went out in the last 24 h. At the limit, the send pauses and waits for you to click “Resume send”. |
| `confirmMicrosoftAll` | Todos os {total} destinatários recebem agora. | All {total} recipients get it now. |
| `confirmMicrosoftPace` | Ritmo da Microsoft: cerca de 28 e-mails por minuto; esta parte leva cerca de {minutes, plural, one {# minuto} other {# minutos}}. | Microsoft's pace: about 28 e-mails a minute; this part takes about {minutes, plural, one {# minute} other {# minutes}}. |
| `confirmMicrosoftSentItems` | Os e-mails ficam salvos em Itens enviados de {email}, e a Microsoft não informa entrega nem abertura. | The e-mails are saved in {email}'s Sent Items, and Microsoft doesn't report delivery or opens. |
| `error.sender_account_missing` | Conecte uma conta Microsoft para enviar por ela. | Connect a Microsoft account to send through it. |
| `error.sender_account_reconnect` | A conta Microsoft precisa ser reconectada. | The Microsoft account needs to be reconnected. |

Confira a paridade:

```bash
node -e 'const f=(o,p="")=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==="object"?f(v,p+k+"."):[p+k]);const a=f(require("./src/messages/pt.json")),b=f(require("./src/messages/en.json"));const A=new Set(a),B=new Set(b);console.log(a.length,b.length,a.filter(k=>!B.has(k)),b.filter(k=>!A.has(k)))'
```

Expected: os dois números iguais e as duas listas vazias.

- [ ] **Step 2: `src/components/email/channel-choice.tsx`**

```tsx
"use client";

import { useEffect, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Mail, Send } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { disconnectMicrosoftAccount } from "@/app/actions/email-sender-accounts";
import type { SenderAccountView } from "@/lib/email-broadcast/types";

/** Full navigation (not a client route): the API redirects to Microsoft. */
const CONNECT_URL = "/api/email/microsoft/connect";

type ConnectError = "cancelled" | "admin_required" | "not_configured" | "failed";

/** "Novo e-mail" first step: platform or the company's Microsoft mailbox (spec 2026-10-15 §7). */
export function ChannelChoice({
  account,
  quotaLimit,
  connected,
  error,
}: {
  account: SenderAccountView | null;
  quotaLimit: number;
  connected: boolean;
  error: ConnectError | null;
}) {
  const t = useTranslations("emailBroadcast");
  const format = useFormatter();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, start] = useTransition();

  // The callback's result arrives in the query string: say it once, then clean the URL.
  useEffect(() => {
    if (!connected && !error) return;
    if (connected) toast(t("channel.connectedToast"));
    else if (error) toast(t(`channel.error.${error}`), { variant: "error" });
    router.replace("/app/email/new");
  }, [connected, error, toast, t, router]);

  async function onSwitch() {
    if (!account) return;
    const ok = await confirm({
      description: t("channel.switchConfirm", { email: account.email }),
      confirmLabel: t("channel.switchConfirmLabel"),
    });
    if (ok) window.location.href = CONNECT_URL;
  }

  async function onDisconnect() {
    if (!account) return;
    const ok = await confirm({
      description: t("channel.disconnectConfirm", { email: account.email }),
      confirmLabel: t("channel.disconnect"),
      variant: "danger",
    });
    if (!ok) return;
    start(async () => {
      const r = await disconnectMicrosoftAccount();
      if (r.ok) toast(t("channel.disconnected"));
      else toast(t("error.unknown"), { variant: "error" });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t("channel.title")}</p>
      <div className="grid max-w-5xl gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-muted">
              <Send className="size-5" aria-hidden="true" />
            </span>
            <h2 className="text-lg font-semibold">{t("channel.platformTitle")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("channel.platformBody")}</p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            <li>{t("channel.platformPoint1")}</li>
            <li>{t("channel.platformPoint2", { limit: format.number(quotaLimit) })}</li>
            <li>{t("channel.platformPoint3")}</li>
          </ul>
          <div className="mt-auto">
            <Link href="/app/email/new?via=platform" className={buttonVariants({ variant: "outline" })}>
              {t("channel.platformContinue")}
            </Link>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-muted">
              <Mail className="size-5" aria-hidden="true" />
            </span>
            <h2 className="text-lg font-semibold">{t("channel.microsoftTitle")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("channel.microsoftBody")}</p>

          {!account ? (
            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
              <p className="text-sm font-medium">{t("channel.noneTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("channel.noneBody")}</p>
              <p className="text-xs text-muted-foreground">{t("channel.consentNote")}</p>
              <div>
                <a href={CONNECT_URL} className={buttonVariants()}>
                  {t("channel.connect")}
                </a>
              </div>
            </div>
          ) : account.status === "NEEDS_RECONNECT" ? (
            <div className="flex flex-col gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <p className="text-sm font-medium">{t("channel.reconnectTitle", { email: account.email })}</p>
              <p className="text-sm">{t("channel.reconnectBody")}</p>
              <div>
                <a href={CONNECT_URL} className={buttonVariants()}>
                  {t("channel.reconnect")}
                </a>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{account.displayName ?? account.email}</p>
                  <p className="truncate text-sm text-muted-foreground">{account.email}</p>
                </div>
                <span className="ml-auto rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                  {t("channel.connected")}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border bg-card px-2.5 py-1">
                  {account.accountKind === "personal" ? t("channel.kindPersonal") : t("channel.kindWork")}
                </span>
                <span className="rounded-full border border-border bg-card px-2.5 py-1">
                  {t("channel.dailyLimit", { count: format.number(account.dailyLimit) })}
                </span>
                <span className="rounded-full border border-border bg-card px-2.5 py-1">
                  {t("channel.sent24h", { count: format.number(account.sentLast24h) })}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/app/email/new?via=microsoft" className={buttonVariants()}>
                  {t("channel.use")}
                </Link>
                <Button type="button" variant="outline" disabled={busy} onClick={onSwitch}>
                  {t("channel.switch")}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={onDisconnect}>
                  {t("channel.disconnect")}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
```

Antes de usar, confira em `src/components/ui/button.tsx` que `buttonVariants` aceita `{ variant: "outline" }`. Se a assinatura for outra, siga o uso de `src/app/[locale]/app/email/page.tsx`.

- [ ] **Step 3: `src/app/[locale]/app/email/new/page.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { emailComposerData } from "@/lib/queries/email-broadcasts";
import { EMPTY_AUDIENCE } from "@/lib/validations/email-broadcast";
import { EmailComposer } from "@/components/email/email-composer";
import { ChannelChoice } from "@/components/email/channel-choice";
import { LIMITS } from "@/config/limits";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const CONNECT_ERRORS = ["cancelled", "admin_required", "not_configured", "failed"] as const;
type ConnectError = (typeof CONNECT_ERRORS)[number];

export default async function NewEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ via?: string; microsoft?: string; microsoft_error?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const sp = await searchParams;
  const data = await emailComposerData(ctx.organizationId);

  // Without the Microsoft app configured there is nothing to choose: straight to the platform composer.
  const via = !data.microsoftConfigured ? "platform" : sp.via === "platform" || sp.via === "microsoft" ? sp.via : null;
  if (via === "microsoft" && data.microsoft?.status !== "ACTIVE") redirect({ href: "/app/email/new", locale });
  const error = (CONNECT_ERRORS as readonly string[]).includes(sp.microsoft_error ?? "")
    ? (sp.microsoft_error as ConnectError)
    : null;

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
        {via ? <p className="mt-1 text-muted-foreground">{t("composerSubtitle")}</p> : null}
      </div>
      {via === null ? (
        <ChannelChoice
          account={data.microsoft}
          quotaLimit={LIMITS.emailBroadcastQuotaPerMonth}
          connected={sp.microsoft === "connected"}
          error={error}
        />
      ) : (
        <EmailComposer
          draft={{
            id: null,
            subject: "",
            html: "",
            fromName: ctx.organization.name,
            fromEmail: "",
            replyTo: "",
            audience: EMPTY_AUDIENCE,
            picked: [],
            attachments: [],
            signatureId: data.signatures.find((s) => s.isDefault)?.id ?? null,
            channel: via === "microsoft" ? "MICROSOFT" : "PLATFORM",
          }}
          options={data.options}
          allowedDomains={data.allowedDomains}
          quota={data.quota}
          signatures={data.signatures}
          microsoft={data.microsoft}
        />
      )}
    </div>
  );
}
```

Em `src/app/[locale]/app/email/[id]/edit/page.tsx`, acrescente `channel: b.channel,` ao `draft` e `microsoft={data.microsoft}` ao `EmailComposer`.

- [ ] **Step 4: Formulário (`src/components/email/email-composer.tsx`)**

1. Imports: `import { microsoftSendMinutes } from "@/lib/email-broadcast/microsoft/core";` e `SenderAccountView` no import de tipos de `@/lib/email-broadcast/types`.
2. Prop nova `microsoft: SenderAccountView | null` na assinatura e no tipo das props.
3. Logo depois de `const imageSupport = useEmailImageSupport();`:

```ts
  const isMicrosoft = draft.channel === "MICROSOFT";
  const microsoftReady = isMicrosoft && microsoft?.status === "ACTIVE";
  const noDomains = !isMicrosoft && allowedDomains.length === 0;
  const fromAllowed = isMicrosoft || isSenderAllowed(fromEmail, allowedDomains);
  const fromProblem = !isMicrosoft && fromEmail.trim() !== "" && !fromAllowed;
```

Apague as três linhas antigas de `noDomains`, `fromAllowed` e `fromProblem`.

4. `payload` ganha `channel: draft.channel,`.
5. Em `onSend`, no começo do `guarded`:

```ts
      if (isMicrosoft && !microsoftReady) {
        toast(t("error.sender_account_reconnect"), { variant: "error" });
        return;
      }
```

O `if (!fromAllowed)` que já existe continua (para a Microsoft ele é sempre verdadeiro).

6. Troque o cálculo de `timing` e a `description` do `confirm` por:

```ts
      const minutes = estimateAttachmentSendMinutes(s.total);
      const timing =
        isMicrosoft || attachments.length === 0
          ? ""
          : ` ${minutes === 0 ? t("confirmAttachmentsQuick") : t("confirmAttachments", { minutes })}`;
      const nowCount = microsoft ? Math.min(s.total, microsoft.remaining) : s.total;
      const microsoftText =
        isMicrosoft && microsoft
          ? ` ${[
              s.total > microsoft.remaining
                ? t("confirmMicrosoftPartial", {
                    now: nowCount,
                    total: s.total,
                    limit: microsoft.dailyLimit,
                    sent: microsoft.sentLast24h,
                  })
                : t("confirmMicrosoftAll", { total: s.total }),
              t("confirmMicrosoftPace", { minutes: microsoftSendMinutes(nowCount) }),
              t("confirmMicrosoftSentItems", { email: microsoft.email }),
            ].join(" ")}`
          : "";
      const ok = await confirm({
        title: t("confirmTitle", { count: s.total }),
        description:
          t("confirmBody", {
            subject: subject || t("noSubject"),
            duplicates: s.duplicates,
            suppressed: s.suppressed,
            invalid: s.invalid,
          }) +
          timing +
          microsoftText,
        confirmLabel: t("confirmSend", { count: s.total }),
      });
```

7. Troque o bloco `<div className="grid gap-4 sm:grid-cols-2">…</div>` dos campos de remetente por:

```tsx
        {isMicrosoft ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{t("fromMicrosoft")}</span>
              <Link href="/app/email/new" className="text-sm font-medium text-brand hover:underline">
                {t("switchChannel")}
              </Link>
            </div>
            {microsoft ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  {microsoft.displayName ? `${microsoft.displayName} <${microsoft.email}>` : microsoft.email}
                </span>
                <span className="ml-auto rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
                  {t("microsoftChip")}
                </span>
              </div>
            ) : null}
            {microsoftReady ? (
              <p className="text-xs text-muted-foreground">{t("fromMicrosoftHint")}</p>
            ) : (
              <p className="text-xs text-red-600">{t("microsoftMissing")}</p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* the existing fromName + fromEmail fields, unchanged */}
          </div>
        )}
```

O bloco do `else` recebe **sem mudança** os dois `<div>` de "Nome do remetente" e "Endereço de envio" que já existem.

8. No botão de enviar, o `disabled` ganha `|| (isMicrosoft && !microsoftReady)`.

- [ ] **Step 5: Verificar e commit**

Run: `npm run typecheck && npx eslint src scripts` e a paridade do Step 1.
Expected: sem erros; paridade igual.

```bash
git add src/components/email/channel-choice.tsx src/components/email/email-composer.tsx "src/app/[locale]/app/email/new/page.tsx" "src/app/[locale]/app/email/[id]/edit/page.tsx" src/messages/pt.json src/messages/en.json
git commit -m "[E-mail] - Adiciona a escolha do canal e o formulario pela conta Microsoft" -m "Novo e-mail pergunta plataforma ou conta Microsoft (conectar, trocar, desconectar, reconectar); o formulario mostra o remetente fixo e a confirmacao traz a estimativa do dia, o ritmo e Itens enviados." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Motivo em vermelho na lista e no relatório

**Files:**
- Modify: `src/app/[locale]/app/email/page.tsx`, `src/app/[locale]/app/email/[id]/page.tsx`, `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consome: `listReason`, `pausedReasonKey` e `recipientFailure` (Task 2); `listEmailBroadcasts` e `getEmailBroadcast` com canal (Task 8).

- [ ] **Step 1: Textos (pt e en)**

Em `emailBroadcast`:

| Chave | pt | en |
|---|---|---|
| `paused.daily_limit` | Envio pausado: o limite diário da conta Microsoft foi atingido. Clique em “Retomar envio” amanhã para continuar até o próximo limite. | Send paused: the Microsoft account's daily limit was reached. Click “Resume send” tomorrow to continue up to the next limit. |
| `paused.reconnect` | Envio pausado: a conta Microsoft precisa ser reconectada (em Novo e-mail). Depois, clique em “Retomar envio”. | Send paused: the Microsoft account needs to be reconnected (in New e-mail). Then click “Resume send”. |
| `paused.no_sender_account` | Envio pausado: a conta Microsoft foi desconectada ou trocada. Conecte uma conta e clique em “Retomar envio”. | Send paused: the Microsoft account was disconnected or switched. Connect an account and click “Resume send”. |
| `paused.account_blocked` | Envio pausado: a Microsoft bloqueou o envio por esta caixa (pode ter sido considerado spam). Verifique a conta na Microsoft antes de retomar. | Send paused: Microsoft blocked sending from this mailbox (it may have been flagged as spam). Check the account with Microsoft before resuming. |
| `listReason.paused.no_connection` | Pausado: o envio da plataforma não está configurado. | Paused: platform sending isn't set up. |
| `listReason.paused.quota` | Pausado: cota mensal da plataforma atingida. | Paused: the platform's monthly quota was reached. |
| `listReason.paused.provider_error` | Pausado: o provedor recusou o envio. | Paused: the provider refused the send. |
| `listReason.paused.domain_not_allowed` | Pausado: o domínio de envio não está mais liberado. | Paused: the sending domain is no longer enabled. |
| `listReason.paused.from_missing` | Pausado: envio antigo sem endereço de envio. | Paused: an old send without a sender address. |
| `listReason.paused.attachment_unavailable` | Pausado: um anexo não pôde ser carregado. | Paused: an attachment couldn't be loaded. |
| `listReason.paused.attachment_invalid` | Pausado: anexos inválidos. | Paused: invalid attachments. |
| `listReason.paused.daily_limit` | Pausado: limite diário da conta Microsoft atingido. Retome amanhã. | Paused: the Microsoft account's daily limit was reached. Resume tomorrow. |
| `listReason.paused.reconnect` | Pausado: a conta Microsoft precisa ser reconectada. | Paused: the Microsoft account needs to be reconnected. |
| `listReason.paused.no_sender_account` | Pausado: a conta Microsoft foi desconectada. | Paused: the Microsoft account was disconnected. |
| `listReason.paused.account_blocked` | Pausado: a Microsoft bloqueou o envio por esta caixa. | Paused: Microsoft blocked sending from this mailbox. |
| `listReason.failed` | {count, plural, one {# falha} other {# falhas}} | {count, plural, one {# failure} other {# failures}} |
| `listReason.uncertain` | {count, plural, one {# com situação incerta} other {# com situação incerta}} | {count, plural, one {# uncertain} other {# uncertain}} |
| `failure.invalid_address` | Endereço recusado: o e-mail do destinatário é inválido. | Address refused: the recipient's e-mail is invalid. |
| `failure.message_too_large` | O e-mail ficou grande demais para a Microsoft. | The e-mail was too large for Microsoft. |
| `failure.interrupted` | Situação incerta: o envio foi interrompido antes da confirmação. Não reenviamos, para não duplicar. | Uncertain: the send was interrupted before confirmation. We didn't resend it, to avoid duplicates. |
| `failure.generic` | Falha ao enviar para este endereço. | Failed to send to this address. |
| `report.filter.uncertain` | Situação incerta | Uncertain |
| `report.viaMicrosoft` | Enviado pela conta Microsoft {email} | Sent through the Microsoft account {email} |
| `report.noTrackingMicrosoft` | A Microsoft não avisa entrega nem abertura: aqui aparecem só os enviados e as falhas. Devoluções de endereço inexistente chegam na própria caixa, como resposta automática do Outlook. | Microsoft doesn't report delivery or opens: this shows only what was sent and what failed. Bounces for unknown addresses arrive in the mailbox itself, as Outlook auto-replies. |
| `col.from` | De | From |
| `col.channelPlatform` | Plataforma | Platform |
| `col.channelMicrosoft` | Conta Microsoft | Microsoft account |

Confira a paridade com o comando da Task 9.

- [ ] **Step 2: Lista (`src/app/[locale]/app/email/page.tsx`)**

1. Import: `import { listReason } from "@/lib/email-broadcast/failure-reason";`.
2. No `thead`, depois da coluna de assunto: `<th className="px-5 py-3 font-medium">{t("col.from")}</th>`.
3. No `map`, logo depois de `const when = …`: `const reason = listReason({ status: r.status, pausedReason: r.pausedReason, problems: r.problems, uncertain: r.uncertain });` e `const microsoft = r.channel === "MICROSOFT";`.
4. Depois da célula do assunto:

```tsx
                    <td className="px-5 py-3">
                      <div className="max-w-56 truncate">{r.fromEmail ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {microsoft ? t("col.channelMicrosoft") : t("col.channelPlatform")}
                      </div>
                    </td>
```

5. A célula de status passa a ser:

```tsx
                    <td className="px-5 py-3">
                      <StatusBadge status={r.status} label={t(`status.${r.status}`)} />
                      {reason?.kind === "paused" ? (
                        <div className="mt-1 max-w-xs text-xs text-red-600">{t(`listReason.paused.${reason.reason}`)}</div>
                      ) : null}
                      {reason?.kind === "problems" ? (
                        <div className="mt-1 max-w-xs text-xs text-red-600">
                          {[
                            reason.failed ? t("listReason.failed", { count: reason.failed }) : null,
                            reason.uncertain ? t("listReason.uncertain", { count: reason.uncertain }) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      ) : null}
                    </td>
```

6. A coluna "Entregues" mostra "—" também para a Microsoft: `{isDraft || microsoft ? "—" : format.number(r.delivered)}`.

- [ ] **Step 3: Relatório (`src/app/[locale]/app/email/[id]/page.tsx`)**

1. Import: `import { pausedReasonKey, recipientFailure } from "@/lib/email-broadcast/failure-reason";`.
2. Troque `FILTERS`, `COUNTER_ORDER` e `BAR_COLORS` por:

```ts
const PLATFORM_FILTERS: ReportFilter[] = ["all", "queued", "sent", "delivered", "problems"];
const MICROSOFT_FILTERS: ReportFilter[] = ["all", "queued", "sent", "problems", "uncertain"];
const PLATFORM_COUNTERS = ["QUEUED", "SENT", "DELIVERED", "BOUNCED", "COMPLAINED", "FAILED"] as const;
const MICROSOFT_COUNTERS = ["QUEUED", "SENT", "FAILED", "UNCERTAIN"] as const;
type Counter = (typeof PLATFORM_COUNTERS)[number] | (typeof MICROSOFT_COUNTERS)[number];
const BAR_COLORS: Record<Counter, string> = {
  QUEUED: "bg-transparent",
  SENT: "bg-blue-500",
  DELIVERED: "bg-green-600",
  BOUNCED: "bg-red-600",
  COMPLAINED: "bg-amber-600",
  FAILED: "bg-red-400",
  UNCERTAIN: "bg-amber-500",
};
```

3. Depois de `if (b.status === "DRAFT") redirect(…)`:

```ts
  const microsoft = b.channel === "MICROSOFT";
  const FILTERS = microsoft ? MICROSOFT_FILTERS : PLATFORM_FILTERS;
  const COUNTERS: readonly Counter[] = microsoft ? MICROSOFT_COUNTERS : PLATFORM_COUNTERS;
```

As linhas de `requested`/`filter` continuam usando `FILTERS`.

4. Os totais passam a ser:

```ts
  // SENDING is a recipient in flight: shown inside "Na fila".
  const shown = (s: Counter) => (s === "QUEUED" ? counts.QUEUED + counts.SENDING : counts[s]);
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  const processed = total - counts.QUEUED - counts.SENDING;
```

E `filterCount`:

```ts
  const filterCount: Record<ReportFilter, number> = {
    all: total,
    queued: counts.QUEUED + counts.SENDING,
    sent: counts.SENT,
    delivered: counts.DELIVERED,
    problems: counts.BOUNCED + counts.COMPLAINED + counts.FAILED,
    uncertain: counts.UNCERTAIN,
  };
```

5. Embaixo do título (depois do parágrafo de `report.started`):

```tsx
          {microsoft && b.fromEmail ? (
            <p className="mt-1 text-sm text-muted-foreground">{t("report.viaMicrosoft", { email: b.fromEmail })}</p>
          ) : null}
```

6. A faixa de pausa vira vermelha e usa o motivo traduzido:

```tsx
      {b.status === "PAUSED" && b.pausedReason ? (
        <p className="rounded-xl border border-red-300 bg-red-50 px-5 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {t(`paused.${pausedReasonKey(b.pausedReason)}`)}
          {b.lastError ? <span title={b.lastError}> ({b.lastError.slice(0, 160)})</span> : null}
        </p>
      ) : null}
```

7. O aviso de rastreio:

```tsx
      {microsoft ? (
        <p className="text-sm text-muted-foreground">{t("report.noTrackingMicrosoft")}</p>
      ) : !deliveryTrackingConfigured() ? (
        <p className="text-sm text-muted-foreground">{t("report.noTracking")}</p>
      ) : null}
```

8. A barra e os contadores usam `COUNTERS` e `shown(s)` no lugar de `COUNTER_ORDER` e `counts[s]`. A grade de contadores passa a usar `className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", microsoft ? "lg:grid-cols-4" : "lg:grid-cols-6")}`.
9. Na tabela, a linha do erro passa a ser:

```tsx
                    {(() => {
                      const failure = recipientFailure(r.error);
                      return failure ? (
                        <div title={failure.technical} className="mt-1 max-w-sm text-xs text-red-600">
                          {t(`failure.${failure.key}`)}
                        </div>
                      ) : null;
                    })()}
```

- [ ] **Step 4: Verificar e commit**

Run: `npm run typecheck && npx eslint src scripts`, mais a paridade.
Expected: sem erros; paridade igual.

```bash
git add "src/app/[locale]/app/email/page.tsx" "src/app/[locale]/app/email/[id]/page.tsx" src/messages/pt.json src/messages/en.json
git commit -m "[E-mail] - Mostra o motivo em vermelho na lista e no relatorio" -m "Lista ganha remetente e canal e a linha vermelha com o motivo (pausa, falhas, situacao incerta); relatorio separa os contadores da Microsoft, traduz o motivo de cada destinatario e deixa a faixa de pausa vermelha, nos dois canais." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Documentação, verificação completa e teste de ponta a ponta

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/guia/04-modulos-e-permissoes.md`, `docs/superpowers/specs/2026-10-15-email-conta-microsoft-design.md` (só se algo mudou)

- [ ] **Step 1: README**
  - Na descrição do E-mail em massa (bullet "**E-mail em massa (submenu E-mail):**"), acrescente:
    > Envio pela conta Microsoft (spec 2026-10-15): cada empresa conecta uma caixa Outlook/Microsoft 365 (`email_sender_accounts`, uma por empresa; rotas `/api/email/microsoft/*`, app "MetodoIA" no Entra, `MICROSOFT_MAIL_CLIENT_*`). "Novo e-mail" pergunta o canal. Pela Microsoft, o despachante monta MIME (`nodemailer` só como montador) e envia por `sendMail` ou por rascunho + anexos (`Mail.ReadWrite`). O ritmo é de ~28/min por caixa e há um limite diário estimado (300 no Outlook pessoal, 10.000 no Microsoft 365), com pausa e "Retomar envio". Cada destinatário é reservado antes da chamada, e o que sobra numa queda vira "Situação incerta", sem reenvio. Envios pela Microsoft não contam na cota da plataforma nem têm rastreio de entrega/abertura.
  - No runbook §8, a entrada **"Antes do merge da branch `feature/email-conta-microsoft`"**:
    1. Aplicar no Supabase `prisma/migrations/20261015120000_email_sender_accounts/migration.sql` com `prisma db execute --file … --schema prisma/schema.prisma` e depois `prisma migrate resolve --applied 20261015120000_email_sender_accounts`. É aditiva: tabela nova, duas colunas com padrão, dois valores de enum e FK `SET NULL`. **Não** use `migrate deploy`.
    2. Pôr `MICROSOFT_MAIL_CLIENT_ID` e `MICROSOFT_MAIL_CLIENT_SECRET` no hPanel.
    3. O retorno de produção (`https://metodotia.com/api/email/microsoft/callback`) já está cadastrado no app.
  - Ainda no §8, o bloco **"Segredo do app Microsoft do E-mail"**: o segredo "Envio de e-mail 2026-10-15" vence em **14/10/2028**. Para trocar: Azure → Registros de aplicativo → MetodoIA → Certificados e segredos → Novo segredo; atualizar `.env` e hPanel; apagar o antigo. Sem troca, todas as contas passam a "precisa reconectar".

- [ ] **Step 2: Contagem de chaves**

Rode o comando de paridade da Task 9 e grave o número em `CLAUDE.md` ("chaves (N hoje)") e no guia 04 ("**N chaves-folha cada um**").

- [ ] **Step 3: As validações**

Pare o `next dev`, depois rode:

```bash
npm run typecheck && npx eslint src scripts && npm run build && npm run check:isolation && npm run check:node && npm run check:email && npm run check:tasks && npm run check:search
```

Expected: tudo passa. O lint do repositório inteiro pode estar poluído por `.claude/worktrees/`, por isso o comando usa `npx eslint src scripts`. Os 4 avisos de lint conhecidos continuam os mesmos.

Commit da documentação:

```bash
git add README.md CLAUDE.md docs/guia/04-modulos-e-permissoes.md
git commit -m "[E-mail] - Documenta o envio pela conta Microsoft" -m "README (funcionalidade, runbook da migration, variaveis e vencimento do segredo) e contagem de chaves." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Preparar o teste real (com o usuário)**
  - Suba o `npx next dev --webpack -p 3000`.
  - Peça ao usuário:
    - os endereços de destino que ele autoriza para os envios de teste (2 ou 3 caixas dele);
    - que ele mesmo faça o login na Microsoft quando a tela pedir. Senha e MFA são dele.
  - No navegador (aba própria, conferindo `location.href` antes de cada ação), em `localhost:3000/app/email/new`:
    - o cartão da Microsoft aparece;
    - "Conectar conta Microsoft" leva à Microsoft;
    - ao voltar, aparece "Conta Microsoft conectada." e o cartão mostra o endereço, o tipo e o limite.
  - Confira no banco local que `email_sender_accounts` tem uma linha com `credentials` criptografado (não é JSON legível).

- [ ] **Step 5: Envio pequeno e envio com anexo grande**
  - Monte um e-mail pela conta Microsoft com 2 destinatários autorizados, assinatura e texto com acento. Confirme e confira:
    - a confirmação mostra "Todos os 2 destinatários recebem agora", o ritmo e "Itens enviados";
    - o relatório chega a 2 "Enviados";
    - o usuário confirma que recebeu, com remetente, acentos e assinatura certos e o link de descadastro funcionando, e que os dois aparecem em "Itens enviados" da caixa.
  - Duplique o envio, anexe um PDF de ~8 MB e envie para 1 destinatário. Confira:
    - o envio vai pelo caminho de rascunho e o relatório mostra "Enviado";
    - o anexo chega inteiro;
    - não sobra rascunho na pasta "Rascunhos" da caixa.

- [ ] **Step 6: Token vencido**

No banco local, force o vencimento do token, sem imprimir as credenciais:

```bash
npx tsx --env-file=.env -e '...'
```

O script lê a linha, abre com `decryptCredentials`, troca `expiresAt` para 1 hora atrás, grava de novo com `encryptCredentials` e imprime só "ok". Depois envie um e-mail para 1 destinatário e confira:
- o envio sai normalmente;
- `credentials` mudou, porque houve renovação;
- o status continua `ACTIVE`.

- [ ] **Step 7: Queda no meio do envio**

No banco local, crie um envio Microsoft `SENDING` com um destinatário já em `SENDING` (simulando a queda). Chame "Retomar envio" e confira:
- esse destinatário vira `UNCERTAIN`, com o motivo "Situação incerta…" no relatório e na lista;
- ele **não** recebe o e-mail; o usuário confirma.

- [ ] **Step 8: Limite diário, desconectar e trocar**
  - **Limite:** com `LIMITS.microsoftDailyPersonal` ou `microsoftDailyWork` temporariamente igual a 1 (só local, sem commit), envie para 2 destinatários e confira:
    - 1 vai;
    - o envio pausa com a linha vermelha "Pausado: limite diário da conta Microsoft atingido. Retome amanhã." na lista e a faixa vermelha no relatório.
    
    Volte o limite ao valor original.
  - **Desconectar:** com um envio pausado, desconecte a conta na tela de escolha (com confirmação). "Retomar envio" responde "Conecte uma conta Microsoft para enviar por ela.".
  - **Reconectar:** conecte de novo e retome. O envio continua pela conta conectada.
  - **Empresa sem conta:** em outra empresa, sem conta conectada, abra um rascunho Microsoft (canal forçado no banco). O formulário mostra o aviso vermelho e o botão de enviar fica desabilitado.

- [ ] **Step 9: Limpeza e relatório**
  - Apague do banco local os envios e a conta de teste, se o usuário quiser, e confirme que nada de teste ficou em produção (o teste é só local).
  - Reporte ao usuário:
    - o que passou e o que falhou;
    - os hashes dos commits;
    - o lembrete de que a migration vai para o Supabase **antes** do merge e as duas variáveis vão para o hPanel.

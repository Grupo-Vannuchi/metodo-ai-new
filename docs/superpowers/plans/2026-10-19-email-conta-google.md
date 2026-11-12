# Envio pela conta Google — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A empresa conecta a conta Google (Gmail pessoal ou Google Workspace) e envia por ela os e-mails em massa, ao lado da plataforma e da conta Microsoft, com as mesmas garantias.

**Architecture:**
- **Regras comuns:** as regras que valem para qualquer caixa saem de `microsoft/` para `mailbox/` e servem aos dois provedores:
  - limite de 24 h, ritmo, endereço do site;
  - renovação do acesso;
  - laço de envio "ninguém recebe duas vezes".
- **Adaptador por provedor:** cada provedor contribui só o que é dele: enviar um e-mail, classificar a falha, limite diário, formato do erro do destinatário. O Google entra como um novo adaptador sobre o Gmail API (upload `message/rfc822`, simples até 5 MiB e retomável acima).
- **Banco:** a conta passa a ser única por `(empresa, provedor)`.
- **Telas:** ganham o terceiro canal.
- **Liberação:** só para as empresas do piloto até a aprovação da Google.

**Tech Stack:** Next.js 16 (App Router, server actions, route handlers), Prisma 6 + PostgreSQL (Docker local, Supabase em produção), next-intl 4, zod 3, arctic 3.7 (`Google`), Gmail API v1, nodemailer 10 (só `MailComposer`), tsx.

**Spec:** [docs/superpowers/specs/2026-10-19-email-conta-google-design.md](../specs/2026-10-19-email-conta-google-design.md). Base: [spec da Microsoft](../specs/2026-10-15-email-conta-microsoft-design.md) e o código atual em `src/lib/email-broadcast/microsoft/`.

## Global Constraints

- **Arquivos proibidos (só importar, nunca alterar):** `src/lib/oauth/**`, `src/app/api/auth/**` (o "Entrar com Google" usa outro projeto e `GOOGLE_CLIENT_*`), `src/lib/integrations/**`, `src/components/auth/provider-mark.tsx`, `src/components/proposals/rich-text-editor.tsx`. Campanhas e e-mail transacional não mudam.
- **Multi-tenant (guia 03):**
  - em request de usuário, use `tenantDb(orgId)`; por id, `findFirst` + `updateMany`/`deleteMany`;
  - nunca `findUnique`/`update`/`delete`/`upsert` em tabela de negócio;
  - o despachante e a renovação de acesso são contexto de sistema: Prisma cru, com `organizationId` explícito.
- **Banco local = Docker** (`metodoai-db`). **Nunca** `prisma migrate dev`, `migrate reset` ou `db push`.
- **i18n:** `pt.json` e `en.json` com as mesmas chaves, sem `{{`; hoje são **2991** de cada lado. A contagem final vai para `CLAUDE.md` e para o guia 04 (Task 10).
- **Env:** só via `src/lib/env.ts`. Variáveis novas, opcionais:
  - `GOOGLE_MAIL_CLIENT_ID` e `GOOGLE_MAIL_CLIENT_SECRET`;
  - `GOOGLE_MAIL_PILOT_ORG_IDS`: ids de empresa separados por vírgula; vazia = todas as empresas.
- **Números e nomes fixos (da spec):**
  - `LIMITS.googleDailyPersonal = 500`, `LIMITS.googleDailyWork = 2_000`;
  - ritmo `MAILBOX_PACE_MS = 2_100` (o mesmo da Microsoft);
  - upload simples até `GMAIL_SIMPLE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024`; acima, retomável.
- **Escopos:** `openid`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/userinfo.profile`, `https://www.googleapis.com/auth/gmail.send`. **Nunca** pedir escopo de leitura.
- **Conexão (rotas e cookies):**
  - rotas `/api/email/google/connect` e `/api/email/google/callback`;
  - cookies `gg_mail_state`, `gg_mail_verifier`, `gg_mail_org` (10 min);
  - na autorização, `access_type=offline` e `prompt=consent select_account`.
- **Conta e erros de conexão:**
  - **Uma conta por provedor por empresa:** `@@unique([organizationId, provider])`.
  - **Tipo de conta:** `hd` presente = `work`; ausente = `personal`.
  - **Sem Gmail:** conta sem `hd` e com endereço fora de `gmail.com`/`googlemail.com` é recusada (`no_gmail`).
  - **Códigos de erro da conexão:** `cancelled`, `admin_required`, `missing_send`, `no_gmail`, `not_configured`, `failed`.
- **Ninguém recebe duas vezes:** na chamada de entrega (POST simples, ou o PUT do retomável), status 0 ou ≥ 500 exceto 503 → `UNCERTAIN`, sem reenvio. Um laço de envio só para os dois provedores; nada de copiar o laço.
- **Envios pelo Google:** não contam na cota mensal da plataforma e não têm rastreio de entrega ou abertura.
- **Commits:** `[E-mail] - Verbo + tarefa`, corpo curto, última linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feature/email-conta-google`, **sem push** até o fim.
- **Servidor de dev:** não subir `next dev` nas tarefas; parar qualquer um antes de `npm run build`.
- **Ambiente:**
  - Node 20;
  - regras puras em ASCII;
  - lint com `npx eslint src scripts` (o `npm run lint` inteiro pega `.claude/worktrees/`).
- **Nada de chamadas reais ao Google ou à Microsoft nas tarefas.** O teste real é feito depois, com o usuário (seção 11 da spec).

## Review Focus

1. **Empresa com conta Microsoft e conta Google:** um envio Google nunca sai pela conta Microsoft, nem o contrário.
   - Teste: caso novo no `check:isolation` (Task 3).
   - Regra: o laço confere `provider` da conta igual ao canal do envio (Task 7).
2. **Conta Google sem Gmail, ou com o Gmail desligado depois de conectada:** recusa clara na conexão; no envio, pausa sem marcar destinatários como falha.
   - Testes: `googleHasGmail` e `gmailFailureAction(400, "failedPrecondition", …)` no `check:email` (Task 1).
3. **Conexão de teste do Google vence em 7 dias, senha trocada ou acesso revogado:** a conta vira "precisa reconectar" e o envio pausa com o motivo certo, sem ficar repetindo.
   - Teste: `isReconnectCode` no `check:email` (Task 1).
   - Uso na renovação (Task 4).
4. **Empresa fora do piloto:** não vê o Google em lugar nenhum e não consegue conectar nem enviar, nem montando a URL à mão.
   - Testes: `pilotAllows` e `listChannelFromParam` com Google indisponível (Tasks 1 e 2).
   - Bloqueio nas rotas e nas actions (Tasks 5 e 8).
5. **Anexo grande (~8 MB):** vai pelo upload retomável, e uma queda na entrega não reenvia.
   - Testes: `gmailUploadMode` e `gmailFailureAction(0 | 500, …, "send")` (Task 1).
   - Etapas do envio (Task 6).

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/email-broadcast/mailbox/core.ts` (novo, puro) | regras comuns: 24 h, ritmo, `joinSiteUrl`, tipos do resultado do envio e da ação de falha, `isReconnectCode` |
| `src/lib/email-broadcast/mailbox/token.ts` (novo; substitui `microsoft/token.ts`) | credenciais e renovação do acesso de qualquer provedor |
| `src/lib/email-broadcast/mailbox/deliver.ts` (novo; substitui `microsoft/deliver.ts`) | laço "ninguém recebe duas vezes" + `markInterruptedUncertain` |
| `src/lib/email-broadcast/microsoft/adapter.ts` (novo) | adaptador Microsoft |
| `src/lib/email-broadcast/google/core.ts` (novo, puro) | regras do Google |
| `src/lib/email-broadcast/google/oauth.ts`, `accounts.ts`, `gmail.ts`, `send.ts`, `adapter.ts` (novos) | conexão, gravação da conta, chamadas ao Gmail, envio de um e-mail, adaptador |
| `src/app/api/email/google/connect/route.ts`, `callback/route.ts` (novos) | rotas OAuth |
| `src/components/email/sender-account-panel.tsx` (renomeia `microsoft-account-panel.tsx`) | painel da conta, por provedor |

---

### Task 1: Regras comuns das caixas e regras puras do Google

**Files:**
- Create: `src/lib/email-broadcast/mailbox/core.ts`, `src/lib/email-broadcast/google/core.ts`
- Modify:
  - `src/lib/email-broadcast/microsoft/core.ts` (tirar o que mudou de casa; `GraphFailureAction` vira alias de `MailboxFailureAction`);
  - quem importava as regras movidas: `microsoft/oauth.ts`, `microsoft/deliver.ts`, `src/lib/queries/email-sender-accounts.ts`, `src/components/email/email-composer.tsx`, `src/app/api/email/microsoft/connect/route.ts`, `src/app/api/email/microsoft/callback/route.ts`;
  - `src/config/limits.ts`, `docs/guia/04-modulos-e-permissoes.md`, `scripts/check-email-broadcast.ts`.

**Interfaces:**
- Produces, em `mailbox/core.ts`:
  - `remainingToday(limit: number, used: number): number` e `sentLast24hWhere(accountId: string, now: Date)`, movidos sem mudança;
  - `joinSiteUrl(base: string, path: string): string`, movido sem mudança;
  - `MAILBOX_PACE_MS = 2_100` (era `MICROSOFT_PACE_MS`) e `mailboxSendMinutes(count: number): number` (era `microsoftSendMinutes`), mesma regra;
  - `type MailboxFailureAction = "refresh" | "retry" | "uncertain" | "recipient" | "daily_limit" | "blocked" | "reconnect" | "pause"`;
  - `type MailboxSendFailure = { ok: false; status: number; code: string | null; message: string; retryAfter: number | null; stage: "prepare" | "send" }` e `type MailboxSendOutcome = { ok: true } | MailboxSendFailure`;
  - `isReconnectCode(code: string): boolean`: `invalid_grant`, `interaction_required`, `consent_required`, `admin_policy_enforced`.
- Produces, em `google/core.ts`:
  - `GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"`;
  - `type GoogleAccountKind = "personal" | "work"`, `googleAccountKind(hd: unknown): GoogleAccountKind`;
  - `googleHasGmail(email: string, hd: unknown): boolean`;
  - `googleGrantedSend(scopes: readonly string[]): boolean`;
  - `googleDailyLimit(kind: string): number`;
  - `GMAIL_SIMPLE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024`, `gmailUploadMode(mimeBytes: number): "simple" | "resumable"`;
  - `gmailFailureAction(status: number, reason: string | null, message: string, attempt: number, stage: "prepare" | "send"): MailboxFailureAction`;
  - `type GoogleConnectError = "cancelled" | "admin_required" | "missing_send" | "no_gmail" | "not_configured" | "failed"`, `googleConsentError(error: string): GoogleConnectError`;
  - `pilotAllows(organizationId: string, pilotList: string | undefined): boolean`.

- [ ] **Step 1: Limites.** Em `src/config/limits.ts`, acrescente ao tipo e ao objeto `googleDailyPersonal: 500` e `googleDailyWork: 2_000`, com comentário "Estimated e-mails per 24 h through a connected Gmail / Google Workspace account". No guia 04, na lista do `limits.ts`, acrescente as duas linhas, ao lado das da Microsoft.

- [ ] **Step 2: Testes que falham** (em `scripts/check-email-broadcast.ts`; imports de `../src/lib/email-broadcast/mailbox/core` e `../src/lib/email-broadcast/google/core`; os testes atuais de `remainingToday`, `sentLast24hWhere`, `microsoftSendMinutes` e `joinSiteUrl` passam a importar de `mailbox/core`, com `microsoftSendMinutes` virando `mailboxSendMinutes`):

```ts
check("isReconnectCode only for refusals a new consent fixes", () => {
  for (const c of ["invalid_grant", "interaction_required", "consent_required", "admin_policy_enforced"]) assert.equal(isReconnectCode(c), true);
  for (const c of ["invalid_client", "server_error", "temporarily_unavailable", ""]) assert.equal(isReconnectCode(c), false);
});

check("googleAccountKind and googleHasGmail read the hosted domain", () => {
  assert.equal(googleAccountKind("nillow.com"), "work");
  assert.equal(googleAccountKind(undefined), "personal");
  assert.equal(googleAccountKind(""), "personal");
  assert.equal(googleHasGmail("ana@gmail.com", undefined), true);
  assert.equal(googleHasGmail("Ana@GoogleMail.com", undefined), true);
  assert.equal(googleHasGmail("contato@nillow.com", "nillow.com"), true);
  assert.equal(googleHasGmail("contato@empresa.com.br", undefined), false);
});

check("googleGrantedSend, googleDailyLimit, gmailUploadMode, pilotAllows", () => {
  assert.equal(googleGrantedSend(["openid", "https://www.googleapis.com/auth/gmail.send"]), true);
  assert.equal(googleGrantedSend(["openid", "https://www.googleapis.com/auth/userinfo.email"]), false);
  assert.equal(googleDailyLimit("personal"), 500);
  assert.equal(googleDailyLimit("work"), 2_000);
  assert.equal(gmailUploadMode(5 * 1024 * 1024), "simple");
  assert.equal(gmailUploadMode(5 * 1024 * 1024 + 1), "resumable");
  assert.equal(pilotAllows("org1", undefined), true);
  assert.equal(pilotAllows("org1", ""), true);
  assert.equal(pilotAllows("org1", " org1 , org2"), true);
  assert.equal(pilotAllows("org3", "org1,org2"), false);
});

check("gmailFailureAction maps Gmail answers to dispatcher moves", () => {
  assert.equal(gmailFailureAction(401, "authError", "", 0, "send"), "refresh");
  assert.equal(gmailFailureAction(401, null, "", 1, "send"), "reconnect");
  assert.equal(gmailFailureAction(429, "rateLimitExceeded", "User-rate limit exceeded (Mail sending)", 0, "send"), "daily_limit");
  assert.equal(gmailFailureAction(429, null, "Too many concurrent requests for user", 0, "send"), "retry");
  assert.equal(gmailFailureAction(403, "userRateLimitExceeded", "", 0, "send"), "retry");
  assert.equal(gmailFailureAction(403, "rateLimitExceeded", "", 5, "send"), "pause");
  assert.equal(gmailFailureAction(403, "domainPolicy", "", 0, "send"), "blocked");
  assert.equal(gmailFailureAction(400, "failedPrecondition", "Mail service not enabled", 0, "send"), "blocked");
  assert.equal(gmailFailureAction(403, "dailyLimitExceeded", "", 0, "send"), "pause");
  assert.equal(gmailFailureAction(403, "insufficientPermissions", "", 0, "send"), "reconnect");
  assert.equal(gmailFailureAction(400, "badRequest", "Invalid To header", 0, "send"), "recipient");
  assert.equal(gmailFailureAction(400, "invalidArgument", "", 0, "send"), "recipient");
  assert.equal(gmailFailureAction(0, null, "", 0, "send"), "uncertain");
  assert.equal(gmailFailureAction(500, null, "", 0, "send"), "uncertain");
  assert.equal(gmailFailureAction(502, null, "", 0, "send"), "uncertain");
  assert.equal(gmailFailureAction(503, null, "", 2, "send"), "retry");
  assert.equal(gmailFailureAction(503, null, "", 3, "send"), "pause");
  assert.equal(gmailFailureAction(0, null, "", 0, "prepare"), "retry");
  assert.equal(gmailFailureAction(500, null, "", 3, "prepare"), "pause");
});

check("googleConsentError reads the provider's error", () => {
  assert.equal(googleConsentError("access_denied"), "cancelled");
  assert.equal(googleConsentError("admin_policy_enforced"), "admin_required");
  assert.equal(googleConsentError("server_error"), "failed");
});
```

- [ ] **Step 3: Rodar e ver falhar.** `npm run check:email` → FAIL com "Cannot find module '../src/lib/email-broadcast/mailbox/core'".

- [ ] **Step 4: Criar `mailbox/core.ts` e `google/core.ts`, e atualizar os imports.**
  - **O que muda de casa:** as regras movidas mudam de arquivo sem mudar de comportamento. Em `microsoft/core.ts` ficam só as regras da Microsoft, com `GraphFailureAction` como `= MailboxFailureAction`.
  - **Ordem das regras em `gmailFailureAction`:**
    1. 401 (refresh na 1ª, reconnect depois);
    2. 429 com `/mail sending/i` na mensagem → `daily_limit`;
    3. `domainPolicy` ou `failedPrecondition` → `blocked`;
    4. `dailyLimitExceeded` → `pause`;
    5. `insufficientPermissions` → `reconnect`;
    6. 429 ou `userRateLimitExceeded`/`rateLimitExceeded` → `retry` enquanto `attempt < 5`;
    7. status 0 ou ≥ 500: em `send`, 503 → `retry` enquanto `attempt < 3` e o resto → `uncertain`; em `prepare` → `retry` enquanto `attempt < 3`;
    8. outro 4xx → `recipient`;
    9. o resto → `pause`.
  - `pilotAllows`: separa por vírgula, tira espaços, ignora vazios; lista vazia = todas as empresas.

- [ ] **Step 5: Verificar.** `npm run check:email` → PASS. `npm run typecheck` → sem erros.

- [ ] **Step 6: Commit** `[E-mail] - Separa as regras comuns das caixas e cria as regras do Google`.

---

### Task 2: Motivos por canal e lista com o Google

**Files:** Modify `src/lib/email-broadcast/failure-reason.ts`, `src/lib/email-broadcast/list-channel.ts`, `src/app/[locale]/app/email/page.tsx` (só a chamada de `listChannelFromParam`), `scripts/check-email-broadcast.ts`.

**Interfaces:**
- Consumes: nada novo.
- Produces, em `failure-reason.ts`:
  - `type MailboxChannel = "PLATFORM" | "MICROSOFT" | "GOOGLE"`;
  - `googleRecipientError(code: string | null, message: string): string` → `"gg:<code>|<mensagem>"`, até 500 caracteres;
  - `recipientFailure` passa a ler também `gg:`: `badRequest`/`invalidArgument` → `invalid_address`; o resto → `generic`;
  - `pausedMessageKey(channel: MailboxChannel, reason: PausedReason): string`;
  - `listPausedMessageKey(channel: MailboxChannel, reason: PausedReason): string`.
- Produces, em `list-channel.ts`:
  - `type ListChannel = "plataforma" | "microsoft" | "google"`;
  - `listChannelFromParam(param: string | string[] | undefined, available: { microsoft: boolean; google: boolean }): ListChannel | null`;
  - `listChannelOf(channel: MailboxChannel): ListChannel` e `broadcastChannelOf(channel: ListChannel): MailboxChannel`;
  - `emailListHref` não muda.

- [ ] **Step 1: Testes que falham:**

```ts
check("pausedMessageKey / listPausedMessageKey pick the provider's wording", () => {
  assert.equal(pausedMessageKey("PLATFORM", "quota"), "paused.quota");
  assert.equal(pausedMessageKey("MICROSOFT", "provider_error"), "paused.provider_error_microsoft");
  assert.equal(pausedMessageKey("MICROSOFT", "daily_limit"), "paused.daily_limit");
  for (const r of ["daily_limit", "reconnect", "no_sender_account", "account_blocked", "provider_error"] as const) {
    assert.equal(pausedMessageKey("GOOGLE", r), `paused.google_${r}`);
  }
  assert.equal(pausedMessageKey("GOOGLE", "attachment_invalid"), "paused.attachment_invalid");
  assert.equal(listPausedMessageKey("MICROSOFT", "daily_limit"), "listReason.paused.daily_limit");
  assert.equal(listPausedMessageKey("GOOGLE", "daily_limit"), "listReason.paused.google_daily_limit");
  assert.equal(listPausedMessageKey("GOOGLE", "provider_error"), "listReason.paused.provider_error");
});

check("googleRecipientError and recipientFailure for gg: errors", () => {
  assert.equal(googleRecipientError("badRequest", "Invalid To header"), "gg:badRequest|Invalid To header");
  assert.equal(googleRecipientError("x", "y".repeat(600)).length, 500);
  assert.deepEqual(recipientFailure("gg:badRequest|Invalid To header"), { key: "invalid_address", technical: "badRequest: Invalid To header" });
  assert.deepEqual(recipientFailure("gg:backendError|x"), { key: "generic", technical: "backendError: x" });
});

check("listChannelFromParam with three channels", () => {
  const both = { microsoft: true, google: true };
  assert.equal(listChannelFromParam("google", both), "google");
  assert.equal(listChannelFromParam("google", { microsoft: true, google: false }), null);
  assert.equal(listChannelFromParam("microsoft", { microsoft: false, google: true }), null);
  assert.equal(listChannelFromParam(undefined, { microsoft: false, google: false }), "plataforma");
  assert.equal(listChannelFromParam("google", { microsoft: false, google: false }), "plataforma");
  assert.equal(listChannelOf("GOOGLE"), "google");
  assert.equal(broadcastChannelOf("google"), "GOOGLE");
});
```

  Os testes atuais de `listChannelFromParam(…, true/false)` passam a usar `{ microsoft: x, google: false }`.

- [ ] **Step 2: Rodar e ver falhar** (`npm run check:email`).
- [ ] **Step 3: Implementar.**
  - **`pausedMessageKey`:**
    - PLATFORM → `paused.<reason>`;
    - MICROSOFT → `paused.provider_error_microsoft` para `provider_error`, senão `paused.<reason>`;
    - GOOGLE → `paused.google_<reason>` para `daily_limit`, `reconnect`, `no_sender_account`, `account_blocked` e `provider_error`, senão `paused.<reason>`.
  - **`listPausedMessageKey`:** igual, com `listReason.paused.`, e Google só para `daily_limit`, `reconnect`, `no_sender_account` e `account_blocked`.
  - **Na página E-mail:** a chamada atual passa `{ microsoft: configured, google: false }`; a Task 9 liga o Google.
- [ ] **Step 4: Verificar** (`npm run check:email` e `npm run typecheck`).
- [ ] **Step 5: Commit** `[E-mail] - Escolhe os textos de pausa pelo canal e prepara a lista para o Google`.

---

### Task 3: Banco — uma conta por provedor e buscas por provedor

**Files:**
- Modify:
  - `prisma/schema.prisma`;
  - `src/lib/email-broadcast/microsoft/accounts.ts`;
  - `src/lib/queries/email-sender-accounts.ts`, `src/lib/queries/email-broadcasts.ts`;
  - `src/app/actions/email-sender-accounts.ts`, `src/app/actions/email-broadcasts.ts`;
  - `src/components/email/microsoft-account-panel.tsx`;
  - `scripts/check-isolation.ts`.
- Create: `prisma/migrations/20261019120000_email_sender_google/migration.sql`.

**Interfaces:**
- Produces:
  - Prisma: `EmailSenderProvider { MICROSOFT GOOGLE }`, `EmailChannel { PLATFORM MICROSOFT GOOGLE }`, e em `EmailSenderAccount` sai o `@unique` de `organizationId` e entra `@@unique([organizationId, provider])`;
  - `getSenderAccountView(organizationId: string, provider: "MICROSOFT" | "GOOGLE"): Promise<SenderAccountView | null>`, com o limite diário pelo provedor (`microsoftDailyLimit` / `googleDailyLimit`);
  - `disconnectSenderAccount(provider: "MICROSOFT" | "GOOGLE"): Promise<SenderAccountActionResult>`, que substitui `disconnectMicrosoftAccount`.

- [ ] **Step 1: Schema e SQL.**
  - Edite o schema.
  - Gere o SQL com `npx prisma migrate diff --from-schema-datamodel <cópia de git show HEAD:prisma/schema.prisma tirada antes da edição> --to-schema-datamodel prisma/schema.prisma --script` e grave sem as linhas `warn`.
  - Esperado, e só isto:
    - `ALTER TYPE "EmailSenderProvider" ADD VALUE 'GOOGLE'`;
    - `ALTER TYPE "EmailChannel" ADD VALUE 'GOOGLE'`;
    - `DROP INDEX "email_sender_accounts_organizationId_key"`;
    - `CREATE UNIQUE INDEX "email_sender_accounts_organizationId_provider_key" ON "email_sender_accounts"("organizationId", "provider")`.
  - Qualquer outra linha: pare e reporte.
- [ ] **Step 2: Aplicar localmente.**
  - `npx prisma db execute --file … --schema prisma/schema.prisma`;
  - depois `npx prisma migrate resolve --applied 20261019120000_email_sender_google --schema prisma/schema.prisma`;
  - por fim `npx prisma generate`.
- [ ] **Step 3: Buscas por provedor.**
  - Toda busca de conta por empresa passa a filtrar `provider`:
    - `saveMicrosoftAccount` com `provider: "MICROSOFT"`;
    - `getSenderAccountView(org, provider)`;
    - `disconnectSenderAccount(provider)`, que audita `email_sender.disconnected` com `meta: { email, provider }`;
    - `startEmailBroadcast`/`resumeEmailBroadcast` no ramo `MICROSOFT`, com `where: { provider: "MICROSOFT" }`;
    - `emailComposerData`, com `getSenderAccountView(org, "MICROSOFT")`.
  - O painel chama `disconnectSenderAccount("MICROSOFT")`.
- [ ] **Step 4: Caso 15 no `check:isolation`.**
  - Montagem: crie na empresa A uma conta `MICROSOFT` e uma `GOOGLE`.
  - Asserções (no estilo do caso 14):
    - `findMany` com `organizationId: orgB.id` vem vazio;
    - `findFirst` com `organizationId: orgA.id, provider: "GOOGLE"` devolve a conta Google;
    - criar uma segunda `GOOGLE` na empresa A falha com `P2002`.
  - Limpeza no `finally`, antes de `emailBroadcast.deleteMany`.
- [ ] **Step 5: Verificar.** `npm run typecheck && npm run check:isolation && npm run check:email` → tudo passa, inclusive o caso 15.
- [ ] **Step 6: Commit** `[E-mail] - Permite uma conta de envio por provedor em cada empresa`.

---

### Task 4: Renovação de acesso comum, configuração do Google e gravação da conta

**Files:**
- Create: `src/lib/email-broadcast/mailbox/token.ts`, `src/lib/email-broadcast/google/oauth.ts`, `src/lib/email-broadcast/google/accounts.ts`.
- Delete: `src/lib/email-broadcast/microsoft/token.ts`.
- Modify: `src/lib/env.ts`, `.env.example`, `microsoft/accounts.ts`, `microsoft/deliver.ts` (imports), `src/app/api/email/microsoft/callback/route.ts` (imports).

**Interfaces:**
- Consumes: `isReconnectCode`, `joinSiteUrl` (Task 1); `pilotAllows`, `GMAIL_SEND_SCOPE`, `GoogleAccountKind` (Task 1).
- Produces, em `mailbox/token.ts`:
  - `type SenderCredentials = { accessToken: string; refreshToken: string; expiresAt: string }`, `sealSenderCredentials(c: SenderCredentials): string`;
  - `type TokenResult` (o atual);
  - `markNeedsReconnect(organizationId: string, accountId: string, message: string): Promise<void>`;
  - `getSenderAccessToken(organizationId: string, accountId: string, provider: "MICROSOFT" | "GOOGLE", opts?: { force?: boolean }): Promise<TokenResult>`.
- Produces, em `google/oauth.ts`:
  - `GOOGLE_MAIL_SCOPES` (a lista da seção Global Constraints);
  - `GG_MAIL_STATE_COOKIE`, `GG_MAIL_VERIFIER_COOKIE`, `GG_MAIL_ORG_COOKIE`;
  - `googleMailConfigured(): boolean`, `googleMailCallbackUrl(): string`, `googleMailClient(): Google` (arctic);
  - `googleMailEnabledFor(organizationId: string): boolean` = configurado && `pilotAllows(org, env.GOOGLE_MAIL_PILOT_ORG_IDS)`.
- Produces, em `google/accounts.ts`: `saveGoogleAccount(organizationId: string, userId: string, input: { email: string; displayName: string | null; accountKind: GoogleAccountKind; credentials: SenderCredentials }): Promise<{ id: string; replaced: boolean }>`.

- [ ] **Step 1: Variáveis.**
  - `src/lib/env.ts`: `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET` e `GOOGLE_MAIL_PILOT_ORG_IDS`, todas `z.string().optional()`, com comentário (projeto Google separado do login; piloto até a aprovação).
  - `.env.example`: as três, vazias, com uma linha de comentário.
- [ ] **Step 2: `mailbox/token.ts`.** É o `microsoft/token.ts` atual com três mudanças:
  1. `provider` entra na chave da trava (`email_sender:${organizationId}:${provider}`) e no `where` da conta;
  2. a renovação escolhe o cliente pelo provedor: MICROSOFT → `microsoftMailClient().refreshAccessToken(rt, MICROSOFT_MAIL_SCOPES)`; GOOGLE → `googleMailClient().refreshAccessToken(rt)`;
  3. os códigos de reconexão vêm de `isReconnectCode`.

  Apague `microsoft/token.ts` e atualize os imports.
- [ ] **Step 3: Gravação.**
  - `saveMicrosoftAccount` passa a usar a chave `email_sender:${organizationId}:MICROSOFT` e `sealSenderCredentials`.
  - `saveGoogleAccount` tem a mesma regra (mesmo endereço atualiza; outro endereço apaga a antiga e cria uma nova), com `provider: "GOOGLE"` e a chave `…:GOOGLE`.
- [ ] **Step 4: `google/oauth.ts`.** Como `microsoft/oauth.ts`, com `new Google(id, secret, googleMailCallbackUrl())` e o retorno `joinSiteUrl(env.NEXT_PUBLIC_SITE_URL, "/api/email/google/callback")`.
- [ ] **Step 5: Verificar.** `npm run typecheck && npx eslint src scripts && npm run check:email && npm run check:isolation`.
- [ ] **Step 6: Commit** `[E-mail] - Generaliza a renovação de acesso e adiciona a configuração do Google`.

---

### Task 5: Rotas de conectar a conta Google

**Files:** Create `src/app/api/email/google/connect/route.ts`, `src/app/api/email/google/callback/route.ts`; Modify `docs/guia/05-rotas-e-jobs.md`.

**Interfaces:**
- Consumes:
  - `googleMailEnabledFor`, `googleMailClient`, `GOOGLE_MAIL_SCOPES`, os cookies `GG_*` (Task 4);
  - `saveGoogleAccount` (Task 4);
  - `googleAccountKind`, `googleHasGmail`, `googleGrantedSend`, `googleConsentError`, `joinSiteUrl` (Task 1).
- Produces: `GET /api/email/google/connect` e `GET /api/email/google/callback`, que voltam para `/app/email/new?google=connected` ou `?google_error=<GoogleConnectError>`.

- [ ] **Step 1: `connect`.** Mesmo esqueleto da rota Microsoft:
  - gate primeiro (sessão → tela `email` → módulo `marketing`);
  - se `!googleMailEnabledFor(org)` → `?google_error=not_configured`;
  - URL de autorização = `createAuthorizationURL(state, verifier, GOOGLE_MAIL_SCOPES)` + `access_type=offline` + `prompt=consent select_account`;
  - cookies `gg_mail_*` (10 min, httpOnly, lax).
- [ ] **Step 2: `callback`.** Mesmo esqueleto e mesma ordem da rota Microsoft:
  1. gate;
  2. empresa habilitada;
  3. `error` do Google → `googleConsentError`;
  4. confere `state`, verificador e empresa;
  5. `validateAuthorizationCode`;
  6. sem `googleGrantedSend(tokens.scopes())` → `missing_send`;
  7. sem refresh token → `failed` (com log de uma linha, sem tokens);
  8. claims do `decodeIdToken`: precisa de `email` e `email_verified === true`, senão `failed`; `!googleHasGmail(email, hd)` → `no_gmail`;
  9. `saveGoogleAccount` (com `displayName = name ?? null`, `accountKind = googleAccountKind(hd)`);
  10. audita `email_sender.connected`/`replaced` com `meta: { email, kind, provider: "GOOGLE" }`;
  11. `?google=connected`.

  Os cookies são limpos em todo retorno depois do gate. Nada de token no log.
- [ ] **Step 3: Guia 05.** Uma linha na tabela de autenticação (igual à da Microsoft, com os cookies `gg_mail_*`) e uma frase sobre o retorno cadastrado no projeto Google.
- [ ] **Step 4: Verificar** (`npm run typecheck && npx eslint src scripts`).
- [ ] **Step 5: Commit** `[E-mail] - Adiciona as rotas de conectar a conta Google`.

---

### Task 6: Envio de um e-mail pelo Gmail

**Files:** Create `src/lib/email-broadcast/google/gmail.ts`, `src/lib/email-broadcast/google/send.ts`.

**Interfaces:**
- Consumes: `buildMime`, `MimeFile`, `MimeMail` (`microsoft/mime.ts`); `gmailUploadMode`, `MailboxSendOutcome` (Task 1).
- Produces:
  - `gmail.ts`:
    - `gmailCall<T>(url: string, init: { method: "POST" | "PUT"; token: string; body?: Uint8Array | string; headers?: Record<string, string>; timeoutMs?: number }): Promise<{ ok: true; status: number; data: T; location: string | null } | { ok: false; status: number; code: string | null; message: string; retryAfter: number | null }>`. Nunca lança exceção. O `code` vem de `error.errors[0].reason`, ou de `error.status`.
    - `gmailSendSimple(token: string, mime: Buffer)`;
    - `gmailStartResumable(token: string, size: number)`;
    - `gmailFinishResumable(token: string, location: string, mime: Buffer)`.
  - `send.ts`: `sendGoogleMail(token: string, mail: Omit<MimeMail, "attachments">, files: MimeFile[]): Promise<MailboxSendOutcome>`. Nunca lança exceção.

- [ ] **Step 1: `gmail.ts`.** Base `https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send`.
  - **Envio simples:** `POST ?uploadType=media`, com `Content-Type: message/rfc822`, corpo = MIME cru e timeout de 60 s.
  - **Início do retomável:** `POST ?uploadType=resumable`, com `X-Upload-Content-Type: message/rfc822`, `X-Upload-Content-Length: <size>`, `Content-Type: application/json; charset=UTF-8` e corpo `{}`. Devolve o `location`.
  - **Fim do retomável:** `PUT <location>`, com `Content-Type: message/rfc822`, `Authorization` e timeout de 120 s.
  - **Resposta OK:** o JSON da mensagem (`id`, `labelIds`).
- [ ] **Step 2: `send.ts`.**
  1. Monta o MIME uma vez (com os anexos).
  2. Se `gmailUploadMode` der `simple`: uma chamada, etapa `send`.
  3. Se der `resumable`: início = etapa `prepare` (sem `location` → falha `prepare`, status 502), fim = etapa `send`.
  4. Exceção ao montar o MIME → falha `prepare`, status 0.
- [ ] **Step 3: Verificar** (`npm run typecheck && npx eslint src scripts`).
- [ ] **Step 4: Commit** `[E-mail] - Envia um e-mail pelo Gmail com upload simples ou retomável`.

---

### Task 7: Um laço de envio para as duas caixas

**Files:**
- Create: `src/lib/email-broadcast/mailbox/deliver.ts`, `src/lib/email-broadcast/microsoft/adapter.ts`, `src/lib/email-broadcast/google/adapter.ts`.
- Delete: `src/lib/email-broadcast/microsoft/deliver.ts`.
- Modify: `src/lib/email-broadcast/dispatch.ts`.

**Interfaces:**
- Consumes:
  - `getSenderAccessToken`, `markNeedsReconnect` (Task 4);
  - `sendMicrosoftMail` (atual) e `sendGoogleMail` (Task 6);
  - `graphFailureAction`, `microsoftDailyLimit`, `microsoftRecipientError` (atuais);
  - `gmailFailureAction`, `googleDailyLimit`, `googleRecipientError` (Tasks 1 e 2).
- Produces, em `mailbox/deliver.ts`:
  - `markInterruptedUncertain(broadcastId: string, organizationId: string): Promise<void>` (movido);
  - `type MailboxPauseReason` (o atual `MicrosoftPauseReason`);
  - `type MailboxRun` (o atual `MicrosoftRun`);
  - `type MailboxAdapter = { channel: "MICROSOFT" | "GOOGLE"; dailyLimit(kind: string): number; send(token: string, mail: Omit<MimeMail, "attachments">, files: MimeFile[]): Promise<MailboxSendOutcome>; failureAction(failure: MailboxSendFailure, attempt: number): MailboxFailureAction; recipientError(code: string | null, message: string): string }`;
  - `runMailboxBroadcast(run: MailboxRun, adapter: MailboxAdapter): Promise<{ done: boolean }>`.
- Produces também: `microsoftAdapter: MailboxAdapter` (em `microsoft/adapter.ts`) e `googleAdapter: MailboxAdapter` (em `google/adapter.ts`).

- [ ] **Step 1: Mover o laço.**
  - `runMailboxBroadcast` é o `runMicrosoftBroadcast` atual, trocando cada ponto fixo da Microsoft pelo adaptador:
    - limite diário → `adapter.dailyLimit`;
    - envio → `adapter.send`;
    - classificação → `adapter.failureAction`;
    - erro do destinatário → `adapter.recipientError`;
    - canal do contador de envios simultâneos → `adapter.channel`;
    - token → `getSenderAccessToken(org, account.id, adapter.channel, …)`.
  - A busca da conta passa a exigir `provider: adapter.channel`: conta de outro provedor = `no_sender_account`.
  - Nenhuma outra linha do laço muda: reserva, liquidação guardada por `SENDING`, refresh no primeiro 401, `waitUpTo` e sequência de 3 falhas.
- [ ] **Step 2: Adaptadores.**
  - **Microsoft:** `failureAction = (f, attempt) => graphFailureAction(f.status, f.code, attempt, f.stage)`.
  - **Google:** `failureAction = (f, attempt) => gmailFailureAction(f.status, f.code, f.message, attempt, f.stage)`.
- [ ] **Step 3: Despachante.**
  - `mailbox = b.channel === "MICROSOFT" || b.channel === "GOOGLE"`.
  - `markInterruptedUncertain` para os dois canais.
  - `runMailboxBroadcast(run, b.channel === "GOOGLE" ? googleAdapter : microsoftAdapter)`.
  - O tipo do `pause` usa `MailboxPauseReason`.
  - O caminho da plataforma não muda.
- [ ] **Step 4: Verificar.** `npm run typecheck && npx eslint src scripts && npm run check:email && npm run build`. O build é o primeiro com o adaptador Google no grafo.
- [ ] **Step 5: Commit** `[E-mail] - Usa um laço de envio só para as caixas Microsoft e Google`.

---

### Task 8: Actions e consultas com o canal Google

**Files:** Modify `src/lib/validations/email-broadcast.ts`, `src/lib/email-broadcast/types.ts`, `src/app/actions/email-broadcasts.ts`, `src/lib/queries/email-broadcasts.ts`, `src/messages/pt.json`, `src/messages/en.json`.

**Interfaces:**
- Consumes: `getSenderAccountView(org, provider)` (Task 3); `googleMailEnabledFor` (Task 4).
- Produces:
  - `broadcastDraftSchema.channel` aceita `"GOOGLE"`;
  - `ComposerDraft.channel: "PLATFORM" | "MICROSOFT" | "GOOGLE"`;
  - `emailComposerData` devolve também `google: SenderAccountView | null` e `googleEnabled: boolean`;
  - `listEmailBroadcasts(org, channel?: "PLATFORM" | "MICROSOFT" | "GOOGLE")`.

- [ ] **Step 1: Rascunho.** `saveEmailDraft`/`duplicateEmailBroadcast` tratam `MICROSOFT` e `GOOGLE` igual: canal de caixa, remetente vazio no rascunho.
- [ ] **Step 2: Iniciar e retomar.**
  - O ramo da caixa vale para `MICROSOFT` e `GOOGLE`: busca a conta com `provider: b.channel`.
  - Para `GOOGLE`, exige `googleMailEnabledFor(orgId)`, senão devolve `sender_account_missing`.
  - Congela remetente e conta como hoje.
  - Na retomada, re-aponta para a conta conectada do mesmo provedor.
- [ ] **Step 3: Consultas.** `emailComposerData` busca o Google só quando `googleEnabled`.
- [ ] **Step 4: Textos neutros** (os dois servem aos dois provedores):

| Chave | pt | en |
|---|---|---|
| `emailBroadcast.error.sender_account_missing` | Conecte a conta de envio desse canal para enviar por ela. | Connect this channel's sending account to send through it. |
| `emailBroadcast.error.sender_account_reconnect` | A conta de envio precisa ser reconectada. | The sending account needs to be reconnected. |

- [ ] **Step 5: Verificar.** `npm run typecheck && npx eslint src scripts && npm run check:isolation`. Paridade igual de chaves; a contagem não muda.
- [ ] **Step 6: Commit** `[E-mail] - Leva o canal Google para as actions e consultas`.

---

### Task 9: Telas com o Google

**Files:**
- Rename: `src/components/email/microsoft-account-panel.tsx` → `src/components/email/sender-account-panel.tsx`.
- Modify:
  - `src/components/email/channel-choice.tsx`, `src/components/email/channel-icon.tsx`, `src/components/email/email-composer.tsx`;
  - `src/app/[locale]/app/email/page.tsx`, `src/app/[locale]/app/email/new/page.tsx`, `src/app/[locale]/app/email/[id]/edit/page.tsx`, `src/app/[locale]/app/email/[id]/page.tsx`;
  - `src/messages/pt.json`, `src/messages/en.json`.

**Interfaces:**
- Consumes:
  - `pausedMessageKey`, `listPausedMessageKey`, `listChannelFromParam`, `ListChannel` (Task 2);
  - `emailComposerData.google`/`googleEnabled` (Task 8);
  - `disconnectSenderAccount(provider)` (Task 3);
  - `mailboxSendMinutes` (Task 1);
  - `googleMailEnabledFor` (Task 4).
- Produces:
  - `SenderAccountPanel({ provider, account, action }: { provider: "MICROSOFT" | "GOOGLE"; account: SenderAccountView | null; action?: ReactNode })`;
  - `ChannelChoice({ microsoft, microsoftEnabled, google, googleEnabled, quotaLimit, notice, mode })`, com `notice: { provider: "MICROSOFT" | "GOOGLE"; connected: boolean; error: string | null } | null`;
  - `ChannelIcon` aceita `"google"`.

- [ ] **Step 1: Painel genérico.**
  - URL de conexão por provedor (`/api/email/microsoft/connect` | `/api/email/google/connect`).
  - Textos por provedor: os da Microsoft continuam os de hoje; os do Google são as chaves `channel.google*` abaixo.
  - Desconectar = `disconnectSenderAccount(provider)`.
  - Rótulo do tipo: `kindPersonal`/`kindWork` na Microsoft; `googleKindPersonal`/`googleKindWork` no Google.
- [ ] **Step 2: Escolha do canal.**
  - Cartão Google só se `googleEnabled`, com o `ChannelIcon` `google`.
  - Grade `md:grid-cols-2 xl:grid-cols-3` quando houver três cartões.
  - A mensagem do retorno (`?microsoft=connected`/`?microsoft_error=` e `?google=connected`/`?google_error=`) usa os textos do provedor e limpa a URL.
- [ ] **Step 3: Páginas.**
  - **`new`:**
    - `via=google` só com `googleEnabled` e conta `ACTIVE`; senão, volta para a escolha;
    - lê `google`/`google_error` (lista fechada `GoogleConnectError`).
  - **`edit`:** passa `google`.
  - **Lista:**
    - `available = { microsoft: microsoftMailConfigured(), google: googleMailEnabledFor(org) }`;
    - `canal=google` mostra o `SenderAccountPanel` `GOOGLE` e "Novo e-mail" → `?via=google`;
    - sem a coluna "Entregues" nas duas caixas;
    - motivo em vermelho por `listPausedMessageKey(r.channel, …)`.
  - **Relatório:**
    - canal de caixa = `MICROSOFT` ou `GOOGLE`, com os mesmos contadores e filtros;
    - "Enviado pela conta …" e aviso de rastreio pelo provedor;
    - faixa de pausa por `pausedMessageKey(b.channel, key)`.
- [ ] **Step 4: Formulário.**
  - O modo "caixa" vale para `MICROSOFT` e `GOOGLE`, com `account = draft.channel === "GOOGLE" ? google : microsoft`.
  - Chip, aviso de conta ausente, ritmo e "Enviados" pelo provedor.
  - `mailboxSendMinutes` no lugar de `microsoftSendMinutes`.
- [ ] **Step 5: Textos novos** (pt / en), dentro de `emailBroadcast`:

| Chave | pt | en |
|---|---|---|
| `channel.googleTitle` | Pela conta Google | Through the Google account |
| `channel.googleBody` | Sai do Gmail ou do Google Workspace da empresa. As respostas chegam nessa caixa e cada e-mail fica salvo em Enviados. | Goes out from the company's Gmail or Google Workspace. Replies land there and every e-mail is saved in Sent. |
| `channel.googleBrowse` | Ver envios pela conta Google | See Google account sends |
| `channel.googleNoneBody` | Você entra no Google e autoriza o envio em nome da caixa. Cada empresa tem uma conta Google de envio. | You sign in to Google and allow sending on the mailbox's behalf. Each company has one Google sending account. |
| `channel.googleConsentNote` | O Google vai pedir permissão para enviar e-mails em seu nome. O MétodoAI nunca lê a sua caixa. | Google will ask for permission to send e-mail on your behalf. MétodoAI never reads your mailbox. |
| `channel.googleConnect` | Conectar conta Google | Connect Google account |
| `channel.googleKindPersonal` | Gmail pessoal | Personal Gmail |
| `channel.googleKindWork` | Google Workspace | Google Workspace |
| `channel.googleSwitchConfirm` | Entrar no Google com outra conta? Ela substitui {email} nesta empresa, e envios pausados passam a sair por ela quando forem retomados. | Sign in to Google with another account? It replaces {email} for this company, and paused sends go out from it when resumed. |
| `channel.googleDisconnectConfirm` | Desconectar {email}? O MétodoAI deixa de enviar por esta conta, e envios em andamento por ela ficam pausados até uma conta ser conectada de novo. Para tirar o acesso também do lado do Google, remova o app em myaccount.google.com → Segurança → Apps e serviços de terceiros. | Disconnect {email}? MétodoAI stops sending from this account, and sends in progress through it pause until an account is connected again. To revoke access on Google's side too, remove the app at myaccount.google.com → Security → Third-party apps & services. |
| `channel.googleDisconnected` | Conta Google desconectada. | Google account disconnected. |
| `channel.googleReconnectBody` | O Google recusou o acesso (senha trocada, acesso revogado ou a conexão de teste de 7 dias venceu). Os envios por esta conta estão pausados até reconectar. | Google refused access (password changed, access revoked, or the 7-day test connection expired). Sends through this account are paused until you reconnect. |
| `channel.googleConnectedToast` | Conta Google conectada. | Google account connected. |
| `channel.googleError.cancelled` | A conexão com o Google foi cancelada. Enquanto o envio pelo Google está em teste, só contas da lista de teste conseguem conectar. | Connecting to Google was cancelled. While sending through Google is in testing, only accounts on the test list can connect. |
| `channel.googleError.admin_required` | O administrador do Google Workspace desta empresa precisa liberar o app MétodoAI como confiável. Peça ao responsável pela TI. | This company's Google Workspace administrator must allow the MétodoAI app as trusted. Ask your IT admin. |
| `channel.googleError.missing_send` | Marque a permissão de enviar e-mails para conectar. | Tick the permission to send e-mails to connect. |
| `channel.googleError.no_gmail` | Esta conta Google não tem Gmail. Conecte um Gmail ou uma conta do Google Workspace. | This Google account has no Gmail. Connect a Gmail or a Google Workspace account. |
| `channel.googleError.not_configured` | O envio pela conta Google não está disponível para esta empresa. Fale com o suporte. | Sending through a Google account isn't available for this company. Contact support. |
| `channel.googleError.failed` | Não foi possível conectar a conta Google. Tente de novo. | Couldn't connect the Google account. Try again. |
| `listChannel.google` | Envios pela conta Google | Google account sends |
| `googleChip` | conta Google | Google account |
| `googleMissing` | Não há uma conta Google ativa nesta empresa. Conecte ou reconecte em Novo e-mail antes de enviar. | There's no active Google account for this company. Connect or reconnect it in New e-mail before sending. |
| `confirmGooglePace` | Ritmo do Google: cerca de 28 e-mails por minuto; esta parte leva cerca de {minutes, plural, one {# minuto} other {# minutos}}. | Google's pace: about 28 e-mails a minute; this part takes about {minutes, plural, one {# minute} other {# minutes}}. |
| `confirmGoogleSent` | Os e-mails ficam salvos em Enviados do Gmail de {email}, e o Google não informa entrega nem abertura. | The e-mails are saved in {email}'s Gmail Sent folder, and Google doesn't report delivery or opens. |
| `report.viaGoogle` | Enviado pela conta Google {email} | Sent through the Google account {email} |
| `report.noTrackingGoogle` | O Google não avisa entrega nem abertura: aqui aparecem só os enviados e as falhas. Devoluções de endereço inexistente chegam na própria caixa do Gmail. | Google doesn't report delivery or opens: this shows only what was sent and what failed. Bounces for unknown addresses arrive in the Gmail inbox itself. |
| `paused.google_daily_limit` | Envio pausado: o limite diário da conta Google foi atingido. Clique em “Retomar envio” amanhã para continuar até o próximo limite. | Send paused: the Google account's daily limit was reached. Click “Resume send” tomorrow to continue up to the next limit. |
| `paused.google_reconnect` | Envio pausado: a conta Google precisa ser reconectada (em Novo e-mail). Depois, clique em “Retomar envio”. | Send paused: the Google account needs to be reconnected (in New e-mail). Then click “Resume send”. |
| `paused.google_no_sender_account` | Envio pausado: a conta Google foi desconectada ou trocada. Conecte uma conta e clique em “Retomar envio”. | Send paused: the Google account was disconnected or switched. Connect an account and click “Resume send”. |
| `paused.google_account_blocked` | Envio pausado: o Google não permite enviar por esta conta (o Gmail não está ativo nela ou o administrador bloqueou apps de terceiros). Verifique a conta antes de retomar. | Send paused: Google doesn't allow sending from this account (Gmail isn't active on it or the admin blocked third-party apps). Check the account before resuming. |
| `paused.google_provider_error` | Envio pausado: o Google recusou ou não respondeu ao envio. Veja o detalhe técnico e clique em “Retomar envio” para tentar de novo. | Send paused: Google refused or didn't answer the send. See the technical detail and click “Resume send” to try again. |
| `listReason.paused.google_daily_limit` | Pausado: limite diário da conta Google atingido. Retome amanhã. | Paused: the Google account's daily limit was reached. Resume tomorrow. |
| `listReason.paused.google_reconnect` | Pausado: a conta Google precisa ser reconectada. | Paused: the Google account needs to be reconnected. |
| `listReason.paused.google_no_sender_account` | Pausado: a conta Google foi desconectada. | Paused: the Google account was disconnected. |
| `listReason.paused.google_account_blocked` | Pausado: o Google não permite enviar por esta conta. | Paused: Google doesn't allow sending from this account. |

- [ ] **Step 6: Verificar.**
  - `npm run typecheck && npx eslint src scripts && npm run check:email && npm run build`;
  - a paridade de chaves (o comando de nó usado nas tarefas da Microsoft) com as listas vazias.
- [ ] **Step 7: Commit** `[E-mail] - Adiciona o canal Google às telas de e-mail`.

---

### Task 10: Política de privacidade, documentação e verificação completa

**Files:** Modify `src/messages/legal/privacy.pt.json`, `src/messages/legal/privacy.en.json`, `src/app/[locale]/privacy/page.tsx` (`UPDATED_AT`), `README.md`, `CLAUDE.md`, `docs/guia/04-modulos-e-permissoes.md`, `docs/guia/06-antes-de-commitar.md`.

- [ ] **Step 1: Política de privacidade.**
  - **Seção nova:** `id: "connected-mailboxes"`, logo depois de `whatsapp`, com título "5. Contas de e-mail conectadas (Google e Microsoft)" / "5. Connected e-mail accounts (Google and Microsoft)".
  - **Renumeração:** as seções seguintes passam de 5–16 para 6–17, e as referências no texto mudam de "seção 6/7/9/12" para "seção 7/8/10/13" (e o mesmo em inglês). São quatro em cada arquivo; confira com `grep -o "seção [0-9]\+"`.
  - **Conteúdo** (blocos `p` e `ul`, no tom da seção do WhatsApp):
    - o que é acessado: endereço, nome e a permissão de envio;
    - para quê: enviar os e-mails que a empresa monta no MétodoAI;
    - que o MétodoAI não lê, não guarda nem compartilha o conteúdo da caixa;
    - como revogar: desconectar no MétodoAI e remover o app na conta Google ou Microsoft;
    - a frase "O uso e a transferência, para qualquer outro app, de informações recebidas das APIs do Google seguem a Google API Services User Data Policy, incluindo os requisitos de Limited Use", com o link https://developers.google.com/terms/api-services-user-data-policy.
  - **Data:** `UPDATED_AT = "2026-10-19"`.
- [ ] **Step 2: README.**
  - **Parágrafo do envio pela caixa:** inclui o Google (Gmail e Workspace, uma conta por provedor, piloto por `GOOGLE_MAIL_PILOT_ORG_IDS`).
  - **Tabela §6:** linha das três variáveis `GOOGLE_MAIL_*`.
  - **Runbook §8:**
    - antes do merge: a migration `20261019120000_email_sender_google` (`db execute` + `migrate resolve`) e as variáveis no hPanel;
    - projeto Google "MetodoIA E-mail" em Testing, com usuários de teste;
    - não publicar antes da aprovação (teto vitalício de 100 contas);
    - depois de aprovar: publicar e apagar `GOOGLE_MAIL_PILOT_ORG_IDS`.
- [ ] **Step 3: Guias e contagem.**
  - Guia 06: o `check:email` cobre as regras do Google.
  - Guia 04 e `CLAUDE.md`: o número de chaves pelo comando de paridade.
- [ ] **Step 4: Validações completas** (sem `next dev`):

```bash
npm run typecheck && npx eslint src scripts && npm run build && npm run check:isolation && npm run check:node && npm run check:email && npm run check:tasks && npm run check:search
```

  Esperado: tudo passa.
- [ ] **Step 5: Commit** `[E-mail] - Documenta o envio pela conta Google e atualiza a política de privacidade`.

O teste real com as contas do usuário (seção 11 da spec) fica para depois da revisão final, com o usuário. Ele depende do projeto Google criado e das contas de teste cadastradas.

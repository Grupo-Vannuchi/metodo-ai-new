# Envio de e-mail em massa por SMTP — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** uma empresa conecta uma conta SMTP de qualquer provedor (servidor, porta, usuário, senha, limites por hora e por dia) e dispara os e-mails em massa por ela, com as mesmas garantias dos canais Microsoft e Google.

**Architecture:** o SMTP vira o terceiro adaptador do laço único `runMailboxBroadcast` (`src/lib/email-broadcast/mailbox/deliver.ts`), cujo contrato ganha três pontos: acesso (token ou configuração), limites calculados pela conta e ritmo. As regras puras (falhas, ritmo, endereços bloqueados, validação) ficam em arquivos sem `server-only`, cobertos pelo `check:email`. A conexão usa `nodemailer/lib/smtp-connection` (já instalado), separando preparação de entrega.

**Tech Stack:** Next.js 16.3 (App Router, server actions), Prisma 6 com driver adapter, Postgres, zod 3, next-intl, nodemailer 10.1.1, Tailwind.

**Spec:** [docs/superpowers/specs/2026-10-21-email-conta-smtp-design.md](../specs/2026-10-21-email-conta-smtp-design.md). Leia junto: as decisões e os textos estão lá.

## Global Constraints

- Nenhuma dependência nova. SMTP por `nodemailer/lib/smtp-connection` (tipos de `@types/nodemailer`), MIME pelo `buildMime` atual.
- Toda consulta de negócio por `tenantDb(orgId)`/DAL. No despachante e no laço, Prisma cru **só** com `organizationId` explícito em todo `where` (guia 03). Trabalho por id: `findFirst` + `updateMany`/`deleteMany`.
- Nada de `process.env.X` direto: use `env` de `src/lib/env.ts`.
- `src/messages/pt.json` e `en.json` com exatamente as mesmas chaves (3087 hoje).
- Microsoft e Google **não mudam de comportamento**; todos os testes atuais do `check:email` continuam passando.
- Arquivos importados pelo `check:email` não podem importar `server-only` nem `@/lib/env`/`@/lib/prisma`.
- Portas aceitas: 465, 587, 2525. Padrões: 100/hora e 500/dia. Máximos: 1.700/hora e 10.000/dia; hora ≤ dia.
- Tempos-limite: teste ao salvar 15 s para conectar, 10 s para a saudação, 30 s de socket; envio 15 s, 10 s e 60 s.
- Senha nunca vai para o navegador, para o log nem para a auditoria.
- Antes de cada commit, os cinco: `npm run typecheck && npx eslint . --ignore-pattern ".claude/**" && npm run build && npm run check:isolation && npm run check:node`, mais `npm run check:email`. O lint direto é porque `.claude/worktrees/` tem checkouts velhos. Se o `typecheck`/`build` acusar TS1109/TS1005 em `.next/dev/types`, apague essa pasta e rode de novo.
- Commits: `[E-mail] - Verbo + Tarefa`, corpo curto, última linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commite só os arquivos da sua tarefa (`git add <caminhos>`).
- Banco local: Docker Postgres `metodoai-db` na porta 5433. Se `docker info` falhar, abra o Docker Desktop (`%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`), espere e rode `docker compose up -d postgres`.
- Depois de `prisma generate`, um `next dev` rodando precisa ser reiniciado na porta 3000 (não suba outro na 3001).

## Review Focus

1. Servidor colado com esquema, porta, espaços ou maiúsculas (`smtp://Smtpi.KingHost.net:587 `): a pessoa recebe "inválido" claro ou o valor normalizado, nunca uma falha genérica de conexão (Task 1).
2. Porta e segurança trocadas (465 com STARTTLS fica mudo até a saudação expirar; 587 com SSL dá "wrong version number"): o erro é `connection_failed`/`tls_failed`, com a dica da 587, nunca `failed` (Task 1).
3. A caixa cheia ou o endereço de um destinatário (`552 5.2.2`, `452 4.2.2 over quota`, `450` repetido no `RCPT TO`) falha ou repete só aquele destinatário, mesmo esgotadas as repetições. Nunca pausa o envio: a retomada pegaria o mesmo endereço primeiro e travaria tudo (Task 1).
4. DNS que devolve endereços públicos e privados misturados, ou IPv6 mapeado para IPv4 interno (`::ffff:127.0.0.1`): bloqueado (Task 1).
5. Dois envios ao mesmo tempo pela mesma conta SMTP, somados, nunca passam do limite por hora (Task 4).

---

### Task 1: Regras puras do SMTP

**Files:**
- Create: `src/lib/email-broadcast/smtp/core.ts` (puro; pode ser importado pelo cliente)
- Create: `src/lib/email-broadcast/smtp/address.ts` (puro, usa `node:net`; só servidor e `check:email`)
- Create: `src/lib/validations/email-smtp-account.ts`
- Modify: `src/config/limits.ts`, `src/lib/email-broadcast/failure-reason.ts`, `src/lib/email-broadcast/list-channel.ts`, `src/lib/email-broadcast/mailbox/core.ts`, `src/app/[locale]/app/email/page.tsx` (só passa `smtp: false` para `listChannelFromParam`), `scripts/check-email-broadcast.ts`, `docs/guia/04-modulos-e-permissoes.md`

**Interfaces:**
- Produces (`smtp/core.ts`):
  - `SMTP_PORTS = [465, 587, 2525] as const`; `type SmtpPort`; `type SmtpSecurity = "ssl" | "starttls"`
  - `type SmtpSettings = { host: string; port: SmtpPort; security: SmtpSecurity; username: string; password: string }`
  - `defaultSmtpSecurity(port: SmtpPort): SmtpSecurity`
  - `smtpDailyLimit(a: { dailyLimit: number | null }): number` e `smtpHourlyLimit(a: { hourlyLimit: number | null }): number` (nulo → padrão de `LIMITS`)
  - `smtpPaceMs(hourlyLimit: number): number` = `max(MAILBOX_PACE_MS, ceil(3_600_000 / max(1, hourlyLimit)))`
  - `smtpSendMinutes(count: number, hourlyLimit: number): number` = `max(1, ceil(max(0, count) × smtpPaceMs(h) / 60_000))`
  - `type SmtpPhase = "guard" | "connect" | "tls" | "auth" | "noauth" | "mail" | "rcpt" | "data" | "message" | "transfer"`
  - `smtpFailureCode(phase: SmtpPhase, responseCode: number | null): string` → `"rcpt-550"`, ou só a fase quando não há código
  - `smtpPhaseOf(code: string | null): SmtpPhase | null`
  - `smtpSendPhase(step: "connect" | "login" | "send", e: { code?: string | null; command?: string | null; message?: string | null }): SmtpPhase`
  - `isSmtpSizeRefusal(code: string | null, message: string): boolean`
  - `smtpFailureAction(status: number, code: string | null, message: string, attempt: number): MailboxFailureAction`
  - `canKeepSmtpPassword(saved: { host: string; port: number; security: SmtpSecurity; username: string; status: "ACTIVE" | "NEEDS_RECONNECT" } | null, next: { host: string; port: number; security: SmtpSecurity; username: string }): boolean`: verdadeiro só com conta `ACTIVE` e os quatro campos iguais
  - `type SmtpConnectError = "auth_failed" | "tls_failed" | "connection_failed" | "host_not_found" | "host_not_allowed" | "no_auth" | "failed"`
  - `smtpConnectError(e: { code?: string | null; responseCode?: number | null; message?: string | null }): SmtpConnectError`
- Produces (`smtp/address.ts`): `isBlockedSmtpAddress(ip: string): boolean`; `pickSmtpAddress(list: { address: string; family: number }[]): { ok: true; ip: string; family: 4 | 6 } | { ok: false; error: "host_not_found" | "host_not_allowed" }`
- Produces (`validations/email-smtp-account.ts`): `smtpAccountSchema`, `type SmtpAccountInput = z.input<…>`, `type SmtpAccountData = z.output<…>` (saída: `email`, `displayName: string | null`, `host`, `port: SmtpPort`, `security`, `username`, `password`, `hourlyLimit`, `dailyLimit`)
- Produces (`limits.ts`): `LIMITS.smtpHourlyDefault = 100`, `smtpDailyDefault = 500`, `smtpHourlyMax = 1_700`, `smtpDailyMax = 10_000`
- Produces (`failure-reason.ts`): `MailboxChannel` ganha `"SMTP"`; `smtpRecipientError(code, message)` → `"smtp:<code>|<message>"` (500 caracteres); `failureMessageKey(channel: MailboxChannel, key: RecipientFailureKey): string`; `pausedMessageKey`/`listPausedMessageKey` com a versão `smtp_` dos mesmos motivos que têm versão `google_`
- Produces (`list-channel.ts`): `ListChannel` ganha `"smtp"`; `ListChannelAvailability = { microsoft: boolean; google: boolean; smtp: boolean }`
- Produces (`mailbox/core.ts`): `sentLastHourWhere(accountId: string, now: Date)`, mesma forma de `sentLast24hWhere` com janela de 60 min

- [ ] **Step 1: Escrever os testes que falham** em `scripts/check-email-broadcast.ts`, no estilo `check(...)` atual (os `listChannelFromParam` antigos ganham `smtp: false`):

```ts
check("smtpPaceMs and smtpSendMinutes follow the hourly limit", () => {
  assert.equal(smtpPaceMs(100), 36_000);
  assert.equal(smtpPaceMs(1_700), 2_118);
  assert.equal(smtpPaceMs(5_000), 2_100);
  assert.equal(smtpPaceMs(1), 3_600_000);
  assert.equal(smtpSendMinutes(500, 100), 300);
  assert.equal(smtpSendMinutes(0, 100), 1);
  assert.equal(smtpSendMinutes(10, 1_700), 1);
  assert.equal(smtpDailyLimit({ dailyLimit: null }), 500);
  assert.equal(smtpDailyLimit({ dailyLimit: 800 }), 800);
  assert.equal(smtpHourlyLimit({ hourlyLimit: null }), 100);
  assert.equal(defaultSmtpSecurity(465), "ssl");
  assert.equal(defaultSmtpSecurity(587), "starttls");
  assert.equal(defaultSmtpSecurity(2525), "starttls");
});

check("smtpFailureAction maps SMTP answers to dispatcher moves", () => {
  const a = smtpFailureAction;
  assert.equal(a(0, "transfer", "Connection closed", 0), "uncertain");
  assert.equal(a(0, "connect", "ETIMEDOUT", 0), "retry");
  assert.equal(a(0, "connect", "ETIMEDOUT", 3), "pause");
  assert.equal(a(0, "guard", "", 0), "pause");
  assert.equal(a(0, "tls", "Hostname/IP does not match certificate's altnames", 0), "pause");
  assert.equal(a(535, "auth-535", "5.7.8 Authentication credentials invalid", 0), "reconnect");
  assert.equal(a(454, "auth-454", "4.7.0 Temporary authentication failure", 0), "retry");
  assert.equal(a(454, "auth-454", "4.7.0 Temporary authentication failure", 3), "pause");
  assert.equal(a(0, "noauth", "", 0), "pause");
  assert.equal(a(552, "message-552", "5.3.4 Message size exceeds fixed limit", 0), "recipient");
  assert.equal(a(0, "message", "Message size larger than allowed 10240000", 0), "recipient");
  // one recipient's address or mailbox: never a pause, even after the retries
  assert.equal(a(552, "rcpt-552", "5.2.2 Mailbox full", 0), "recipient");
  assert.equal(a(452, "rcpt-452", "4.2.2 Mailbox over quota", 0), "retry");
  assert.equal(a(452, "rcpt-452", "4.2.2 Mailbox over quota", 5), "recipient");
  assert.equal(a(550, "message-550", "5.1.1 Recipient rejected", 0), "recipient");
  assert.equal(a(450, "rcpt-450", "Mailbox unavailable", 4), "retry");
  assert.equal(a(450, "rcpt-450", "Mailbox unavailable", 5), "recipient");
  assert.equal(a(550, "rcpt-550", "5.1.1 User unknown", 0), "recipient");
  // the account's own limit or sender
  assert.equal(a(550, "mail-550", "5.7.1 Sending rate limit exceeded", 0), "daily_limit");
  assert.equal(a(451, "rcpt-451", "Limite de envio excedido", 0), "daily_limit");
  assert.equal(a(550, "rcpt-550", "5.7.1 Daily sending quota exceeded", 0), "daily_limit");
  assert.equal(a(553, "mail-553", "5.7.1 Sender address rejected: not owned by user", 0), "blocked");
  assert.equal(a(553, "mail-553", "5.1.8 Sender address domain does not exist", 0), "blocked");
  assert.equal(a(550, "message-550", "5.7.1 generated content blocked", 0), "recipient"); // "generated" is not "rate"
  assert.equal(a(554, "message-554", "5.7.1 Message rejected as spam", 0), "recipient");
  assert.equal(a(554, "data-554", "Transaction failed", 0), "pause");
  assert.equal(a(421, "mail-421", "Service not available, closing channel", 0), "retry");
  assert.equal(a(421, "mail-421", "Service not available, closing channel", 5), "pause");
  assert.equal(a(0, null, "", 0), "pause");
});

check("canKeepSmtpPassword only reuses the saved password for the same server and user", () => {
  const saved = { host: "smtpi.kinghost.net", port: 587, security: "starttls" as const, username: "a@b.com", status: "ACTIVE" as const };
  const same = { host: "smtpi.kinghost.net", port: 587, security: "starttls" as const, username: "a@b.com" };
  assert.equal(canKeepSmtpPassword(saved, same), true);
  assert.equal(canKeepSmtpPassword(null, same), false);
  assert.equal(canKeepSmtpPassword({ ...saved, status: "NEEDS_RECONNECT" }, same), false);
  assert.equal(canKeepSmtpPassword(saved, { ...same, host: "smtp.atacante.com" }), false);
  assert.equal(canKeepSmtpPassword(saved, { ...same, port: 465 }), false);
  assert.equal(canKeepSmtpPassword(saved, { ...same, security: "ssl" }), false);
  assert.equal(canKeepSmtpPassword(saved, { ...same, username: "outro@b.com" }), false);
});

check("smtpSendPhase separates the preparation from the hand-over", () => {
  assert.equal(smtpSendPhase("connect", { code: "ETIMEDOUT" }), "connect");
  assert.equal(smtpSendPhase("connect", { code: "ESOCKET", message: "Hostname/IP does not match certificate's altnames" }), "tls");
  assert.equal(smtpSendPhase("connect", { code: "ESOCKET", message: "ssl3_get_record:wrong version number" }), "tls");
  assert.equal(smtpSendPhase("login", { code: "EAUTH" }), "auth");
  assert.equal(smtpSendPhase("login", { code: "ENOAUTH" }), "noauth");
  assert.equal(smtpSendPhase("login", { code: "ECONNECTION" }), "connect");
  assert.equal(smtpSendPhase("send", { code: "EENVELOPE", command: "MAIL FROM" }), "mail");
  assert.equal(smtpSendPhase("send", { code: "EENVELOPE", command: "RCPT TO" }), "rcpt");
  assert.equal(smtpSendPhase("send", { code: "EENVELOPE", command: "DATA" }), "data");
  assert.equal(smtpSendPhase("send", { code: "EMESSAGE", command: "DATA" }), "message");
  assert.equal(smtpSendPhase("send", { code: "EMESSAGE", command: "MAIL FROM" }), "message");
  assert.equal(smtpSendPhase("send", { code: "ETIMEDOUT" }), "transfer");
  assert.equal(smtpSendPhase("send", { code: "ECONNECTION" }), "transfer");
  assert.equal(smtpSendPhase("send", {}), "transfer");
  assert.equal(smtpFailureCode("rcpt", 550), "rcpt-550");
  assert.equal(smtpFailureCode("transfer", null), "transfer");
  assert.equal(smtpPhaseOf("rcpt-550"), "rcpt");
  assert.equal(smtpPhaseOf("bogus"), null);
  assert.equal(smtpPhaseOf(null), null);
});

check("smtpConnectError names the save-form failures", () => {
  assert.equal(smtpConnectError({ code: "EAUTH", responseCode: 535 }), "auth_failed");
  assert.equal(smtpConnectError({ responseCode: 535 }), "auth_failed");
  assert.equal(smtpConnectError({ code: "ENOAUTH" }), "no_auth");
  assert.equal(smtpConnectError({ code: "ESOCKET", message: "self-signed certificate" }), "tls_failed");
  assert.equal(smtpConnectError({ code: "ETLS" }), "tls_failed");
  assert.equal(smtpConnectError({ code: "ESOCKET", message: "ssl3_get_record:wrong version number" }), "tls_failed");
  assert.equal(smtpConnectError({ code: "EDNS" }), "host_not_found");
  assert.equal(smtpConnectError({ code: "ENOTFOUND" }), "host_not_found");
  assert.equal(smtpConnectError({ code: "ETIMEDOUT", message: "Greeting never received" }), "connection_failed");
  assert.equal(smtpConnectError({ code: "ECONNECTION" }), "connection_failed");
  assert.equal(smtpConnectError({ code: "ECONNREFUSED" }), "connection_failed");
  assert.equal(smtpConnectError({}), "failed");
});

check("isBlockedSmtpAddress and pickSmtpAddress keep the server off internal networks", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"]) assert.equal(isBlockedSmtpAddress(ip), true, ip);
  for (const ip of ["177.153.0.10", "8.8.8.8", "172.32.0.1", "2804:14c::1", "::ffff:8.8.8.8"])
    assert.equal(isBlockedSmtpAddress(ip), false, ip);
  assert.deepEqual(pickSmtpAddress([]), { ok: false, error: "host_not_found" });
  assert.deepEqual(pickSmtpAddress([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]), { ok: false, error: "host_not_allowed" });
  assert.deepEqual(pickSmtpAddress([{ address: "2001:4860:4860::8888", family: 6 }, { address: "8.8.4.4", family: 4 }]), { ok: true, ip: "8.8.4.4", family: 4 });
  assert.deepEqual(pickSmtpAddress([{ address: "2001:4860:4860::8888", family: 6 }]), { ok: true, ip: "2001:4860:4860::8888", family: 6 });
});

check("smtpAccountSchema validates and normalizes the SMTP form", () => {
  const ok = smtpAccountSchema.parse({ email: " Contato@Cliente.com.br ", displayName: "", host: " SMTPI.KingHost.net ",
    port: "587", security: "starttls", username: "", password: "x", hourlyLimit: "100", dailyLimit: "500" });
  assert.equal(ok.email, "contato@cliente.com.br");
  assert.equal(ok.host, "smtpi.kinghost.net");
  assert.equal(ok.port, 587);
  assert.equal(ok.username, "contato@cliente.com.br");
  assert.equal(ok.displayName, null);
  const base = { email: "a@b.com", host: "smtp.b.com", port: 465, security: "ssl", password: "x", hourlyLimit: 100, dailyLimit: 500 };
  for (const host of ["smtp://smtpi.kinghost.net", "smtpi.kinghost.net:587", "smtp kinghost.net", "localhost", ""])
    assert.equal(smtpAccountSchema.safeParse({ ...base, host }).success, false, host);
  for (const port of [25, 2526]) assert.equal(smtpAccountSchema.safeParse({ ...base, port }).success, false);
  for (const lim of [{ hourlyLimit: 0 }, { hourlyLimit: 1_701 }, { dailyLimit: 10_001 }, { hourlyLimit: 600, dailyLimit: 500 }])
    assert.equal(smtpAccountSchema.safeParse({ ...base, ...lim }).success, false, JSON.stringify(lim));
  assert.equal(smtpAccountSchema.safeParse({ ...base, password: "x".repeat(513) }).success, false);
  assert.equal(smtpAccountSchema.safeParse({ ...base, password: "" }).success, true); // a action decide se a senha falta
});

check("SMTP failure reasons, paused texts and list channel", () => {
  assert.equal(smtpRecipientError("rcpt-550", "5.1.1 User unknown"), "smtp:rcpt-550|5.1.1 User unknown");
  assert.equal(smtpRecipientError("rcpt-550", "x".repeat(600)).length, 500);
  assert.deepEqual(recipientFailure("smtp:rcpt-550|5.1.1 User unknown"), { key: "invalid_address", technical: "rcpt-550: 5.1.1 User unknown" });
  assert.equal(recipientFailure("smtp:message-552|5.3.4 Message size exceeds fixed limit")?.key, "message_too_large");
  assert.equal(recipientFailure("smtp:rcpt-552|5.2.2 Mailbox full")?.key, "generic");
  assert.equal(recipientFailure("smtp:message-554|spam")?.key, "generic");
  assert.equal(pausedMessageKey("SMTP", "daily_limit"), "paused.smtp_daily_limit");
  assert.equal(pausedMessageKey("SMTP", "provider_error"), "paused.smtp_provider_error");
  assert.equal(pausedMessageKey("SMTP", "quota"), "paused.quota");
  assert.equal(listPausedMessageKey("SMTP", "reconnect"), "listReason.paused.smtp_reconnect");
  assert.equal(listPausedMessageKey("SMTP", "provider_error"), "listReason.paused.provider_error");
  assert.equal(failureMessageKey("SMTP", "message_too_large"), "failure.smtp_message_too_large");
  assert.equal(failureMessageKey("MICROSOFT", "message_too_large"), "failure.message_too_large");
  assert.equal(failureMessageKey("SMTP", "generic"), "failure.generic");
  assert.equal(listChannelFromParam("smtp", { microsoft: false, google: false, smtp: true }), "smtp");
  assert.equal(listChannelFromParam("smtp", { microsoft: true, google: true, smtp: false }), null);
  assert.equal(listChannelFromParam(undefined, { microsoft: false, google: false, smtp: false }), "plataforma");
  assert.equal(listChannelOf("SMTP"), "smtp");
  assert.equal(broadcastChannelOf("smtp"), "SMTP");
  assert.equal(emailListHref("smtp"), "/app/email?canal=smtp");
  const now = new Date("2026-10-21T12:00:00Z");
  assert.deepEqual(sentLastHourWhere("acc", now), {
    status: { in: ["SENT", "SENDING", "UNCERTAIN"] },
    sentAt: { gte: new Date("2026-10-21T11:00:00Z") },
    broadcast: { senderAccountId: "acc" },
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.** `npm run check:email`. Esperado: falha de import (os símbolos ainda não existem).

- [ ] **Step 3: Implementar.**
  - **`smtp/core.ts`**, nesta ordem em `smtpFailureAction` (a primeira regra que bate decide; é a tabela 5.3 da spec):
    1. `transfer` → uncertain;
    2. `guard` → pause;
    3. `connect` → retry se `attempt < 3`, senão pause;
    4. `tls` → pause;
    5. `auth`: 4xx → retry se `attempt < 3`, senão pause; o resto → reconnect;
    6. `noauth` → pause;
    7. tamanho (`isSmtpSizeRefusal`: código `message-552`, ou texto com `5.3.4`, "message size", "too large", "too big" ou "tamanho") → recipient;
    8. fase `rcpt`, `data` ou `message` com código estendido `[45].1.x` ou `[45].2.x` no texto → recipient no 5xx; no 4xx, retry se `attempt < 5`, senão **recipient**;
    9. limite (`/\b(rate|limit|quota|too many|limite|excedid)/i`) → daily_limit;
    10. `rcpt`: 5xx → recipient; 4xx → retry se `attempt < 5`, senão **recipient**;
    11. outros 5xx: `mail` → blocked; `message` → recipient; `data` e o resto → pause;
    12. outros 4xx → retry se `attempt < 5`, senão pause;
    13. resto → pause.

    O código estendido é o primeiro `\b[245]\.\d{1,3}\.\d{1,3}\b` da resposta. Na fase `mail`, `5.1.x` é do **remetente**, e por isso a regra 8 não vale ali.
  - **Detecção de TLS** em `smtpSendPhase`/`smtpConnectError`: código `ETLS`, `EPROTO` ou começando com `ERR_TLS`, ou texto com `certificate`, `self-signed`/`self signed`, `altname`, `unable to verify`, `wrong version number` ou `ssl routines`. A regra de TLS vem antes da de conexão.
  - **`smtpConnectError`:** `EAUTH`, ou códigos 530/534/535 → `auth_failed`; `ENOAUTH` → `no_auth`; TLS → `tls_failed`; `EDNS`, `ENOTFOUND` ou `EAI_AGAIN` → `host_not_found`; `ECONNECTION`, `ETIMEDOUT`, `ESOCKET`, `ECONNREFUSED`, `ECONNRESET`, `EHOSTUNREACH` ou `ENETUNREACH` → `connection_failed`; resto → `failed`.
  - **`address.ts`:** um `net.BlockList` com os intervalos:
    - IPv4: 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4 e 240/4;
    - IPv6: ::/128, ::1/128, 64:ff9b::/96, 100::/64, 2001:db8::/32, fc00::/7, fe80::/10 e ff00::/8.

    `::ffff:a.b.c.d` é conferido pelo IPv4 embutido. O que não for IP é bloqueado.
  - **Schema:**
    - `host` = trim + minúsculas e regex de nome com pelo menos um ponto, ou IPv4 literal: sem `:`, `/` nem espaço;
    - `username` vazio → `email`; `displayName` vazio → `null`;
    - `port` e os limites com `z.coerce.number().int()`;
    - `.refine` para `hourlyLimit <= dailyLimit`.
  - **`failure-reason.ts`:**
    - o prefixo `smtp:` em `recipientFailure`: tamanho → `message_too_large`; `rcpt-` com 550, 551, 553, 501, 510 ou 511 → `invalid_address`; resto → `generic`;
    - `failureMessageKey` só desvia `SMTP + message_too_large`.

- [ ] **Step 4: Rodar e ver passar.** `npm run check:email`. Esperado: `✅ email-broadcast: N checks passed.`
- [ ] **Step 5: Guia 04.** Na lista de `LIMITS`, acrescente os 4 campos SMTP (padrões e máximos, informados pela empresa).
- [ ] **Step 6: Os cinco + check:email, e commit** `[E-mail] - Adiciona as regras puras do envio por SMTP`.

---

### Task 2: Banco e leitura da conta SMTP

**Files:**
- Modify: `prisma/schema.prisma` (enums `EmailChannel` e `EmailSenderProvider` + `SMTP`; `EmailSenderAccount` + `hourlyLimit Int?` e `dailyLimit Int?`, com comentário `/// Só SMTP: limites informados pela empresa.`)
- Create: `prisma/migrations/20261021120000_email_sender_smtp/migration.sql`
- Create: `src/lib/email-broadcast/smtp/credentials.ts` (`server-only`)
- Modify: `src/lib/email-broadcast/types.ts`, `src/lib/queries/email-sender-accounts.ts`, `src/lib/queries/email-broadcasts.ts`, `src/app/actions/email-sender-accounts.ts`, `scripts/check-isolation.ts`, `docs/guia/03-multi-tenancy.md`

**Interfaces:**
- Consumes: `SmtpSettings`, `smtpDailyLimit`, `smtpHourlyLimit`, `remainingToday` (Task 1)
- Produces:
  - `sealSmtpSettings(s: SmtpSettings): string` e `openSmtpSettings(sealed: string): SmtpSettings | null`. Usam `encryptCredentials`/`decryptCredentials`, com a porta guardada como texto; nulo se faltar campo ou a porta não estiver em `SMTP_PORTS`.
  - `SenderAccountView`: `accountKind: "personal" | "work" | "smtp"`, mais `hourlyLimit: number | null` e `host: string | null` (nulos fora do SMTP).
  - `getSenderAccountView(organizationId, provider: "MICROSOFT" | "GOOGLE" | "SMTP")`.
  - `emailComposerData(...)` devolve também `smtp: SenderAccountView | null`.
  - `listEmailBroadcasts(organizationId, channel?: "PLATFORM" | "MICROSOFT" | "GOOGLE" | "SMTP")`.
  - `disconnectSenderAccount(provider: "MICROSOFT" | "GOOGLE" | "SMTP")`.
- **Não** acrescente `SMTP` ao `channel` de `validations/email-broadcast.ts` nem a `ComposerDraft`: isso é da Task 4. Antes dela, um rascunho SMTP cairia no ramo da plataforma.

- [ ] **Step 1: Migration.** `npx prisma migrate dev --create-only --name email_sender_smtp`, renomeie a pasta para `20261021120000_email_sender_smtp` e confira que o SQL é só isto:

```sql
-- AlterEnum
ALTER TYPE "EmailChannel" ADD VALUE 'SMTP';

-- AlterEnum
ALTER TYPE "EmailSenderProvider" ADD VALUE 'SMTP';

-- AlterTable
ALTER TABLE "email_sender_accounts" ADD COLUMN "dailyLimit" INTEGER,
ADD COLUMN "hourlyLimit" INTEGER;
```

Depois rode `npx prisma migrate dev` (aplica no Docker local e gera o client) e reinicie o `next dev` se estiver rodando.

- [ ] **Step 2: Escrever o teste que falha** em `scripts/check-isolation.ts`, junto das asserções Microsoft/Google:
  - a empresa A ganha uma conta `SMTP` (`hourlyLimit 100`, `dailyLimit 500`) ao lado das outras duas;
  - `providersA` passa a ser `"GOOGLE,MICROSOFT,SMTP"`;
  - as contas da empresa B continuam vazias;
  - `findFirst({ organizationId: orgA, provider: "SMTP" })` devolve a conta SMTP com os dois limites;
  - uma segunda conta SMTP na empresa A dá `P2002`.

  Limpe as linhas no teardown, como as atuais.
- [ ] **Step 3: Rodar e ver falhar.** `npm run check:isolation`. Esperado: falha na asserção dos três provedores (ou de tipo, antes do Step 1).
- [ ] **Step 4: Implementar.**
  - `credentials.ts`, os tipos, `getSenderAccountView` e o `disconnectSenderAccount`, cuja checagem de tempo de execução passa a aceitar os três provedores.
  - `getSenderAccountView` para SMTP:
    - `dailyLimit` = `smtpDailyLimit(row)`;
    - `hourlyLimit` = `smtpHourlyLimit(row)`;
    - `host` de `openSmtpSettings(row.credentials)`.
  - O painel atual mostra "work" para `smtp` até a Task 5; não mexa nele aqui.
- [ ] **Step 5: Rodar e ver passar.** `npm run check:isolation`. Esperado: todas as asserções passam (as atuais + as novas).
- [ ] **Step 6: Guia 03.** Atualize a frase das asserções da conta de envio (Microsoft, Google e SMTP na mesma empresa) e o número total.
- [ ] **Step 7: Os cinco + check:email, e commit** `[E-mail] - Adiciona a conta SMTP no banco`.

---

### Task 3: Testar a conexão e salvar a conta

**Files:**
- Create: `src/lib/email-broadcast/smtp/connect.ts` (`server-only`)
- Create: `src/lib/email-broadcast/smtp/accounts.ts` (`server-only`)
- Modify: `src/lib/queries/email-sender-accounts.ts`, `src/lib/email-broadcast/types.ts`, `src/app/actions/email-sender-accounts.ts`

**Interfaces:**
- Consumes: Task 1 (`pickSmtpAddress`, `isBlockedSmtpAddress`, `smtpConnectError`, `smtpAccountSchema`), Task 2 (`sealSmtpSettings`, `openSmtpSettings`)
- Produces:
  - **`resolveSmtpHost(host: string): Promise<{ ok: true; ip: string; family: 4 | 6 } | { ok: false; error: "host_not_found" | "host_not_allowed" }>`**
    - IP literal → `isBlockedSmtpAddress`;
    - nome → `dns.promises.lookup(host, { all: true, verbatim: true })` + `pickSmtpAddress`;
    - erro de DNS → `host_not_found`.
  - **`openSmtpConnection(settings: Omit<SmtpSettings, "password">, ip: string, timeouts: { connection: number; greeting: number; socket: number }): SMTPConnection`**
    - `host: ip`, `port`;
    - `secure: security === "ssl"`, `requireTLS: security === "starttls"`;
    - `servername` e `tls.servername` com o nome digitado, `tls.rejectUnauthorized: true`;
    - os três tempos-limite;
    - `name` = hostname de `env.NEXT_PUBLIC_SITE_URL`.
  - `smtpConnect(conn)`, `smtpLogin(conn, user, pass)` e `smtpSendRaw(conn, envelope: { from: string; to: string[] }, raw: Buffer)` como Promises. `smtpClose(conn)` não lança erro (`quit` + `close`).
  - **`verifySmtpSettings(s: SmtpSettings): Promise<{ ok: true } | { ok: false; error: SmtpConnectError; technical: string }>`**
    - tempos de 15 s, 10 s e 30 s;
    - resolve → conecta → faz o login → fecha;
    - mapeia com `smtpConnectError`; os erros da proteção de endereço passam como estão.
  - **`storeSmtpAccount(organizationId: string, userId: string, input: { email: string; displayName: string | null; settings: SmtpSettings; hourlyLimit: number; dailyLimit: number }): Promise<{ id: string; replaced: boolean }>`**
    - mesma regra de `saveGoogleAccount`, com a trava `email_sender:<org>:SMTP`;
    - grava `accountKind "smtp"`, `credentials: sealSmtpSettings(settings)`, os dois limites, `status ACTIVE` e `lastError null`.
  - `type SmtpAccountFormView = { email: string; displayName: string | null; host: string; port: SmtpPort; security: SmtpSecurity; username: string; hourlyLimit: number; dailyLimit: number; status: "ACTIVE" | "NEEDS_RECONNECT" }` (em `types.ts`), sem senha. `getSmtpAccountForm(organizationId): Promise<SmtpAccountFormView | null>` em `queries/email-sender-accounts.ts`.
  - **Server action `saveSmtpAccount(input: SmtpAccountInput): Promise<SmtpSaveResult>`**, com `type SmtpSaveResult = { ok: true; replaced: boolean } | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "password_required" | SmtpConnectError | "unknown"; technical?: string }`.

- [ ] **Step 1: Escrever o smoke que falha.** Script `C:\Users\RafaelFernades\AppData\Local\Temp\claude\c--Users-RafaelFernades-Desktop-metodo-ai-new\522d5b51-03bc-4873-b503-3626cfecf91e\scratchpad\smtp-smoke.ts`, que importa `verifySmtpSettings` e `resolveSmtpHost` e confere:
  - `resolveSmtpHost("127.0.0.1")` → `host_not_allowed`;
  - `resolveSmtpHost("nao-existe.invalid")` → `host_not_found`;
  - `verifySmtpSettings({ host: "smtp.gmail.com", port: 587, security: "starttls", username: "ninguem@example.com", password: "errada" })` → `auth_failed`;
  - o mesmo com `port: 465, security: "starttls"` → `connection_failed` (a 465 espera TLS desde o início).

  Rode com `npx tsx --conditions=react-server --env-file=.env <script>`. Esperado agora: falha de import.
- [ ] **Step 2: Implementar `connect.ts` e `accounts.ts`.**
- [ ] **Step 3: Rodar o smoke e ver passar** (as quatro linhas com o resultado esperado). A rede aqui é instável: um `ETIMEDOUT` isolado pede repetir uma vez, não mudar o código.
- [ ] **Step 4: Implementar a action e a consulta.**
  - Gate igual ao de `disconnectSenderAccount`, conferido antes de tudo; `safeParse` → `invalid`.
  - Conta SMTP atual por `tenantDb` (`provider: "SMTP"`).
  - Senha vazia:
    - `canKeepSmtpPassword(contaGuardada, dadosNovos)` verdadeiro → usa a senha guardada (`openSmtpSettings`);
    - senão (sem conta, conta `NEEDS_RECONNECT`, ou servidor, porta, segurança ou usuário diferentes) → `password_required`.

    Isso impede que a senha guardada seja mandada para um servidor diferente daquele em que foi digitada (spec §2).
  - `verifySmtpSettings`: falha → devolve o código + `technical` (até 300 caracteres), sem gravar.
  - Sucesso → `storeSmtpAccount` + `audit(ctx, { action: replaced ? "email_sender.replaced" : "email_sender.connected", entity: "EmailSenderAccount", entityId, meta: { provider: "SMTP", email, host } })` + `revalidatePath("/app/email")` e `revalidatePath("/app/email/new")`.
  - Exceção → `unknown` com `console.error` sem a senha.
- [ ] **Step 5: Os cinco + check:email, e commit** `[E-mail] - Adiciona o teste e a gravação da conta SMTP`.

---

### Task 4: Laço de envio com o adaptador SMTP

**Files:**
- Modify: `src/lib/email-broadcast/mailbox/deliver.ts`, `src/lib/email-broadcast/mailbox/core.ts`, `src/lib/email-broadcast/microsoft/adapter.ts`, `src/lib/email-broadcast/google/adapter.ts`, `src/lib/email-broadcast/dispatch.ts`, `src/app/actions/email-broadcasts.ts`, `src/lib/validations/email-broadcast.ts`, `src/lib/email-broadcast/types.ts` (`ComposerDraft.channel` + `"SMTP"`), `scripts/check-email-broadcast.ts`
- Create: `src/lib/email-broadcast/smtp/send.ts`, `src/lib/email-broadcast/smtp/adapter.ts` (os dois `server-only`)

**Interfaces:**
- Consumes: Task 1 (`smtpFailureAction`, `smtpSendPhase`, `smtpFailureCode`, `smtpPaceMs`, `smtpDailyLimit`, `smtpHourlyLimit`, `smtpRecipientError`, `sentLastHourWhere`), Task 2 (`openSmtpSettings`), Task 3 (`resolveSmtpHost`, `openSmtpConnection`, `smtpConnect`, `smtpLogin`, `smtpSendRaw`, `smtpClose`)
- Produces (`deliver.ts`):
  - `type MailboxAccount = { id: string; status: "ACTIVE" | "NEEDS_RECONNECT"; accountKind: string; dailyLimit: number | null; hourlyLimit: number | null }`
  - `type MailboxAccess<A> = { ok: true; access: A } | { ok: false; reason: "reconnect" | "temporary"; message: string }`
  - `MailboxAdapter<A>` com:
    - `channel: "MICROSOFT" | "GOOGLE" | "SMTP"`;
    - `access(organizationId, accountId, opts?: { force?: boolean }): Promise<MailboxAccess<A>>`;
    - `dailyLimit(account: MailboxAccount): number`;
    - `hourlyLimit(account: MailboxAccount): number | null`;
    - `paceMs(account: MailboxAccount): number`;
    - `send(access: A, mail, files)`;
    - `failureAction` e `recipientError`, como hoje.
  - `runMailboxBroadcast<A>(run, adapter: MailboxAdapter<A>)`.
- Produces (`mailbox/core.ts`): `waitChunksMs(totalMs: number, maxChunkMs = 10_000): number[]`; `mailboxPaceWaitMs(paceMs: number, running: number): number` = `paceMs × min(max(1, running), 20)`.
- Produces: `sendSmtpMail(settings: SmtpSettings, mail: Omit<MimeMail, "attachments">, files: MimeFile[]): Promise<MailboxSendOutcome>` e `smtpAdapter: MailboxAdapter<SmtpSettings>`.

- [ ] **Step 1: Escrever os testes que falham** (`check:email`):

```ts
check("waitChunksMs and mailboxPaceWaitMs split long waits under the lease", () => {
  assert.deepEqual(waitChunksMs(36_000), [10_000, 10_000, 10_000, 6_000]);
  assert.deepEqual(waitChunksMs(2_100), [2_100]);
  assert.deepEqual(waitChunksMs(0), []);
  assert.equal(mailboxPaceWaitMs(2_100, 0), 2_100);
  assert.equal(mailboxPaceWaitMs(36_000, 2), 72_000); // two sends of one account: each waits twice as long
  assert.equal(mailboxPaceWaitMs(2_100, 50), 42_000);
});
```

- [ ] **Step 2: Rodar e ver falhar** (`npm run check:email`: símbolo inexistente).
- [ ] **Step 3: Implementar o contrato novo em `deliver.ts`.**
  - **Conta:** o `select` da conta passa a trazer `dailyLimit` e `hourlyLimit`, relidos a cada e-mail (uma edição de limites vale a partir do próximo).
  - **Limite diário:** `adapter.dailyLimit(account)`.
  - **Limite por hora** (ponto opcional): depois do diário, quando `adapter.hourlyLimit(account)` não for nulo, conta `sentLastHourWhere(account.id, now)` com `organizationId`. Se a conta chegou no limite, espera 10 s com `run.wait(10)` e faz `continue`, sem reservar ninguém e sem pausar.
  - **Ritmo:** a pausa entre e-mails passa a ser `mailboxPaceWaitMs(adapter.paceMs(account), running)`.
    - Até 10 s, um `sleep` só, como hoje.
    - Acima disso, `waitChunksMs` com `run.wait(chunk / 1000)` em cada bloco, parando se `Date.now() >= run.deadline`.
  - **Acesso:** `adapter.access(...)` no lugar de `getSenderAccessToken` (no 401 com `{ force: true }`, como hoje).
  - **Microsoft/Google:**
    - `access` embrulha `getSenderAccessToken(org, id, provider, opts)`;
    - `dailyLimit` = `(a) => microsoftDailyLimit(a.accountKind)` / `googleDailyLimit(a.accountKind)`;
    - `hourlyLimit: () => null`;
    - `paceMs: () => MAILBOX_PACE_MS`.
- [ ] **Step 4: Implementar `smtp/send.ts`.**
  - `buildMime` falha → `{ ok: false, status: 0, code: null, message, retryAfter: null, stage: "prepare" }`.
  - `resolveSmtpHost`: `host_not_found` → fase `connect`; `host_not_allowed` → fase `guard`.
  - Conexão com 15 s, 10 s e 60 s.
  - `smtpConnect` → `smtpLogin` → `smtpSendRaw({ from: mail.from.address, to: [mail.to] }, mime)`. Cada erro vira `smtpSendPhase(passo, erro)` →

    ```ts
    { ok: false, status: erro.responseCode ?? 0, code: smtpFailureCode(fase, erro.responseCode ?? null),
      message: (erro.response || erro.message).slice(0, 400), retryAfter: null,
      stage: fase === "transfer" || fase === "message" ? "send" : "prepare" }
    ```
  - `smtpClose` sempre, num `finally`. Nunca lança erro.
  - **Teto de 75 s** por tentativa (`SMTP_SEND_BUDGET_MS = 75_000`), com um timer que fecha a conexão quando estoura:
    - antes do `send`, a falha vira fase `connect`;
    - durante o `send`, vira `transfer`.

    Assim a tentativa cabe no lease de 90 s.
- [ ] **Step 5: Implementar `smtp/adapter.ts`.**
  - `access` lê a conta por Prisma cru: `findFirst({ where: { id, organizationId, provider: "SMTP" } })`. Ausente ou não `ACTIVE` → `reconnect`.
  - `openSmtpSettings` nulo → `markNeedsReconnect(org, id, "unreadable credentials")` + `reconnect`.
  - `dailyLimit: smtpDailyLimit`, `hourlyLimit: smtpHourlyLimit`, `paceMs: (a) => smtpPaceMs(smtpHourlyLimit(a))`.
  - `send: sendSmtpMail`, `failureAction: (f, n) => smtpFailureAction(f.status, f.code, f.message, n)`, `recipientError: smtpRecipientError`.
- [ ] **Step 6: Ligar o canal.**
  - `dispatch.ts`: `mailbox` inclui `SMTP`, e o adaptador é escolhido pelo canal (três ramos, cada um chamando `runMailboxBroadcast` com o seu).
  - `actions/email-broadcasts.ts`: os quatro `mailbox = channel === "MICROSOFT" || channel === "GOOGLE"` (salvar, duplicar, iniciar, retomar) incluem `SMTP`, com busca da conta por `provider: channel`.
  - `validations/email-broadcast.ts`: `channel` com `"SMTP"`.
  - `ComposerDraft.channel` com `"SMTP"`.
- [ ] **Step 7: Rodar e ver passar** (`npm run check:email`, com os testes antigos de Microsoft e Google intactos).
- [ ] **Step 8: Os cinco, e commit** `[E-mail] - Envia pela conta SMTP no laço das caixas`.

---

### Task 5: Telas da conta SMTP

**Files:**
- Create: `src/app/[locale]/app/email/smtp/page.tsx`, `src/components/email/smtp-account-form.tsx`
- Modify: `src/components/email/sender-account-panel.tsx`, `src/components/email/channel-choice.tsx`, `src/components/email/channel-icon.tsx`, `src/app/[locale]/app/email/page.tsx`, `src/app/[locale]/app/email/new/page.tsx` (só passa `smtp` para `ChannelChoice`), `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consumes: `getSmtpAccountForm`, `SmtpAccountFormView`, `saveSmtpAccount`, `SmtpSaveResult` (Task 3); `getSenderAccountView(..., "SMTP")`, `emailComposerData().smtp`, `disconnectSenderAccount("SMTP")` (Task 2); `defaultSmtpSecurity`, `SMTP_PORTS`, `LIMITS.smtp*` (Task 1)
- Produces: `ChannelChoice` com a prop `smtp: SenderAccountView | null` (o cartão SMTP sempre aparece); `SenderAccountPanel` aceita `provider="SMTP"`; `ChannelIcon` aceita `"smtp"`.

- [ ] **Step 1: Página `/app/email/smtp`.**
  - Server component, coberto pelo layout do E-mail.
  - Trilha "E-mail / Conta SMTP".
  - Título "Conectar conta SMTP" (nova) ou "Conta SMTP" (editar/reconectar).
  - Passa para o formulário o `initial` (sem conta: porta 587, `starttls` e os padrões de `LIMITS`) e o `mode: "new" | "edit" | "reconnect"`.
- [ ] **Step 2: `SmtpAccountForm` (client).**
  - Campos da spec 4.1, com `Input`/`Label` de `@/components/ui/field`.
  - Porta num `<select>` com `SMTP_PORTS`; trocar a porta põe `defaultSmtpSecurity(porta)` na segurança.
  - Senha `type="password"`, `autoComplete="new-password"`, com a dica "deixe em branco para manter a senha atual" só no `edit`. Se a pessoa mudar servidor, porta, segurança ou usuário em relação ao `initial`, a senha passa a ser obrigatória e a dica diz por quê. Com a senha vazia nesse caso, o servidor responde `password_required`.
  - As três ajudas da spec §6.
  - Botão "Testar e salvar", com `useTransition`.
  - Falha → mensagem `t("smtp.error.<código>", { host, port })` em vermelho, com `title` = `technical`.
  - Sucesso → toast "Conta SMTP conectada." + `router.push("/app/email/new")` + `router.refresh()`.
  - Exceção da action → `error.unknown`, sem perder o que foi digitado.
- [ ] **Step 3: Painel, cartão e ícone.**
  - `SenderAccountPanel` com `provider="SMTP"` usa `Link` para `/app/email/smtp` no lugar de `connectUrl`:
    - nenhuma conta → "Configurar SMTP";
    - `NEEDS_RECONNECT` → texto "O servidor recusou a senha. Informe a senha nova." + "Reconectar";
    - conectada → chips de servidor (`host`), "{hourly} por hora", `dailyLimit` e `sent24h`; botões `action`, "Editar" (no lugar de "Trocar") e "Desconectar". A confirmação de desconectar tem texto próprio.
  - `ChannelIcon` `smtp` → ícone `Server` do `lucide-react`.
  - `ChannelChoice`:
    - quarto cartão "Por outro provedor (SMTP)", com o texto da spec §6;
    - compor → "Usar" em `/app/email/new?via=smtp`; navegar → "Ver envios por SMTP" em `emailListHref("smtp")`;
    - grade: 3 cartões → `xl:grid-cols-3`; 2 ou 4 → duas colunas a partir de `md`.
- [ ] **Step 4: Lista.** Em `app/email/page.tsx`:
  - `smtp: true` na disponibilidade;
  - escolha e lista com `getSenderAccountView(..., "SMTP")`;
  - `provider` mapeia `smtp` → `"SMTP"`;
  - `new/page.tsx` passa `smtp={data.smtp}` ao `ChannelChoice`.
- [ ] **Step 5: i18n.** pt e en com as mesmas chaves novas:
  - `channel.smtp*`;
  - `smtp.*`: formulário, ajudas e `smtp.error.<código>` para os 7 códigos de `SmtpConnectError`, mais `password_required`, com os textos da tabela 4.1;
  - `listChannel.smtp` "Envios por SMTP".

  Confira a contagem: `node -e` somando as chaves dos dois arquivos, que precisam ter o mesmo total.
- [ ] **Step 6: Verificação.**
  - Os cinco + check:email.
  - `npm run dev` (ou o servidor já na 3000), logado como o dono do seed. Confira que:
    - `/app/email` mostra o cartão SMTP;
    - `/app/email/smtp` abre;
    - "Testar e salvar" com o Gmail e uma senha errada mostra "O servidor recusou o usuário ou a senha.".

  Registre o que conferiu.
- [ ] **Step 7: Commit** `[E-mail] - Adiciona as telas da conta SMTP`.

---

### Task 6: Formulário do e-mail, relatório e textos de pausa

**Files:**
- Modify: `src/app/[locale]/app/email/new/page.tsx`, `src/app/[locale]/app/email/[id]/edit/page.tsx`, `src/components/email/email-composer.tsx`, `src/app/[locale]/app/email/[id]/page.tsx`, `src/messages/pt.json`, `src/messages/en.json`

**Interfaces:**
- Consumes: `ComposerDraft.channel "SMTP"` (Task 4), `emailComposerData().smtp` (Task 2), `smtpSendMinutes`, `smtpHourlyLimit` (Task 1), `failureMessageKey`, `pausedMessageKey`, `listPausedMessageKey` (Task 1)
- Produces: `EmailComposer` com a prop `smtp: SenderAccountView | null`.

- [ ] **Step 1: Novo e editar.**
  - `via=smtp` vale sempre que houver conta SMTP `ACTIVE`; sem ela, redireciona para `/app/email/new`.
  - `VIA_CHANNEL.smtp = "smtp"`.
  - O rascunho nasce com `channel: "SMTP"`.
  - Novo e editar passam `smtp={data.smtp}` ao `EmailComposer`.
  - Com o SMTP sempre disponível, a regra "sem nenhuma caixa → direto para a plataforma" não acontece mais. Mantenha o código simples, sem esse ramo morto.
- [ ] **Step 2: `EmailComposer`.**
  - `isSmtp`; `isMailbox` inclui o SMTP; `account` = `smtp` quando `isSmtp`.
  - Chip `smtpChip` ("conta SMTP") e aviso `smtpMissing`.
  - Na confirmação do SMTP, `minutes = smtpSendMinutes(nowCount, account.hourlyLimit ?? LIMITS.smtpHourlyDefault)`:
    - `minutes >= 90` → `confirmSmtpPaceHours` ("No limite de {perHour} por hora, esta parte leva cerca de {hours} h.", com `hours = round(minutes / 60)`);
    - senão `confirmSmtpPace` ("No limite de {perHour} por hora, esta parte leva cerca de {minutes, plural, …}.");
    - depois, `confirmSmtpSent` ("Nenhuma cópia fica em Enviados de {email}, e o provedor não informa entrega nem abertura.").
  - As frases parcial/total da Microsoft continuam (são neutras).
- [ ] **Step 3: Relatório.**
  - `report.viaSmtp` ("Enviado pela conta SMTP {email}") e `report.noTrackingSmtp`.
  - O motivo de falha de cada destinatário passa a usar `t(failureMessageKey(b.channel, failure.key))`.
- [ ] **Step 4: i18n.** pt e en, com o tom das versões Google atuais:
  - `paused.smtp_*`: os 5 motivos. O `daily_limit` cita os dois casos ("o limite do dia informado foi atingido ou o provedor recusou por limite de envio");
  - `listReason.paused.smtp_*`: 4 motivos;
  - `failure.smtp_message_too_large` ("O e-mail ficou grande demais para o servidor SMTP.");
  - `smtpChip`, `smtpMissing`, `confirmSmtpPace`, `confirmSmtpPaceHours`, `confirmSmtpSent`, `report.viaSmtp`, `report.noTrackingSmtp`.

  Mesma contagem nos dois arquivos.
- [ ] **Step 5: Os cinco + check:email.** No navegador (local), abra `/app/email/new?via=smtp` sem conta e confira que volta para a escolha. Se houver conta local, confira o chip.
- [ ] **Step 6: Commit** `[E-mail] - Leva o canal SMTP ao formulário e ao relatório`.

---

### Task 7: Documentação e verificação completa

**Files:**
- Modify: `README.md` (parágrafo do E-mail em massa + runbook §8), `docs/guia/06-antes-de-commitar.md` (linha do `nodemailer`)

- [ ] **Step 1: README.**
  - **Parágrafo do E-mail:** uma frase sobre o canal SMTP, cobrindo:
    - spec;
    - `/app/email/smtp`;
    - limites por hora e por dia da empresa;
    - proteção de endereço;
    - sem Enviados e sem rastreio.
  - **§8:** um bloco "Envio por SMTP", com:
    - aplicar `20261021120000_email_sender_smtp` com `db execute` + `migrate resolve` (nunca `migrate deploy`);
    - nenhuma variável nova;
    - suporte: `tls_failed` → usar o servidor do provedor; 465 sem resposta → 587 com STARTTLS; limite por hora baixo deixa o envio lento e um restart do Passenger para o envio até "Retomar envio".
- [ ] **Step 2: Guia 06.** O `nodemailer` monta MIME para Microsoft/Google e também envia por SMTP no canal SMTP.
- [ ] **Step 3: Verificação.** `npm run typecheck && npx eslint . --ignore-pattern ".claude/**" && npm run build && npm run check:isolation && npm run check:node && npm run check:email`. Esperado: tudo verde. Confira também a paridade de chaves pt/en.
- [ ] **Step 4: Commit** `[E-mail] - Documenta o envio por SMTP`.

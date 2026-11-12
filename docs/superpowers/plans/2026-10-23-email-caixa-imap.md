# Caixa de entrada por IMAP (conta SMTP) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Caixa de entrada" no canal SMTP do E-mail, lendo a caixa da empresa por IMAP (mesmo login do
SMTP), com o mesmo comportamento da caixa Microsoft: listar, buscar, abrir (marca lido), anexos e responder.

**Architecture:** Um backend IMAP novo (`src/lib/email-broadcast/imap/`) devolve os mesmos tipos da caixa
Microsoft (`InboxView`, `MailboxResult`…), e os componentes da caixa ganham uma prop `channel`
(`"microsoft" | "smtp"`). As configurações do IMAP vão dentro das credenciais criptografadas da conta SMTP (sem
migração). Regras puras em `imap/core.ts` e `imap/parse.ts` (testadas pelo `check:email`); o código de servidor é
testado por um script de integração novo (`check:imap`) contra uma caixa descartável da Ethereal.

**Tech Stack:** Next 16.3.6, Node 20, Prisma 6, zod 3.25, `imapflow@2.3.0`, `postal-mime@4.0.5`, nodemailer 10
(já no repo), tsx + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-10-23-email-caixa-imap-design.md`

## Global Constraints

- Branch `feature/email-caixa-imap` (de `origin/main` 540c3b4, sem upstream). **Sem merge**: termina com push + link
  de PR.
- Dependências exatas: `npm install --save-exact imapflow@2.3.0 postal-mime@4.0.5`; `check:node` tem de passar.
- **Sem migração:** IMAP (`imapHost`, `imapPort`, `imapSecurity`) dentro de `EmailSenderAccount.credentials`; conta
  antiga sem esses campos abre com `imap: null` e segue só enviando.
- Escritas na caixa permitidas, e só estas: `\Seen` ao abrir, `\Answered` no original ao responder, APPEND da cópia
  da resposta em Enviados. Proibido no código: `messageDelete`, `messageMove`, `messageCopy`, `expunge`,
  `mailboxDelete`, `mailboxRename`, `mailboxCreate` (guarda estática no `check:email`, Task 1).
- A senha nunca vai para o navegador, log, auditoria ou erro: textos técnicos passam por `redactSmtpSecrets`; logs
  só com a primeira linha do erro. Ligar o IMAP ou trocar servidor/porta dele exige digitar a senha.
- Rede: o host IMAP passa por `resolveSmtpHost` (guarda anti-rede-interna do SMTP); conectar no IP checado com SNI =
  host digitado; `rejectUnauthorized: true`; porta 143 só com STARTTLS obrigatório.
- Uma conexão IMAP por pedido: `logger: false`, `disableAutoIdle: true`, tempos 15 s (conexão) / 10 s (saudação) /
  30 s (socket), ouvinte de `error` sempre, `logout` no `finally`.
- Ids na URL: e-mail `msg=<uidvalidity>.<uid>`; anexo `a=<índice>`. E-mail acima de 15 MB não é baixado nem
  analisado (cabeçalhos + aviso "abra no webmail").
- Acesso: telas `email` e `emailInbox` + módulo `marketing` (igual à Microsoft); sem variável de piloto.
- i18n pt/en em paridade e contagem de chaves atualizada no `CLAUDE.md` (3173 hoje).
- Antes de cada commit: `npm run typecheck && npx eslint . --ignore-pattern ".claude/**" && npm run build && npm run check:isolation && npm run check:node`
  + `npm run check:email` (+ `npm run check:imap` a partir da Task 2). Commit `[E-mail] - Verbo + Tarefa`, corpo
  estruturado, última linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ambiente local: o Docker Desktop não abre sozinho (abrir o `Docker Desktop.exe` e `docker compose up -d postgres`);
  rotas de API em dev só com `npx next dev --webpack` em :3000, reiniciado depois de `npm install`/`npm run build`.
- Guias no mesmo commit: 05 (rota nova), 06 (`check:email` / `check:imap`), 04 (tela `emailInbox`); README §8.

## Review Focus

1. Conta SMTP antiga (sem IMAP) ou que nunca liga o IMAP → envio igual a antes, sem aba de caixa; editar outros
   campos continua reaproveitando a senha. Testes: Task 2 (credencial antiga abre com `imap: null`), Task 3 (regra da
   senha), Task 7 (conta sem IMAP não mostra a aba).
2. Senha trocada no provedor depois de salvar → a caixa mostra o painel de reconectar, nunca 500 nem carregamento
   eterno. Teste: Task 4 (senha errada → `reconnect`).
3. E-mail em latin1/Windows-1252 (comum no Brasil) e HTML com imagem `cid:` → assunto e corpo legíveis, imagem
   embutida. Testes: Task 1 (`detailFromParsed` com cid) e Task 4 (fixture latin1 "Promoção de outubro").
4. Busca com aspas, barra invertida ou acento → nada de erro de protocolo. Teste: Task 4 (`a"b\` e "promoção").
5. `msg`/`a` adulterados (UIDVALIDITY de outra caixa, não numérico, número gigante, índice fora da lista) → "não
   encontrado" / 400, nunca outro e-mail nem queda. Testes: Task 1 (`parseImapMessageRef`, `isAttachmentIndex`),
   Task 4 (UIDVALIDITY errada e índice inexistente → `not_found`).

---

### Task 1: Núcleo IMAP puro + dependências

**Files:**
- Create: `src/lib/email-broadcast/imap/core.ts` (puro, sem built-ins do Node: o formulário do cliente importa)
- Create: `src/lib/email-broadcast/imap/parse.ts` (puro, pode usar `Buffer`; sem `server-only`)
- Modify: `package.json`, `package-lock.json` (as duas dependências exatas)
- Modify: `scripts/check-email-broadcast.ts` (seção "IMAP"), `docs/guia/06-antes-de-commitar.md` (parágrafo do `check:email`)

**Interfaces — Produces:**
```ts
// core.ts
export const IMAP_PORTS = [993, 143] as const;
export type ImapPort = (typeof IMAP_PORTS)[number];
export type ImapSecurity = "ssl" | "starttls";
export type ImapSettings = { host: string; port: ImapPort; security: ImapSecurity };
export function defaultImapSecurity(port: ImapPort): ImapSecurity;           // 993 → "ssl", 143 → "starttls"
export function suggestImapHost(smtpHost: string): string;
export function imapMessageRef(uidValidity: number, uid: number): string;    // "123.45"
export function parseImapMessageRef(value: unknown): { uidValidity: number; uid: number } | null;
export function isAttachmentIndex(value: unknown): value is string;          // /^\d{1,3}$/
export type ImapConnectError = "auth_failed" | "tls_failed" | "connection_failed" | "host_not_found" | "host_not_allowed" | "failed";
export function imapConnectError(e: { authenticationFailed?: boolean; code?: string | null; message?: string | null }): ImapConnectError;
export function pickSentFolder(folders: { path: string; specialUse?: string | null }[]): string | null;
export function replyHeaders(original: { subject: string; messageId: string | null; references: string[] }): { subject: string; headers: Record<string, string> };
export function replyOutcome(o: MailboxSendOutcome): "sent" | "uncertain" | "failed";
export type ImapListItem = { uid: number; uidValidity: number; subject: string | null; from: { name?: string; address?: string }[]; date: Date; seen: boolean; hasAttachments: boolean };
export function summaryFromImap(item: ImapListItem): InboxMessageSummary;   // id = imapMessageRef(...), preview ""
// parse.ts
export type ImapBodyNode = { type?: string; disposition?: string; dispositionParameters?: Record<string, string>; parameters?: Record<string, string>; childNodes?: ImapBodyNode[] };
export function hasAttachmentsInStructure(node: ImapBodyNode | undefined): boolean;
export function listedAttachments(parsed: Pick<Email, "attachments" | "html">): { index: number; attachment: Attachment }[];
export function detailFromParsed(summary: InboxMessageSummary, parsed: Email): InboxMessageDetail;
export const IMAP_MAX_MESSAGE_BYTES = 15 * 1024 * 1024;
```
`Email`/`Attachment` = `import type` de `postal-mime`. `MailboxSendOutcome` de `mailbox/core.ts`; `InboxMessageSummary`/`InboxMessageDetail` de `microsoft/inbox-core.ts`.

- [ ] **Step 1: Instalar** `npm install --save-exact imapflow@2.3.0 postal-mime@4.0.5`; `npm run check:node` passa (se não, parar e relatar).
- [ ] **Step 2: Escrever a seção "IMAP" no `check:email`** (estilo `check(name, fn)` do arquivo):
  - `suggestImapHost`: `"smtpi.kinghost.net"`, `"smtp.kinghost.net"`, `"SMTPI.KingHost.NET"` → `"imap.kinghost.net"`; `"smtpi.uni5.net"` → `"imap.uni5.net"`; `"smtp.hostinger.com"` → `"imap.hostinger.com"`; `"smtp.mail.yahoo.com"` → `"imap.mail.yahoo.com"`; `"smtps.empresa.com.br"` → `"imap.empresa.com.br"`; `"mail.empresa.com.br"` → `"mail.empresa.com.br"`; `""` → `""`.
  - `defaultImapSecurity(993)` `"ssl"`, `(143)` `"starttls"`.
  - `parseImapMessageRef`: `"123.45"` → `{123,45}`; `null` para `"0.45"`, `"12.0"`, `"a.1"`, `"1"`, `"1.2.3"`, `" 1.2"`, `"4294967296.1"`, `"1.4294967296"`, `12`; `imapMessageRef(123,45)` → `"123.45"`.
  - `isAttachmentIndex`: `"0"`, `"12"` sim; `"1234"`, `"-1"`, `"1.2"`, `"a"` não.
  - `imapConnectError`: `{authenticationFailed:true}` → `auth_failed`; `{code:"ENOTFOUND"}` → `host_not_found`; `{code:"ERR_TLS_CERT_ALTNAME_INVALID"}` e `{code:"DEPTH_ZERO_SELF_SIGNED_CERT"}` → `tls_failed`; `{code:"ECONNREFUSED"}`, `{code:"ETIMEDOUT"}`, `{code:"ECONNRESET"}` → `connection_failed`; `{}` → `failed`.
  - `pickSentFolder`: `[{path:"INBOX"},{path:"INBOX.Sent"}]` → `"INBOX.Sent"` (KingHost); `[{path:"Sent Mail",specialUse:"\\Sent"},{path:"Sent"}]` → `"Sent Mail"`; `[{path:"enviados"}]` → `"enviados"`; `[{path:"INBOX"}]` → `null`.
  - `replyHeaders({subject:"Promoção",messageId:"<a@x>",references:["<r1@x>"]})` → `{subject:"Re: Promoção", headers:{"In-Reply-To":"<a@x>","References":"<r1@x> <a@x>"}}`; assunto `"RE: oi"` e `"Res: oi"` ficam iguais; `messageId:null` → `headers:{}`.
  - `replyOutcome`: `{ok:true}` → `sent`; `{ok:false,status:0,stage:"send",…}` → `uncertain`; `status:550` → `failed`; `status:0,stage:"prepare"` → `failed`.
  - `summaryFromImap` (uidValidity 7, uid 9, `from:[{name:"Fulano",address:"Fulano@X.com"}]`, `seen:true`, `subject:null`) → `{id:"7.9", subject:"", from:{name:"Fulano",email:"fulano@x.com"}, isRead:true, preview:""}`.
  - `hasAttachmentsInStructure`: multipart com filho `disposition:"attachment"` → true; só `text/plain` + `text/html` → false; imagem `inline` sem nome → false.
  - `detailFromParsed` com HTML `<img src="cid:img1">`, um anexo inline `contentId:"<img1>"` PNG e um PDF `tabela.pdf`: `bodyDocument` contém `data:image/png;base64,`; `attachments` = `[{id:"1", name:"tabela.pdf", contentType:"application/pdf", downloadable:true}]` (id = índice original); só texto → `bodyDocument` com o texto escapado; `webLink` null. Limites de imagens embutidas iguais aos da Microsoft (≤10, ≤1,5 MB cada, ≤4 MB no total).
  - Guarda estática: nenhum `.ts` em `src/lib/email-broadcast/imap/` casa `/\b(messageDelete|messageMove|messageCopy|expunge|mailboxDelete|mailboxRename|mailboxCreate)\b/`.
- [ ] **Step 3: `npm run check:email`** — esperado: FAIL (módulos `imap/core` e `imap/parse` não existem).
- [ ] **Step 4: Implementar `core.ts` e `parse.ts`** conforme as interfaces. `suggestImapHost`: minúsculas; troca o primeiro rótulo `smtp`/`smtpi`/`smtps` por `imap`; senão devolve o host. `detailFromParsed`: HTML → `replaceCidImages` + `inboxBodyDocument({contentType:"html",…})`; só texto → `inboxBodyDocument({contentType:"text",…})`; anexos de `listedAttachments` (tira os inline cujo `cid:` aparece no HTML).
- [ ] **Step 5: `npm run check:email`** — esperado: todos ✓. Guia 06: o parágrafo do `check:email` passa a citar as regras puras do IMAP.
- [ ] **Step 6: Cinco checagens + `check:email`; commit** `[E-mail] - Adiciona o núcleo puro da caixa por IMAP` (inclui o spec e este plano).

### Task 2: Conexão IMAP, credenciais com IMAP e o `check:imap`

**Files:**
- Create: `src/lib/email-broadcast/imap/connect.ts` (`server-only`)
- Create: `scripts/check-email-imap.ts`, `scripts/tsconfig.server.json`, `scripts/shims/server-only.ts`
- Modify: `src/lib/email-broadcast/smtp/core.ts` (`SmtpSettings` ganha `imap?: ImapSettings | null`), `src/lib/email-broadcast/smtp/credentials.ts`
- Modify: `package.json` (`"check:imap": "tsx --tsconfig scripts/tsconfig.server.json --env-file=.env scripts/check-email-imap.ts"`), guia 06 (parágrafo do `check:imap`)

**Interfaces — Produces:**
```ts
export type ImapAuth = { user: string; pass: string };
export async function openImap(settings: ImapSettings, auth: ImapAuth): Promise<{ ok: true; client: ImapFlow } | { ok: false; error: ImapConnectError; technical: string }>;
export async function closeImap(client: ImapFlow): Promise<void>;   // logout; cai para close(); nunca lança
export async function verifyImapSettings(settings: ImapSettings, auth: ImapAuth): Promise<{ ok: true } | { ok: false; error: ImapConnectError; technical: string }>;
// credentials.ts
sealSmtpSettings(s: SmtpSettings): string;          // grava imapHost/imapPort (texto)/imapSecurity quando s.imap
openSmtpSettings(sealed: string): SmtpSettings | null;   // devolve imap: ImapSettings | null (null se ausente ou inválido; nunca invalida o SMTP)
```
Harness do `check:imap` (as próximas tasks só acrescentam checks): `type ImapCtx = { stamp: number; ethereal: { user: string; pass: string; smtp: {host,port,secure}; imap: {host,port,secure} }; orgId: string; prisma: PrismaClient }`; arrays `checks` e `cleanups`; `main()` cria a conta Ethereal (`nodemailer.createTestAccount()`, até 3 tentativas — rede instável), uma org de teste `IMAP-E2E-${stamp}` e roda os checks; a limpeza apaga org e conta SMTP **sempre** (`finally`). O shim `scripts/shims/server-only.ts` é `export {};` e o `tsconfig.server.json` estende o raiz com `paths: { "server-only": ["./scripts/shims/server-only.ts"], "@/*": ["./src/*"] }` (testado: carrega módulos de servidor e o `env.ts`).

- [ ] **Step 1: Escrever o harness e os checks:**
  - `sealSmtpSettings` → `openSmtpSettings` com `imap:{host:"imap.kinghost.net",port:993,security:"ssl"}` volta igual; sem `imap` volta `imap:null` e o resto idêntico; credencial antiga (selada com o código de hoje, sem chaves IMAP — use `encryptCredentials` direto com só os campos SMTP) abre com `imap:null`; `imapPort:"110"` selado à mão abre com `imap:null` e SMTP intacto.
  - `verifyImapSettings` contra a Ethereal (`imap.ethereal.email`, 993, ssl) com o login dela → `{ok:true}`; senha errada → `auth_failed`; host `127.0.0.1` → `host_not_allowed`; o `technical` de qualquer falha nunca contém a senha.
- [ ] **Step 2: `npm run check:imap`** — esperado: FAIL (`imap/connect` não existe).
- [ ] **Step 3: Implementar** `connect.ts` (regras de rede e tempos da seção Global Constraints; nome exato da opção de SNI conferido no `.d.ts` do imapflow) e as credenciais.
- [ ] **Step 4: `npm run check:imap`** e `npm run check:email` — esperado: todos ✓.
- [ ] **Step 5: Guia 06** (o `check:imap` precisa de rede, Postgres do Docker e cria/apaga a própria org). **Cinco checagens + checks; commit** `[E-mail] - Adiciona a conexão IMAP e o check de integração`.

### Task 3: Formulário da conta SMTP com IMAP (paralela à Task 4)

**Files:**
- Modify: `src/lib/email-broadcast/smtp/core.ts` (`canKeepSmtpPassword` considera o IMAP)
- Modify: `src/lib/validations/email-smtp-account.ts`, `src/app/actions/email-sender-accounts.ts`
- Modify: `src/lib/email-broadcast/types.ts` (`SmtpAccountFormView.imap: ImapSettings | null`, `SenderAccountView.imapHost: string | null`), `src/lib/queries/email-sender-accounts.ts`
- Modify: `src/components/email/smtp-account-form.tsx`, `src/app/[locale]/app/email/smtp/page.tsx`
- Modify: `src/messages/pt.json`, `src/messages/en.json`, `CLAUDE.md` (contagem), `scripts/check-email-broadcast.ts`

**Interfaces:**
- Consumes: `IMAP_PORTS`, `ImapSettings`, `defaultImapSecurity`, `suggestImapHost`, `ImapConnectError` (Task 1); `verifyImapSettings` e credenciais com `imap` (Task 2).
- Produces: `smtpAccountSchema` aceita `imapHost?: string` ("" = sem IMAP) e `imapPort?: 993 | 143`; a saída ganha `imap: ImapSettings | null` (segurança derivada da porta). `canKeepSmtpPassword(saved & { imap: ImapSettings | null }, next & { imap: ImapSettings | null })`. `SmtpSaveResult.error` ganha `` `imap_${ImapConnectError}` `` e `"invalid_imap_host"`. `SenderAccountView.imapHost` (só SMTP; null nos outros e sem IMAP).

- [ ] **Step 1: Checks no `check:email`:** schema com `imapHost:""` → `imap:null`; `"imap.kinghost.net"` + `993` → `{host,993,"ssl"}`; `143` → `"starttls"`; porta `110` → erro `invalid_imap_port`; host `"imap://x"` → `invalid_imap_host`. Regra da senha: IMAP null→null e igual→igual mantêm; null→ligado, troca de host, porta ou segurança do IMAP → **não** mantém; ligado→null mantém.
- [ ] **Step 2: `npm run check:email`** — esperado: FAIL.
- [ ] **Step 3: Implementar** schema, regra da senha e `saveSmtpAccount`: depois do `verifySmtpSettings` ok, com `imap` testa `verifyImapSettings(imap, {user: username, pass: password})`; falha → `{ok:false, error:` `` `imap_${e}` `` `, technical}` e nada é salvo. `getSmtpAccountForm` devolve `imap`; `getSenderAccountView` devolve `imapHost`.
- [ ] **Step 4: Formulário:** seção "Caixa de entrada (IMAP)" com caixa de seleção "Mostrar a caixa de entrada no MétodoAI"; ligada, mostra servidor (preenchido com `suggestImapHost(host)` se vazio) e porta (993 SSL / 143 STARTTLS); dica: usa o mesmo usuário e senha do envio, e ligar ou trocar o servidor pede a senha de novo. Textos em pt/en (`emailBroadcast.smtp.form.imap*`, `emailBroadcast.smtp.error.imap_*`, `invalid_imap_host`); contagem no `CLAUDE.md`.
- [ ] **Step 5: `npm run check:email`** — esperado: todos ✓. **Cinco checagens + checks; commit** `[E-mail] - Adiciona o IMAP ao formulário da conta SMTP`.

### Task 4: Leitura da caixa por IMAP + rota de anexo (paralela à Task 3)

**Files:**
- Create: `src/lib/email-broadcast/imap/inbox.ts` (`server-only`), `src/app/api/email/smtp/attachment/route.ts`
- Modify: `scripts/check-email-imap.ts` (seção "caixa"), `docs/guia/05-rotas-e-jobs.md` (linha na tabela)

**Interfaces:**
- Consumes: Tasks 1 e 2; tipos `MailboxResult`, `InboxView`, `InboxAttachmentDownload` (`import type` de `microsoft/inbox.ts`).
- Produces:
```ts
export async function loadImapInboxView(organizationId: string, opts: { search: string; unreadOnly: boolean; messageId: string | null }): Promise<MailboxResult<InboxView>>;
export async function imapUnreadCount(organizationId: string): Promise<number | null>;
export async function downloadImapAttachment(organizationId: string, messageId: string, index: string): Promise<MailboxResult<InboxAttachmentDownload>>;
```
Regras: conta = `tenantDb(organizationId).emailSenderAccount.findFirst({ where: { provider: "SMTP" } })`; sem conta ou sem `imap` → `no_account`; status ≠ ACTIVE ou `auth_failed` → `reconnect`; outra falha de conexão → `temporary`. Uma conexão, `getMailboxLock("INBOX")` (leitura e escrita), `release` e `closeImap` no `finally`. Lista: sem filtro/busca, sequência `max(1, exists-49):*`; com filtro/busca, `search({seen:false})` / `{text: q}` (combinados) em UIDs e os 50 maiores; mais recente primeiro. E-mail aberto: UIDVALIDITY diferente → detalhe `not_found`; `size` > `IMAP_MAX_MESSAGE_BYTES` → cabeçalhos + aviso; senão `fetchOne(source)` + `PostalMime.parse` + `detailFromParsed`; não lido → `messageFlagsAdd(uid, ["\\Seen"])` e a lista/contagem já refletem. Não lidas = `status("INBOX",{unseen:true}).unseen`. Anexo: mesmo `source` + `listedAttachments` + índice; fora da lista → `not_found`. Rota: igual à da Microsoft (sessão → 401; telas `email` e `emailInbox` + `marketing` → 403; `parseImapMessageRef(m)` e `isAttachmentIndex(a)` → 400; `not_found` 404, `reconnect`/`no_account` 409, resto 502; download `application/octet-stream` + `nosniff` + `no-store`).

- [ ] **Step 1: Checks de integração** (a conta SMTP da org de teste aponta para a Ethereal com IMAP; as mensagens entram mandando pelo SMTP da própria Ethereal, que guarda tudo na INBOX): M1 texto em ISO-8859-1, assunto "Promoção de outubro", de `cliente@exemplo.com.br`; M2 HTML com imagem `cid:` e o anexo `tabela.pdf`. Asserções:
  - lista com M2 antes de M1, as duas não lidas, M2 com `hasAttachments`;
  - `unreadOnly` → 2; busca `"promoção"` → só M1; busca `a"b\` → `ok:true`;
  - abrir M2 → `bodyDocument` com `data:image/png;base64,` e anexo `tabela.pdf`; na mesma resposta M2 aparece lido e `unreadCount` 1;
  - `downloadImapAttachment(M2, "<índice>")` devolve os mesmos bytes do PDF; índice `"9"` → `not_found`;
  - `msg` com UIDVALIDITY trocada → detalhe `not_found`;
  - conta com senha errada → `reason:"reconnect"`; `imapUnreadCount` → número.
- [ ] **Step 2: `npm run check:imap`** — esperado: FAIL (`imap/inbox` não existe).
- [ ] **Step 3: Implementar** `inbox.ts` e a rota.
- [ ] **Step 4: `npm run check:imap`** — esperado: todos ✓. Guia 05: linha "Usuário logado baixando anexo da caixa IMAP".
- [ ] **Step 5: Cinco checagens + checks; commit** `[E-mail] - Adiciona a leitura da caixa por IMAP`.

### Task 5: Responder pela caixa IMAP

**Files:**
- Modify: `src/lib/email-broadcast/smtp/send.ts` (extrair `sendSmtpMime`), `src/lib/email-broadcast/imap/inbox.ts`, `src/app/actions/email-inbox.ts`, `scripts/check-email-imap.ts` (seção "resposta")

**Interfaces:**
- Produces:
```ts
export async function sendSmtpMime(settings: SmtpSettings, envelope: { from: string; to: string[] }, mime: Buffer): Promise<MailboxSendOutcome>;  // sendSmtpMail = buildMime + sendSmtpMime
export async function replyToImapMessage(organizationId: string, messageId: string, text: string): Promise<MailboxResult<{ accountId: string; to: string | null; uncertain: boolean; savedToSent: boolean }>>;
export async function replyToSmtpInboxMessage(messageId: string, text: string): Promise<InboxReplyResult>;   // server action
```
Fluxo: original por `fetchOne(uid, { envelope: true, headers: ["message-id", "references", "reply-to"] })`; destinatário = Reply-To ?? From (nenhum → `not_found`); `replyHeaders`; `buildMime({ from: {name: displayName, address: email}, to, replyTo: null, subject, html: replyHtmlFromText(text), text, headers, attachments: [] })`; `sendSmtpMime`; `replyOutcome`: `failed` → `temporary`, `uncertain` → `{uncertain:true}` sem APPEND; `sent` → `append(pickSentFolder(list()), mime, ["\\Seen"])` (falha no APPEND só vira `savedToSent:false`) e `messageFlagsAdd(uid, ["\\Answered"])`. A action repete os portões da Microsoft, valida `parseImapMessageRef` e `REPLY_MAX_CHARS`, e audita `email_sender.replied` com `meta: { to, channel: "SMTP" }`.

- [ ] **Step 1: Checks:** responder M1 → `ok`, `uncertain:false`, `savedToSent:true`; a INBOX da Ethereal recebe "Re: Promoção de outubro" com `In-Reply-To` = Message-ID de M1; a pasta de Enviados da Ethereal (`\Sent`) ganha 1 mensagem; M1 fica com `\Answered`. `sendSmtpMail` continua passando nos checks de envio que já existem.
- [ ] **Step 2: `npm run check:imap`** — esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: `npm run check:imap` e `npm run check:email`** — esperado: todos ✓.
- [ ] **Step 5: Cinco checagens + checks; commit** `[E-mail] - Adiciona a resposta pela caixa IMAP`.

### Task 6: Tela — aba Caixa de entrada no canal SMTP

**Files:**
- Modify: `src/lib/email-broadcast/microsoft/inbox-core.ts`, `src/lib/queries/email-inbox.ts`
- Rename: `src/components/email/inbox/microsoft-tabs.tsx` → `mailbox-tabs.tsx`
- Modify: `src/components/email/inbox/email-inbox.tsx`, `inbox-reply.tsx`, `inbox-search.tsx`, `src/components/email/channel-choice.tsx`, `src/app/[locale]/app/email/page.tsx`
- Modify: `src/messages/pt.json`, `en.json`, `CLAUDE.md` (contagem), `scripts/check-email-broadcast.ts`, `docs/guia/04-modulos-e-permissoes.md`

**Interfaces:**
```ts
export type MailboxChannel = "microsoft" | "smtp";
export type MailboxTab = "envios" | "caixa";                       // era MicrosoftTab
export function mailboxTabFromParam(param: string | string[] | undefined): MailboxTab;   // era microsoftTabFromParam
export function inboxHref(state?: { canal?: MailboxChannel; filtro?: InboxFilter; q?: string; msg?: string }): string;  // canal padrão "microsoft"
export function MailboxTabs(props: { channel: MailboxChannel; active: MailboxTab; unread: Promise<number | null> | null }): JSX.Element;
export async function mailboxSendsTo(organizationId: string, channel: "MICROSOFT" | "SMTP", emails: (string | null)[]): Promise<SentToAddress[]>;  // substitui microsoftSendsTo
```
`EmailInbox` e `InboxReply` ganham `channel: MailboxChannel`: SMTP usa `loadImapInboxView`, `mailboxSendsTo("SMTP")`, `SenderAccountPanel provider="SMTP"`, anexo em `/api/email/smtp/attachment` e `replyToSmtpInboxMessage`. Os textos que citam o Outlook ficam só no canal Microsoft; o SMTP ganha `emailBroadcast.inbox.smtp.*` (dica da resposta "sai de {email} e uma cópia fica em Enviados", "resposta incerta: confira em Enviados antes de tentar de novo"). Página: `inboxScreen = canAccessScreen(ctx, "emailInbox")`; caixa SMTP só com `inboxScreen && smtpAccount?.status === "ACTIVE" && smtpAccount.imapHost`; `msg` validado por canal (`isGraphId` / `parseImapMessageRef`); contador de não lidas por canal (`inboxUnreadCount` / `imapUnreadCount`, em stream como hoje); `ChannelChoice` ganha `smtpInbox?: { href; unread } | null` (botão "Abrir caixa de entrada" no cartão SMTP).

- [ ] **Step 1: Checks no `check:email`:** `inboxHref({canal:"smtp",filtro:"nao-lidas",q:"x",msg:"1.2"})` → `"/app/email?canal=smtp&aba=caixa&filtro=nao-lidas&q=x&msg=1.2"`; `inboxHref()` igual a antes; `mailboxTabFromParam("caixa")`/`("x")`.
- [ ] **Step 2: `npm run check:email`** — esperado: FAIL.
- [ ] **Step 3: Implementar** e trocar todas as chamadas (`microsoftTabFromParam`, `MicrosoftTabs`, `microsoftSendsTo`); textos pt/en e contagem; guia 04 (a tela `emailInbox` cobre Microsoft e a conta SMTP com IMAP).
- [ ] **Step 4: `npm run check:email`, `npm run typecheck`** — esperado: verdes; os checks antigos da caixa Microsoft continuam passando.
- [ ] **Step 5: Cinco checagens + checks; commit** `[E-mail] - Abre a caixa de entrada no canal SMTP`.

### Task 7: Ponta a ponta no navegador, runbook e PR

**Files:** `README.md` (§8: "E-mail: caixa de entrada por IMAP"); script do teste no workspace do plano (fora do git), como no teste do SMTP (Edge headless por CDP).

- [ ] **Step 1: Teste no navegador** com `npx next dev --webpack`, logado como o dono do seed na org local: conectar uma conta Ethereal SMTP + IMAP pelo formulário (`imap.ethereal.email`/993); conta sem IMAP não mostra a aba; ligar o IMAP sem digitar a senha → erro "senha"; mandar 2 e-mails pela Ethereal; abrir `/app/email?canal=smtp&aba=caixa`; ver a lista e o contador no cartão do canal; abrir (fica lido); responder (aviso de enviado); baixar o anexo (200, `application/octet-stream`). Capturas no workspace.
- [ ] **Step 2: README §8:** editar a conta SMTP do Varandas, ligar o IMAP (`imap.kinghost.net`, 993), digitar a senha e salvar; a saída na 993 a partir da Hostinger ainda não foi provada — o primeiro "Testar e salvar" prova; conta de revenda usa `imap.uni5.net`.
- [ ] **Step 3: Rodada completa** (cinco checagens + `check:email` + `check:imap`); commit `[E-mail] - Documenta a caixa de entrada por IMAP`.
- [ ] **Step 4:** `git push -u origin feature/email-caixa-imap` e link `https://github.com/Grupo-Vannuchi/metodo-ai-new/compare/main...feature/email-caixa-imap?expand=1` com título e corpo (o corpo termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). **Não fazer merge.**

## Paralelismo

Ordem: Task 1 → Task 2 → (Task 3 ∥ Task 4 → Task 5) → Task 6 → Task 7. As Tasks 3 e 4 não tocam os mesmos
arquivos (a 3 mexe em formulário, schema, action e consultas da conta; a 4 em `imap/inbox.ts`, rota e
`check-email-imap.ts`) e podem rodar em worktrees separadas, juntadas antes da Task 5.

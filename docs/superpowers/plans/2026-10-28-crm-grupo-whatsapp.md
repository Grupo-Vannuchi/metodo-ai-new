# Contatos do CRM num grupo do WhatsApp — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "Adicionar a grupo do WhatsApp" em CRM → Contatos (pasta aberta ou contatos marcados).
- Ele usa o número conectado da própria pessoa.
- Adiciona os contatos, um por vez, a um grupo em que esse número é admin.
- Manda o link do grupo no privado a quem o WhatsApp recusa por privacidade.
- Mostra o resultado de cada contato.

**Architecture:**
- **Regras puras:** `src/lib/whatsapp/group-add/core.ts`, mais parsers puros da Evolution em
  `src/lib/integrations/evolution-groups.ts`. São testados pelo `check:group-add`, sem rede.
- **Chamadas novas da Evolution:** em `evolution-client.ts`.
- **Dados:** duas tabelas, rodada e itens, registradas no `TENANT_MODELS`.
- **Executor de sistema** (`group-add/runner.ts`), no molde do e-mail em massa:
  - trava em `lastDispatchAt`;
  - o item vira `PROCESSING` antes de cada chamada;
  - `after()` quando não há fila, e job do QStash quando há;
  - uma rota de cron nova retoma as rodadas devidas.
- **Actions finas** em `src/app/actions/whatsapp-group-add.ts`, chamando `group-add/service.ts`.
- **Telas:** diálogo no CRM, página de acompanhamento e seção na página do contato.
- **Testes do servidor:** `check:group-add:e2e`, contra uma Evolution falsa em loopback e o Postgres local.

**Tech Stack:** Next 16.3.6 (`after` de `next/server`), Node 20, Prisma 6 (`engineType = "client"` + `PrismaPg`),
zod 3.25, next-intl, Evolution API v2 (Baileys), tsx + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-10-28-crm-grupo-whatsapp-design.md`

## Global Constraints

- **Branch:** `feature/crm-grupo-whatsapp`, de `origin/main` 85b5710, sem upstream. O spec está em 88b30b2.
  **Sem merge:** o trabalho termina com push e link de PR, depois da revisão final.
- **Ritmo:** pausa aleatória de 30 a 90 s entre uma pessoa e a próxima. A previsão usa 60 s por pessoa.
- **Horário:** nenhuma chamada de adicionar ou de convite sai fora das 08:00–20:00 de São Paulo, todos os dias.
  São Paulo é UTC−3 fixo, como em `saoPauloDayStart` (`src/lib/tasks/board-core.ts`).
- **Teto:** 100 pessoas por dia por número.
  - O número é o `senderKey` da rodada: os dígitos do `ownerJid` da instância (`jidDigits`). Sem `ownerJid`,
    nenhum grupo fica liberado, porque não dá para confirmar o admin.
  - O dia é o dia corrido de São Paulo.
  - Contam `ADDED`, `INVITED` e `FAILED` com `processedAt`.
  - Não contam `ALREADY_IN`, `NO_WHATSAPP`, `SKIPPED`, `LEFT_GROUP` e `ALREADY_INVITED`.
  - O convite não conta a mais.
- **Uma rodada `RUNNING` por `senderKey`, em qualquer empresa.** As outras ficam `QUEUED` e sobem por ordem de
  criação quando a anterior vira `DONE` ou `CANCELED`. Uma rodada `PAUSED` segura a fila.
- **Grupo:** até 1.024 participantes.
- **Escritas no WhatsApp:** só duas são permitidas: adicionar participante e mandar o texto do convite.
  - Proibido em `src/lib/whatsapp/group-add/`: `/group/sendInvite`, `"remove"`, `"promote"`, `"demote"` e
    `updateSetting`.
  - Uma guarda estática no `check:group-add` garante isso (Task 2).
- **Convite:**
  - o link vem de `GET /group/inviteCode`, uma vez por rodada, e fica guardado na rodada;
  - o texto é o que a pessoa escreveu, com `{{nome}}` e `{{grupo}}`;
  - o link vai sempre numa linha própria no fim;
  - padrão pt: "Oi {{nome}}! Este é o link para entrar no grupo {{grupo}}:".
- **Opt-out:** quem tem opt-out nunca é adicionado nem recebe convite.
- **Queda no meio:** um item que ficou `PROCESSING` depois de uma queda vira `FAILED` com motivo `interrupted` e
  nunca é refeito.
- **Logs:** levam o id do item ou da rodada. Nunca o telefone inteiro, nunca o texto do convite.
- **Multi-tenant:**
  - actions e consultas usam `tenantDb`;
  - o executor, o cron e a promoção por número usam o Prisma cru com `organizationId` explícito;
  - a conta do teto e da fila por `senderKey` cruza empresas e só lê contagens e ids.
- **Credenciais da Evolution:** só por `resolveEvoCreds()` / `loadEvoCredsById()`. A conexão usada é a da própria
  pessoa: `ownerId = ctx.userId`, `provider: "EVOLUTION"`.
- **Acesso:**
  - tela `contacts` mais os módulos `crm` e `inbox`; o servidor resolve e passa como prop;
  - pausar, retomar e cancelar ficam com quem começou a rodada, ou com `hasRole(ctx.role, "ADMIN")`.
- **Migração:** por `migrate diff`. Nunca `migrate dev`, `reset` ou `db push`.
  - Pasta: `20261028120000_whatsapp_group_add`.
  - É aplicada no Supabase antes do merge, com um parágrafo no README §8.
- **i18n:** pt e en com as mesmas chaves (hoje 3236). Recontar e atualizar o número em:
  - `CLAUDE.md:66`;
  - guia 02 (`:23` e `:38`);
  - guia 04 (`:165`).
- **Antes de cada commit:**

  ```bash
  npm run typecheck && npx eslint . --ignore-pattern ".claude/**" --ignore-pattern ".superpowers/**" && npm run build && npm run check:isolation && npm run check:node
  ```

  Rodar também `npm run check:group-add`, e `npm run check:group-add:e2e` a partir da Task 2. O typecheck só
  depois que o build terminar. O `npm run lint` canônico roda uma vez no fim.
- **Commit:** `[CRM] - Verbo + Tarefa`, corpo estruturado, linha Co-Authored-By do próprio ambiente.
- **Ambiente local:**
  - o Docker Desktop não abre sozinho: abrir à mão e depois `docker start metodoai-db`;
  - `next dev --webpack` em :3000;
  - não matar processos de outras sessões.
- **Guias no mesmo commit** do que mudou:
  - 03: `TENANT_MODELS`, asserções do `check:isolation`, arquivos em `src/lib/queries`;
  - 04: gating;
  - 05: cron novo;
  - 06: scripts novos;
  - README §7 e §8.

## Review Focus

1. **Telefone em formatos diferentes.** O telefone do CRM está num formato e o participante em outro: com ou sem
   55, com 8 ou 9 dígitos, com máscara. Tem de ser reconhecido como o mesmo número ("Já estava no grupo", "Saiu do
   grupo"). Teste: Task 1 (`phoneMatchKey`).
2. **O próprio número sem identificação clara.** Ele aparece no grupo como `@lid` sem `phoneNumber`, ou o
   `ownerJid` vem com `:device`. O grupo não pode aparecer como "você é admin" por engano. Ele fica bloqueado com
   "não foi possível confirmar que você é admin". Teste: Task 2 (`isAdminOf` → `null`, `jidDigits`).
3. **Corpo inesperado da Evolution.** Ela responde 200 ao adicionar, mas sem `updateParticipants`, ou com status
   numérico. O item vira `FAILED` com motivo `unknown_answer`, e não sai convite. Testes: Task 2
   (`participantUpdateCode`) e Task 4.
4. **Número cai e o banco diz ACTIVE.** O número cai no meio da rodada, mas o banco continua com `ACTIVE`. A rodada
   pausa como `disconnected` pelo `connectionState` ao vivo, sem tentar adicionar. Teste: Task 4.
5. **Dois cliques em "Começar".** Sai uma rodada só. A segunda chamada devolve `already_running`. Teste: Task 4
   (`startGroupAdd` duas vezes).

---

### Task 1: Regras puras + `check:group-add`

**Files:**
- Create: `src/lib/whatsapp/group-add/core.ts`. Puro: sem `server-only`, importa só `@/lib/phone`,
  `@/lib/whatsapp/group-import` e `@/lib/tasks/board-core`.
- Create: `scripts/check-whatsapp-group-add.ts`.
- Modify: `package.json`: `"check:group-add": "tsx scripts/check-whatsapp-group-add.ts"`.
- Modify: `docs/guia/06-antes-de-commitar.md`: parágrafo logo depois do `check:groups`.

**Interfaces — Produces:**
```ts
export const GROUP_ADD_DAILY_CAP = 100;
export const GROUP_ADD_WINDOW = { startHour: 8, endHour: 20 } as const; // São Paulo
export const GROUP_ADD_PAUSE_SECONDS = { min: 30, max: 90 } as const;
export const GROUP_ADD_FORECAST_SECONDS = 60;
export const WHATSAPP_GROUP_MAX = 1024;
export const GROUP_ADD_MAX_CONTACTS = 1000;
export const INVITE_TEXT_MAX = 1000;
export type GroupAddItemStatus = "PENDING" | "PROCESSING" | "ADDED" | "INVITED" | "ALREADY_IN" | "NO_WHATSAPP"
  | "SKIPPED" | "LEFT_GROUP" | "ALREADY_INVITED" | "FAILED";
export const CAP_COUNTED: readonly GroupAddItemStatus[]; // ["ADDED", "INVITED", "FAILED"]
export type SkipReason = "no_phone" | "opted_out" | "not_mobile" | "duplicate";
export function phoneMatchKey(raw: string | null | undefined): string | null;
export type CandidateInput = { contactId: string; name: string; phone: string | null; optedOut: boolean };
export type PreviousOutcome = { phoneKey: string; status: "ADDED" | "INVITED" };
export type PlannedItem = { contactId: string; name: string; phone: string | null; phoneKey: string | null;
  status: "PENDING" | "ALREADY_IN" | "NO_WHATSAPP" | "SKIPPED" | "LEFT_GROUP" | "ALREADY_INVITED"; reason: SkipReason | null };
export function planGroupAdd(contacts: readonly CandidateInput[], participantKeys: ReadonlySet<string>,
  previous: readonly PreviousOutcome[]): PlannedItem[];
export type GroupAddCounts = { total: number; pending: number; alreadyIn: number; noWhatsapp: number; skipped: number;
  leftGroup: number; alreadyInvited: number };
export function countPlan(items: readonly { status: GroupAddItemStatus }[]): GroupAddCounts;
export type AddOutcome = "ADDED" | "NEEDS_INVITE" | "ALREADY_IN" | "FAILED";
export function outcomeFromCode(code: string | null): AddOutcome;
export function isInsideWindow(now: Date): boolean;
export function nextWindowStart(now: Date): Date;
export function nextAttemptAt(now: Date, pauseSeconds: number): Date;
export function capResumeAt(now: Date): Date;
export function pickPauseSeconds(random: () => number): number;
export function renderInvite(template: string, vars: { nome: string; grupo: string }, inviteUrl: string): string;
export function forecastFinish(now: Date, remaining: number, usedToday: number): Date;
```

- [ ] **Step 1: Write the failing checks.** Use the `check(name, fn)` + `node:assert/strict` style of
  `scripts/check-whatsapp-groups.ts`. The final line is `✅ group-add: ${passed} checks passed.`. All instants below
  are UTC.
  - **`phoneMatchKey`:**
    - `"(11) 98765-4321"`, `"5511987654321"`, `"+55 11 98765-4321"` and `"551187654321"` (12 digits, no 9) give the
      same key;
    - `null`, `""` and `"abc"` give `null`.
  - **`planGroupAdd`:** one case per rule, in this precedence:
    1. opt-out → `SKIPPED` / `opted_out`, even when the number is in the group;
    2. no phone → `SKIPPED` / `no_phone`;
    3. landline `"(11) 3333-4444"` → `NO_WHATSAPP` / `not_mobile`;
    4. in the group → `ALREADY_IN`;
    5. previous `ADDED` and not in the group → `LEFT_GROUP`;
    6. previous `INVITED` and not in the group → `ALREADY_INVITED`;
    7. previous `INVITED` and in the group today → `ALREADY_IN`;
    8. a second contact with the same key → `SKIPPED` / `duplicate`;
    9. everyone else → `PENDING`.

    The output keeps the input order.
  - **`countPlan`** of that result, with the exact numbers.
  - **`outcomeFromCode`:** `"200"` → `ADDED`, `"403"` → `NEEDS_INVITE`, `"409"` → `ALREADY_IN`. `"408"`, `"500"`
    and `null` → `FAILED`.
  - **`isInsideWindow`:** `2026-10-28T10:59:59Z` is `false`. `T11:00:00Z` and `T22:59:59Z` are `true`.
    `T23:00:00Z` is `false`.
  - **`nextWindowStart`:**
    - from `2026-10-28T23:30:00Z` → `2026-10-29T11:00:00Z`;
    - from `2026-10-28T08:00:00Z` → `2026-10-28T11:00:00Z`;
    - inside the window → the same instant.
  - **`nextAttemptAt`:** `(2026-10-28T22:59:30Z, 60)` → `2026-10-29T11:00:00Z`. `(2026-10-28T12:00:00Z, 45)` →
    `2026-10-28T12:00:45Z`.
  - **`capResumeAt`:** `(2026-10-28T12:00:00Z)` → `2026-10-29T11:00:00Z`.
  - **`pickPauseSeconds`:** `(() => 0)` → 30, `(() => 0.999999)` → 90, always an integer.
  - **`renderInvite`:**
    - `("Oi {{nome}}! Este é o link para entrar no grupo {{grupo}}:", { nome: "Ana", grupo: "Ofertas" },
      "https://chat.whatsapp.com/AbC")` → `"Oi Ana! Este é o link para entrar no grupo Ofertas:\n\nhttps://chat.whatsapp.com/AbC"`;
    - a text that already ends with the same link does not repeat it;
    - `{{ nome }}` with spaces is replaced too.
  - **`forecastFinish`:**
    - `(2026-10-28T12:00:00Z, 50, 0)` → `T12:50:00Z`;
    - `(T12:00:00Z, 50, 80)` → `2026-10-29T11:30:00Z`;
    - `(2026-10-28T22:30:00Z, 50, 0)` → `2026-10-29T11:20:00Z`;
    - `remaining` 0 → `now`.
- [ ] **Step 2:** `npm run check:group-add` → FAIL (module not found).
- [ ] **Step 3: Implement `core.ts`.**
  - `phoneMatchKey` is `normalizeWhatsappNumber` → `normalizeGroupNumber` → `brPhoneKey`, returning `null` when a
    step yields nothing.
  - `not_mobile` means `!looksLikeWhatsappMobile(normalizeWhatsappNumber(phone))`.
  - Days and hours derive from `saoPauloDayStart`.
  - `forecastFinish` simulates person by person:
    - each one takes 60 s, starting at `nextWindowStart(t)`;
    - it counts against the São Paulo day, resetting the count on day change;
    - at the cap it jumps to `capResumeAt`.
- [ ] **Step 4:** `npm run check:group-add` → PASS.
- [ ] **Step 5: Guide 06 and commit.** Add the guide 06 paragraph, shaped like the `check:groups` one. It ends with
  "Não usa banco nem rede. Rode sempre que mexer em `src/lib/whatsapp/group-add/core.ts` ou em
  `src/lib/integrations/evolution-groups.ts`." Commit: `[CRM] - Adiciona as regras puras de contatos num grupo do WhatsApp`.

### Task 2: Evolution — parsers puros, chamadas novas, Evolution falsa

**Files:**
- Modify: `src/lib/integrations/evolution-groups.ts` (pure): parsers.
- Modify: `src/lib/integrations/evolution-client.ts`: calls, using the private `req()`, each with its own timeout.
- Create: `scripts/shims/fake-evolution.ts`. HTTP on `127.0.0.1:0`, returning `{ port, close, calls, set }`:
  - per-route handlers that the test can swap;
  - it records method, path, query and body of every call.
- Create: `scripts/check-whatsapp-group-add-e2e.ts`:
  - script `"check:group-add:e2e": "tsx --tsconfig scripts/tsconfig.server.json --env-file=.env scripts/check-whatsapp-group-add-e2e.ts"`;
  - structure of `scripts/check-email-imap.ts`: `check(name, run(ctx))` registry, final line
    `check:group-add:e2e — ${n} checks passed`.
- Modify: `scripts/check-whatsapp-group-add.ts`: parser checks and the static guard.
- Modify: `package.json` and guide 06: the e2e paragraph, with prerequisites.

**Interfaces — Produces:**
```ts
// evolution-groups.ts
export function jidDigits(jid: string): string; // strips ":device" and the domain; "" for @lid/@g.us
export type EvoGroupSummary = { jid: string; subject: string; size: number; announce: boolean | null;
  participants: GroupParticipant[]; unresolved: number }; // unresolved = participants dropped by parseGroupParticipants
export function parseGroupList(data: unknown): EvoGroupSummary[]; // array or { groups: [...] }; only *@g.us
export function isAdminOf(group: Pick<EvoGroupSummary, "participants" | "unresolved">, ownDigits: string): boolean | null;
export function ownerJidFrom(data: unknown, instance: string): string | null; // v2 [{ name, ownerJid }] and v1 [{ instance: { instanceName, owner } }]
export function participantUpdateCode(data: unknown): string | null; // updateParticipants[0].status, number → string
export function existsOnWhatsapp(data: unknown): boolean | null; // [{ exists }]
export function inviteUrlFrom(data: unknown): string | null; // only https://chat.whatsapp.com/…; builds it from inviteCode
// evolution-client.ts ({i} = encodeURIComponent(creds.instance))
export async function fetchAllGroups(creds: EvoCreds): Promise<EvoGroupSummary[] | null>; // GET /group/fetchAllGroups/{i}?getParticipants=true, 30000
export async function fetchGroupSummary(creds: EvoCreds, groupJid: string): Promise<EvoGroupSummary | null>; // GET /group/findGroupInfos/{i}?groupJid=…, 20000
export async function fetchOwnerJid(creds: EvoCreds): Promise<string | null>; // GET /instance/fetchInstances?instanceName={i}, 15000
export async function addGroupParticipant(creds: EvoCreds, groupJid: string, number: string): Promise<{ httpStatus: number; code: string | null }>;
  // POST /group/updateParticipant/{i}?groupJid=…, { action: "add", participants: [number] }, 30000
export async function checkOnWhatsapp(creds: EvoCreds, number: string): Promise<boolean | null>; // POST /chat/whatsappNumbers/{i}, { numbers: [number] }, 15000
export async function fetchGroupInviteUrl(creds: EvoCreds, groupJid: string): Promise<string | null>; // GET /group/inviteCode/{i}?groupJid=…, 15000
export async function sendPlainText(creds: EvoCreds, number: string, text: string): Promise<{ ok: boolean; httpStatus: number }>;
  // POST /message/sendText/{i}, { number, text }, 30000; logs nothing with the number or the text
```

- [ ] **Step 1: Pure checks** in `check-whatsapp-group-add.ts`, with v2 payloads.
  - **`parseGroupList`.** Input:
    `[{ id: "120363000000000001@g.us", subject: "Ofertas", size: 3, announce: true, participants: [{ id: "5511987654321@s.whatsapp.net", admin: "superadmin" }, { id: "1@lid", phoneNumber: "5511912345678@s.whatsapp.net", admin: null }, { id: "2@lid", admin: null }] }, { id: "x@s.whatsapp.net" }]`.
    Expected: one group, 2 participants, `unresolved` 1, `announce` true.
  - **`isAdminOf`** on that group:
    - `"5511987654321"` → `true`;
    - `"5511912345678"` → `false`;
    - `"5511900000000"` → `null`, because `unresolved > 0`;
    - with `unresolved` 0 and the number absent → `false`.
  - **`jidDigits`:** `"5511987654321:12@s.whatsapp.net"` → `"5511987654321"`.
  - **`ownerJidFrom`:**
    - v2: `[{ name: "inst", ownerJid: "5511987654321@s.whatsapp.net" }]`;
    - v1: `[{ instance: { instanceName: "inst", owner: "5511987654321@s.whatsapp.net" } }]`;
    - another instance name → `null`.
  - **`participantUpdateCode`:** `{ updateParticipants: [{ status: "403" }] }` → `"403"`, `[{ status: 200 }]` →
    `"200"`, `{}` → `null`.
  - **`existsOnWhatsapp`:** `[{ exists: false }]` → `false`, `{}` → `null`.
  - **`inviteUrlFrom`:**
    - `{ inviteUrl: "https://chat.whatsapp.com/AbC" }` → the same URL;
    - `{ inviteCode: "AbC" }` → `"https://chat.whatsapp.com/AbC"`;
    - `{ inviteUrl: "http://evil.example/x" }` → `null`.
  - **Static guard:** reads every `.ts` in `src/lib/whatsapp/group-add/` and asserts that `core.ts` was read. No
    file may contain `sendInvite`, `"remove"`, `"promote"`, `"demote"` or `updateSetting`, and `evolution-client.ts`
    has no `action: "remove" | "promote" | "demote"`.
- [ ] **Step 2: e2e checks** (no database in this task). Each one starts its own fake, with creds
  `{ baseUrl: "http://127.0.0.1:<port>", apiKey: "e2e", instance: "e2e" }`:
  - every new call hits the right method, path, query and body;
  - every call parses the fake's answer;
  - the fake closing the connection → `addGroupParticipant` gives `{ httpStatus: 0, code: null }` and
    `sendPlainText` gives `{ ok: false, httpStatus: 0 }`;
  - a 500 on `sendText` → no captured `console.error` line contains `5511987654321` or the text.
- [ ] **Step 3:** Run both scripts → FAIL.
- [ ] **Step 4:** Implement the parsers and calls. `fetchGroupSummary` reuses `parseGroupList([g])` on the same
  shape `findGroupInfo` accepts. `findGroupInfo` stays as it is.
- [ ] **Step 5:** `npm run check:group-add`, `npm run check:group-add:e2e` and `npm run check:groups` → PASS.
- [ ] **Step 6:** Guide 06 (e2e paragraph) and commit `[WhatsApp] - Adiciona as chamadas de grupo da Evolution para o CRM`.

### Task 3: Tabelas, migração e isolamento

**Files:**
- Modify: `prisma/schema.prisma`: new block after the CRM section.
- Create: `prisma/migrations/20261028120000_whatsapp_group_add/migration.sql`.
- Modify: `src/lib/tenant-db.ts`: `"WhatsappGroupAddRun", "WhatsappGroupAddItem"` at the end of `TENANT_MODELS`.
- Modify: `scripts/check-isolation.ts`: block `// 16)`, plus the deletes in the `finally`.
- Modify: `docs/guia/03-multi-tenancy.md`: "78 hoje" → 80, "24 asserções" → 27, and the data list at line 155.
- Modify: `README.md` §8: "Antes do merge da branch `feature/crm-grupo-whatsapp`" with `db execute` +
  `migrate resolve --applied 20261028120000_whatsapp_group_add` (additive: 2 enums + 2 tables). **Not**
  `migrate deploy`.

**Interfaces — Produces (exact schema):**
```prisma
enum WhatsappGroupAddStatus { QUEUED RUNNING PAUSED DONE CANCELED }
enum WhatsappGroupAddItemStatus { PENDING PROCESSING ADDED INVITED ALREADY_IN NO_WHATSAPP SKIPPED LEFT_GROUP ALREADY_INVITED FAILED }

/// Adding a set of CRM contacts to one WhatsApp group through the member's own number (spec 2026-10-28).
model WhatsappGroupAddRun {
  id             String                 @id @default(cuid())
  organizationId String
  /// IntegrationConnection.id (loose: deleting the connection keeps the history).
  connectionId   String
  /// The phone behind the connection: the instance's ownerJid digits. Cap and queue are per senderKey.
  senderKey      String
  createdById    String
  groupJid       String
  groupName      String
  inviteText     String                 @db.Text
  inviteUrl      String?
  status         WhatsappGroupAddStatus @default(QUEUED)
  /// "manual" | "disconnected" | "not_admin" | "no_connection" | "error"
  pausedReason   String?
  /// "pace" | "window" | "cap" | "unavailable" — why nextAttemptAt is in the future
  waitReason     String?
  nextAttemptAt  DateTime?
  lastError      String?
  /// Runner lease (src/lib/whatsapp/group-add/runner.ts).
  lastDispatchAt DateTime?
  startedAt      DateTime?
  finishedAt     DateTime?
  createdAt      DateTime               @default(now())
  updatedAt      DateTime               @updatedAt

  items WhatsappGroupAddItem[]

  @@index([organizationId, createdAt])
  @@index([organizationId, status])
  @@index([organizationId, groupJid])
  @@index([senderKey, status])
  @@map("whatsapp_group_add_runs")
}

/// One contact in a run. Unique per (run, contact): nobody is processed twice in a run.
model WhatsappGroupAddItem {
  id             String                     @id @default(cuid())
  organizationId String
  runId          String
  /// Loose reference: deleting the contact keeps the history.
  contactId      String
  contactName    String
  position       Int
  phone          String?
  phoneKey       String?
  senderKey      String
  status         WhatsappGroupAddItemStatus @default(PENDING)
  /// WhatsApp's per-number code from the add call ("200", "403", …).
  code           String?
  /// SkipReason | "interrupted" | "uncertain" | "unknown_answer" | "http_<n>" | "no_invite_link" | "invite_failed"
  reason         String?
  processedAt    DateTime?
  updatedAt      DateTime                   @updatedAt

  run WhatsappGroupAddRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([runId, contactId])
  @@index([runId, status, position])
  @@index([organizationId, contactId])
  @@index([senderKey, processedAt])
  @@map("whatsapp_group_add_items")
}
```

- [ ] **Step 1:** Write block `// 16)` in `check-isolation.ts`:
  - create a run and an item in org A, using a fake `contactId`;
  - assert org B lists no runs and no items;
  - assert a second item with the same `(runId, contactId)` fails with `P2002`.

  That is 3 new assertions, 27 in total. In the `finally`, delete runs by `organizationId` before the orgs; items go
  with the cascade.
- [ ] **Step 2:** `npm run check:isolation` → FAIL (the model does not exist).
- [ ] **Step 3:** Edit the schema and generate the migration:

  ```bash
  TMP=$(mktemp -d); git show origin/main:prisma/schema.prisma > "$TMP/schema-main.prisma"
  mkdir -p prisma/migrations/20261028120000_whatsapp_group_add
  npx prisma migrate diff --from-schema-datamodel "$TMP/schema-main.prisma" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261028120000_whatsapp_group_add/migration.sql
  ```

  Open the SQL. It may contain only `CREATE TYPE`, `CREATE TABLE`, `CREATE [UNIQUE] INDEX` and the FK from items to
  runs. Remove `warn` lines. Anything else means stop and report. Then:

  ```bash
  npx prisma db execute --file prisma/migrations/20261028120000_whatsapp_group_add/migration.sql --schema prisma/schema.prisma
  npx prisma migrate resolve --applied 20261028120000_whatsapp_group_add
  npx prisma generate
  ```
- [ ] **Step 4:** Add the models to `TENANT_MODELS`. `npm run check:isolation` → PASS (27).
- [ ] **Step 5:** Guide 03, README §8, the full validation, and commit `[CRM] - Adiciona as tabelas das rodadas de grupo do WhatsApp`.

### Task 4: Serviço, executor e consultas (e2e com banco)

**Files:**
- Create: `src/lib/whatsapp/group-add/runner.ts` (`server-only`; raw Prisma, explicit `organizationId`).
- Create: `src/lib/whatsapp/group-add/service.ts` (`server-only`; org data via `tenantDb`).
- Create: `src/lib/queries/whatsapp-group-add.ts` (DAL, `tenantDb`).
- Modify: `scripts/check-whatsapp-group-add-e2e.ts`: database checks.
  - `assertLocalDatabase()` as in `check-email-imap.ts`.
  - Throwaway org, user and membership, slug `wga-e2e-<stamp>`.
  - EVOLUTION connection seeded with `encryptCredentials` from `@/lib/integrations/crypto`, pointing at the fake.
    Its fields: `ownerId` = the user, `status: "ACTIVE"`.
  - Cleanup in the `finally`: runs (items cascade), contacts, folders, connections, memberships, users, orgs.
- Modify: guide 03 (the new file in `src/lib/queries`; the executor and the promotion as system contexts) and
  guide 06 (the e2e paragraph).

**Interfaces:**
- **Consumes:** Task 1 (all of it), Task 2 (calls and parsers), Task 3 (models), `loadEvoCredsById`,
  `connectionState`, `isQueueConfigured`/`enqueue`, `after`.
- **Produces:**

```ts
// runner.ts
/** @internal test seam */
export const groupAddRuntime: { now: () => Date; sleep: (ms: number) => Promise<void>; random: () => number; leaseMs: number; chunkMs: number };
  // production: real clock, setTimeout, Math.random, 90_000, 10_000
export async function kickGroupAddRun(runId: string): Promise<void>; // queue: enqueue("whatsapp-group-add", { runId }); otherwise after(() => runGroupAddRun(runId))
export async function runGroupAddRun(runId: string, opts?: { budgetMs?: number }): Promise<{ done: boolean; retryAfterSec?: number }>;
export async function promoteQueuedRuns(senderKey: string): Promise<string[]>; // RUNNING if none on that senderKey; advisory lock
export async function findDueGroupAddRuns(now: Date): Promise<string[]>;
  // RUNNING with nextAttemptAt <= now (or null) and lease free. PAUSED "disconnected" whose number answers "open"
  // moves back to RUNNING (or QUEUED behind another RUNNING run on the same senderKey), in system context with
  // explicit organizationId, before its id is returned.
// service.ts
export type GroupOption = { jid: string; subject: string; size: number; announce: boolean | null; admin: boolean | null };
export type GroupAddSource = { kind: "folder"; folderId: string | null } | { kind: "contacts"; contactIds: string[] };
export type GroupAddError = "no_connection" | "disconnected" | "unavailable" | "not_admin" | "not_found" | "empty" | "already_running";
export async function listMyGroups(organizationId: string, userId: string): Promise<{ ok: true; groups: GroupOption[] } | { ok: false; error: GroupAddError }>;
export async function previewGroupAdd(organizationId: string, userId: string, source: GroupAddSource, groupJid: string):
  Promise<{ ok: true; group: GroupOption; counts: GroupAddCounts; usedToday: number; forecastAt: string; overLimit: boolean } | { ok: false; error: GroupAddError }>;
export async function startGroupAdd(organizationId: string, userId: string, input: { source: GroupAddSource; groupJid: string; inviteText: string }):
  Promise<{ ok: true; runId: string } | { ok: false; error: GroupAddError }>;
export async function pauseGroupAdd(organizationId: string, runId: string): Promise<boolean>;
export async function resumeGroupAdd(organizationId: string, runId: string): Promise<{ ok: true } | { ok: false; error: GroupAddError }>;
export async function cancelGroupAdd(organizationId: string, runId: string): Promise<boolean>;
export async function pokeGroupAdd(organizationId: string, runId: string): Promise<void>; // kick if due and the lease is free
// queries/whatsapp-group-add.ts
export type GroupAddRunView = { id: string; groupName: string; status: "QUEUED" | "RUNNING" | "PAUSED" | "DONE" | "CANCELED";
  pausedReason: string | null; waitReason: string | null; nextAttemptAt: Date | null; createdById: string; startedAt: Date | null;
  finishedAt: Date | null; counts: Record<GroupAddItemStatus, number>;
  items: { contactId: string; contactName: string; status: GroupAddItemStatus; reason: string | null; processedAt: Date | null }[] };
export async function getGroupAddRunView(organizationId: string, runId: string): Promise<GroupAddRunView | null>;
export async function listContactGroupAdds(organizationId: string, contactId: string):
  Promise<{ runId: string; groupName: string; status: GroupAddItemStatus; processedAt: Date | null; createdById: string }[]>;
```

**Behavior that the tests pin:**
- **Connection used by the service.** The caller's newest `provider: "EVOLUTION"` connection with
  `ownerId = userId`.
  - None → `no_connection`.
  - `connectionState` not `open` → `disconnected`.
  - Evolution out of reach → `unavailable`.
  - The `senderKey` is `jidDigits(await fetchOwnerJid(creds))`.
  - No `ownerJid` → `listMyGroups` lists every group with `admin: null`, and start answers `not_admin`.
- **Start:**
  1. Re-reads the participants with `fetchGroupSummary`.
  2. `isAdminOf` not `true` → `not_admin`.
  3. Plans with `planGroupAdd`. `participantKeys` come from `phoneMatchKey` of the participants. `previous` comes
     from items in the same org, where `run.groupJid` = this group and the status is `ADDED` or `INVITED`.
  4. More than 1,024 participants after the `PENDING` ones → the overflow starts as `FAILED` / `group_full`, with
     no `processedAt`, so it does not count against the cap.
  5. Creates the run as `QUEUED` with its items: `position` = input order, `senderKey` copied.
  6. Calls `promoteQueuedRuns(senderKey)` and kicks every promoted run.

  A run `QUEUED`, `RUNNING` or `PAUSED` for the same group in the same org → `already_running`.
- **Runner, per loop.** One person at a time:
  1. Take the lease, with `lastDispatchAt` free or older than `leaseMs`. Without the lease, return `{ done: true }`.
  2. As the owner: items `PROCESSING` → `FAILED` / `interrupted`.
  3. Status not `RUNNING` → release and stop.
  4. Outside the window → `nextAttemptAt = nextWindowStart`, `waitReason = "window"`, release.
  5. Count today for the `senderKey` (`CAP_COUNTED`, `processedAt >= saoPauloDayStart(now)`) reaches 100 →
     `nextAttemptAt = capResumeAt`, `waitReason = "cap"`, release.
  6. `nextAttemptAt` in the future and less than `leaseMs` away → wait in chunks of `chunkMs`, renewing the lease
     each time. Otherwise release.
  7. `loadEvoCredsById` null → `PAUSED` / `no_connection`. `connectionState` `ok` and not `open` → `PAUSED` /
     `disconnected`. `!ok` → `nextAttemptAt = now + 5 min`, `waitReason = "unavailable"`.
  8. First person of the run, and each resume: `fetchGroupSummary` + `isAdminOf`. Not `true` → `PAUSED` /
     `not_admin`.
  9. Reserve the next `PENDING` by `position` (`updateMany` `PENDING` → `PROCESSING`; skip when the count is not 1).
  10. `checkOnWhatsapp`: `false` → `NO_WHATSAPP`, with no `processedAt` and no pause.
  11. `addGroupParticipant`:
      - `httpStatus 0` → `FAILED` / `uncertain`;
      - non-2xx → `FAILED` / `http_<n>`;
      - `code` null → `FAILED` / `unknown_answer`;
      - otherwise use `outcomeFromCode`.
  12. `NEEDS_INVITE`:
      - get the run's `inviteUrl`, fetching it once if needed. `null` → `FAILED` / `no_invite_link`;
      - `renderInvite(run.inviteText, { nome: contactName, grupo: groupName })` → `sendPlainText`;
      - ok → `INVITED`, else `FAILED` / `invite_failed`.
  13. Every add attempt writes `processedAt` and then `nextAttemptAt = nextAttemptAt(now, pickPauseSeconds(random))`
      with `waitReason = "pace"`.
  14. No `PENDING` left → `DONE` + `finishedAt`, release, then `promoteQueuedRuns(senderKey)` and kick.
  15. `LeaseLost` → `{ done: true }`. Any other error → `PAUSED` / `error`, with `lastError` free of phone and text.
- **Pause, resume, cancel:**
  - `pauseGroupAdd`: `QUEUED`/`RUNNING` → `PAUSED` / `manual`.
  - `resumeGroupAdd` re-checks the connection and the admin. It then sets `RUNNING`, or `QUEUED` when another run is
    `RUNNING` on the same `senderKey`, clears the reasons and kicks.
  - `cancelGroupAdd`: `QUEUED`/`RUNNING`/`PAUSED` → `CANCELED`, `PENDING` items stay `PENDING`. Then it calls
    `promoteQueuedRuns`.

- [ ] **Step 1: Write the e2e checks.**
  - **Shared setup.** `groupAddRuntime` with a controllable clock fixed at `2026-10-28T13:00:00Z`. `sleep` advances
    the clock without waiting. `random` → 0.
  - **The checks:**
    1. **`listMyGroups`:** marks `admin` `true` / `false` / `null` per group.
    2. **`previewGroupAdd`:** the exact counts for a folder with one contact per Task 1 status, including a previous
       run with `ADDED`/`INVITED`.
    3. **Full run.** The fake answers 200, 403, 409, HTTP 500, and `exists:false` for one number. End state:
       `ADDED`, `INVITED`, `ALREADY_IN`, `FAILED` (`http_500`), `NO_WHATSAPP`, then `DONE`. Also:
       - exactly one `sendText`, with `renderInvite`'s text and the link last;
       - no call to `/group/sendInvite`;
       - an opt-out contact appears in no request.
    4. **Window:** clock at `2026-10-28T23:05:00Z` → no `updateParticipant`; `nextAttemptAt = 2026-10-29T11:00:00Z`;
       `waitReason = "window"`.
    5. **Cap:** 100 `ADDED` items today on the same `senderKey`, in **another org** → no `updateParticipant`;
       `nextAttemptAt = 2026-10-29T11:00:00Z`; `waitReason = "cap"`.
    6. **Queue per number:** a second connection with the same `ownerJid` starts a run `QUEUED`. It turns `RUNNING`
       when the first one ends.
    7. **Disconnected:** `connectionState` `close` → `PAUSED` / `disconnected`, with no add. Back to `open`,
       `findDueGroupAddRuns` lists it and it continues.
    8. **Not admin** → `PAUSED` / `not_admin`, with no add.
    9. **Two runners:** two `runGroupAddRun` at the same time → one `updateParticipant` per number.
    10. **Leftover `PROCESSING`** item → `FAILED` / `interrupted`, with no call for that number.
    11. **`{}` answer** to `updateParticipant` → `FAILED` / `unknown_answer`, with no invite.
    12. **`startGroupAdd` twice** → the second returns `already_running`.
    13. **Org B** gets `null` from `getGroupAddRunView` for org A's run, and an empty `listContactGroupAdds`.
    14. **Logs:** no captured `console.error` line contains a contact's number.
    15. **Colleague's number:** a user with no connection of their own gets `no_connection` from `listMyGroups`,
        even when a colleague in the same org has an ACTIVE connection.
- [ ] **Step 2:** `npm run check:group-add:e2e` → FAIL.
- [ ] **Step 3:** Implement `runner.ts`, `service.ts` and `queries/whatsapp-group-add.ts`.
  - Lease, beat, `LeaseLost` and sweep follow `src/lib/email-broadcast/dispatch.ts` and `mailbox/deliver.ts`.
  - `promoteQueuedRuns` uses `prisma.$transaction` with `pg_advisory_xact_lock(hashtext('whatsapp_group_add:' || senderKey))`,
    as in `deliver.ts:233-247`.
- [ ] **Step 4:** `npm run check:group-add:e2e`, `npm run check:group-add` and `npm run check:isolation` → PASS.
- [ ] **Step 5:** Guides 03 and 06, the full validation, and commit `[CRM] - Adiciona o executor das rodadas de grupo do WhatsApp`.

### Task 5: Actions, job, cron e auditoria

**Files:**
- Create: `src/lib/validations/whatsapp-group-add.ts`.
  - `groupAddSourceSchema`: discriminated union by `kind`. `contactIds` takes 1 to 1,000 ids.
  - `groupAddStartSchema`: `groupJid` matches `/^\d+(-\d+)?@g\.us$/`; `inviteText` is trimmed, 1 to 1,000
    characters.
- Create: `src/app/actions/whatsapp-group-add.ts` (`"use server"`):

  ```ts
  type Fail = { ok: false; error: GroupAddError | "unauthorized" | "forbidden" | "invalid" | "unknown" };
  export async function listGroupsForAddAction(): Promise<{ ok: true; groups: GroupOption[] } | Fail>;
  export async function previewGroupAddAction(input: unknown): Promise<{ ok: true; ... } | Fail>; // same payload as previewGroupAdd
  export async function startGroupAddAction(input: unknown): Promise<{ ok: true; runId: string } | Fail>;
  export async function pauseGroupAddAction(runId: string): Promise<{ ok: true } | Fail>;
  export async function resumeGroupAddAction(runId: string): Promise<{ ok: true } | Fail>;
  export async function cancelGroupAddAction(runId: string): Promise<{ ok: true } | Fail>;
  export async function pokeGroupAddAction(runId: string): Promise<{ ok: true } | Fail>;
  ```

  Every action starts with the same `gate()`:
  - `getOrgContext()` null → `unauthorized`;
  - `!canAccessScreen(ctx, "contacts") || !hasModule(ctx.modules, "crm") || !hasModule(ctx.modules, "inbox")` →
    `forbidden`.

  On top of that:
  - pause, resume and cancel need `run.createdById === ctx.userId || hasRole(ctx.role, "ADMIN")`, else
    `forbidden`;
  - start, pause, resume and cancel call `audit`;
  - `revalidatePath` on `/app/contacts/grupos/${runId}`.
- Modify: `src/config/audit.ts`: `"whatsapp_group_add.started" | ".paused" | ".resumed" | ".canceled"`, and the
  entity `"WhatsappGroupAddRun"`. Labels in `audit.actions` and `audit.entities` in pt and en.
- Modify: `src/lib/jobs/index.ts`: `"whatsapp-group-add"` calls `runGroupAddRun(runId, { budgetMs: 50_000 })` and
  re-enqueues with `delaySeconds = retryAfterSec` while `!done`.
- Create: `src/app/api/cron/whatsapp-groups/route.ts`:
  - `export const runtime = "nodejs"` and `GET(req: Request)`;
  - first line: `if (!isCronAuthorized(req)) return cronUnauthorized();`;
  - then `findDueGroupAddRuns(new Date())` → `kickGroupAddRun` each;
  - returns `Response.json({ ok: true, resumed })`.
- Modify: guide 05:
  - the cron route goes into the list of crons, and "quatro" becomes "cinco" at L194 and L253;
  - the auth table.
- Modify: README §8:
  - a row in the crons table, `*/5 * * * *`, "Opcional: sem ele a rodada continua quando alguém abre a tela";
  - the matching curl line;
  - "quatro" becomes "cinco" at L460, L473 and L533.

- [ ] **Step 1:** Add checks to `check:group-add` for the schemas:
  - a valid `groupJid`, an invalid one (`"x@g.us"`), and `"5511…@s.whatsapp.net"`;
  - `inviteText` that is empty or has 1,001 characters;
  - `contactIds` that is empty or has 1,001 ids.

  Add to e2e: the cron's `findDueGroupAddRuns` ignores a run whose lease is still live.
- [ ] **Step 2:** FAIL → implement → PASS (`check:group-add`, `check:group-add:e2e`).
- [ ] **Step 3:** Run the cron route locally, with `next dev --webpack`:
  - `curl` without the header → 401;
  - with `Authorization: Bearer $CRON_SECRET` from `.env` → 200 `{ ok: true, resumed: 0 }`;
  - if `.env` has no `CRON_SECRET`, show 401 in both cases and say so in the report.
- [ ] **Step 4:** Full validation and commit `[CRM] - Adiciona as ações e o cron das rodadas de grupo do WhatsApp`.

### Task 6: Telas — botão, diálogo, acompanhamento e seção no contato

**Files:**
- Modify: `src/components/crm/folder-explorer.tsx`. New optional prop
  `renderOpenFolderActions?: (column: FolderColumn<T>) => React.ReactNode`, rendered in the header of the open folder
  (around L422-429).
- Modify: `src/components/crm/bulk-bar.tsx`. Optional prop `onAddToGroup?: () => void`, with the `Users` icon and
  the label `crm.bulk.addToGroup`.
- Modify: `src/components/crm/contacts-grid.tsx`. Prop `canAddToGroup: boolean`; when true, it wires the two
  entries to `GroupAddDialog`:
  - folder source: `{ kind: "folder", folderId: column.id }`;
  - selection source: `{ kind: "contacts", contactIds: ids }`.
- Modify: `src/app/[locale]/app/contacts/page.tsx`: `canAddToGroup = hasModule(ctx.modules, "inbox")`.
- Create: `src/components/crm/group-add-dialog.tsx`. A portal modal, as in `duplicates-modal.tsx`. It has three
  steps.
  1. **Group:** `listGroupsForAddAction`, with a search box. Each group shows its participants and one of: "você é
     admin", "você não é admin deste grupo", or "não foi possível confirmar que você é admin". The last two are
     disabled.
     - `no_connection` → "Conecte o seu WhatsApp em Conversas", with a link to `/app/inbox`.
     - `disconnected` → "Seu WhatsApp está desconectado. Reconecte em Conversas."
  2. **Conferir** (`previewGroupAddAction`):
     - the counts;
     - the privacy notice "Num grupo, todos veem o telefone de todos.";
     - "Neste grupo todos podem mandar mensagens." when `announce` is false;
     - "O grupo passaria de 1.024 participantes." when `overLimit`;
     - the invite textarea, with the default `crm.groupAdd.inviteDefault` and the hint "O link do grupo vai no fim
       da mensagem.";
     - the pace "1 pessoa a cada 30 a 90 segundos, só das 8h às 20h, até 100 por dia";
     - the forecast, from `forecastAt`.
  3. **Começar** (`startGroupAddAction`) → `router.push(`/app/contacts/grupos/${runId}`)`. Errors become toasts
     from `crm.groupAdd.error.*`.
- Create: `src/app/[locale]/app/contacts/grupos/[runId]/page.tsx`:
  - `force-dynamic`; the contacts layout already gates `contacts` + `crm`;
  - `!hasModule(ctx.modules, "inbox")` → `notFound()`;
  - `getGroupAddRunView` null → `notFound()`.
- Create: `src/components/crm/group-add-run.tsx` (client). It shows:
  - the header: group, a status chip, the reason for a pause or a wait, "X de Y" progress, and the forecast;
  - one row per contact, with a status chip;
  - the buttons Pausar, Retomar and Cancelar, according to the status and the permission computed on the server;
  - `AutoRefresh` (`src/components/email/auto-refresh.tsx`) while the run is `QUEUED` or `RUNNING`;
  - `pokeGroupAddAction` on mount.
- Modify: `src/app/[locale]/app/contacts/[id]/page.tsx`. A "Grupos do WhatsApp" section after the tasks, gated by
  `canInbox`, with `listContactGroupAdds` in the `Promise.all`. One line per item, for example "Adicionado ao grupo
  Ofertas da Semana em 28/10 por Fulano". Names come from `listMembers`, which is already loaded.
- Modify: `src/messages/pt.json` and `en.json`:
  - `crm.bulk.addToGroup`, `crm.groupAdd.*` and the audit labels;
  - pt status labels: "Na fila", "Em andamento", "Adicionado", "Convite enviado", "Já estava no grupo", "Sem
    WhatsApp", "Pulado", "Saiu do grupo", "Já recebeu o convite", "Não deu agora";
  - waits: "Aguardando o horário: volta às 8h", "Teto de 100 por dia atingido: volta amanhã às 8h", "Na fila: este
    número já está adicionando pessoas a outro grupo";
  - pauses: "Pausada por você", "WhatsApp desconectado", "Seu número não é mais admin do grupo", "Conexão removida",
    "Erro inesperado".
- Modify: the count in `CLAUDE.md`, guide 02 and guide 04, plus guide 04: the gating of `contacts` + `crm` +
  `inbox` for this feature.

- [ ] **Step 1:** Implement the screens and the texts. There is no React runner. The proof is typecheck, build and
  the browser in Task 7.
- [ ] **Step 2:** Leaf-key count with a node script: pt = en, the same key set, and the number written in the 4
  places.
- [ ] **Step 3:** Full validation and commit `[CRM] - Adiciona as telas de contatos num grupo do WhatsApp`.

### Task 7: Ponta a ponta no navegador e runbook

**Files:**
- Modify: `README.md`.
  - §7: a feature paragraph with the code pointers.
  - §8, the runbook:
    - migration before the merge;
    - optional cron;
    - the first real use with 5 to 10 contacts;
    - only between 8h and 20h;
    - tests only with team numbers;
    - log lines to watch.

- [ ] **Step 1: Local scenario.** A seed script in the scratch folder (not committed) creates an org, a user, an
  EVOLUTION connection pointing at the fake, which stays up, contacts and a folder. Then `next dev --webpack` and a
  headless browser (Edge via CDP). Run between 8h and 20h São Paulo, or the run waits. Scenarios:
  - (a) the button on the open folder and on the selection;
  - (b) a disabled group with its reason;
  - (c) the conference counts and the default invite text;
  - (d) Começar → the tracking page fills in, with real pauses of 30 to 90 s, using 3 contacts;
  - (e) Pausar, then Retomar;
  - (f) the section on the contact page;
  - (g) no connection → the message with the link to Conversas.

  The fake's records show one add per number and no `sendInvite`.
- [ ] **Step 2:** README §7 and §8, the canonical `npm run lint`, the full validation and every check, and commit
  `[CRM] - Documenta contatos do CRM num grupo do WhatsApp`.
- [ ] **Step 3, manual and outside the agents:** the real test, on a test group with 2 or 3 team numbers. One of
  them has group privacy set to "Meus contatos". This confirms the Baileys codes (200/403/409) and the `announce`
  field. If a code differs, it becomes a fix in `outcomeFromCode` with a check. Never with customers.

## Ordem

Tasks 1 → 2 → 3 → 4 → 5 → 6 → 7, in sequence. Each one depends on the interfaces of the one before. There is no
safe parallelism.

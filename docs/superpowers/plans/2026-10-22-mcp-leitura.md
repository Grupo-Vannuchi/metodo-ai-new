# MCP de leitura do MétodoAI — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servidor MCP só de leitura em `https://metodotia.com/api/mcp` para o Claude consultar
dados de qualquer organização do MétodoAI (buscas e resumos por módulo), sem expor dados sensíveis.

**Architecture:** Duas rotas Next — `/api/mcp` (chave no `Authorization: Bearer`) e
`/api/mcp/[key]` (chave no caminho) — chamam um handler único que autentica (404 em falha), limita a
taxa e atende cada POST com um `McpServer` novo + `WebStandardStreamableHTTPServerTransport` sem
sessão e com resposta JSON. As ferramentas são declaradas por módulo em `src/lib/mcp/tools/` e leem
por uma DAL nova em `src/lib/queries/mcp/` (`tenantDb(orgId)`, `select` explícito). Funções puras
(chave, datas, paginação, folha, varredura de campos sensíveis) ficam em `src/lib/mcp/core.ts` e são
testadas por `check:mcp`; o comportamento ponta a ponta é testado por `check:mcp:e2e` contra o
`next dev`, com dados plantados (incluindo um texto-sentinela em todo campo sensível).

**Tech Stack:** Next 16.3.6 (route handlers), Node 20, Prisma 6 + `@prisma/adapter-pg`, zod 3.25,
`@modelcontextprotocol/sdk` **1.32.1 exato**, tsx + `node:assert/strict` nos checks.

**Spec:** `docs/superpowers/specs/2026-10-22-mcp-leitura-design.md`

## Global Constraints

- Branch `feature/mcp-leitura` (já criada a partir de `origin/main` 14f0cd4). **Sem merge na `main`**:
  termina com push + link de PR; merge só com OK explícito do usuário.
- Só leitura: nenhum `create*`/`update*`/`upsert`/`delete*`/`$executeRaw*` em `src/lib/mcp/` e
  `src/lib/queries/mcp/` (o `check:mcp` falha se aparecer).
- Toda ferramenta, exceto `listar_organizacoes`, exige `organizationId`. Tabelas de negócio só via
  `tenantDb(organizationId)`; Prisma cru (`@/lib/prisma`) só para `Organization`,
  `OrganizationModule`, `Membership` e `User`, sempre com ids/`organizationId` explícitos.
- `select` explícito em toda consulta; nunca objeto Prisma inteiro nem `include` sem `select`. Campos
  de texto livre (`notes`, `intro`, `document`, `description` de Tarefa) não saem.
- Lista de exclusão do spec vale integralmente. A reauditoria contra o schema atual acrescenta:
  `IntegrationConnection.meta` (guarda o `webhookToken`), `TimeOff.reason`/`decisionNote` (pode ser
  dado de saúde), `EmailBroadcast.attachments`/`stats`/`lastError`, `EmailSenderAccount.lastError`,
  `Message.senderName`/`quotedSender`/`reactions`/`mediaName`, `Conversation.remoteJid`/`name`/`customName`.
- Folha: `FinanceEntry` com `employeeId != null` **ou** `payrollRunId != null` nunca aparece um a um;
  nos resumos entra somada numa única linha `"Folha de pagamento"`.
- Módulo DORMANT não esconde dados (nenhuma ferramenta consulta `OrganizationModule` para filtrar);
  `listar_organizacoes`/`resumo_organizacao` mostram o status. Downloader e a caixa de entrada do
  E-mail (`emailInbox`, lida ao vivo da Microsoft) ficam **sem** ferramenta: o primeiro não guarda dado
  de negócio, a segunda é corpo de e-mail. Prospecção entra só como contagem em `resumo_organizacao`.
- Listas: `limit` padrão 50, teto 200 (acima disso corta em 200, não dá erro), `offset` padrão 0.
  Formato `{ total, limit, offset, items }`.
- Datas de entrada `YYYY-MM-DD` = dias UTC (`T00:00:00Z`), `to` inclusivo — mesmo critério do
  Financeiro, que grava `dueDate` como `new Date("yyyy-mm-dd")`. "Atrasada" em Tarefas usa
  `saoPauloDayStart` de `src/lib/tasks/board-core.ts`, como a tela de Tarefas.
- Decimal sai como string (`money`: 2 casas; `qty`: 3). Chaves de saída em inglês camelCase (nomes do
  schema); descrições das ferramentas e mensagens de erro em português.
- Auth: env `MCP_API_KEY` (zod `min(32)`, opcional; ausente ⇒ tudo 404). Chave aceita no
  `Authorization: Bearer` ou no segmento `/api/mcp/<chave>`; falha ⇒ **404** (nunca 401 — o claude.ai
  trata 401 como "inicie OAuth"); nenhum `/.well-known/oauth-*`.
- Transporte sem sessão, resposta JSON. GET/DELETE autenticados ⇒ 405 com `Allow: POST`.
- Rate limit: `makeRateLimiter(\`mcp:${env.NODE_ENV}\`, 120, 60)` (decisão do plano: 120/min, porque o
  e2e faz ~80 chamadas); excedeu ⇒ 429. Sem Redis ⇒ libera (comportamento do helper).
- Log por chamada: `console.info("[mcp]", JSON.stringify({ tool, organizationId, ms, ok }))`. Nunca
  logar a chave, a URL nem argumentos de busca. Nada em `AuditLog`.
- Env só via `src/lib/env.ts`; Prisma da app só via `src/lib/prisma.ts`. Scripts criam o próprio
  `PrismaClient` com `PrismaPg`, como `scripts/check-isolation.ts`.
- Antes de **cada** commit: `npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node`,
  mais `npm run check:mcp` e, a partir da Task 2, `npm run check:mcp:e2e`. Commit
  `[MCP] - Verbo + Tarefa`, corpo estruturado, última linha
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Guia no mesmo commit da mudança: rota nova → guia 05; `src/lib/queries/` → guia 03; script no
  `package.json` → guia 06.
- Ambiente local (Windows): Postgres do Docker (`docker compose up -d postgres`, porta 5433);
  `next dev` em :3000 — reinicie-o depois de `npm install`/`prisma generate`; não suba outro em :3001.

## Review Focus

1. Organização vazia (sem dados, módulos DORMANT) → toda ferramenta devolve listas vazias e zeros,
   nunca erro. Teste: varredura da org B (Task 3).
2. Lançamento de folha marcado só com `employeeId`, ou só com `payrollRunId` → some da lista e entra em
   "Folha de pagamento". Teste: Task 5.
3. Lançamento que vence exatamente no dia `from` ou no dia `to` (meia-noite UTC) → entra no período.
   Teste: Task 1 (puro) e Task 5 (e2e).
4. Entrada fora da faixa: `limit: 1000` → 200; `to` antes de `from`; `"2026-02-30"` → `isError` com
   mensagem em português, nunca 500. Teste: Task 1, Task 3 e Task 4.
5. Chave colada com espaço ou quebra de linha no fim (hPanel ou URL do conector) → autoriza; chave
   diferente ou cortada → 404. Teste: Task 1.

---

### Task 1: Núcleo puro + `check:mcp`

**Files:**
- Create: `src/lib/mcp/core.ts` (sem `server-only`)
- Create: `src/lib/mcp/inputs.ts` (sem `server-only`)
- Create: `scripts/check-mcp.ts`
- Modify: `package.json` — `"check:mcp": "tsx scripts/check-mcp.ts"`
- Modify: `docs/guia/06-antes-de-commitar.md` — parágrafo do `check:mcp`, ao lado de `check:email`/`check:tasks`
- Commit junto: o spec e este plano

**Interfaces:**
- Produces (`src/lib/mcp/core.ts`):
```ts
export class McpInputError extends Error {}
export function extractBearer(header: string | null): string | null;
export function keysMatch(provided: string | null | undefined, secret: string | null | undefined): boolean;
export function parseDay(s: string): Date;            // "YYYY-MM-DD" → T00:00:00Z; inválida → McpInputError
export function utcDayStart(now: Date): Date;
export type Period = { from: string; to: string; gte: Date; lt: Date };
export function resolvePeriod(from: string | undefined, to: string | undefined, now: Date): Period;
export function resolveRange(from?: string, to?: string): { gte?: Date; lt?: Date } | null;
export function page(limit?: number, offset?: number): { take: number; skip: number };
export function listResult<T>(total: number, p: { take: number; skip: number }, items: T[]):
  { total: number; limit: number; offset: number; items: T[] };
export function money(v: { toString(): string } | number | null | undefined): string | null;
export function qty(v: { toString(): string } | number | null | undefined): string | null;
export const PAYROLL_LABEL = "Folha de pagamento";
export const NO_CATEGORY_LABEL = "Sem categoria";
export type FinanceGroupRow = { type: "INCOME" | "EXPENSE"; categoryName: string | null; payroll: boolean; total: number };
export type CategoryLine = { categoryName: string; total: string };
export function bucketByCategory(rows: FinanceGroupRow[]):
  { income: CategoryLine[]; expense: CategoryLine[]; totalIncome: string; totalExpense: string; result: string };
export const FORBIDDEN_KEYS: readonly string[];
export function findSensitiveKeys(value: unknown): string[];   // caminhos, ex. "items[0].body"
```
- Produces (`src/lib/mcp/inputs.ts`, zod 3, cada campo com `.describe()` em português):
  `dayParam` (regex `^\d{4}-\d{2}-\d{2}$`), `periodShape = { from: dayParam.optional(), to: dayParam.optional() }`,
  `pageShape = { limit: z.number().int().min(1).optional(), offset: z.number().int().min(0).optional() }`
  (sem `.max` — quem corta é `page()`), `searchParam = z.string().trim().min(1).max(100).optional()`.
- `FORBIDDEN_KEYS` (exato): `body, quotedBody, quotedSender, senderName, reactions, mediaUrl, mediaName,
  lastMessagePreview, remoteJid, payload, prompt, content, html, signatureHtml, signatureText, audience,
  attachments, lastError, baseSalary, netPay, totalEarnings, totalDeductions, totalNet, bankName,
  bankBranch, bankAccount, pixKey, document, address, birthDate, terminationReason, decisionNote, notes,
  intro, employeeId, payrollRunId, passwordHash, tokenHash, credentialsEnc, credentials, secret,
  pageToken, meta, webhookToken, accessToken, refreshToken, password`.

- [ ] **Step 1: Escrever `scripts/check-mcp.ts`** no estilo de `scripts/check-task-board.ts` (`check(name, fn)` + `node:assert/strict`), com `K = "a1".repeat(32)`:
  - `extractBearer("Bearer abc")` → `"abc"`; `extractBearer("bearer  abc \n")` → `"abc"`; `extractBearer("Basic abc")` → `null`; `extractBearer(null)` → `null`.
  - `keysMatch(K + "\n", K)` e `keysMatch(" " + K, K + " ")` → `true`; `keysMatch(K.slice(1), K)`, `keysMatch(K.toUpperCase(), K)`, `keysMatch(K, undefined)`, `keysMatch(undefined, K)`, `keysMatch("", "")` → `false`.
  - `parseDay("2026-10-01").toISOString()` → `"2026-10-01T00:00:00.000Z"`; `parseDay("2026-02-30")` e `parseDay("01/10/2026")` lançam `McpInputError`.
  - `resolvePeriod(undefined, undefined, new Date("2026-10-22T15:00:00Z"))` → `{ from: "2026-10-01", to: "2026-10-22", gte: 2026-10-01T00:00Z, lt: 2026-10-23T00:00Z }`.
  - `resolvePeriod("2026-10-01", "2026-10-31", now)`: `lt` = `2026-11-01T00:00:00.000Z`; as datas `2026-10-01T00:00Z` e `2026-10-31T00:00Z` satisfazem `gte <= d < lt`.
  - `resolvePeriod("2026-10-10", "2026-10-01", now)` lança `McpInputError` com mensagem contendo `"não pode ser anterior"`; intervalo maior que 3660 dias lança.
  - `resolveRange()` → `null`; `resolveRange("2026-10-01")` → só `gte`; `resolveRange(undefined, "2026-10-31")` → só `lt` = `2026-11-01T00:00Z`.
  - `page()` → `{ take: 50, skip: 0 }`; `page(1000, 5)` → `{ take: 200, skip: 5 }`; `page(0)` → `take 1`; `page(10, -3)` → `skip 0`.
  - `money("1234.5")` → `"1234.50"`; `money(null)` → `null`; `qty("2.5")` → `"2.500"`.
  - `bucketByCategory([{EXPENSE,"Aluguel",false,1000},{EXPENSE,"Salários",true,4321.09},{EXPENSE,"Salários",false,200},{EXPENSE,null,true,100},{INCOME,null,false,5000}])` → expense `[{"Folha de pagamento","4421.09"},{"Aluguel","1000.00"},{"Salários","200.00"}]`, income `[{"Sem categoria","5000.00"}]`, totalExpense `"5621.09"`, totalIncome `"5000.00"`, result `"-621.09"`.
  - `findSensitiveKeys({ items: [{ name: "x", body: "y" }], nested: { meta: {} } })` → `["items[0].body", "nested.meta"]`; `findSensitiveKeys({ name: "body" })` → `[]` (só chaves contam).
  - Varredura estática: todo `.ts` em `src/lib/mcp/` e `src/lib/queries/mcp/` (se existirem) não casa `/\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$queryRawUnsafe)\(/`.

- [ ] **Step 2: Adicionar o script ao `package.json` e rodar `npm run check:mcp`** — esperado: FAIL (não acha `../src/lib/mcp/core`).

- [ ] **Step 3: Implementar `core.ts` e `inputs.ts`** conforme as interfaces. `keysMatch`: `trim()` nos dois lados, `false` se algum vazio, compara os digests `sha256` com `timingSafeEqual` (tamanho fixo, nada vaza pelo comprimento). `findSensitiveKeys`: percorre objetos simples e arrays; só nomes de chave, contra um `Set` de `FORBIDDEN_KEYS`.

- [ ] **Step 4: `npm run check:mcp`** — esperado: todos ✓.

- [ ] **Step 5: Guia 06** — parágrafo: o que o `check:mcp` cobre, sem banco nem rede; rodar sempre que mexer em `src/lib/mcp/` ou `src/lib/queries/mcp/`.

- [ ] **Step 6: Cinco checagens + `check:mcp`; commit** `[MCP] - Adiciona núcleo puro e check do servidor MCP` (inclui o spec e este plano).

### Task 2: Endpoint autenticado (ainda sem ferramentas)

**Files:**
- Modify: `package.json`/`package-lock.json` — `npm install --save-exact @modelcontextprotocol/sdk@1.32.1`; script `"check:mcp:e2e": "tsx --env-file=.env scripts/check-mcp-e2e.ts"`
- Modify: `src/lib/env.ts` — `MCP_API_KEY: z.string().min(32, "MCP_API_KEY must be at least 32 characters").optional()`, logo abaixo de `CRON_SECRET`, com comentário de uma linha
- Modify: `.env.example` — `MCP_API_KEY=` com o mesmo comentário/comando de geração do `CRON_SECRET`
- Modify: `README.md` §6 — linha `MCP_API_KEY` | não | chave do MCP de leitura (`/api/mcp`); sem ela o endpoint responde 404
- Create: `src/lib/mcp/auth.ts`, `src/lib/mcp/server.ts`, `src/lib/mcp/handler.ts` (todos `server-only`)
- Create: `src/app/api/mcp/route.ts`, `src/app/api/mcp/[key]/route.ts`
- Create: `scripts/check-mcp-e2e.ts`
- Modify: `docs/guia/05-rotas-e-jobs.md`, `docs/guia/06-antes-de-commitar.md`

**Interfaces:**
- Consumes: `extractBearer`, `keysMatch` (Task 1); `makeRateLimiter` (`src/lib/ratelimit.ts`); `env`.
- Produces:
  - `isMcpAuthorized(req: Request, pathKey: string | null): boolean` — `keysMatch(pathKey, env.MCP_API_KEY) || keysMatch(extractBearer(req.headers.get("authorization")), env.MCP_API_KEY)`.
  - `buildMcpServer(): McpServer` — `new McpServer({ name: "metodoai", version: "1.0.0" }, { instructions })`, com `instructions` em português (2–3 frases: só leitura; use `listar_organizacoes` para achar o `organizationId`; datas `YYYY-MM-DD`). A Task 3 passa a registrar as ferramentas aqui.
  - `handleMcpRequest(req: Request, pathKey: string | null): Promise<Response>`, nesta ordem:
    1. não autorizado → `new Response("Not Found", { status: 404 })`;
    2. método ≠ POST → 405, `Allow: POST`, `content-type: application/json`, corpo `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}`;
    3. limiter existe e `(await limiter.limit("all")).success === false` → 429 com `Retry-After: 60`;
    4. por request: `const server = buildMcpServer(); const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); await server.connect(transport); try { return await transport.handleRequest(req); } finally { void server.close(); }`.
  - Imports do SDK: `@modelcontextprotocol/sdk/server/mcp.js` e `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js` (se o `typecheck` não achar os tipos com `.js`, tire o `.js`). Se o `build` quebrar ao empacotar o SDK, adicione `serverExternalPackages: ["@modelcontextprotocol/sdk"]` no `next.config.ts` e registre o motivo em comentário.
  - Rotas: as duas com `export const runtime = "nodejs"; export const dynamic = "force-dynamic";` e `POST`, `GET`, `DELETE` delegando a `handleMcpRequest` (`null` na rota sem chave). `[key]` recebe `{ params }: { params: Promise<{ key: string }> }`, como `src/app/api/auth/[provider]/route.ts`.
  - Harness do e2e (`scripts/check-mcp-e2e.ts`), que as próximas tasks só alimentam:
    `type Ctx = { stamp: number; secret: string; orgA: { id: string; name: string }; orgB: { id: string; name: string }; userA: { id: string; name: string; email: string }; prisma: PrismaClient; call(name: string, args: object): Promise<{ isError: boolean; text: string; json: any }> }`;
    arrays `fixtures`, `cleanups` (`(ctx: Ctx) => Promise<void>`) e `checks` (`{ name: string; run: (ctx: Ctx) => Promise<void> }`); `secret = \`MCPSEGREDO${stamp}\``; todo registro de nome/título da org A começa com `MCP-E2E-A-${stamp}`. `main()`: fixtures base → fixtures dos módulos → conecta o cliente do SDK → checks → cleanups em ordem reversa, **sempre** (`finally`). `BASE = process.env.MCP_E2E_URL ?? "http://localhost:3000/api/mcp"`; sem `MCP_API_KEY` no ambiente → sai com código 1 e mensagem.

- [ ] **Step 1: Instalar o SDK (versão exata) e rodar `npm run check:node`** — tem que passar. Se falhar, pare e relate o pacote e a exigência de Node (não contorne).
- [ ] **Step 2: Gerar a chave local** (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), gravar `MCP_API_KEY=<chave>` no `.env` (fora do git; nunca imprima a chave em saída, log ou commit). Reiniciar o `next dev` em :3000 com o Postgres do Docker no ar.
- [ ] **Step 3: Escrever o harness com fixtures base e estes checks.** Fixtures base (Prisma cru): orgs `MCP-E2E-A-${stamp}` e `MCP-E2E-B-${stamp}` (slugs `mcp-e2e-a-${stamp}`/`-b-`), usuário A (`mcp-a-${stamp}@test.local`, `passwordHash: "x"`) OWNER da org A, `OrganizationModule` `crm` ACTIVE e `finance` DORMANT na org A; a org B fica vazia. A limpeza apaga módulos, membership, usuário e orgs (as tasks seguintes apagam as próprias linhas antes).
  - POST `initialize` em `BASE` sem auth → 404; POST em `${BASE}/${"0".repeat(64)}` → 404.
  - GET em `${BASE}/${KEY}` → 405.
  - Cliente do SDK pela chave no caminho (`new StreamableHTTPClientTransport(new URL(\`${BASE}/${KEY}\`))`) conecta e `client.ping()` resolve.
  - Cliente pela chave no header (`new StreamableHTTPClientTransport(new URL(BASE), { requestInit: { headers: { Authorization: \`Bearer ${KEY}\` } } })`) conecta e `client.getServerVersion()?.name === "metodoai"`.
- [ ] **Step 4: `npm run check:mcp:e2e`** — esperado: FAIL (a rota ainda não existe).
- [ ] **Step 5: Implementar** env, `auth.ts`, `server.ts`, `handler.ts` e as duas rotas.
- [ ] **Step 6: `npm run check:mcp:e2e`** — esperado: todos ✓. Conferir também que `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/.well-known/oauth-protected-resource` dá `404`.
- [ ] **Step 7: Guias.** Guia 05: linha na tabela "Claude (MCP de leitura) | `MCP_API_KEY` no `Authorization: Bearer` ou no caminho `/api/mcp/<chave>` → `isMcpAuthorized` | src/lib/mcp/auth.ts" e seção curta "MCP de leitura" (404 em vez de 401 e por quê; GET/DELETE 405; limite de 120/min; a chave no caminho aparece nos logs de acesso da Hostinger, então chave vazada = trocar no hPanel e no conector). Guia 06: parágrafo do `check:mcp:e2e` (precisa de `next dev` em :3000, Postgres e `MCP_API_KEY` no `.env`; cria e apaga os próprios dados; com o Redis configurado, duas rodadas seguidas podem bater no limite de 120/min — espere um minuto).
- [ ] **Step 8: Cinco checagens + `check:mcp` + `check:mcp:e2e`; commit** `[MCP] - Adiciona endpoint autenticado do servidor MCP`.

### Task 3: Registro de ferramentas + ferramentas de plataforma

**Files:**
- Create: `src/lib/mcp/tool.ts`, `src/lib/mcp/tools/index.ts`, `src/lib/mcp/tools/plataforma.ts`
- Create: `src/lib/queries/mcp/shared.ts`, `src/lib/queries/mcp/plataforma.ts`
- Modify: `src/lib/mcp/server.ts` — `registerTools(server, ALL_TOOLS)`
- Modify: `scripts/check-mcp-e2e.ts`
- Modify: `docs/guia/03-multi-tenancy.md` — "Onde cada coisa vive": atualizar a contagem de arquivos da DAL e explicar `queries/mcp/` (contexto de sistema: a organização vem do argumento da ferramenta, nunca de sessão; Prisma cru só nos modelos globais)

**Interfaces:**
- Produces (`src/lib/mcp/tool.ts`):
```ts
export type OrgRef = { id: string; name: string };
export type McpToolDef = { name: string; description: string; input: z.ZodRawShape; scope: "global" | "org";
  run: (args: Record<string, unknown>, org: OrgRef | null, now: Date) => Promise<unknown> };
export function globalTool<S extends z.ZodRawShape>(d: { name: string; description: string; input: S;
  run: (args: z.infer<z.ZodObject<S>>, now: Date) => Promise<unknown> }): McpToolDef;
export function orgTool<S extends z.ZodRawShape>(d: { name: string; description: string; input: S;
  run: (args: z.infer<z.ZodObject<S>>, org: OrgRef, now: Date) => Promise<unknown> }): McpToolDef;
export function registerTools(server: McpServer, defs: McpToolDef[]): void;
```
  `registerTools` chama `server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, handler)`, onde `inputSchema` das ferramentas `org` ganha `organizationId: z.string().min(1).describe("Id da organização (use listar_organizacoes)")` na frente. O handler:
  - escopo `org`: `getOrganizationRef(args.organizationId)`; `null` → `isError` com `"Organização não encontrada: <id>. Use listar_organizacoes para ver os ids."`;
  - payload = escopo `org` ? `{ organization: org, ...result }` : `result`;
  - `findSensitiveKeys(payload)` não vazio → `console.error("[mcp] campo sensível bloqueado", tool, caminhos)` e `isError` `"Resposta bloqueada: campo sensível na saída."`;
  - `McpInputError` → `isError` com a mensagem dela; outro erro → `console.error("[mcp] erro", tool, err)` e `isError` `"Erro interno ao consultar <tool>."`;
  - sucesso → `{ content: [{ type: "text", text: JSON.stringify(payload) }] }`;
  - sempre o log `[mcp]` da seção Global Constraints.
  Um `as`/`eslint-disable-next-line @typescript-eslint/no-explicit-any` dentro de `registerTools` é aceitável (mesmo padrão de `tenant-db.ts`).
- `src/lib/mcp/tools/index.ts`: `export const ALL_TOOLS: McpToolDef[] = [...plataformaTools]` (cada task seguinte acrescenta o seu array).
- `src/lib/queries/mcp/shared.ts`: `userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>>` (Prisma cru, `select: { id: true, name: true }`).
- `src/lib/queries/mcp/plataforma.ts`:
  - `getOrganizationRef(id: string): Promise<OrgRef | null>`
  - `listOrganizations(o: { search?: string; take: number; skip: number }): Promise<{ total: number; items: OrgListItem[] }>`, com `OrgListItem = { id, name, slug, createdAt, onboardedAt, owner: { id, name, email } | null, memberCount: number, modules: { moduleId: string; status: "ACTIVE" | "DORMANT" }[] }`; busca em `name`/`slug` sem diferenciar maiúsculas; ordem `name` asc.
  - `listMembers(organizationId: string): Promise<{ userId: string; name: string; email: string; role: "OWNER" | "ADMIN" | "MEMBER"; createdAt: Date }[]>`
  - `organizationSummary(organizationId: string): Promise<{ modules: { moduleId: string; status: string }[]; counts: { members, companies, contacts, opportunitiesOpen, proposals, financeEntries, employeesActive, supplyItems, purchaseOrdersOpen, assets, tasksOpen, campaigns, emailBroadcasts, conversations, extractionJobs, extractedLeads, importedLeads: number } }>` — `financeEntries` sem folha; `purchaseOrdersOpen` = DRAFT/APPROVED/ORDERED/PARTIAL; `tasksOpen` = `doneAt: null`; `importedLeads` = `importedAt` preenchido.

Ferramentas (`plataformaTools`):

| Ferramenta | Escopo | Entrada | Saída |
|---|---|---|---|
| `listar_organizacoes` | global | `search?`, `limit?`, `offset?` | `listResult` de `OrgListItem` |
| `listar_membros` | org | — | `{ items }` de `listMembers` |
| `resumo_organizacao` | org | — | `organizationSummary` |

- [ ] **Step 1: Checks no e2e:**
  - `tools/list` traz exatamente os nomes de uma constante `EXPECTED_TOOLS` (começa com as 3 de plataforma; cada task acrescenta as suas) e toda ferramenta tem `annotations.readOnlyHint === true`.
  - `listar_organizacoes { search: \`MCP-E2E-A-${stamp}\` }` → `total` 1, `owner.email` do usuário A, `modules` contém `{crm, ACTIVE}` e `{finance, DORMANT}`.
  - `listar_organizacoes { limit: 1000 }` → `json.limit === 200`.
  - `listar_membros { organizationId: orgA.id }` → 1 item com `role: "OWNER"`.
  - `resumo_organizacao { organizationId: "nao-existe" }` → `isError` e texto com `"Organização não encontrada"`.
  - **`sweep`** (sempre o último check): para cada ferramenta listada cujo `inputSchema.properties` tem `organizationId`, chamar com `{ organizationId: orgA.id }` e com `{ organizationId: orgB.id }`. Exigir: `!isError`; `!text.includes(ctx.secret)`; `findSensitiveKeys(json)` vazio (import de `../src/lib/mcp/core`); `json.organization.id` igual à org chamada; nos resultados da org B, nenhum texto contém `-A-${stamp}`.
- [ ] **Step 2: `npm run check:mcp:e2e`** — esperado: FAIL (nenhuma ferramenta).
- [ ] **Step 3: Implementar** `tool.ts`, `shared.ts`, `plataforma.ts` (queries), `tools/plataforma.ts`, `tools/index.ts` e o registro em `server.ts`.
- [ ] **Step 4: `npm run check:mcp:e2e` e `npm run check:mcp`** — esperado: todos ✓ (a varredura estática já cobre os arquivos novos).
- [ ] **Step 5: Guia 03.**
- [ ] **Step 6: Cinco checagens + checks do MCP; commit** `[MCP] - Adiciona ferramentas de plataforma ao MCP`.

### Task 4: CRM

**Files:** Create `src/lib/queries/mcp/crm.ts`, `src/lib/mcp/tools/crm.ts`; Modify `src/lib/mcp/tools/index.ts`, `scripts/check-mcp-e2e.ts`.

**Interfaces:**
- Consumes: `orgTool`, `page`, `listResult`, `resolvePeriod`, `resolveRange`, `money`, `pageShape`, `periodShape`, `searchParam`, `userNames`.
- Produces: `crmTools: McpToolDef[]`; queries `searchCompanies`, `searchContacts`, `searchOpportunities`, `searchProposals`, `salesSummary`, todas com `(organizationId: string, args, now: Date)`.

Ferramentas:
- `buscar_empresas` — `search?` (name, cnpj, email), `limit?`, `offset?`. Item `{ id, name, cnpj, email, phone, website, city, uf, source, createdAt, contactCount, openOpportunityCount }`; `city`/`uf` saem do JSON `address`, e a chave `address` nunca sai. Ordem `name` asc.
- `buscar_contatos` — `search?` (name/email/phone), `companyId?`, `tag?`, página. Item `{ id, name, email, phone, role, tags, companyId, companyName, source, optedOut, createdAt }`.
- `buscar_oportunidades` — `status?` (OpportunityStatus), `pipelineId?`, `stageId?`, `ownerId?`, `companyId?`, `search?` (title/code), `dateField?` (`"createdAt" | "closedAt" | "expectedCloseDate"`, padrão `createdAt`), `from?`/`to?` (`resolveRange`), página. Item `{ id, code, title, value, status, pipelineName, stageName, companyName, contactName, productServiceName, ownerId, ownerName, expectedCloseDate, closedAt, outcomeReason, createdAt }`. Ordem `createdAt` desc.
- `buscar_propostas` — `status?` (ProposalStatus), `companyId?`, `search?` (title/code/clientCompany), `from?`/`to?` em `createdAt`, página. Item `{ id, code, title, status, subtotal, discount, total, clientCompany, clientName, companyId, opportunityId, ownerName, validUntil, sentAt, decidedAt, createdAt }`.
- `resumo_vendas` — `from?`/`to?` (`resolvePeriod`), `pipelineId?`. Saída `{ period: { from, to }, pipeline: { id, name } | null, created: { count, value }, won: { count, value, avgTicket }, lost: { count, value }, canceled: { count, value }, winRate, lossReasons: [{ reason, count }], openFunnel: [{ stageId, stageName, count, value }], byOwner: [{ ownerId, ownerName, wonCount, wonValue, goal }], proposals: [{ status, count, total }] }`. Regras:
  - "fechada no período" = `OR: [{ closedAt: { gte, lt } }, { closedAt: null, updatedAt: { gte, lt } }]` (o `getSalesReport` do app usa `updatedAt`; aqui `closedAt` manda quando existe);
  - `created` = `createdAt` no período; `winRate` = won/(won+lost), 4 casas, 0 sem fechamentos; `lossReasons` = top 8 de LOST+CANCELED fechadas no período com `outcomeReason` preenchido;
  - funil: pipeline = `pipelineId` ?? `isDefault` ?? primeiro por `order` (igual ao `getSalesReport`), oportunidades OPEN agora;
  - `goal` = soma de `Goal.targetValue` do dono nos meses `YYYY-MM` entre `from` e `to` (`null` sem meta); `proposals` = `createdAt` no período.

- [ ] **Step 1: Fixtures e checks no e2e.** Org A, datas = agora, dono = usuário A: empresa `MCP-E2E-A-${stamp} Ltda` com `notes` = secret e `address` `{ street: secret, city: "Campinas", uf: "SP" }`; contato com e-mail **ligado à empresa**; pipeline padrão com 2 etapas; oportunidades (todas ligadas à empresa e ao contato, com `notes` = secret) OPEN 1000, WON 2500 com `closedAt` agora, WON 500 com `closedAt` nulo (legado), LOST com `outcomeReason` "Preço"; meta do usuário A no mês corrente = 3000; proposta ACCEPTED total 2500 com `notes`/`intro` = secret. Limpeza por `organizationId`, filhos antes dos pais. Checks:
  - `buscar_empresas { search: "Ltda" }` → 1 item, `city` "Campinas", `contactCount` 1, `openOpportunityCount` 1, sem chave `address`.
  - `buscar_oportunidades { status: "WON" }` → 2 itens com `ownerName` do usuário A.
  - `resumo_vendas` (padrão) → `won.count` 2, `won.value` `"3000.00"`, `lost.count` 1, `winRate` 0.6667, `byOwner[0]` com `wonCount` 2 e `goal` `"3000.00"`, `lossReasons` contém `{ reason: "Preço", count: 1 }`.
  - `resumo_vendas { from: "2026-10-10", to: "2026-10-01" }` → `isError` com `"não pode ser anterior"`.
  - `EXPECTED_TOOLS` += as 5.
- [ ] **Step 2: Rodar o e2e** — esperado: FAIL (ferramentas inexistentes).
- [ ] **Step 3: Implementar** queries e ferramentas; registrar `crmTools` no índice.
- [ ] **Step 4: Rodar o e2e** — esperado: todos ✓ (inclui o `sweep`).
- [ ] **Step 5: Cinco checagens + checks do MCP; commit** `[MCP] - Adiciona ferramentas de CRM ao MCP`.

### Task 5: Financeiro

**Files:** Create `src/lib/queries/mcp/financeiro.ts`, `src/lib/mcp/tools/financeiro.ts`; Modify índice e e2e.

**Interfaces:**
- Consumes: `bucketByCategory`, `PAYROLL_LABEL`, `utcDayStart`, `Period` (Task 1); `orgTool` (Task 3).
- Produces: `financeiroTools`; queries `searchEntries(organizationId, args)` e `financeSummary(organizationId, period: Period, now: Date)`; constantes `NOT_PAYROLL = { employeeId: null, payrollRunId: null }` e `PAYROLL = { OR: [{ employeeId: { not: null } }, { payrollRunId: { not: null } }] }`.

Ferramentas:
- `buscar_lancamentos` — `type?`, `status?`, `categoryName?` (nome exato, sem diferenciar maiúsculas), `search?` (description), `from?`/`to?` em `dueDate`, página; o `where` **sempre** inclui `NOT_PAYROLL`. Item `{ id, type, description, amount, status, dueDate, settledAt, method, categoryName, contactName, companyName, opportunityTitle, installmentNo, installmentTotal }`, ordem `dueDate` desc, `createdAt` desc. A descrição avisa que a folha não aparece aqui e aponta para `resumo_financeiro`.
- `resumo_financeiro` — `from?`/`to?` (`resolvePeriod`). Saída:
  - `competencia` = `bucketByCategory` de `dueDate` no período, qualquer status (a DRE do app), montado com dois `groupBy`: `NOT_PAYROLL` por `[type, categoryId]` (com nome da categoria) e `PAYROLL` por `[type]` (`payroll: true`);
  - `caixa: { received, paid, result, payrollPaid }` = SETTLED com `settledAt` no período;
  - `pendente: { receivable, payable, payrollPayable }` = PENDING com `dueDate` no período;
  - `vencidos: { receivable: { count, total }, payable: { count, total } }` = PENDING com `dueDate < utcDayStart(now)`, sem limite de período (folha incluída em `payable`);
  - `saldoRealizado` = SETTLED INCOME − SETTLED EXPENSE de todo o histórico (igual ao `balance` do `getFinanceSummary`);
  - `observacao: "Lançamentos de folha entram somados na linha \"Folha de pagamento\"; não há valores por pessoa."`.

- [ ] **Step 1: Fixtures e checks no e2e** (datas fixas em setembro de 2026 para testar as bordas): categorias "Aluguel" e "Salários" (EXPENSE) e "Vendas" (INCOME); um `Employee` (ACTIVE, departamento "Comercial", cargo "Vendedor", `baseSalary` 98765.43, e `pixKey`, `bankAccount`, `document`, `terminationReason` = secret) e um `PayrollRun` mínimo do mês com totais 98765.43 — a Task 6 reaproveita os dois. Lançamentos:
  - INCOME 5000 "Vendas", `dueDate` `2026-09-01T00:00Z` (borda `from`), SETTLED com `settledAt` `2026-09-01T12:00Z`;
  - EXPENSE 1000 "Aluguel", `dueDate` `2026-09-30T00:00Z` (borda `to`), PENDING, `notes` = secret;
  - folha EXPENSE 4000 "Salários" **só com `employeeId`**, `dueDate` `2026-09-05`, SETTLED com `settledAt` `2026-09-05T12:00Z`;
  - folha EXPENSE 321.09 "Salários" **só com `payrollRunId`**, `dueDate` `2026-09-15`, PENDING.

  Checks:
  - `buscar_lancamentos {}` → `total` 2, nenhum `amount` "4000.00" ou "321.09".
  - `resumo_financeiro { from: "2026-09-01", to: "2026-09-30" }` →
    - `competencia.expense` = `[{ "Folha de pagamento", "4321.09" }, { "Aluguel", "1000.00" }]` (sem linha "Salários"); `totalExpense` "5321.09"; `totalIncome` "5000.00";
    - `caixa.received` "5000.00", `caixa.paid` "4000.00", `caixa.payrollPaid` "4000.00";
    - `pendente.payable` "1321.09", `pendente.payrollPayable` "321.09";
    - `vencidos.payable` `{ count: 2, total: "1321.09" }`.
  - O texto de nenhuma resposta do Financeiro contém "98765.43".
  - `EXPECTED_TOOLS` += as 2.
- [ ] **Step 2: Rodar o e2e** — esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar o e2e** — esperado: todos ✓.
- [ ] **Step 5: Cinco checagens + checks do MCP; commit** `[MCP] - Adiciona ferramentas do Financeiro ao MCP`.

### Task 6: RH

**Files:** Create `src/lib/queries/mcp/rh.ts`, `src/lib/mcp/tools/rh.ts`; Modify índice e e2e.

**Interfaces:**
- Produces: `rhTools`; queries `searchEmployees(organizationId, args)` e `hrSummary(organizationId, period: Period, now: Date)`.

Ferramentas:
- `buscar_funcionarios` — `status?` (EmployeeStatus), `departmentId?`, `search?` (nome), página. Item **exatamente** `{ id, name, jobRoleName, departmentName, status, hiredAt, terminatedAt }`.
- `resumo_rh` — `from?`/`to?` (`resolvePeriod`). Saída, só contagens e sem nomes:
  - `headcount: { active, onLeave, terminated }`;
  - `byDepartment: [{ departmentName, active }]` (status ACTIVE; sem departamento → "Sem departamento");
  - `hires` (`hiredAt` no período) e `terminations` (`terminatedAt` no período);
  - `timeOff: { pending, approvedInPeriod: [{ type, count, days }] }` — `pending` = PENDING de todo o histórico; `approvedInPeriod` = APPROVED com `startDate` no período;
  - `awayToday` = APPROVED com `startDate < utcDayStart(now) + 1 dia` e `endDate >= utcDayStart(now)`.

- [ ] **Step 1: Fixtures e checks no e2e.** Fixtures: mais um `Employee` TERMINATED com `terminatedAt` agora e `terminationReason` = secret; `TimeOff` SICK APPROVED de hoje até hoje (`utcDayStart(now)`) com `reason` e `decisionNote` = secret; `TimeOff` VACATION PENDING. Checks:
  - `buscar_funcionarios {}` → `total` 2, e as chaves de cada item são exatamente as 7 listadas.
  - `resumo_rh` (padrão) → `headcount.active` 1, `headcount.terminated` 1, `terminations` 1, `timeOff.pending` 1, `awayToday` 1.
  - Nenhuma resposta contém "98765.43".
  - `EXPECTED_TOOLS` += as 2.
- [ ] **Step 2: Rodar o e2e** — esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar o e2e** — esperado: todos ✓.
- [ ] **Step 5: Cinco checagens + checks do MCP; commit** `[MCP] - Adiciona ferramentas de RH ao MCP`.

### Task 7: Suprimentos

**Files:** Create `src/lib/queries/mcp/suprimentos.ts`, `src/lib/mcp/tools/suprimentos.ts`; Modify índice e e2e.

**Interfaces:**
- Consumes: `getStockBalances` (`@/lib/queries/stock`) e `getSupplyIndicators` (`@/lib/queries/supply-indicators`), já com `organizationId` explícito e só campos seguros — mesmos números das telas.
- Produces: `suprimentosTools`; queries `searchStock`, `searchMovements`, `searchPurchaseOrders`, `searchAssets`, `suppliesSummary`.

Ferramentas:
- `buscar_itens_estoque` — `search?`, `belowMin?` (boolean), página. Usa `getStockBalances(organizationId, search)`, filtra `belowMin` e pagina em memória. Item `{ itemId, code, description, unit, balance, reserved, available, minStock, belowMin }`, quantidades via `qty()`.
- `buscar_movimentacoes` — `itemId?`, `warehouseId?`, `type?` (StockMovementType), `from?`/`to?` em `createdAt`, página. Item `{ id, createdAt, type, qty, unitCost, lot, validity, itemId, itemDescription, warehouseName, reason, reference }` (sem `note`).
- `buscar_pedidos_compra` — `status?` (PurchaseOrderStatus), `supplierId?`, `from?`/`to?` em `createdAt`, página. Item `{ id, code, status, supplierName, warehouseName, total, itemCount, expectedAt, approvedAt, orderedAt, receivedAt, createdAt }`.
- `buscar_ativos` — `status?` (AssetStatus), `search?` (name/code/serialNumber), página. Item `{ id, code, name, serialNumber, nature, status, location, custodian, acquisitionDate, acquisitionValue, nextMaintenance: { type, dueDate } | null }` (próximo evento SCHEDULED por `dueDate` asc).
- `resumo_suprimentos` — `from?`/`to?` (`resolvePeriod`). Saída `{ period, indicators, purchases: [{ status, count, total }], movements: [{ type, count }], serviceTickets: [{ status, count }] }`: `indicators` = `getSupplyIndicators(organizationId)` como vem; `purchases`/`movements` por `createdAt` no período; `serviceTickets` por `receivedAt` no período.

- [ ] **Step 1: Fixtures e checks no e2e.** Fixtures: fornecedor, almoxarifado, item com `minStock` 10 e `notes` = secret; movimento IN de 4 com `note` = secret (fica abaixo do mínimo); pedido ORDERED total 300 com `notes` = secret e 1 item; ativo com `notes` = secret e manutenção SCHEDULED com `notes` = secret. Checks:
  - `buscar_itens_estoque { belowMin: true }` → 1 item com `balance` "4.000".
  - `buscar_ativos {}` → `nextMaintenance.type` "MAINTENANCE".
  - `resumo_suprimentos` (padrão) → `purchases` contém `{ status: "ORDERED", count: 1, total: "300.00" }`.
  - `EXPECTED_TOOLS` += as 5.
- [ ] **Step 2: Rodar o e2e** — esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar o e2e** — esperado: todos ✓.
- [ ] **Step 5: Cinco checagens + checks do MCP; commit** `[MCP] - Adiciona ferramentas de Suprimentos ao MCP`.

### Task 8: Marketing, Inbox e IA (só metadados e contagens)

**Files:** Create `src/lib/queries/mcp/{marketing,inbox,ia}.ts` e `src/lib/mcp/tools/{marketing,inbox,ia}.ts`; Modify índice e e2e.

**Interfaces:**
- Produces: `marketingTools`, `inboxTools`, `iaTools`; queries `searchCampaigns`, `searchEmailBroadcasts`, `conversationsSummary`, `listAiAgents`.

Ferramentas:
- `buscar_campanhas` — `status?` (CampaignStatus), `channel?` (Channel), página. Item `{ id, name, channel, status, templateName, startAt, lastDispatchAt, createdAt, recipients: { total, PENDING, SENT, DELIVERED, READ, FAILED } }`, com `recipients` por `groupBy` de `CampaignRecipient` (`campaignId`, `status`) só dos ids da página.
- `buscar_disparos_email` — `status?` (EmailBroadcastStatus), `channel?` (EmailChannel), `from?`/`to?` em `createdAt`, página. Item `{ id, subject, channel, status, fromName, fromEmail, pausedReason, startedAt, finishedAt, createdAt, recipients: { total, QUEUED, SENT, DELIVERED, BOUNCED, COMPLAINED, FAILED, SENDING, UNCERTAIN } }`.
- `resumo_conversas` — `from?`/`to?` (`resolvePeriod`). Saída, sem ler o conteúdo de nenhuma mensagem:
  - `connections: [{ id, label, provider, status, conversations, unread }]` — `IntegrationConnection` com provider EVOLUTION ou META_CLOUD, selecionando só `id, label, provider, status`;
  - `conversations: { total, groups, withUnread, unassigned, activeInPeriod }` — `activeInPeriod` = `lastMessageAt` no período;
  - `messages: { inbound, outbound }` — `groupBy` por `direction` com `timestamp` no período, só contagem;
  - `byAssignee: [{ userId, userName, conversations }]`.
- `listar_agentes_ia` — sem entrada extra. Saída `{ items: [{ id, name, enabled, model, handoffMinutes, connectionLabel, updatedAt }], assistant: { threads, messages } }` (só contagens; nunca `prompt` nem `content`).

- [ ] **Step 1: Fixtures e checks no e2e.** Fixtures (org A):
  - `MessageTemplate` com `body` = secret; `Campaign` com esse template e 1 destinatário SENT (contato da Task 4);
  - `EmailBroadcast` com `html`, `signatureHtml` e `lastError` = secret e `audience` `{ x: secret }`, mais 1 destinatário DELIVERED;
  - `IntegrationConnection` EVOLUTION com `credentialsEnc` = secret e `meta` `{ webhookToken: secret }`;
  - `Conversation` com `remoteJid` `${secret}@s.whatsapp.net`, `lastMessagePreview` = secret e `unreadCount` 2; duas `Message`, INBOUND e OUTBOUND, com `body` = secret e `timestamp` agora;
  - `WhatsappAgent` com `prompt` = secret; `AssistantThread` do usuário A + `AssistantMessage` com `content` = secret.

  Checks:
  - `buscar_campanhas` → `recipients.SENT` 1 e `templateName` preenchido.
  - `buscar_disparos_email` → `recipients.DELIVERED` 1.
  - `resumo_conversas` (padrão) → `messages` `{ inbound: 1, outbound: 1 }`, `conversations.withUnread` 1.
  - `listar_agentes_ia` → 1 item e `assistant.messages` 1.
  - O `sweep` acusa qualquer secret que vazar.
  - `EXPECTED_TOOLS` += as 4.
- [ ] **Step 2: Rodar o e2e** — esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar o e2e** — esperado: todos ✓.
- [ ] **Step 5: Cinco checagens + checks do MCP; commit** `[MCP] - Adiciona ferramentas de Marketing, Inbox e IA ao MCP`.

### Task 9: Tarefas

**Files:** Create `src/lib/queries/mcp/tarefas.ts`, `src/lib/mcp/tools/tarefas.ts`; Modify índice e e2e.

**Interfaces:**
- Consumes: `saoPauloDayStart(now: Date, dayOffset = 0)` de `src/lib/tasks/board-core.ts`.
- Produces: `tarefasTools`; queries `searchTasks(organizationId, args, now)` e `tasksSummary(organizationId, period: Period, now: Date)`.

Ferramentas:
- `buscar_tarefas` — `status?` (TaskStatus), `priority?` (TaskPriority), `type?` (TaskType), `assignedToId?`, `overdue?` (boolean), `search?` (title), `from?`/`to?` em `dueDate`, página. Item `{ id, title, type, priority, status, progress, startDate, dueDate, doneAt, overdue, assignedToId, assigneeName, companyName, contactName, opportunityTitle, createdAt }` (sem `description`). `overdue` = `doneAt` nulo e `dueDate < saoPauloDayStart(now)`; o filtro `overdue: true` usa a mesma regra no `where`.
- `resumo_tarefas` — `from?`/`to?` (`resolvePeriod`). Saída `{ period, open: { todo, inProgress }, overdue, createdInPeriod, doneInPeriod, byAssignee: [{ userId, userName, open, overdue, doneInPeriod }] }` (aberta = `doneAt` nulo).

- [ ] **Step 1: Fixtures e checks no e2e.** Fixtures: tarefa TODO vencida há 3 dias, atribuída ao usuário A, com `description` = secret; tarefa DONE com `doneAt` agora; tarefa IN_PROGRESS sem data. Checks:
  - `buscar_tarefas { overdue: true }` → 1 item com `overdue: true` e `assigneeName` do usuário A.
  - `resumo_tarefas` (padrão) → `open` `{ todo: 1, inProgress: 1 }`, `overdue` 1, `doneInPeriod` 1.
  - `EXPECTED_TOOLS` += as 2, totalizando 23.
- [ ] **Step 2: Rodar o e2e** — esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar o e2e** — esperado: todos ✓.
- [ ] **Step 5: Cinco checagens + checks do MCP; commit** `[MCP] - Adiciona ferramentas de Tarefas ao MCP`.

### Task 10: Fechamento — reauditoria, runbook e PR

**Files:** Modify `README.md` §8 — subseção "MCP de leitura":
- antes do merge, cadastrar `MCP_API_KEY` no hPanel;
- depois do deploy, editar o conector "METODO AI" no claude.ai para `https://metodotia.com/api/mcp/<chave>` e testar com "liste as organizações";
- trocar a chave = trocar no hPanel e no conector;
- a chave no caminho fica nos logs de acesso da Hostinger.

- [ ] **Step 1: Reauditoria.** Para cada modelo que alguma ferramenta seleciona, confira no `prisma/schema.prisma` atual os campos `String`/`Json` e confirme que nenhum selecionado está na lista de exclusão (spec + Global Constraints). Corrija o que achar e diga o que achou.
- [ ] **Step 2: Rodada completa:** cinco checagens + `check:mcp` + `check:mcp:e2e`, tudo verde; cole o resumo.
- [ ] **Step 3: Teste manual por terminal:** `curl` com `initialize` e depois `tools/list` em `http://localhost:3000/api/mcp/<chave>`, com `Content-Type: application/json` e `Accept: application/json, text/event-stream` → 200 em JSON com 23 ferramentas. Não imprima a chave.
- [ ] **Step 4: Ofereça ao usuário** o comando para ele mesmo conectar o Claude Code local (não rode — muda a configuração dele): `claude mcp add --transport http metodoai-local http://localhost:3000/api/mcp --header "Authorization: Bearer <chave>"`.
- [ ] **Step 5: Commit** `[MCP] - Documenta o runbook do MCP de leitura` (com as cinco checagens antes).
- [ ] **Step 6:** `git push -u origin feature/mcp-leitura` e entregue ao usuário o link `https://github.com/Grupo-Vannuchi/metodo-ai-new/compare/main...feature/mcp-leitura?expand=1` com título e corpo do PR (o corpo termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). **Não faça merge.**

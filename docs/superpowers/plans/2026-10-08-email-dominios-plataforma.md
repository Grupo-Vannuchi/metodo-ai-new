# E-mail pela conta Resend da plataforma, com domínios liberados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o E-mail em massa usar a chave Resend da plataforma (`RESEND_API_KEY` do `.env`) para todas as empresas. Cada empresa envia só de domínios próprios, verificados à mão no painel do Resend e liberados por um comando.

**Architecture:**
- **Domínio liberado:** uma tabela `email_sender_domains` com o domínio globalmente único, alimentada pelo script `scripts/email-domain.ts`. Ela é a trava que impede uma empresa de enviar como outra.
- **Remetente:** o composer ganha o campo "Endereço de envio", digitado a cada envio, que precisa ser de um domínio liberado. O servidor confere de novo no início do envio, e o disparador confere a cada lote.
- **Sai a conexão por cliente:** o webhook passa a ser único (`/api/email/webhook`, segredo no env) e o código de conexão e webhook por cliente é removido.
- **Proteção do reset de senha:** o disparo desacelera para cerca de 2 requisições/s, e o e-mail transacional ganha uma nova tentativa após 429.

**Tech Stack:** Next.js 16, Prisma 6 + PostgreSQL (Docker local, Supabase em produção), next-intl 4, zod 3, tsx para scripts, API REST do Resend.

**Spec:** [docs/superpowers/specs/2026-10-08-email-dominios-plataforma-design.md](../specs/2026-10-08-email-dominios-plataforma-design.md). Ela altera partes da spec de 2026-10-06; leia as duas.

## Global Constraints

- **Campanhas não muda.** Arquivos proibidos:
  - `src/lib/dispatch.ts`, `src/lib/integrations/**`;
  - `src/app/api/webhooks/[provider]/route.ts`;
  - `src/app/actions/campaigns.ts`, `src/app/actions/unsubscribe.ts`;
  - `src/lib/queries/campaigns.ts`, `src/lib/validations/campaign.ts`;
  - `src/components/campaigns/**`, `src/app/[locale]/app/campaigns/**`;
  - `src/lib/unsubscribe.ts`, `src/app/[locale]/unsubscribe/**`.
- **Conexões não muda:** `src/app/[locale]/app/connections/**` e `src/app/actions/connections.ts`.
- **`src/lib/email/send.ts`** só ganha a nova tentativa após 429. Nada mais nele muda.
- **Multi-tenant (guia 03):**
  - em request de usuário, `tenantDb(orgId)`; por id, `findFirst` + `updateMany`/`deleteMany` com checagem de `count`;
  - nunca `findUnique`/`update`/`delete`/`upsert`/`*AndReturn` em tabela de negócio;
  - Prisma cru só em contexto de sistema (disparador, webhook, script), com `organizationId` explícito ou vindo da linha autorizada.
- `EmailSenderDomain` entra em `TENANT_MODELS`.
- **Banco local = Docker** (`docker compose up -d postgres`, container `metodoai-db`). **Nunca** o Postgres portátil (`pg.cmd`); se ele estiver rodando, `pg.cmd stop`.
- **Nunca** `prisma migrate dev`/`migrate reset`/`db push`. Migration só pelo procedimento da Task 1.
- **i18n:** `src/messages/pt.json` e `en.json` com as mesmas chaves, sem `{{` dentro de mensagem. A contagem fica no CLAUDE.md e no guia 04.
- **Env:** só via `src/lib/env.ts`, nunca `process.env` no código da app. Scripts em `scripts/` podem ler `process.env`.
- **Rotas `/api/*`:** a autenticação é a primeira coisa do handler (guia 05).
- **Números fixos:**
  - `PACE_MS = 500`;
  - nova tentativa do transacional: uma vez, espera = `retry-after` em segundos, no máximo 2 s, 1 s se o header faltar;
  - dedupe do webhook: `RESEND:email:{svix-id}`;
  - domínio da plataforma: `metodotia.com`, nunca liberável para cliente, nem subdomínios.
- **Comando:** `npm run email:dominio -- list | add <dominio> <slug> [--yes] | remove <dominio> [--yes]`. Gravar fora de localhost exige `--yes`. Lê `DIRECT_URL` (se não vazio) ou `DATABASE_URL`.
- **Commits:** `[E-mail] - Verbo + tarefa`, corpo curto, última linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feature/email-dominios-plataforma`. Sem push.
- Comentários de código em inglês; docs e mensagens do script em pt-BR.
- Antes de `npm run build`, pare qualquer `next dev`. Para rotas de API novas em dev, use `npx next dev --webpack`, porque o Turbopack local devolve 404 para elas.
- Node 20: nenhuma API mais nova.

## Review Focus

1. **Empresa B tenta enviar do domínio da empresa A** → recusado no início do envio e no disparador. Cobertura: `isSenderAllowed` (Task 2), `@unique` + `check:isolation` (Task 1) e a checagem no `startEmailBroadcast` (Task 5).
2. **Endereço digitado com maiúsculas e espaços** (`" Promo@LojaXYZ.com.br "`) → aceito se o domínio está liberado e gravado normalizado. Cobertura: Task 2 (`domainOfEmail`) e Task 5 (normalização no save).
3. **Domínio removido com o comando no meio de um envio** → o envio pausa com `domain_not_allowed` no lote seguinte, sem mandar mais nada. Cobertura: checagem a cada lote no disparador (Task 5); o revisor deve confirmar no diff.
4. **Pedido de reset de senha durante um envio grande** → o reset chega. Cobertura: `PACE_MS = 500` (Task 5) e a nova tentativa após 429 (Task 4, com teste do atraso).
5. **Comando rodado contra produção por engano** → sem `--yes`, nada é gravado; com URL malformada, a mensagem é clara. Cobertura: Task 3, passos de verificação.

---

### Task 1: Banco (tabela de domínios e coluna `fromEmail`)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261008120000_email_sender_domains/migration.sql` (gerado)
- Modify: `src/lib/tenant-db.ts` (`TENANT_MODELS`)
- Modify: `scripts/check-isolation.ts`
- Modify: `docs/guia/03-multi-tenancy.md`

**Interfaces:**
- Produz:
  - o model Prisma `emailSenderDomain` (`id`, `organizationId`, `domain` único, `createdAt`);
  - `emailBroadcast.fromEmail: string | null`.

- [ ] **Step 1: Banco local do Docker de pé**

Run: `docker ps --format '{{.Names}} {{.Status}}'`. Esperado: `metodoai-db` com `(healthy)`.
- Se o daemon não responder, abra `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`, espere `docker info` responder e rode `docker compose up -d postgres`.
- Se `%LOCALAPPDATA%\metodoai-dev\pg.cmd status` mostrar o portátil rodando, rode `pg.cmd stop`.

- [ ] **Step 2: Escrever o teste que falha (isolamento)**

Em `scripts/check-isolation.ts`, logo antes de `console.log("\n✅ Tenant isolation: all checks passed.");`:

```ts
    // 11) Sender domains are per org, and a domain belongs to ONE org (unique).
    const senderDomain = `iso-${stamp}.example.com`;
    await prisma.emailSenderDomain.create({
      data: { organizationId: orgA.id, domain: senderDomain },
    });
    const domainsB = await prisma.emailSenderDomain.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      domainsB.length === 0,
      "sender domain list scoped to org B excludes org A's domain",
    );
    let duplicateRejected = false;
    try {
      await prisma.emailSenderDomain.create({
        data: { organizationId: orgB.id, domain: senderDomain },
      });
    } catch {
      duplicateRejected = true;
    }
    assert(duplicateRejected, "the same sender domain cannot be assigned to a second org");
```

No `finally`, antes de `await prisma.emailSuppression.deleteMany(...)`:

```ts
    await prisma.emailSenderDomain.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
```

Run: `npm run typecheck`. Esperado: FAIL com `Property 'emailSenderDomain' does not exist`.

- [ ] **Step 3: Schema**

Em `model EmailBroadcast`, logo depois da linha `replyTo        String?`:

```prisma
  /// Sender address typed in the composer (normalized). Its domain must be an
  /// EmailSenderDomain of this org for the send to start or continue.
  fromEmail      String?
```

Depois do bloco `model EmailSuppression { ... }`:

```prisma
/// A sender domain the platform team VERIFIED in the platform's Resend account
/// and assigned to ONE organization (scripts/email-domain.ts). Globally unique:
/// the lock that stops org B from sending as org A's domain through the shared
/// platform account.
model EmailSenderDomain {
  id             String   @id @default(cuid())
  organizationId String
  /// Lowercase, no "@".
  domain         String   @unique
  createdAt      DateTime @default(now())

  @@index([organizationId])
  @@map("email_sender_domains")
}
```

- [ ] **Step 4: Gerar e aplicar a migration (sem `migrate dev`)**

```bash
mkdir -p prisma/migrations/20261008120000_email_sender_domains
git show origin/main:prisma/schema.prisma > "$TEMP/schema-main.prisma"
npx prisma migrate diff --from-schema-datamodel "$TEMP/schema-main.prisma" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261008120000_email_sender_domains/migration.sql
```

Abra o SQL. Ele deve ter **só** estes comandos:
- `ALTER TABLE "email_broadcasts" ADD COLUMN "fromEmail" TEXT;`
- `CREATE TABLE "email_sender_domains" (...)`;
- `CREATE UNIQUE INDEX "email_sender_domains_domain_key"`;
- `CREATE INDEX "email_sender_domains_organizationId_idx"`.

Se houver qualquer outra coisa, pare e reporte. Depois:

```bash
npx prisma db execute --file prisma/migrations/20261008120000_email_sender_domains/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20261008120000_email_sender_domains
npx prisma generate
```

Em `src/lib/tenant-db.ts`, no fim de `TENANT_MODELS` (depois de `"EmailSuppression",`), acrescente `"EmailSenderDomain",`.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run typecheck && npm run check:isolation`
Esperado: PASS, terminando em `✅ Tenant isolation: all checks passed.`, com as duas asserções novas listadas.

- [ ] **Step 6: Guia 03**

Em `docs/guia/03-multi-tenancy.md`:
- troque a contagem de `TENANT_MODELS` (74) pelo novo total. Confira com `node -e "const s=require('fs').readFileSync('src/lib/tenant-db.ts','utf8');const m=s.match(/TENANT_MODELS[\s\S]*?\]\)/)[0];console.log((m.match(/\"[A-Za-z]+\"/g)||[]).length)"`; o esperado é 75;
- troque o número de asserções (12) pelo novo (`grep -c "    assert(" scripts/check-isolation.ts`; o esperado é 14);
- acrescente "domínio de envio" à lista do que o script popula.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261008120000_email_sender_domains src/lib/tenant-db.ts scripts/check-isolation.ts docs/guia/03-multi-tenancy.md
git commit -m "[E-mail] - Adiciona a tabela de dominios de envio e o remetente por envio" -m "Migration aditiva: email_sender_domains (dominio unico) e a coluna fromEmail em email_broadcasts; isolamento coberto." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regras puras de domínio do remetente

**Files:**
- Create: `src/lib/email-broadcast/sender-domain.ts`
- Modify: `scripts/check-email-broadcast.ts`
- Modify: `docs/guia/06-antes-de-commitar.md` (parágrafo "Checagem de módulo")

**Interfaces:**
- Consome: `normalizeEmail`, `isValidEmail` (`./normalize`).
- Produz:
  - `PLATFORM_DOMAIN = "metodotia.com"`;
  - `normalizeDomain(raw: string): string | null`;
  - `domainOfEmail(email: string): string | null`;
  - `isPlatformDomain(domain: string): boolean`;
  - `isSenderAllowed(email: string, allowedDomains: readonly string[]): boolean`.

- [ ] **Step 1: Escrever o teste que falha**

No topo de `scripts/check-email-broadcast.ts`, junto dos imports:

```ts
import {
  domainOfEmail,
  isPlatformDomain,
  isSenderAllowed,
  normalizeDomain,
} from "../src/lib/email-broadcast/sender-domain";
```

Antes do `console.log` final:

```ts
// --- sender domains ----------------------------------------------------------------
check("normalizeDomain lowercases, strips @ and trailing dot, rejects non-domains", () => {
  assert.equal(normalizeDomain(" @LojaXYZ.com.br. "), "lojaxyz.com.br");
  assert.equal(normalizeDomain("lojaxyz"), null);
  assert.equal(normalizeDomain("http://x.com"), null);
  assert.equal(normalizeDomain("a b.com"), null);
  assert.equal(normalizeDomain(""), null);
});

check("domainOfEmail returns the normalized domain of a valid address only", () => {
  assert.equal(domainOfEmail(" Contato@LojaXYZ.com.br "), "lojaxyz.com.br");
  assert.equal(domainOfEmail("sem-arroba"), null);
  assert.equal(domainOfEmail("maria@@x.com"), null);
});

check("isPlatformDomain matches metodotia.com and its subdomains only", () => {
  assert.equal(isPlatformDomain("metodotia.com"), true);
  assert.equal(isPlatformDomain("mail.metodotia.com"), true);
  assert.equal(isPlatformDomain("metodotia.com.br"), false);
  assert.equal(isPlatformDomain("xmetodotia.com"), false);
});

check("isSenderAllowed needs an exact allowed domain and never the platform's", () => {
  assert.equal(isSenderAllowed(" Promo@LojaXYZ.com.br ", ["lojaxyz.com.br"]), true);
  assert.equal(isSenderAllowed("a@outra.com", ["lojaxyz.com.br"]), false);
  assert.equal(isSenderAllowed("a@mail.lojaxyz.com.br", ["lojaxyz.com.br"]), false);
  assert.equal(isSenderAllowed("x@metodotia.com", ["metodotia.com"]), false);
  assert.equal(isSenderAllowed("", ["lojaxyz.com.br"]), false);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run check:email`
Esperado: FAIL com `Cannot find module '../src/lib/email-broadcast/sender-domain'`.

- [ ] **Step 3: Implementar `src/lib/email-broadcast/sender-domain.ts`**

```ts
import { isValidEmail, normalizeEmail } from "./normalize";

/**
 * Sender-domain rules of the mass e-mail: every org sends through the
 * PLATFORM's Resend account, so the From domain must be one the platform team
 * verified and assigned to that org (EmailSenderDomain). Pure and free of
 * `server-only`: the composer, the server and scripts/ all use it.
 */

/** The platform's own sending domain — never assignable to a client org. */
export const PLATFORM_DOMAIN = "metodotia.com";

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Canonical form of a domain typed by an admin, or null when it isn't one. */
export function normalizeDomain(raw: string): string | null {
  const domain = raw.trim().toLowerCase().replace(/^@+/, "").replace(/\.+$/, "");
  return domain.length <= 253 && DOMAIN_RE.test(domain) ? domain : null;
}

/** Normalized domain of a valid e-mail address, or null. */
export function domainOfEmail(email: string): string | null {
  const normalized = normalizeEmail(email);
  return isValidEmail(normalized) ? normalized.slice(normalized.lastIndexOf("@") + 1) : null;
}

export function isPlatformDomain(domain: string): boolean {
  return domain === PLATFORM_DOMAIN || domain.endsWith(`.${PLATFORM_DOMAIN}`);
}

/** True when the address' exact domain is one of the org's allowed domains
 * (subdomains don't inherit) and it isn't the platform's. */
export function isSenderAllowed(email: string, allowedDomains: readonly string[]): boolean {
  const domain = domainOfEmail(email);
  return domain !== null && !isPlatformDomain(domain) && allowedDomains.includes(domain);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run check:email && npm run typecheck`
Esperado: PASS, com 4 checagens novas e o total anterior + 4.

Em `docs/guia/06-antes-de-commitar.md`, no parágrafo "**Checagem de módulo (fora das cinco):**", troque
"(normalização, deduplicação, renderização, assinatura Svix, transições de status)" por
"(normalização, deduplicação, renderização, assinatura Svix, transições de status, domínio do remetente,
espera da nova tentativa do e-mail transacional)".

- [ ] **Step 5: Commit**

```bash
git add src/lib/email-broadcast/sender-domain.ts scripts/check-email-broadcast.ts docs/guia/06-antes-de-commitar.md
git commit -m "[E-mail] - Adiciona as regras de dominio do remetente" -m "Funcoes puras (dominio exato, nunca o da plataforma) cobertas pelo check:email." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Comando `npm run email:dominio`

**Files:**
- Create: `scripts/email-domain.ts`
- Modify: `package.json` (script)
- Modify: `README.md` (runbook §8: subseção "E-mail em massa: liberar domínio de um cliente")

**Interfaces:**
- Consome: `normalizeDomain`, `isPlatformDomain` (Task 2); o model `emailSenderDomain` (Task 1).
- Produz: o comando operacional (nenhum código da app depende dele).

- [ ] **Step 1: Criar `scripts/email-domain.ts`**

```ts
/**
 * Platform-team command: assign a sender domain — already VERIFIED in the
 * platform's Resend dashboard — to ONE organization; list; remove.
 *
 *   npm run email:dominio -- list
 *   npm run email:dominio -- add <domain> <org-slug> [--yes]
 *   npm run email:dominio -- remove <domain> [--yes]
 *
 * Production (README §8): npx tsx --env-file=.env.supabase scripts/email-domain.ts <same args>
 * Connects to DIRECT_URL (when set) or DATABASE_URL. Writes to a non-local
 * database require --yes. System context: raw Prisma, organizationId explicit.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isPlatformDomain, normalizeDomain } from "../src/lib/email-broadcast/sender-domain";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const USAGE = [
  "Uso:",
  "  npm run email:dominio -- list",
  "  npm run email:dominio -- add <dominio> <slug-da-empresa> [--yes]",
  "  npm run email:dominio -- remove <dominio> [--yes]",
].join("\n");

const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) fail("DIRECT_URL/DATABASE_URL não definido.");
if (!/^postgres(ql)?:\/\//.test(url)) {
  fail('URL do banco malformada: ela precisa começar com "postgresql://".');
}
const host = new URL(url).hostname;
const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const [command, ...rest] = args.filter((a) => a !== "--yes");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

/** Writes outside localhost need an explicit --yes (checked before touching the DB). */
function confirmWrite(): void {
  if (!isLocal && !yes) {
    fail(`Banco de destino: ${host}. Para gravar fora do ambiente local, repita o comando com --yes.`);
  }
}

async function list(): Promise<void> {
  const rows = await prisma.emailSenderDomain.findMany({ orderBy: { domain: "asc" } });
  if (rows.length === 0) {
    console.log("Nenhum domínio liberado.");
    return;
  }
  const orgs = await prisma.organization.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.organizationId))] } },
    select: { id: true, slug: true, name: true },
  });
  const byId = new Map(orgs.map((o) => [o.id, o]));
  for (const r of rows) {
    const o = byId.get(r.organizationId);
    console.log(`${r.domain}  →  ${o ? `${o.slug} (${o.name})` : r.organizationId}`);
  }
}

async function add(rawDomain: string, slug: string): Promise<void> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) fail(`Domínio inválido: "${rawDomain}".`);
  if (isPlatformDomain(domain)) {
    fail(`${domain} é o domínio da plataforma e não pode ser liberado para clientes.`);
  }
  const org = await prisma.organization.findFirst({
    where: { slug },
    select: { id: true, slug: true, name: true },
  });
  if (!org) fail(`Empresa com slug "${slug}" não encontrada.`);
  const existing = await prisma.emailSenderDomain.findFirst({ where: { domain } });
  if (existing) {
    if (existing.organizationId === org.id) {
      console.log(`✓ ${domain} já estava liberado para ${org.slug}.`);
      return;
    }
    const owner = await prisma.organization.findFirst({
      where: { id: existing.organizationId },
      select: { slug: true, name: true },
    });
    fail(`${domain} já pertence a outra empresa: ${owner ? `${owner.slug} (${owner.name})` : existing.organizationId}.`);
  }
  await prisma.emailSenderDomain.create({ data: { organizationId: org.id, domain } });
  console.log(`✓ ${domain} liberado para ${org.slug} (${org.name}).`);
  console.log("  Lembrete: o domínio precisa estar Verified no painel do Resend da plataforma.");
}

async function remove(rawDomain: string): Promise<void> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) fail(`Domínio inválido: "${rawDomain}".`);
  const existing = await prisma.emailSenderDomain.findFirst({ where: { domain } });
  if (!existing) fail(`${domain} não está liberado para nenhuma empresa.`);
  await prisma.emailSenderDomain.deleteMany({
    where: { id: existing.id, organizationId: existing.organizationId },
  });
  console.log(`✓ ${domain} removido. Envios em andamento desse domínio pausam no próximo lote.`);
}

async function main(): Promise<void> {
  console.log(`Banco: ${host}`);
  if (command === "list" && rest.length === 0) return list();
  if (command === "add" && rest.length === 2) {
    confirmWrite();
    return add(rest[0], rest[1]);
  }
  if (command === "remove" && rest.length === 1) {
    confirmWrite();
    return remove(rest[0]);
  }
  fail(USAGE);
}

main()
  .catch((e) => {
    console.error(`✖ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

Em `package.json`, dentro de `scripts`, depois de `"check:email"`:

```json
    "email:dominio": "tsx --env-file=.env scripts/email-domain.ts",
```

- [ ] **Step 2: Verificar no banco local (Docker)**

Descubra dois slugs locais:
`node --env-file=.env -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query('select slug,name from organizations order by name')).then(r=>{console.log(r.rows);return c.end()})"`

Rode, trocando `<slugA>` e `<slugB>`, e cole a saída no relatório:
1. `npm run email:dominio -- list` → `Nenhum domínio liberado.` (ou a lista atual).
2. `npm run email:dominio -- add Teste-Plano.Example.com. <slugA>` → `✓ teste-plano.example.com liberado para <slugA> …`
3. `npm run email:dominio -- add teste-plano.example.com <slugA>` → `✓ … já estava liberado …`
4. `npm run email:dominio -- add teste-plano.example.com <slugB>` → `✖ … já pertence a outra empresa: <slugA> …`, com exit ≠ 0.
5. `npm run email:dominio -- add metodotia.com <slugA>` → `✖ metodotia.com é o domínio da plataforma …`
6. `npm run email:dominio -- add mail.metodotia.com <slugA>` → recusado, igual.
7. `npm run email:dominio -- add lojaxyz <slugA>` → `✖ Domínio inválido`.
8. `npm run email:dominio -- add x.example.com slug-que-nao-existe` → `✖ Empresa com slug … não encontrada.`
9. `npm run email:dominio -- list` → mostra `teste-plano.example.com  →  <slugA> (…)`.
10. `npm run email:dominio -- remove teste-plano.example.com` → `✓ … removido`; o `list` volta ao estado inicial.
11. **Trava de produção, sem rede:** `DIRECT_URL="postgresql://u:p@db.example.com:5432/x" npx tsx scripts/email-domain.ts add a.example.com qualquer` → `Banco: db.example.com` e `✖ … repita o comando com --yes`. Não pode tentar conectar.
12. **URL malformada:** `DIRECT_URL="ostgresql://u:p@db.example.com/x" npx tsx scripts/email-domain.ts list` → `✖ URL do banco malformada …`
13. **Sem argumentos:** `npm run email:dominio --` → mostra o `Uso:`, com exit ≠ 0.

- [ ] **Step 3: README, runbook §8**

Acrescente uma subseção depois de "Migrações (Supabase)":

```markdown
### E-mail em massa: liberar o domínio de um cliente

Todas as empresas enviam pela conta Resend da plataforma (`RESEND_API_KEY`). Cada empresa só envia de
domínio próprio, liberado assim:

1. Painel do Resend (conta da plataforma) → **Domains → Add Domain** → domínio do cliente. Passe ao
   cliente as linhas de DNS e espere **Verified**.
2. Libere para a empresa (o `slug` aparece na URL/Configurações da empresa):
   `npx tsx --env-file=.env.supabase scripts/email-domain.ts add <dominio> <slug> --yes`
   (`.env.supabase` com `DIRECT_URL` de produção; apague o arquivo depois.)
3. Conferir: `... scripts/email-domain.ts list`. Remover: `... remove <dominio> --yes` (envios em andamento
   desse domínio pausam no próximo lote).

Um domínio pertence a uma empresa só, e `metodotia.com` nunca é liberado para cliente. A chave do
`.env` precisa estar como "Sending access" com **All domains** no Resend.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/email-domain.ts package.json README.md
git commit -m "[E-mail] - Adiciona o comando para liberar dominio de envio por empresa" -m "list/add/remove com trava de dominio unico, recusa de metodotia.com e --yes obrigatorio fora do localhost." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Nova tentativa do e-mail transacional após 429

**Files:**
- Create: `src/lib/email/retry-after.ts`
- Modify: `src/lib/email/send.ts`
- Modify: `scripts/check-email-broadcast.ts`

**Interfaces:**
- Produz: `transactionalRetryDelayMs(retryAfter: string | null): number`.

- [ ] **Step 1: Escrever o teste que falha**

Import no topo de `scripts/check-email-broadcast.ts`:

```ts
import { transactionalRetryDelayMs } from "../src/lib/email/retry-after";
```

Antes do `console.log` final:

```ts
check("transactionalRetryDelayMs follows retry-after, capped at 2s, 1s by default", () => {
  assert.equal(transactionalRetryDelayMs(null), 1000);
  assert.equal(transactionalRetryDelayMs("0.5"), 500);
  assert.equal(transactionalRetryDelayMs("1"), 1000);
  assert.equal(transactionalRetryDelayMs("30"), 2000);
  assert.equal(transactionalRetryDelayMs("abc"), 1000);
  assert.equal(transactionalRetryDelayMs("-3"), 1000);
});
```

Run: `npm run check:email`. Esperado: FAIL com `Cannot find module '../src/lib/email/retry-after'`.

- [ ] **Step 2: Implementar `src/lib/email/retry-after.ts`**

```ts
/**
 * How long a transactional e-mail (login, invite, reset) waits before its one
 * retry after a 429: Resend's Retry-After seconds, capped at 2s because a
 * person is waiting on that request; 1s when the header is missing or invalid.
 * The platform's Resend account is shared with the mass e-mail, so a big send
 * can briefly hit the account's rate limit. Pure: no env, no server-only.
 */
export function transactionalRetryDelayMs(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  const wait = Number.isFinite(seconds) && seconds > 0 ? seconds : 1;
  return Math.min(wait, 2) * 1000;
}
```

- [ ] **Step 3: Usar em `src/lib/email/send.ts`**

Acrescente o import `import { transactionalRetryDelayMs } from "@/lib/email/retry-after";`. Dentro de `sendEmail`, troque o bloco `try { const res = await fetch(...); ... }` só no trecho do `fetch`: extraia a chamada para uma função local e repita uma vez em 429:

```ts
  try {
    const post = () =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: Array.isArray(input.to) ? input.to : [input.to],
          subject: input.subject,
          html: input.html,
          ...(input.text ? { text: input.text } : {}),
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        }),
      });

    let res = await post();
    if (res.status === 429) {
      // The account is shared with the mass e-mail: wait briefly and retry once.
      await new Promise((r) => setTimeout(r, transactionalRetryDelayMs(res.headers.get("retry-after"))));
      res = await post();
    }
```

O restante, a partir de `const data = (await res.json()…`, fica **exatamente** como está.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run check:email && npm run typecheck && npm run lint`
Esperado: PASS, sem avisos novos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/retry-after.ts src/lib/email/send.ts scripts/check-email-broadcast.ts
git commit -m "[E-mail] - Repete uma vez o e-mail transacional quando o Resend limita a taxa" -m "A conta Resend passa a ser dividida com o envio em massa; reset/convite/verificacao esperam ate 2 s e tentam de novo uma vez." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Envio pela chave da plataforma e domínios liberados (servidor e tela)

**Files:**
- Create: `src/lib/email-broadcast/platform.ts`
- Create: `src/lib/queries/email-sender-domains.ts`
- Modify: `src/lib/env.ts` (`RESEND_WEBHOOK_SECRET`)
- Modify: `src/lib/validations/email-broadcast.ts`
- Modify: `src/lib/email-broadcast/types.ts`
- Modify: `src/lib/queries/email-broadcasts.ts`
- Modify: `src/app/actions/email-broadcasts.ts`
- Modify: `src/lib/email-broadcast/dispatch.ts`
- Modify: `src/components/email/email-composer.tsx`
- Modify: `src/app/[locale]/app/email/page.tsx`, `new/page.tsx`, `[id]/edit/page.tsx`, `[id]/page.tsx`
- Modify: `src/messages/pt.json`, `src/messages/en.json`, `CLAUDE.md`, `docs/guia/04-modulos-e-permissoes.md`

**Interfaces:**
- Consome: `isSenderAllowed` (Task 2); o model `emailSenderDomain` e `fromEmail` (Task 1).
- Produz:
  - `platformResendKey(): string | null` e `deliveryTrackingConfigured(): boolean`;
  - `listSenderDomains(organizationId: string): Promise<string[]>`;
  - `env.RESEND_WEBHOOK_SECRET?: string`;
  - erros novos de action: `"domain_not_allowed" | "from_required"`;
  - motivo de pausa novo: `"domain_not_allowed"`.
- `src/lib/email-broadcast/connection.ts` **continua existindo** nesta task, porque a rota antiga do webhook ainda o importa. Ele sai na Task 6. Depois desta task, nada além da rota antiga pode importá-lo.

- [ ] **Step 1: Env, plataforma e DAL**

Em `src/lib/env.ts`, logo depois da linha `EMAIL_FROM: z.string().optional(),`:

```ts
  // Signing secret of the platform's Resend webhook (dashboard → Webhooks →
  // https://<site>/api/email/webhook). Optional: without it the mass e-mail
  // still sends, but delivery statuses stay "Sent".
  RESEND_WEBHOOK_SECRET: z.string().optional(),
```

`src/lib/email-broadcast/platform.ts`:

```ts
import "server-only";
import { env } from "@/lib/env";

/**
 * The mass e-mail sends through the PLATFORM's Resend account — the same key
 * as login/invite/reset mail (src/lib/email/send.ts). Per-org Resend
 * connections (Conexões) are no longer used here; Campaigns still uses them.
 */
export function platformResendKey(): string | null {
  return env.RESEND_API_KEY?.trim() || null;
}

/** Delivery statuses work once the platform webhook secret is configured. */
export function deliveryTrackingConfigured(): boolean {
  return Boolean(env.RESEND_WEBHOOK_SECRET?.trim());
}
```

`src/lib/queries/email-sender-domains.ts`:

```ts
import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/** Sender domains the platform team assigned to this org (scripts/email-domain.ts). */
export async function listSenderDomains(organizationId: string): Promise<string[]> {
  const rows = await tenantDb(organizationId).emailSenderDomain.findMany({
    orderBy: { domain: "asc" },
    select: { domain: true },
  });
  return rows.map((r) => r.domain);
}
```

- [ ] **Step 2: Validação, tipos e DAL do envio**

`src/lib/validations/email-broadcast.ts`: em `broadcastDraftSchema`, logo depois de `fromName: z.string().trim().max(100),`:

```ts
  fromEmail: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || isValidEmail(normalizeEmail(v)), "invalid_from"),
```

`src/lib/email-broadcast/types.ts`: em `ComposerDraft`, depois de `fromName: string;`, acrescente `fromEmail: string;`.

`src/lib/queries/email-broadcasts.ts`:
- troque `import { getResendConnection } from "@/lib/email-broadcast/connection";` por `import { listSenderDomains } from "@/lib/queries/email-sender-domains";`;
- em `getEmailBroadcast`, acrescente `fromEmail: true,` ao `select` (depois de `fromName: true,`);
- troque `emailComposerData` inteira por:

```ts
/** Everything the composer page needs besides the draft itself. */
export async function emailComposerData(organizationId: string) {
  const [options, allowedDomains, used] = await Promise.all([
    emailComposerOptions(organizationId),
    listSenderDomains(organizationId),
    countEmailsSentThisMonth(organizationId),
  ]);
  return {
    options,
    allowedDomains,
    quota: { used, limit: LIMITS.emailBroadcastQuotaPerMonth },
  };
}
```

- [ ] **Step 3: Actions (`src/app/actions/email-broadcasts.ts`)**

- Imports: remova `import { getResendConnection, ensureResendWebhook } from "@/lib/email-broadcast/connection";` e acrescente:

```ts
import { platformResendKey } from "@/lib/email-broadcast/platform";
import { isSenderAllowed } from "@/lib/email-broadcast/sender-domain";
import { listSenderDomains } from "@/lib/queries/email-sender-domains";
```

- `EmailActionError`: acrescente `| "domain_not_allowed"` e `| "from_required"` (antes de `| "unknown"`).
- `saveEmailDraft`, no objeto `data`, depois de `fromName: …,`: `fromEmail: parsed.data.fromEmail ? normalizeEmail(parsed.data.fromEmail) : null,`
- `duplicateEmailBroadcast`: acrescente `fromEmail: true` ao `select` e `fromEmail: src.fromEmail,` ao `data` do `create`.
- `startEmailBroadcast`:
  - acrescente `fromEmail: true` ao `select` do `findFirst`;
  - troque as duas linhas
    ```ts
      const conn = await getResendConnection(orgId);
      if (!conn) return { ok: false, error: "no_connection" };
    ```
    por:
    ```ts
      if (!platformResendKey()) return { ok: false, error: "no_connection" };
      if (!b.fromEmail) return { ok: false, error: "from_required" };
      // Server-side gate: the composer checks too, but only this decides.
      if (!isSenderAllowed(b.fromEmail, await listSenderDomains(orgId))) {
        return { ok: false, error: "domain_not_allowed" };
      }
    ```
  - **remova** o bloco inteiro `// After the claim, so two tabs cannot both register a webhook.` + `await ensureResendWebhook(conn).catch(…);`.
- `resumeEmailBroadcast`:
  - troque o `select: { status: true }` do `findFirst` por `select: { status: true, fromEmail: true }`;
  - no ramo `if (b.status === "PAUSED")`, troque a linha
    `if (!(await getResendConnection(g.ctx.organizationId))) return { ok: false, error: "no_connection" };`
    por:
    ```ts
        if (!platformResendKey()) return { ok: false, error: "no_connection" };
        if (!b.fromEmail || !isSenderAllowed(b.fromEmail, await listSenderDomains(g.ctx.organizationId))) {
          return { ok: false, error: "domain_not_allowed" };
        }
    ```

- [ ] **Step 4: Disparador (`src/lib/email-broadcast/dispatch.ts`)**

- Import: troque `import { getResendConnection } from "./connection";` por:

```ts
import { platformResendKey } from "./platform";
import { isSenderAllowed } from "./sender-domain";
```

- Troque `const PACE_MS = 150;` por:

```ts
/** ~2 requests/s at most: the platform's Resend account (~10 req/s) is shared
 * with login/invite/reset mail, which must keep its headroom. */
const PACE_MS = 500;
```

- No `select` do primeiro `findFirst` de `runEmailBroadcast`, acrescente `fromEmail: true`.
- `pause`: o tipo do primeiro parâmetro passa a ser `"no_connection" | "quota" | "provider_error" | "domain_not_allowed"`.
- Logo depois da declaração de `pause`, acrescente:

```ts
  /** Re-checked before every batch: a domain removed with email:dominio stops the send. */
  const senderStillAllowed = async () => {
    const rows = await prisma.emailSenderDomain.findMany({
      where: { organizationId: org },
      select: { domain: true },
    });
    return Boolean(b.fromEmail) && isSenderAllowed(b.fromEmail as string, rows.map((r) => r.domain));
  };
```

- Dentro do `try`, troque
  ```ts
      const conn = await getResendConnection(org);
      if (!conn) {
        await pause("no_connection", null);
        return { done: true };
      }
  ```
  por:
  ```ts
      const apiKey = platformResendKey();
      if (!apiKey) {
        await pause("no_connection", null);
        return { done: true };
      }
      if (!b.fromEmail) {
        await pause("domain_not_allowed", null);
        return { done: true };
      }
  ```
- Troque `const from = formatFrom(b.fromName, conn.fromEmail);` por `const from = formatFrom(b.fromName, b.fromEmail);`.
- Troque `sendOne(conn.apiKey,` por `sendOne(apiKey,` e `sendBatch(conn.apiKey,` por `sendBatch(apiKey,`.
- No `while`, logo depois de `if (current?.status !== "SENDING") return { done: true };`, acrescente:

```ts
      if (!(await senderStillAllowed())) {
        await pause("domain_not_allowed", null);
        return { done: true };
      }
```

- [ ] **Step 5: Composer (`src/components/email/email-composer.tsx`)**

- Import: acrescente `import { isSenderAllowed } from "@/lib/email-broadcast/sender-domain";`. Remova `Link` do import de `@/i18n/navigation` se ficar sem uso; o lint aponta.
- Props: troque `fromEmail,` / `fromEmail: string | null;` por `allowedDomains,` / `allowedDomains: string[];`.
- Estado: depois de `const [fromName, setFromName] = useState(draft.fromName);`, acrescente `const [fromEmail, setFromEmail] = useState(draft.fromEmail);`.
- Troque `const noConnection = !fromEmail;` por:

```tsx
  const noDomains = allowedDomains.length === 0;
  const fromAllowed = isSenderAllowed(fromEmail, allowedDomains);
  const fromProblem = fromEmail.trim() !== "" && !fromAllowed;
```

- `payload`: `const payload = () => ({ subject, html, fromName, fromEmail, replyTo, audience });`
- Em `onSend`, como primeira linha dentro do `guarded(async () => {`:

```tsx
        if (!fromAllowed) {
          toast(t(fromEmail.trim() ? "error.domain_not_allowed" : "error.from_required"), { variant: "error" });
          return;
        }
```

- Troque o bloco `{noConnection ? ( <p …>{t("connection.missingBody")} … </p> ) : null}` por:

```tsx
        {noDomains ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="font-medium">{t("domains.noneTitle")}.</span> {t("domains.noneBody")}
          </p>
        ) : null}
```

- Troque o campo somente leitura
  `<Input id="fromEmail" value={fromEmail ?? ""} readOnly placeholder={t("connection.missingTitle")} />`
  por:

```tsx
            <Input
              id="fromEmail"
              type="email"
              value={fromEmail}
              maxLength={254}
              placeholder={t("fromEmailPlaceholder")}
              aria-invalid={fromProblem}
              onChange={(e) => setFromEmail(e.target.value)}
            />
            {fromProblem ? (
              <p className="mt-1 text-xs text-red-600">{t("domains.notAllowed")}</p>
            ) : !noDomains ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("domains.hint", { domains: allowedDomains.join(", ") })}
              </p>
            ) : null}
```

- No botão "Revisar e enviar", troque `disabled={busy || noConnection || preview?.stats.total === 0}` por `disabled={busy || !fromAllowed || preview?.stats.total === 0}`.

- [ ] **Step 6: Páginas**

`new/page.tsx`: no `draft`, depois de `fromName: ctx.organization.name,`, acrescente `fromEmail: "",`. Troque `fromEmail={data.fromEmail}` por `allowedDomains={data.allowedDomains}`.

`[id]/edit/page.tsx`: no `draft`, depois de `fromName: b.fromName ?? "",`, acrescente `fromEmail: b.fromEmail ?? "",`. Troque `fromEmail={data.fromEmail}` por `allowedDomains={data.allowedDomains}`.

`page.tsx` (lista):
- imports: troque `import { getResendConnection, deliveryTrackingActive } from "@/lib/email-broadcast/connection";` por `import { deliveryTrackingConfigured } from "@/lib/email-broadcast/platform";` e `import { listSenderDomains } from "@/lib/queries/email-sender-domains";`;
- troque `const [rows, conn, used] = await Promise.all([listEmailBroadcasts(ctx.organizationId), getResendConnection(ctx.organizationId), countEmailsSentThisMonth(ctx.organizationId)]);` por:

```tsx
  const [rows, domains, used] = await Promise.all([
    listEmailBroadcasts(ctx.organizationId),
    listSenderDomains(ctx.organizationId),
    countEmailsSentThisMonth(ctx.organizationId),
  ]);
  const tracking = deliveryTrackingConfigured();
```

- troque todo o bloco `{conn ? ( … ) : ( … )}` (o card de conexão) por:

```tsx
        {domains.length > 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4">
            <CheckCircle2 className="size-5 shrink-0 text-green-600" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t("domains.title")}</p>
              <p className="truncate text-sm text-muted-foreground">
                {domains.join(", ")} · {tracking ? t("domains.tracking") : t("domains.noTracking")}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t("domains.noneTitle")}</p>
              <p className="text-sm">{t("domains.noneBody")}</p>
            </div>
          </div>
        )}
```

`[id]/page.tsx` (relatório):
- imports: troque `import { getResendConnection, deliveryTrackingActive } from "@/lib/email-broadcast/connection";` por `import { deliveryTrackingConfigured } from "@/lib/email-broadcast/platform";`;
- troque
  ```tsx
    const [{ counts, recipients, canResume }, conn] = await Promise.all([
      getEmailBroadcastReport(ctx.organizationId, id, filter),
      getResendConnection(ctx.organizationId),
    ]);
  ```
  por `const { counts, recipients, canResume } = await getEmailBroadcastReport(ctx.organizationId, id, filter);`;
- troque `{conn && !deliveryTrackingActive(conn) ? (` por `{!deliveryTrackingConfigured() ? (`.

- [ ] **Step 7: Textos (pt e en)**

Dentro de `emailBroadcast`, nos dois arquivos:
- **Remova** o bloco `"connection": { … }` inteiro (8 chaves).
- **Acrescente**, no lugar dele, `"domains"` e `"fromEmailPlaceholder"`.

pt:

```json
    "domains": {
      "title": "Domínios liberados",
      "noneTitle": "Nenhum domínio liberado",
      "noneBody": "Fale com o suporte para liberar o domínio da sua empresa para envio.",
      "hint": "Domínios liberados: {domains}",
      "notAllowed": "Este domínio não está liberado para sua empresa. Use um endereço de um domínio liberado.",
      "tracking": "status de entrega ativo",
      "noTracking": "status de entrega indisponível"
    },
    "fromEmailPlaceholder": "contato@seudominio.com.br",
```

en:

```json
    "domains": {
      "title": "Allowed domains",
      "noneTitle": "No domain allowed",
      "noneBody": "Contact support to allow your company's domain for sending.",
      "hint": "Allowed domains: {domains}",
      "notAllowed": "This domain isn't allowed for your company. Use an address on an allowed domain.",
      "tracking": "delivery status on",
      "noTracking": "delivery status unavailable"
    },
    "fromEmailPlaceholder": "contact@yourdomain.com",
```

Em `emailBroadcast.error`, acrescente:
- pt: `"domain_not_allowed": "O domínio do endereço de envio não está liberado para sua empresa.",` e `"from_required": "Preencha o endereço de envio.",`
- en: `"domain_not_allowed": "The sending address's domain isn't allowed for your company.",` e `"from_required": "Fill in the sending address.",`

Em `emailBroadcast.paused`, acrescente:
- pt: `"domain_not_allowed": "Envio pausado: o domínio do endereço de envio deixou de estar liberado para sua empresa.",`
- en: `"domain_not_allowed": "Send paused: the sending address's domain is no longer allowed for your company.",`

**Atualize os textos** (mesmas chaves):

| Chave | pt | en |
|---|---|---|
| `error.no_connection` | `"O envio de e-mail da plataforma não está configurado. Fale com o suporte."` | `"The platform's e-mail sending isn't configured. Contact support."` |
| `paused.no_connection` | `"Envio pausado: o envio de e-mail da plataforma não está configurado. Fale com o suporte."` | `"Send paused: the platform's e-mail sending isn't configured. Contact support."` |
| `report.noTracking` | `"Sem status de entrega: o aviso de entrega da plataforma ainda não está configurado. Os e-mails ficam como “Enviado”."` | `"No delivery status: the platform's delivery webhook isn't configured yet. Emails stay as “Sent”."` |

Confira a paridade e a contagem:

```bash
node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p+k+'.'):[p+k]);const a=new Set(f(require('./src/messages/pt.json'))),b=new Set(f(require('./src/messages/en.json')));console.log(a.size,b.size,[...a].filter(k=>!b.has(k)),[...b].filter(k=>!a.has(k)))"
```

O esperado é `2786 2786 [] []` (2783 − 8 + 11). Atualize "2783" para o número obtido no `CLAUDE.md` ("chaves (N hoje)") e no guia 04 ("**N chaves-folha cada um**").

- [ ] **Step 8: Verificar**

- `grep -rn "connection\." src/components/email "src/app/[locale]/app/email"` → nada (nenhum `t("connection.…")` sobrando).
- `grep -rln "email-broadcast/connection" src` → só `src/app/api/webhooks/resend/[connectionId]/route.ts`.

Run (com `next dev` parado):
`npm run typecheck && npm run lint && npm run build && npm run check:email && npm run check:isolation && npm run check:node`
Esperado: tudo PASS. O lint mostra só os 4 avisos antigos.

- [ ] **Step 9: Commit**

```bash
git add -A src "src/app/[locale]/app/email" CLAUDE.md docs/guia/04-modulos-e-permissoes.md
git commit -m "[E-mail] - Envia pela conta Resend da plataforma com dominio liberado por empresa" -m "Endereco de envio digitado por envio, conferido na tela, no inicio e a cada lote; sem conexao por cliente; ritmo de ~2 req/s para preservar o reset de senha." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Webhook único da plataforma

**Files:**
- Create: `src/app/api/email/webhook/route.ts`
- Delete: `src/app/api/webhooks/resend/[connectionId]/route.ts`
- Delete: `src/lib/email-broadcast/connection.ts`
- Modify: `docs/guia/05-rotas-e-jobs.md`, `README.md` (§6 tabela de env e runbook §8)

**Interfaces:**
- Consome:
  - `env.RESEND_WEBHOOK_SECRET` (Task 5);
  - `verifySvixSignature`, `parseResendEvent`, `TRANSITIONS` e `suppressionFor` (`@/lib/email-broadcast/webhook`);
  - `suppressEmail` (`@/lib/email-broadcast/suppression`).

- [ ] **Step 1: Criar a rota**

```ts
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { parseResendEvent, suppressionFor, TRANSITIONS, verifySvixSignature } from "@/lib/email-broadcast/webhook";
import { suppressEmail } from "@/lib/email-broadcast/suppression";

export const runtime = "nodejs";

/**
 * Delivery events of the PLATFORM's Resend account, configured once in the
 * Resend dashboard (Webhooks → this URL) with its secret in
 * RESEND_WEBHOOK_SECRET. Authorization: the Svix signature, checked before
 * anything is trusted; without the secret every call is 401. The account also
 * carries login/invite/reset mail: events that don't match a mass e-mail
 * recipient are acknowledged and NOT stored. The org comes from the matched
 * recipient row (system context); every write filters by it. Separate from
 * the generic /api/webhooks/[provider] sink (Campaigns), which stays untouched.
 */
export async function POST(req: NextRequest) {
  const secret = env.RESEND_WEBHOOK_SECRET?.trim();
  const body = await req.text();
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

  const event = parseResendEvent(payload);
  if (!event) return Response.json({ ok: true, ignored: true });
  const recipient = await prisma.emailBroadcastRecipient.findFirst({
    where: { providerMessageId: event.emailId },
    select: { id: true, email: true, organizationId: true },
  });
  if (!recipient) return Response.json({ ok: true, ignored: true });
  const org = recipient.organizationId;

  const dedupeKey = `RESEND:email:${svixId}`;
  try {
    await prisma.webhookEvent.create({
      data: {
        organizationId: org,
        provider: "RESEND",
        eventType: event.type,
        dedupeKey,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ ok: true, duplicate: true }); // Svix retry of an event we already have
    }
    console.error("[webhook:email] failed to store event", error);
    return new Response("error", { status: 500 });
  }

  try {
    const t = TRANSITIONS[event.type];
    await prisma.emailBroadcastRecipient.updateMany({
      where: { organizationId: org, providerMessageId: event.emailId, status: { in: t.from } },
      data: { status: t.to, ...(event.message ? { error: event.message.slice(0, 500) } : {}) },
    });
    const reason = suppressionFor(event);
    if (reason) await suppressEmail(org, recipient.email, reason, recipient.id);
    // processedAt null means "stored but not applied".
    await prisma.webhookEvent.updateMany({
      where: { dedupeKey, organizationId: org },
      data: { processedAt: new Date() },
    });
  } catch (error) {
    console.error("[webhook:email] failed to apply event", error);
    // Drop the stored event so the Svix retry reapplies it. Safe: transitions are
    // forward-only and suppression is createMany+skipDuplicates.
    try {
      await prisma.webhookEvent.deleteMany({ where: { dedupeKey, organizationId: org } });
    } catch (cleanupError) {
      console.error("[webhook:email] failed to drop stored event", cleanupError);
    }
    return new Response("error", { status: 500 });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Remover o código antigo**

```bash
git rm -r "src/app/api/webhooks/resend"
git rm src/lib/email-broadcast/connection.ts
```

`grep -rn "email-broadcast/connection\|ensureResendWebhook\|deliveryTrackingActive\|webhookSecret(" src` → nada.

- [ ] **Step 3: Verificar localmente (Docker, dados falsos, sem e-mail real)**

1. Num script no workspace do SDD (nunca commitado), semeie na empresa "MétodoAI Demo":
   - um `email_broadcasts` com id `e2e-eb-t6`, status `DONE`, subject `E2E`, html `<p>x</p>`, fromEmail `a@e2e.example.com`, `createdById` de um membro da empresa;
   - dois destinatários: `e2e-r-t6-a` (`e2e-a-t6@example.com`, providerMessageId `e2e-pm-t6-a`) e `e2e-r-t6-b` (`e2e-b-t6@example.com`, `e2e-pm-t6-b`), status `SENT`, batchNo 0.
   Use as colunas camelCase com aspas, como na migration.
2. Suba o dev com o segredo de teste:
   `RESEND_WEBHOOK_SECRET="whsec_$(node -e "process.stdout.write(Buffer.from('local-e2e-secret').toString('base64'))")" npx next dev --webpack`, em background. Espere o `localhost:3000` responder.
3. Monte um assinador no workspace, com a mesma lógica do `signSvix` de `src/lib/email-broadcast/webhook.ts`: `v1,` + base64 do HMAC-SHA256 de `${id}.${ts}.${body}`, com a chave = base64 decodificado de `local-e2e-secret`.
4. Checagens; cole comando, status, corpo e evidência do banco:
   - a) POST `/api/email/webhook` sem headers → 401;
   - b) `email.delivered` assinado para `e2e-pm-t6-a` (svix-id `evt_t6_1`) → 200 `{"ok":true}`; o destinatário fica `DELIVERED`; existe `webhook_events` com `dedupeKey='RESEND:email:evt_t6_1'` e `processedAt` preenchido;
   - c) a mesma requisição de novo → 200 `{"ok":true,"duplicate":true}`;
   - d) `email.bounced` `{"bounce":{"type":"Permanent","message":"Caixa inexistente"}}` para `e2e-pm-t6-b` (`evt_t6_2`) → 200; o destinatário fica `BOUNCED` com o erro; existe um `email_suppressions` `BOUNCED`;
   - e) `email.delivered` para `id-de-email-de-login` (`evt_t6_3`) → 200 `{"ok":true,"ignored":true}`, sem linha em `webhook_events`;
   - f) corpo alterado depois de assinar → 401.
5. **Limpeza** (sempre):
   - apague as suppressions dos dois e-mails de teste, os `webhook_events` com `dedupeKey like 'RESEND:email:evt_t6%'` e o broadcast `e2e-eb-t6` (os destinatários vão em cascata);
   - mostre as contagens zeradas;
   - pare o dev (`netstat -ano | grep :3000` → `taskkill //PID <pid> //F`).

- [ ] **Step 4: Docs**

`docs/guia/05-rotas-e-jobs.md`: na tabela dos jeitos de autenticar, troque a linha do webhook do Resend por:
`| Resend (webhook do e-mail em massa) | assinatura Svix com o segredo da plataforma (RESEND_WEBHOOK_SECRET) → verifySvixSignature | [src/app/api/email/webhook/route.ts](../../src/app/api/email/webhook/route.ts) |`
Remova a nota sobre registro automático (`ensureResendWebhook`) e substitua por: "configurado uma vez no painel do Resend da plataforma; sem o segredo, a rota responde 401 a tudo."

README:
- **§6 (tabela de env):** acrescente a linha `| RESEND_WEBHOOK_SECRET | não | segredo do webhook de entrega do E-mail em massa (painel Resend → Webhooks) |`.
- **Runbook §8:** na subseção do E-mail (Task 3), acrescente o passo "Uma vez só: Resend → Webhooks → Add endpoint `https://metodotia.com/api/email/webhook`, com os eventos `email.delivered`, `email.bounced`, `email.complained` e `email.failed`; copie o signing secret para `RESEND_WEBHOOK_SECRET` no hPanel."

- [ ] **Step 5: Verificar e commitar**

Run: `npm run typecheck && npm run lint && npm run build && npm run check:email`
Esperado: PASS. O build lista `/api/email/webhook` e não lista mais `/api/webhooks/resend/[connectionId]`.

```bash
git add -A src docs/guia/05-rotas-e-jobs.md README.md
git commit -m "[E-mail] - Troca o webhook por conexao pelo webhook unico da plataforma" -m "Rota /api/email/webhook com segredo no env; eventos de outros e-mails da conta (login, reset) sao ignorados sem gravar. Remove a conexao por cliente do modulo." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Documentação final e verificação completa

**Files:**
- Modify: `README.md` (§7, item "E-mail em massa")

- [ ] **Step 1: README §7**

No item "**E-mail em massa (submenu E-mail):**":
- troque a parte do webhook "registrado sozinho na conta do cliente: `/api/webhooks/resend/[connectionId]`" por "webhook único da plataforma: `/api/email/webhook` (segredo `RESEND_WEBHOOK_SECRET`)";
- acrescente: "Envia pela conta Resend da plataforma (`RESEND_API_KEY`). O remetente é digitado em cada envio e o domínio dele precisa estar em `email_sender_domains` daquela empresa (comando `email:dominio`, runbook §8). O ritmo é de ~2 req/s para preservar os e-mails de login e reset."

- [ ] **Step 2: Verificação completa**

Run: `npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node && npm run check:email`
Esperado: tudo PASS (`check:isolation` com 14 asserções).

**Campanhas e Conexões intocadas**, saída vazia:

```bash
git diff origin/main --stat -- src/lib/dispatch.ts src/lib/integrations "src/app/api/webhooks/[provider]" src/app/actions/campaigns.ts src/app/actions/unsubscribe.ts src/app/actions/connections.ts src/lib/queries/campaigns.ts src/lib/validations/campaign.ts src/components/campaigns "src/app/[locale]/app/campaigns" "src/app/[locale]/app/connections" src/lib/unsubscribe.ts "src/app/[locale]/unsubscribe"
```

**`send.ts` só com a nova tentativa:** `git diff origin/main -- src/lib/email/send.ts` mostra apenas o import, a extração de `post` e o bloco do 429.

- [ ] **Step 3: Commit e parar**

```bash
git add README.md
git commit -m "[Docs] - Documenta o envio pela conta da plataforma e os dominios liberados" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Não faça push. Reporte ao controlador:
- o que passou;
- o pendente com o usuário:
  - aplicar a migration `20261008120000_email_sender_domains` no Supabase antes do merge;
  - conferir "All domains" na chave;
  - configurar o webhook e o `RESEND_WEBHOOK_SECRET`;
  - liberar o domínio do cliente com o comando.

# Conversas (Oficial) — WhatsApp Cloud API direto na Meta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela nova "Conversas (Oficial)" (`/app/inbox-oficial`) em que cada vendedor conecta o próprio número da WhatsApp Cloud API, recebe e responde clientes (texto, anexos, citar, reagir, modelos aprovados, janela de 24h) e dispara campanhas por modelos aprovados — sem mudar nada para empresas fora da lista de liberação.

**Architecture:** Código e tabelas novos. Funções puras (parser do webhook, assinatura, janela, erros, modelos, mídia, payloads) em `src/lib/whatsapp-cloud/` com testes `node:test`; em volta delas, módulos de servidor (cliente Graph, gravação do webhook, envio, mídia, modelos, campanha), um webhook assinado em `/api/webhooks/whatsapp-cloud`, rotas `/api/inbox-oficial/*`, actions e a tela. Campanhas reaproveitam `Campaign`/`CampaignRecipient` com uma tabela de vínculo 1-para-1 e um desvio no início do disparo.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript strict, Prisma 6 (`engineType = "client"` + `@prisma/adapter-pg`), PostgreSQL, next-intl 4, Tailwind v4, lucide-react, `node:test` via `tsx`, WhatsApp Cloud API (Graph v26.0).

**Spec:** [docs/superpowers/specs/2026-09-28-whatsapp-cloud-inbox-design.md](../specs/2026-09-28-whatsapp-cloud-inbox-design.md) — leia antes de começar; este plano argumenta a partir dela.

## Global Constraints

- Branch: `feature/change-provider-to-whatsapp-official`. Nunca commitar na `main`.
- Produção é Node **20.x** (`.nvmrc` = `20`): **nenhuma dependência npm nova**. `tsx` e `zod` já existem.
- **Isolamento (guia 03):** os 5 modelos novos entram em `TENANT_MODELS`. Caminho de usuário usa `tenantDb(orgId)`; trabalho por id é `findFirst` + `updateMany`/`deleteMany` com `{ id }` e `count === 0` = não autorizado. Nunca `findUnique`/`update`/`delete`/`upsert` em modelo de negócio. Contexto de sistema (webhook, job, disparo) usa `prisma` cru **sempre** com `organizationId` explícito no `where`.
- **Nunca** ler `process.env.X` no código da app — só via `src/lib/env.ts` (as 4 variáveis novas são opcionais). Scripts em `scripts/` podem ler `process.env`, como `check-isolation.ts`.
- **Módulos puros** (`window.ts`, `status.ts`, `errors.ts`, `signature.ts`, `webhook-parser.ts`, `template-params.ts`, `media-rules.ts`, `payloads.ts`, `preview.ts`, e `__tests__/fixtures.ts`) **não importam** `server-only`, `@/lib/env`, `@/lib/prisma` nem nada com alias `@/` — só `node:*` e imports relativos entre si. Os testes rodam fora do Next, onde `server-only` nem existe.
- Tudo de servidor que não é puro começa com `import "server-only";`.
- Graph API: versão padrão **`v26.0`**, sobrescrevível por `META_GRAPH_VERSION`.
- i18n: toda chave nova entra em `src/messages/pt.json` **e** `src/messages/en.json`, mesma estrutura.
- Next 16: `params`/`searchParams` são `Promise`; em dúvida sobre uma API, leia `node_modules/next/dist/docs/` antes.
- `lint` tem **4 avisos conhecidos**; o número não pode subir.
- Mexeu em fonte de verdade → guia no **mesmo commit**: `tenant-db.ts` → guia 03; `screens.ts`/`modules.ts` → guia 04; `src/app/api/` → guia 05; scripts do `package.json` → guia 06.
- Commits: `[WhatsApp Oficial] - Verbo + tarefa`, corpo com **O que / Por que / Impacto**, última linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Empresa fora de `WHATSAPP_CLOUD_ORG_IDS` não pode perceber diferença nenhuma (menu, campanhas, modelos de acesso).
- Ambiente local (Windows): Postgres portátil — `"$LOCALAPPDATA/metodoai-dev/pg.cmd" start` antes de `npm run dev`, `build` ou `check:isolation`. Abrir o app em `http://localhost:3000`, nunca pelo IP de rede.

## Review Focus

Modos de falha que a spec implica e que os testes unitários não exercitam (dependem de banco/HTTP). Cada um ganhou um passo de verificação roteirizado com o simulador de webhook (`scripts/wa-cloud-webhook.ts`, Task 10) na tarefa dona do código:

1. **Meta reenvia o mesmo webhook** (deploy derruba o site 30–60 s; Meta repete por até 7 dias) → a mensagem aparece **uma vez** e o contador de não lidas sobe **uma vez**. Dono: Task 10, Step "Reenvio não duplica".
2. **Cliente só com nome de usuário (BSUID, sem telefone)** escreve e depois volta com telefone → **uma** conversa, sem contato de CRM criado na primeira vez, com `waId` preenchido na segunda. Dono: Task 10, Step "BSUID e depois telefone".
3. **Status fora de ordem** (`read` antes de `delivered`) numa mensagem de campanha → mensagem e destinatário ficam em `READ`, nunca voltam. Dono: Task 14, Step "Status fora de ordem".
4. **Vendedor B tenta ler/agir na conversa oficial do vendedor A** (mesma empresa) → lista vazia/`not_found`, nada vaza. Dono: Task 11, Step "Privacidade entre vendedores".
5. **Token do número perde validade no meio de uma campanha** (erro 190 no status) → campanha pausa com motivo visível e o número fica com status de erro. Dono: Task 14, Step "Token inválido pausa".

---

## Mapa de arquivos

**Novos — puros (testados):**
- `src/lib/whatsapp-cloud/window.ts` — janela de 24h.
- `src/lib/whatsapp-cloud/status.ts` — transição de status só para frente.
- `src/lib/whatsapp-cloud/errors.ts` — código da Meta → categoria; textos de falha/pausa; erro do corpo da Graph.
- `src/lib/whatsapp-cloud/signature.ts` — `X-Hub-Signature-256` e comparação em tempo constante.
- `src/lib/whatsapp-cloud/webhook-parser.ts` — payload da Meta → eventos normalizados.
- `src/lib/whatsapp-cloud/template-params.ts` — variáveis, mapeamento, componentes e texto final de modelos.
- `src/lib/whatsapp-cloud/media-rules.ts` — tipos/tamanhos aceitos, detecção pelo conteúdo, extensão.
- `src/lib/whatsapp-cloud/payloads.ts` — corpo JSON de cada envio.
- `src/lib/whatsapp-cloud/preview.ts` — prévia da lista e rótulo de citação.
- `src/lib/whatsapp-cloud/__tests__/*.test.ts` + `fixtures.ts`.

**Novos — servidor:**
- `src/lib/whatsapp-cloud/rollout.ts`, `graph.ts`, `meta-api.ts`, `prisma-errors.ts`, `numbers.ts`, `templates.ts`, `guard.ts`, `media.ts`, `campaign-pause.ts`, `ingest.ts`, `send.ts`, `campaign.ts`, `campaign-setup.ts`.
- `src/lib/queries/inbox-oficial.ts`, `src/lib/queries/whatsapp-cloud-campaigns.ts`.
- `src/app/actions/inbox-oficial-number.ts`, `src/app/actions/inbox-oficial.ts`, `src/app/actions/whatsapp-cloud-campaigns.ts`.
- `src/app/api/webhooks/whatsapp-cloud/route.ts`.
- `src/app/api/inbox-oficial/{conversations,messages,media/fetch,media/upload}/route.ts`.
- `src/app/[locale]/app/inbox-oficial/page.tsx`.
- `src/components/inbox-oficial/`: `types.ts`, `modal.tsx`, `number-settings.tsx`, `cloud-inbox.tsx`, `conversation-list.tsx`, `message-thread.tsx`, `composer.tsx`, `window-banner.tsx`, `template-picker.tsx`, `new-conversation-dialog.tsx`.
- `src/components/campaigns/cloud-campaign-fields.tsx`, `src/components/campaigns/cloud-campaign-rename-form.tsx`.
- `scripts/wa-cloud-webhook.ts` — simulador de webhook para desenvolvimento.
- `prisma/migrations/20260928120000_whatsapp_cloud/migration.sql`.

**Modificados (sem efeito para quem não está liberado):**
- `prisma/schema.prisma`, `src/lib/tenant-db.ts`, `scripts/check-isolation.ts`, `src/lib/env.ts`, `src/config/screens.ts`, `src/config/modules.ts`, `src/components/app/app-shell.tsx`, `src/components/app/app-nav.tsx`, `src/components/app/back-bar.tsx`, `src/app/[locale]/app/settings/access/page.tsx`, `src/lib/queries/connections.ts`, `src/lib/whatsapp/ingest.ts` (só `export`), `src/lib/jobs/index.ts`, `src/lib/dispatch.ts`, `src/app/actions/campaigns.ts`, `src/components/campaigns/campaign-form.tsx`, `src/app/[locale]/app/campaigns/new/page.tsx`, `src/app/[locale]/app/campaigns/[id]/edit/page.tsx`, `src/app/[locale]/app/campaigns/[id]/page.tsx`, `src/messages/pt.json`, `src/messages/en.json`, `package.json`, `README.md`, `CLAUDE.md` (contagem de chaves), `docs/guia/02..06`.

---

### Task 1: Suíte de testes + janela de 24h, status e erros

**Files:**
- Modify: `package.json` (scripts)
- Create: `src/lib/whatsapp-cloud/window.ts`, `src/lib/whatsapp-cloud/status.ts`, `src/lib/whatsapp-cloud/errors.ts`
- Test: `src/lib/whatsapp-cloud/__tests__/window.test.ts`, `status.test.ts`, `errors.test.ts`
- Modify: `docs/guia/06-antes-de-commitar.md` (seção nova)

**Interfaces:**
- Produces:
  - `WINDOW_MS: number`; `windowClosesAt(lastInboundAt: Date | string | null | undefined): Date | null`; `isWindowOpen(lastInboundAt: Date | string | null | undefined, now?: Date): boolean`
  - `type CloudMessageStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED"`; `nextMessageStatus(current: CloudMessageStatus | null, incoming: CloudMessageStatus): CloudMessageStatus | null`
  - `type MetaErrorCategory` (13 valores, ver código); `categorizeMetaError(code: number | null | undefined): MetaErrorCategory`; `isNumberLevelError(c): boolean`; `isCampaignStopper(c): boolean`; `type GraphError = { code: number | null; message: string }`; `graphErrorFromBody(status: number, body: unknown): GraphError`; `recipientErrorText(c: MetaErrorCategory, detail: string | null | undefined): string`; `pauseReasonText(c: MetaErrorCategory): string`

- [ ] **Step 1: Adicionar o script de teste**

Em `package.json`, dentro de `"scripts"`, logo depois da linha `"check:node": "tsx scripts/check-node.ts",`, acrescente:

```json
    "test:wa-cloud": "tsx --test src/lib/whatsapp-cloud/__tests__/*.test.ts",
```

- [ ] **Step 2: Escrever os testes que falham**

`src/lib/whatsapp-cloud/__tests__/window.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { WINDOW_MS, isWindowOpen, windowClosesAt } from "../window";

const now = new Date("2026-09-28T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("janela de 24h", () => {
  test("sem mensagem do cliente, está fechada", () => {
    assert.equal(isWindowOpen(null, now), false);
    assert.equal(windowClosesAt(null), null);
  });

  test("1h depois da última mensagem do cliente, está aberta", () => {
    assert.equal(isWindowOpen(ago(60 * 60 * 1000), now), true);
  });

  test("fecha exatamente 24h depois", () => {
    assert.equal(isWindowOpen(ago(WINDOW_MS), now), false);
    assert.equal(isWindowOpen(ago(WINDOW_MS - 1000), now), true);
  });

  test("aceita string ISO (JSON do polling)", () => {
    assert.equal(isWindowOpen(ago(1000).toISOString(), now), true);
  });

  test("data inválida conta como fechada", () => {
    assert.equal(isWindowOpen("não é data", now), false);
  });

  test("windowClosesAt soma 24h", () => {
    assert.equal(windowClosesAt(now)?.toISOString(), "2026-09-29T12:00:00.000Z");
  });
});
```

`src/lib/whatsapp-cloud/__tests__/status.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { nextMessageStatus } from "../status";

describe("status só anda para frente", () => {
  test("sem status → SENT", () => assert.equal(nextMessageStatus(null, "SENT"), "SENT"));
  test("SENT → DELIVERED", () => assert.equal(nextMessageStatus("SENT", "DELIVERED"), "DELIVERED"));
  test("READ não volta para DELIVERED", () => assert.equal(nextMessageStatus("READ", "DELIVERED"), null));
  test("SENT → FAILED", () => assert.equal(nextMessageStatus("SENT", "FAILED"), "FAILED"));
  test("entregue não vira FAILED", () => assert.equal(nextMessageStatus("DELIVERED", "FAILED"), null));
  test("FAILED não ressuscita", () => assert.equal(nextMessageStatus("FAILED", "READ"), null));
  test("PENDING recebido é ignorado", () => assert.equal(nextMessageStatus("SENT", "PENDING"), null));
  test("mesmo status é ignorado", () => assert.equal(nextMessageStatus("READ", "READ"), null));
});
```

`src/lib/whatsapp-cloud/__tests__/errors.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  categorizeMetaError,
  graphErrorFromBody,
  isCampaignStopper,
  isNumberLevelError,
  pauseReasonText,
  recipientErrorText,
} from "../errors";

describe("categorizeMetaError", () => {
  test("131047 = janela fechada", () => assert.equal(categorizeMetaError(131047), "window_closed"));
  test("190 = token inválido", () => assert.equal(categorizeMetaError(190), "token_invalid"));
  test("130429 = limite de velocidade", () => assert.equal(categorizeMetaError(130429), "rate_limited"));
  test("código desconhecido", () => assert.equal(categorizeMetaError(999999), "unknown"));
  test("sem código", () => assert.equal(categorizeMetaError(null), "unknown"));
});

describe("classificação", () => {
  test("token inválido é problema do número", () => assert.equal(isNumberLevelError("token_invalid"), true));
  test("não entregável não é problema do número", () => assert.equal(isNumberLevelError("undeliverable"), false));
  test("modelo pausado para a campanha", () => assert.equal(isCampaignStopper("template_paused"), true));
  test("não entregável não para a campanha", () => assert.equal(isCampaignStopper("undeliverable"), false));
});

describe("graphErrorFromBody", () => {
  test("usa error_data.details quando existe", () => {
    const e = graphErrorFromBody(400, {
      error: { message: "(#131047) Re-engagement message", code: 131047, error_data: { details: "Mais de 24h." } },
    });
    assert.deepEqual(e, { code: 131047, message: "Mais de 24h." });
  });

  test("cai para error.message", () => {
    const e = graphErrorFromBody(401, { error: { message: "Invalid OAuth access token.", code: 190 } });
    assert.deepEqual(e, { code: 190, message: "Invalid OAuth access token." });
  });

  test("corpo estranho vira 'Meta <status>'", () => {
    assert.deepEqual(graphErrorFromBody(500, "oops"), { code: null, message: "Meta 500" });
  });
});

describe("textos", () => {
  test("destinatário sem WhatsApp", () =>
    assert.equal(recipientErrorText("undeliverable", "x"), "Número não recebe WhatsApp."));
  test("categoria sem texto usa o detalhe da Meta", () =>
    assert.equal(recipientErrorText("invalid_params", "Parâmetro 2 vazio"), "Parâmetro 2 vazio"));
  test("sem detalhe usa texto genérico", () => assert.equal(recipientErrorText("unknown", null), "Falha no envio."));
  test("motivo de pausa do modelo pausado", () =>
    assert.equal(pauseReasonText("template_paused"), "A Meta pausou o modelo desta campanha."));
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:wa-cloud`
Expected: FAIL — `Cannot find module '../window'` (e os outros dois).

- [ ] **Step 4: Implementar `window.ts`**

```ts
/**
 * Janela de atendimento de 24h (puro — roda no servidor e no navegador). A Meta
 * só aceita mensagem livre até 24h depois da última mensagem do cliente; fora
 * dela, só modelo aprovado passa (erro 131047).
 */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowClosesAt(lastInboundAt: Date | string | null | undefined): Date | null {
  if (!lastInboundAt) return null;
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + WINDOW_MS);
}

export function isWindowOpen(
  lastInboundAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  const closes = windowClosesAt(lastInboundAt);
  return closes !== null && now.getTime() < closes.getTime();
}
```

- [ ] **Step 5: Implementar `status.ts`**

```ts
/**
 * Status das NOSSAS mensagens (puro). Webhooks de status chegam fora de ordem e
 * repetidos; só avançamos (um `delivered` atrasado não desfaz um `read`), uma
 * mensagem já entregue nunca vira falha e uma falha nunca ressuscita.
 */
export type CloudMessageStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

const RANK = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 } as const;

export function nextMessageStatus(
  current: CloudMessageStatus | null,
  incoming: CloudMessageStatus,
): CloudMessageStatus | null {
  const cur = current ?? "PENDING";
  if (incoming === "PENDING") return null;
  if (incoming === "FAILED") return cur === "PENDING" || cur === "SENT" ? "FAILED" : null;
  if (cur === "FAILED") return null;
  return RANK[incoming] > RANK[cur] ? incoming : null;
}
```

- [ ] **Step 6: Implementar `errors.ts`**

```ts
/**
 * Erros da WhatsApp Cloud API (puro). Traduz o código numérico da Meta numa
 * categoria que o produto entende e guarda os textos (pt) gravados em
 * CampaignRecipient.error / WhatsappCloudCampaign.pausedReason — mesma
 * convenção do disparo antigo, que também grava texto em pt.
 * Códigos: developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 */
export type MetaErrorCategory =
  | "window_closed"
  | "undeliverable"
  | "rate_limited"
  | "pair_rate_limited"
  | "marketing_opt_out"
  | "marketing_limited"
  | "template_paused"
  | "template_disabled"
  | "token_invalid"
  | "not_registered"
  | "account_restricted"
  | "invalid_params"
  | "unknown";

const BY_CODE: Record<number, MetaErrorCategory> = {
  131047: "window_closed",
  131026: "undeliverable",
  130429: "rate_limited",
  131056: "pair_rate_limited",
  131050: "marketing_opt_out",
  131049: "marketing_limited",
  132015: "template_paused",
  132016: "template_disabled",
  190: "token_invalid",
  10: "token_invalid",
  200: "token_invalid",
  133010: "not_registered",
  131031: "account_restricted",
  100: "invalid_params",
  131008: "invalid_params",
  131009: "invalid_params",
  132000: "invalid_params",
  132001: "invalid_params",
};

export function categorizeMetaError(code: number | null | undefined): MetaErrorCategory {
  if (code === null || code === undefined) return "unknown";
  return BY_CODE[code] ?? "unknown";
}

/** Problemas do número inteiro (não da mensagem): o número vai para ERROR. */
export function isNumberLevelError(c: MetaErrorCategory): boolean {
  return c === "token_invalid" || c === "not_registered" || c === "account_restricted";
}

/** Erros que param a campanha inteira em vez de só falhar um destinatário. */
export function isCampaignStopper(c: MetaErrorCategory): boolean {
  return c === "template_paused" || c === "template_disabled" || isNumberLevelError(c);
}

export type GraphError = { code: number | null; message: string };

/** Extrai código + mensagem do corpo de erro da Graph API. */
export function graphErrorFromBody(status: number, body: unknown): GraphError {
  const err =
    body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; error_data?: { details?: unknown } };
    const code = typeof e.code === "number" ? e.code : null;
    const details = typeof e.error_data?.details === "string" ? e.error_data.details : "";
    const message = typeof e.message === "string" ? e.message : "";
    return { code, message: details || message || `Meta ${status}` };
  }
  return { code: null, message: `Meta ${status}` };
}

const RECIPIENT_TEXT: Partial<Record<MetaErrorCategory, string>> = {
  undeliverable: "Número não recebe WhatsApp.",
  marketing_opt_out: "Contato optou por não receber marketing.",
  marketing_limited: "A Meta limitou mensagens de marketing para este contato.",
  window_closed: "Fora da janela de 24h.",
};

/** Texto gravado no destinatário de campanha que falhou. */
export function recipientErrorText(c: MetaErrorCategory, detail: string | null | undefined): string {
  return RECIPIENT_TEXT[c] ?? (detail?.trim() || "Falha no envio.");
}

const PAUSE_TEXT: Partial<Record<MetaErrorCategory, string>> = {
  template_paused: "A Meta pausou o modelo desta campanha.",
  template_disabled: "A Meta desativou o modelo desta campanha.",
  token_invalid: "O token do número oficial é inválido ou perdeu permissão.",
  not_registered: "O número oficial não está registrado na Meta.",
  account_restricted: "A conta do WhatsApp está restrita pela Meta.",
};

/** Motivo gravado quando uma campanha é pausada por erro da Meta. */
export function pauseReasonText(c: MetaErrorCategory): string {
  return PAUSE_TEXT[c] ?? "Campanha pausada por erro da Meta.";
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npm run test:wa-cloud`
Expected: PASS — `# pass 30`-ish, `# fail 0`.

- [ ] **Step 8: Documentar a suíte no guia 06**

Em `docs/guia/06-antes-de-commitar.md`, insira **antes** da linha `## Convenção de commit`:

```markdown
## `test:wa-cloud` (fora das cinco obrigatórias)

`npm run test:wa-cloud` roda `src/lib/whatsapp-cloud/__tests__/*.test.ts` com o `node:test`
nativo via `tsx` — a primeira suíte de testes do repositório, sem dependência nova. Cobre só as
unidades **puras** da integração com a WhatsApp Cloud API (parser do webhook, assinatura, janela
de 24h, erros, modelos, mídia, payloads). Não precisa de banco nem de `.env`.

Regra que mantém a suíte rodando: os módulos testados não importam `server-only`, `@/lib/env`
nem `@/lib/prisma` — fora do Next, `server-only` nem existe e o `env` exige variáveis. Não está no
CI nem nas cinco checagens obrigatórias (decisão da spec de 28/09/2026); rode antes de commitar
qualquer mudança em `src/lib/whatsapp-cloud/`.

```

- [ ] **Step 9: Typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros; lint com os mesmos 4 avisos conhecidos.

- [ ] **Step 10: Commit**

```bash
git add package.json src/lib/whatsapp-cloud docs/guia/06-antes-de-commitar.md
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona suite de testes e regras de janela, status e erros

O que:
- Script test:wa-cloud (node:test via tsx, sem dependencia nova).
- window.ts (janela de 24h), status.ts (so para frente), errors.ts
  (codigo da Meta -> categoria, textos de falha e de pausa).

Por que:
- Base pura e testada da integracao direta com a Cloud API (spec 2026-09-28).

Impacto:
- Nenhum no app; guia 06 documenta a suite.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Assinatura do webhook

**Files:**
- Create: `src/lib/whatsapp-cloud/signature.ts`
- Test: `src/lib/whatsapp-cloud/__tests__/signature.test.ts`

**Interfaces:**
- Produces: `verifySignature(rawBody: Uint8Array, header: string | null, appSecret: string | undefined): boolean`; `safeEqualString(a: string, b: string): boolean`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/whatsapp-cloud/__tests__/signature.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { safeEqualString, verifySignature } from "../signature";

const secret = "app-secret-de-teste";
const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', "utf8");
const sign = (b: Uint8Array, s = secret) => `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;

describe("verifySignature", () => {
  test("assinatura correta passa", () => assert.equal(verifySignature(body, sign(body), secret), true));
  test("segredo errado falha", () => assert.equal(verifySignature(body, sign(body, "outro"), secret), false));
  test("corpo alterado falha", () =>
    assert.equal(verifySignature(Buffer.from(`${body.toString()} `), sign(body), secret), false));
  test("sem cabeçalho falha", () => assert.equal(verifySignature(body, null, secret), false));
  test("sem segredo configurado falha (fail-closed)", () =>
    assert.equal(verifySignature(body, sign(body), undefined), false));
  test("sem o prefixo sha256= falha", () =>
    assert.equal(verifySignature(body, sign(body).replace("sha256=", ""), secret), false));
  test("hex inválido falha sem lançar", () => assert.equal(verifySignature(body, "sha256=zz", secret), false));
});

describe("safeEqualString", () => {
  test("iguais", () => assert.equal(safeEqualString("abc", "abc"), true));
  test("diferentes", () => assert.equal(safeEqualString("abc", "abd"), false));
  test("tamanhos diferentes", () => assert.equal(safeEqualString("abc", "abcd"), false));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:wa-cloud`
Expected: FAIL — `Cannot find module '../signature'`.

- [ ] **Step 3: Implementar**

`src/lib/whatsapp-cloud/signature.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Confere o `X-Hub-Signature-256` que a Meta manda em todo POST de webhook: um
 * HMAC-SHA256 dos bytes CRUS do corpo com o App Secret (puro). Fail-closed: sem
 * segredo ou sem cabeçalho, recusa. Compara em tempo constante.
 */
export function verifySignature(
  rawBody: Uint8Array,
  header: string | null,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !header) return false;
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Comparação de strings em tempo constante (token de verificação do GET). */
export function safeEqualString(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:wa-cloud`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp-cloud/signature.ts src/lib/whatsapp-cloud/__tests__/signature.test.ts
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona verificacao da assinatura do webhook da Meta

O que:
- verifySignature (HMAC-SHA256 sobre os bytes crus, tempo constante,
  fail-closed) e safeEqualString para o token do GET.

Por que:
- O webhook e publico por necessidade; a assinatura e a unica prova de que
  o POST veio da Meta (spec 2026-09-28, secao 9).

Impacto:
- Nenhum no app ainda.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Parser do webhook + fixtures

**Files:**
- Create: `src/lib/whatsapp-cloud/webhook-parser.ts`, `src/lib/whatsapp-cloud/__tests__/fixtures.ts`
- Test: `src/lib/whatsapp-cloud/__tests__/webhook-parser.test.ts`

**Interfaces:**
- Produces (em `webhook-parser.ts`):
  - `type CloudInboundType = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "STICKER" | "LOCATION" | "UNSUPPORTED"`
  - `type CloudMediaRef = { id: string; mime: string | null; filename: string | null; voice: boolean }`
  - `type CloudIdentity = { bsuid: string | null; waId: string | null }`
  - `type CloudInboundMessage = CloudIdentity & { kind: "message"; phoneNumberId: string; wamid: string; username: string | null; profileName: string | null; timestamp: Date; type: CloudInboundType; body: string | null; media: CloudMediaRef | null; quotedWamid: string | null; extra: Record<string, unknown> }`
  - `type CloudInboundReaction = CloudIdentity & { kind: "reaction"; phoneNumberId: string; targetWamid: string; emoji: string; timestamp: Date }` (`emoji === ""` = reação removida)
  - `type CloudStatusUpdate = CloudIdentity & { kind: "status"; phoneNumberId: string; wamid: string; status: "SENT" | "DELIVERED" | "READ" | "FAILED"; timestamp: Date; errorCode: number | null; errorMessage: string | null; pricingCategory: string | null; pricingType: string | null }`
  - `type CloudTemplateStatusUpdate = { kind: "template_status"; wabaId: string; metaTemplateId: string; name: string; language: string; status: string; reason: string | null }`
  - `type CloudUserIdUpdate = { kind: "user_id_update"; phoneNumberId: string | null; waId: string | null; previousBsuid: string; currentBsuid: string }`
  - `type CloudEvent = CloudInboundMessage | CloudInboundReaction | CloudStatusUpdate | CloudTemplateStatusUpdate | CloudUserIdUpdate`
  - `parseCloudWebhook(payload: unknown): CloudEvent[]`
- Produces (em `fixtures.ts`, usado também pelo simulador da Task 10): `PHONE_NUMBER_ID`, `WABA_ID`, `envelope`, `inboundText`, `inboundMedia`, `inboundLocation`, `inboundReaction`, `statusUpdate`, `templateStatusUpdate`, `userIdUpdate` (assinaturas no código).

- [ ] **Step 1: Criar as fixtures**

`src/lib/whatsapp-cloud/__tests__/fixtures.ts` (payloads no formato da referência de webhooks da Meta, set/2026):

```ts
/**
 * Payloads de webhook no formato da referência da Meta (puro). Usados pelos
 * testes e pelo simulador scripts/wa-cloud-webhook.ts.
 */
export const PHONE_NUMBER_ID = "106540352242922";
export const WABA_ID = "102290129340398";

type Obj = Record<string, unknown>;

export function envelope(value: Obj, field = "messages", wabaId = WABA_ID): Obj {
  return { object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field, value }] }] };
}

function metadata(phoneNumberId: string): Obj {
  return { display_phone_number: "15550783881", phone_number_id: phoneNumberId };
}

export type WhoOpts = {
  phoneNumberId?: string;
  wamid?: string;
  /** Telefone do cliente; `null` simula cliente só com nome de usuário. */
  waId?: string | null;
  bsuid?: string | null;
  name?: string;
  username?: string;
  timestamp?: number;
  contextId?: string;
};

function sender(o: WhoOpts) {
  const waId = o.waId === undefined ? "5511999990001" : o.waId;
  const bsuid = o.bsuid === undefined ? "BR.1349120865530274191" : o.bsuid;
  const contact: Obj = { profile: { name: o.name ?? "Maria Cliente", ...(o.username ? { username: o.username } : {}) } };
  if (waId) contact.wa_id = waId;
  if (bsuid) contact.user_id = bsuid;
  const from: Obj = {};
  if (waId) from.from = waId;
  if (bsuid) from.from_user_id = bsuid;
  return { contact, from };
}

function messageValue(o: WhoOpts, typed: Obj): Obj {
  const { contact, from } = sender(o);
  return {
    messaging_product: "whatsapp",
    metadata: metadata(o.phoneNumberId ?? PHONE_NUMBER_ID),
    contacts: [contact],
    messages: [
      {
        ...from,
        id: o.wamid ?? "wamid.IN.0001",
        timestamp: String(o.timestamp ?? 1790000000),
        ...(o.contextId ? { context: { from: "15550783881", id: o.contextId } } : {}),
        ...typed,
      },
    ],
  };
}

export function inboundText(o: WhoOpts & { body?: string } = {}): Obj {
  return envelope(messageValue(o, { type: "text", text: { body: o.body ?? "Olá, quero um orçamento" } }));
}

export function inboundMedia(
  kind: "image" | "video" | "audio" | "document" | "sticker",
  o: WhoOpts & { caption?: string; filename?: string } = {},
): Obj {
  const mime = {
    image: "image/jpeg",
    video: "video/mp4",
    audio: "audio/ogg; codecs=opus",
    document: "application/pdf",
    sticker: "image/webp",
  }[kind];
  const media: Obj = { id: `media-${kind}-1`, mime_type: mime, sha256: "abc", url: "https://lookaside.fbsbx.com/x" };
  if (o.caption) media.caption = o.caption;
  if (kind === "document") media.filename = o.filename ?? "orcamento.pdf";
  if (kind === "audio") media.voice = true;
  return envelope(messageValue(o, { type: kind, [kind]: media }));
}

export function inboundLocation(o: WhoOpts & { name?: string; address?: string } = {}): Obj {
  const location: Obj = { latitude: -23.55, longitude: -46.63 };
  if (o.name) location.name = o.name;
  if (o.address) location.address = o.address;
  return envelope(messageValue(o, { type: "location", location }));
}

export function inboundReaction(o: WhoOpts & { targetWamid: string; emoji?: string | null }): Obj {
  const reaction: Obj = { message_id: o.targetWamid };
  if (o.emoji !== null) reaction.emoji = o.emoji ?? "👍";
  return envelope(messageValue(o, { type: "reaction", reaction }));
}

export function statusUpdate(o: {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed" | "played";
  phoneNumberId?: string;
  waId?: string | null;
  bsuid?: string | null;
  errorCode?: number;
  errorDetails?: string;
  pricingCategory?: string;
  timestamp?: number;
}): Obj {
  const s: Obj = { id: o.wamid, status: o.status, timestamp: String(o.timestamp ?? 1790000100) };
  const waId = o.waId === undefined ? "5511999990001" : o.waId;
  const bsuid = o.bsuid === undefined ? "BR.1349120865530274191" : o.bsuid;
  if (waId) s.recipient_id = waId;
  if (bsuid) s.recipient_user_id = bsuid;
  if (o.pricingCategory) s.pricing = { pricing_model: "PMP", type: "regular", category: o.pricingCategory };
  if (o.status === "failed") {
    s.errors = [
      {
        code: o.errorCode ?? 131026,
        title: "Message undeliverable",
        message: "Message undeliverable",
        error_data: { details: o.errorDetails ?? "O destinatário não pode receber esta mensagem." },
      },
    ];
  }
  return envelope({
    messaging_product: "whatsapp",
    metadata: metadata(o.phoneNumberId ?? PHONE_NUMBER_ID),
    statuses: [s],
  });
}

export function templateStatusUpdate(o: {
  name: string;
  event: string;
  language?: string;
  reason?: string;
  id?: number;
  wabaId?: string;
}): Obj {
  return envelope(
    {
      event: o.event,
      message_template_id: o.id ?? 594425479261596,
      message_template_name: o.name,
      message_template_language: o.language ?? "pt_BR",
      reason: o.reason ?? "NONE",
    },
    "message_template_status_update",
    o.wabaId ?? WABA_ID,
  );
}

export function userIdUpdate(o: { previous: string; current: string; waId?: string; phoneNumberId?: string }): Obj {
  return envelope({
    messaging_product: "whatsapp",
    metadata: metadata(o.phoneNumberId ?? PHONE_NUMBER_ID),
    user_id_update: [
      { wa_id: o.waId ?? "5511999990001", detail: "user changed number", user_id: { previous: o.previous, current: o.current }, timestamp: "1790000200" },
    ],
  });
}
```

- [ ] **Step 2: Escrever os testes que falham**

`src/lib/whatsapp-cloud/__tests__/webhook-parser.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseCloudWebhook, type CloudEvent } from "../webhook-parser";
import * as f from "./fixtures";

const one = (payload: unknown): CloudEvent => {
  const events = parseCloudWebhook(payload);
  assert.equal(events.length, 1);
  return events[0];
};

describe("mensagens recebidas", () => {
  test("texto com telefone, BSUID, nome e usuário", () => {
    const e = one(f.inboundText({ username: "maria.c" }));
    assert.equal(e.kind, "message");
    if (e.kind !== "message") return;
    assert.equal(e.phoneNumberId, f.PHONE_NUMBER_ID);
    assert.equal(e.wamid, "wamid.IN.0001");
    assert.equal(e.type, "TEXT");
    assert.equal(e.body, "Olá, quero um orçamento");
    assert.equal(e.waId, "5511999990001");
    assert.equal(e.bsuid, "BR.1349120865530274191");
    assert.equal(e.profileName, "Maria Cliente");
    assert.equal(e.username, "maria.c");
    assert.equal(e.timestamp.toISOString(), new Date(1790000000 * 1000).toISOString());
    assert.equal(e.media, null);
  });

  test("cliente só com BSUID (sem telefone)", () => {
    const e = one(f.inboundText({ waId: null }));
    assert.equal(e.kind, "message");
    if (e.kind !== "message") return;
    assert.equal(e.waId, null);
    assert.equal(e.bsuid, "BR.1349120865530274191");
  });

  test("sem telefone e sem BSUID é descartada", () => {
    assert.deepEqual(parseCloudWebhook(f.inboundText({ waId: null, bsuid: null })), []);
  });

  test("imagem com legenda", () => {
    const e = one(f.inboundMedia("image", { caption: "foto da peça" }));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "IMAGE");
    assert.equal(e.body, "foto da peça");
    assert.deepEqual(e.media, { id: "media-image-1", mime: "image/jpeg", filename: null, voice: false });
  });

  test("áudio de voz", () => {
    const e = one(f.inboundMedia("audio"));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "AUDIO");
    assert.equal(e.media?.voice, true);
    assert.equal(e.media?.mime, "audio/ogg; codecs=opus");
  });

  test("documento com nome de arquivo", () => {
    const e = one(f.inboundMedia("document"));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "DOCUMENT");
    assert.equal(e.media?.filename, "orcamento.pdf");
  });

  test("figurinha", () => {
    const e = one(f.inboundMedia("sticker"));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "STICKER");
  });

  test("localização com nome e endereço", () => {
    const e = one(f.inboundLocation({ name: "Loja", address: "Av. Paulista, 1000" }));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "LOCATION");
    assert.equal(e.body, "Loja — Av. Paulista, 1000");
    assert.deepEqual(e.extra.location, { latitude: -23.55, longitude: -46.63, name: "Loja", address: "Av. Paulista, 1000" });
  });

  test("localização sem nome usa coordenadas", () => {
    const e = one(f.inboundLocation());
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.body, "-23.55,-46.63");
  });

  test("resposta citando outra mensagem", () => {
    const e = one(f.inboundText({ contextId: "wamid.OUT.9" }));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.quotedWamid, "wamid.OUT.9");
  });

  test("tipo desconhecido vira UNSUPPORTED com o tipo cru", () => {
    const payload = f.inboundText();
    const value = (payload.entry as { changes: { value: { messages: Record<string, unknown>[] } }[] }[])[0].changes[0].value;
    value.messages[0] = { ...value.messages[0], type: "contacts", text: undefined, contacts: [] };
    const e = one(payload);
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "UNSUPPORTED");
    assert.equal(e.extra.rawType, "contacts");
  });

  test("resposta de botão de modelo vira TEXT", () => {
    const payload = f.inboundText();
    const value = (payload.entry as { changes: { value: { messages: Record<string, unknown>[] } }[] }[])[0].changes[0].value;
    value.messages[0] = { ...value.messages[0], type: "button", text: undefined, button: { text: "Parar de receber", payload: "STOP" } };
    const e = one(payload);
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "TEXT");
    assert.equal(e.body, "Parar de receber");
  });
});

describe("reações", () => {
  test("reação com emoji", () => {
    const e = one(f.inboundReaction({ targetWamid: "wamid.OUT.1", emoji: "❤️" }));
    assert.deepEqual(
      { kind: e.kind, target: e.kind === "reaction" ? e.targetWamid : "", emoji: e.kind === "reaction" ? e.emoji : "" },
      { kind: "reaction", target: "wamid.OUT.1", emoji: "❤️" },
    );
  });

  test("reação removida (sem emoji) vira emoji vazio", () => {
    const e = one(f.inboundReaction({ targetWamid: "wamid.OUT.1", emoji: null }));
    if (e.kind !== "reaction") return assert.fail("esperava reaction");
    assert.equal(e.emoji, "");
  });
});

describe("status", () => {
  test("entregue com cobrança", () => {
    const e = one(f.statusUpdate({ wamid: "wamid.OUT.1", status: "delivered", pricingCategory: "service" }));
    if (e.kind !== "status") return assert.fail("esperava status");
    assert.equal(e.status, "DELIVERED");
    assert.equal(e.pricingCategory, "service");
    assert.equal(e.pricingType, "regular");
    assert.equal(e.waId, "5511999990001");
    assert.equal(e.bsuid, "BR.1349120865530274191");
    assert.equal(e.errorCode, null);
  });

  test("falha com código e detalhe", () => {
    const e = one(f.statusUpdate({ wamid: "wamid.OUT.2", status: "failed", errorCode: 131047, errorDetails: "Mais de 24h." }));
    if (e.kind !== "status") return assert.fail("esperava status");
    assert.equal(e.status, "FAILED");
    assert.equal(e.errorCode, 131047);
    assert.equal(e.errorMessage, "Mais de 24h.");
  });

  test("played é ignorado", () => {
    assert.deepEqual(parseCloudWebhook(f.statusUpdate({ wamid: "wamid.OUT.3", status: "played" })), []);
  });
});

describe("outros eventos", () => {
  test("modelo pausado", () => {
    const e = one(f.templateStatusUpdate({ name: "boas_vindas", event: "PAUSED", reason: "NONE" }));
    assert.deepEqual(e, {
      kind: "template_status",
      wabaId: f.WABA_ID,
      metaTemplateId: "594425479261596",
      name: "boas_vindas",
      language: "pt_BR",
      status: "PAUSED",
      reason: null,
    });
  });

  test("modelo rejeitado guarda o motivo", () => {
    const e = one(f.templateStatusUpdate({ name: "promo", event: "REJECTED", reason: "PROMOTIONAL" }));
    if (e.kind !== "template_status") return assert.fail("esperava template_status");
    assert.equal(e.reason, "PROMOTIONAL");
  });

  test("troca de BSUID", () => {
    const e = one(f.userIdUpdate({ previous: "BR.1", current: "BR.2" }));
    assert.deepEqual(e, {
      kind: "user_id_update",
      phoneNumberId: f.PHONE_NUMBER_ID,
      waId: "5511999990001",
      previousBsuid: "BR.1",
      currentBsuid: "BR.2",
    });
  });

  test("objeto que não é do WhatsApp é ignorado", () => {
    assert.deepEqual(parseCloudWebhook({ object: "page", entry: [] }), []);
    assert.deepEqual(parseCloudWebhook(null), []);
  });

  test("mensagem sem id é ignorada", () => {
    const payload = f.inboundText();
    const value = (payload.entry as { changes: { value: { messages: Record<string, unknown>[] } }[] }[])[0].changes[0].value;
    delete value.messages[0].id;
    assert.deepEqual(parseCloudWebhook(payload), []);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:wa-cloud`
Expected: FAIL — `Cannot find module '../webhook-parser'`.

- [ ] **Step 4: Implementar o parser**

`src/lib/whatsapp-cloud/webhook-parser.ts`:

```ts
/**
 * Parser dos webhooks da WhatsApp Cloud API → eventos normalizados (puro — sem
 * banco nem `server-only`, coberto por __tests__/webhook-parser.test.ts).
 * Formato: developers.facebook.com/documentation/business-messaging/whatsapp/
 * webhooks/reference. O que não reconhece é pulado, nunca lança.
 *
 * Identidade do cliente: o BSUID (`user_id` / `from_user_id`) vem sempre desde
 * abr/2026; o telefone (`wa_id` / `from`) pode faltar para quem adotou nome de
 * usuário. Por isso os dois são opcionais e a gravação casa por qualquer um.
 */
type Json = Record<string, unknown>;

export type CloudInboundType =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "DOCUMENT"
  | "STICKER"
  | "LOCATION"
  | "UNSUPPORTED";

export type CloudMediaRef = { id: string; mime: string | null; filename: string | null; voice: boolean };

export type CloudIdentity = { bsuid: string | null; waId: string | null };

export type CloudInboundMessage = CloudIdentity & {
  kind: "message";
  phoneNumberId: string;
  wamid: string;
  username: string | null;
  profileName: string | null;
  timestamp: Date;
  type: CloudInboundType;
  body: string | null;
  media: CloudMediaRef | null;
  quotedWamid: string | null;
  /** Extras por tipo: `location`, `referral` (anúncio), `rawType` (não suportado). */
  extra: Record<string, unknown>;
};

export type CloudInboundReaction = CloudIdentity & {
  kind: "reaction";
  phoneNumberId: string;
  targetWamid: string;
  /** "" = o cliente removeu a reação. */
  emoji: string;
  timestamp: Date;
};

export type CloudStatusUpdate = CloudIdentity & {
  kind: "status";
  phoneNumberId: string;
  wamid: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  timestamp: Date;
  errorCode: number | null;
  errorMessage: string | null;
  pricingCategory: string | null;
  pricingType: string | null;
};

export type CloudTemplateStatusUpdate = {
  kind: "template_status";
  wabaId: string;
  metaTemplateId: string;
  name: string;
  language: string;
  status: string;
  reason: string | null;
};

export type CloudUserIdUpdate = {
  kind: "user_id_update";
  phoneNumberId: string | null;
  waId: string | null;
  previousBsuid: string;
  currentBsuid: string;
};

export type CloudEvent =
  | CloudInboundMessage
  | CloudInboundReaction
  | CloudStatusUpdate
  | CloudTemplateStatusUpdate
  | CloudUserIdUpdate;

const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): Json[] =>
  Array.isArray(v) ? v.map(obj).filter((x): x is Json => x !== null) : [];
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function tsToDate(v: unknown): Date {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

const MEDIA_TYPES: Record<string, CloudInboundType> = {
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  document: "DOCUMENT",
  sticker: "STICKER",
};

const STATUS_MAP: Record<string, CloudStatusUpdate["status"]> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export function parseCloudWebhook(payload: unknown): CloudEvent[] {
  const root = obj(payload);
  if (!root || root.object !== "whatsapp_business_account") return [];
  const events: CloudEvent[] = [];
  for (const entry of arr(root.entry)) {
    const wabaId = str(entry.id) ?? "";
    for (const change of arr(entry.changes)) {
      const field = str(change.field);
      const value = obj(change.value);
      if (!value) continue;

      if (field === "message_template_status_update") {
        const t = parseTemplateStatus(wabaId, value);
        if (t) events.push(t);
        continue;
      }

      const phoneNumberId = str(obj(value.metadata)?.phone_number_id);
      for (const u of arr(value.user_id_update)) {
        const e = parseUserIdUpdate(phoneNumberId, u);
        if (e) events.push(e);
      }
      if (field !== "messages" || !phoneNumberId) continue;

      const contacts = arr(value.contacts);
      for (const m of arr(value.messages)) {
        const e = parseMessage(phoneNumberId, m, contacts);
        if (e) events.push(e);
      }
      for (const s of arr(value.statuses)) {
        const e = parseStatus(phoneNumberId, s);
        if (e) events.push(e);
      }
    }
  }
  return events;
}

function findContact(contacts: Json[], m: Json): Json | null {
  const fromUser = str(m.from_user_id);
  const from = str(m.from);
  const match = contacts.find(
    (c) => (fromUser !== null && str(c.user_id) === fromUser) || (from !== null && str(c.wa_id) === from),
  );
  return match ?? (contacts.length === 1 ? contacts[0] : null);
}

function parseMessage(
  phoneNumberId: string,
  m: Json,
  contacts: Json[],
): CloudInboundMessage | CloudInboundReaction | null {
  const wamid = str(m.id);
  if (!wamid) return null;
  const contact = findContact(contacts, m);
  const profile = obj(contact?.profile);
  const bsuid = str(m.from_user_id) ?? str(contact?.user_id);
  const waId = str(m.from) ?? str(contact?.wa_id);
  if (!bsuid && !waId) return null;
  const timestamp = tsToDate(m.timestamp);
  const type = str(m.type) ?? "unknown";

  if (type === "reaction") {
    const r = obj(m.reaction);
    const target = str(r?.message_id);
    if (!target) return null;
    return { kind: "reaction", phoneNumberId, bsuid, waId, targetWamid: target, emoji: str(r?.emoji) ?? "", timestamp };
  }

  const extra: Record<string, unknown> = {};
  const referral = obj(m.referral);
  if (referral) extra.referral = referral;
  const base = {
    kind: "message" as const,
    phoneNumberId,
    wamid,
    bsuid,
    waId,
    username: str(profile?.username),
    profileName: str(profile?.name),
    timestamp,
    quotedWamid: str(obj(m.context)?.id),
  };

  if (type === "text") {
    return { ...base, type: "TEXT", body: str(obj(m.text)?.body), media: null, extra };
  }

  const mediaType = MEDIA_TYPES[type];
  if (mediaType) {
    const media = obj(m[type]);
    const id = str(media?.id);
    if (!id) return { ...base, type: "UNSUPPORTED", body: null, media: null, extra: { ...extra, rawType: type } };
    return {
      ...base,
      type: mediaType,
      body: str(media?.caption),
      media: { id, mime: str(media?.mime_type), filename: str(media?.filename), voice: media?.voice === true },
      extra,
    };
  }

  if (type === "location") {
    const loc = obj(m.location) ?? {};
    const name = str(loc.name);
    const address = str(loc.address);
    const label = [name, address].filter(Boolean).join(" — ");
    return {
      ...base,
      type: "LOCATION",
      body: label || `${loc.latitude},${loc.longitude}`,
      media: null,
      extra: { ...extra, location: { latitude: loc.latitude, longitude: loc.longitude, name, address } },
    };
  }

  if (type === "button") {
    return { ...base, type: "TEXT", body: str(obj(m.button)?.text), media: null, extra };
  }

  if (type === "interactive") {
    const i = obj(m.interactive);
    const title = str(obj(i?.button_reply)?.title) ?? str(obj(i?.list_reply)?.title);
    return { ...base, type: "TEXT", body: title, media: null, extra };
  }

  return { ...base, type: "UNSUPPORTED", body: null, media: null, extra: { ...extra, rawType: type } };
}

function parseStatus(phoneNumberId: string, s: Json): CloudStatusUpdate | null {
  const wamid = str(s.id);
  const status = STATUS_MAP[str(s.status) ?? ""];
  if (!wamid || !status) return null;
  const err = arr(s.errors)[0] as Json | undefined;
  const pricing = obj(s.pricing);
  return {
    kind: "status",
    phoneNumberId,
    wamid,
    status,
    timestamp: tsToDate(s.timestamp),
    bsuid: str(s.recipient_user_id),
    waId: str(s.recipient_id),
    errorCode: typeof err?.code === "number" ? err.code : null,
    errorMessage: err ? (str(obj(err.error_data)?.details) ?? str(err.message) ?? str(err.title)) : null,
    pricingCategory: str(pricing?.category),
    pricingType: str(pricing?.type),
  };
}

function parseTemplateStatus(wabaId: string, v: Json): CloudTemplateStatusUpdate | null {
  const name = str(v.message_template_name);
  const language = str(v.message_template_language);
  const status = str(v.event);
  if (!wabaId || !name || !language || !status) return null;
  const reason = str(v.reason);
  const id = v.message_template_id;
  return {
    kind: "template_status",
    wabaId,
    metaTemplateId: id === undefined || id === null ? "" : String(id),
    name,
    language,
    status,
    reason: reason && reason !== "NONE" ? reason : null,
  };
}

function parseUserIdUpdate(phoneNumberId: string | null, u: Json): CloudUserIdUpdate | null {
  const ids = obj(u.user_id);
  const previous = str(ids?.previous);
  const current = str(ids?.current);
  if (!previous || !current || previous === current) return null;
  return { kind: "user_id_update", phoneNumberId, waId: str(u.wa_id), previousBsuid: previous, currentBsuid: current };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:wa-cloud`
Expected: PASS, `# fail 0`.

- [ ] **Step 6: Typecheck e commit**

Run: `npm run typecheck`
Expected: sem erros.

```bash
git add src/lib/whatsapp-cloud/webhook-parser.ts src/lib/whatsapp-cloud/__tests__
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona parser dos webhooks da Cloud API

O que:
- parseCloudWebhook: mensagens (texto, midia, localizacao, botao,
  interativo, nao suportado), reacoes, status com erro e cobranca, status
  de modelo e troca de BSUID.
- Fixtures no formato da referencia da Meta (reusadas pelo simulador).

Por que:
- Cliente pode chegar so com BSUID (sem telefone) desde 2026; o parser
  trata os dois identificadores como opcionais (spec secao 4).

Impacto:
- Nenhum no app ainda.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Modelos de mensagem (variáveis, mapeamento, componentes, prévia)

**Files:**
- Create: `src/lib/whatsapp-cloud/template-params.ts`
- Test: `src/lib/whatsapp-cloud/__tests__/template-params.test.ts`

**Interfaces:**
- Produces:
  - `type TemplateComponent = { type: string; format?: string; text?: string; buttons?: { type: string; text?: string; url?: string }[] }`
  - `type TemplateDef = { name: string; language: string; parameterFormat: string; components: TemplateComponent[] }`
  - `type TemplateVariable = { id: string; key: string; component: "header" | "body" }` — `id` é `"header.<key>"` ou `"body.<key>"`
  - `type ParamSource = { source: "nome" | "empresa" | "fixo"; value?: string }`; `type ParamMapping = Record<string, ParamSource>` (chave = `TemplateVariable.id`); `type ParamContext = { nome: string; empresa: string }`
  - `type SendComponent = { type: "header" | "body"; parameters: { type: "text"; text: string; parameter_name?: string }[] }`
  - `type UnsupportedReason = "media_header" | "location_header" | "button_variable"`
  - `type CloudTemplateOption = { id: string; name: string; language: string; category: string; def: TemplateDef; variables: TemplateVariable[]; unsupported: UnsupportedReason | null }`
  - `toTemplateDef(row: { name: string; language: string; parameterFormat: string; components: unknown }): TemplateDef`
  - `templateVariables(def): TemplateVariable[]`; `unsupportedReason(def): UnsupportedReason | null`
  - `resolveParamValues(vars, mapping, ctx): Record<string, string>`; `buildTemplateComponents(def, values): SendComponent[]`; `renderTemplateText(def, values): string`
  - `suggestValues(vars, ctx): Record<string, string>`; `defaultMapping(vars): ParamMapping`; `mappingIsComplete(vars, mapping): boolean`
  - `toTemplateOption(row: { id: string; name: string; language: string; category: string; parameterFormat: string; components: unknown }): CloudTemplateOption`

- [ ] **Step 1: Escrever os testes que falham**

`src/lib/whatsapp-cloud/__tests__/template-params.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTemplateComponents,
  defaultMapping,
  mappingIsComplete,
  renderTemplateText,
  resolveParamValues,
  suggestValues,
  templateVariables,
  toTemplateDef,
  toTemplateOption,
  unsupportedReason,
  type TemplateDef,
} from "../template-params";

const positional: TemplateDef = {
  name: "retorno_orcamento",
  language: "pt_BR",
  parameterFormat: "POSITIONAL",
  components: [
    { type: "HEADER", format: "TEXT", text: "Orçamento {{1}}" },
    { type: "BODY", text: "Olá {{1}}, seu orçamento da {{2}} está pronto. Código {{1}}." },
    { type: "FOOTER", text: "Responda PARAR para sair." },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Parar de receber" }] },
  ],
};

const named: TemplateDef = {
  name: "boas_vindas",
  language: "pt_BR",
  parameterFormat: "NAMED",
  components: [{ type: "BODY", text: "Oi {{first_name}}! Aqui é da {{company_name}}." }],
};

describe("templateVariables", () => {
  test("posicional: cabeçalho e corpo separados, sem repetir, em ordem numérica", () => {
    assert.deepEqual(templateVariables(positional), [
      { id: "header.1", key: "1", component: "header" },
      { id: "body.1", key: "1", component: "body" },
      { id: "body.2", key: "2", component: "body" },
    ]);
  });

  test("nomeado: ordem de aparição", () => {
    assert.deepEqual(templateVariables(named).map((v) => v.id), ["body.first_name", "body.company_name"]);
  });

  test("cabeçalho de imagem não tem variável de texto", () => {
    const def: TemplateDef = { ...named, components: [{ type: "HEADER", format: "IMAGE" }, ...named.components] };
    assert.deepEqual(templateVariables(def).map((v) => v.id), ["body.first_name", "body.company_name"]);
  });
});

describe("unsupportedReason", () => {
  test("texto + quick reply é suportado", () => assert.equal(unsupportedReason(positional), null));
  test("cabeçalho de imagem não é suportado", () =>
    assert.equal(unsupportedReason({ ...named, components: [{ type: "HEADER", format: "IMAGE" }] }), "media_header"));
  test("cabeçalho de localização não é suportado", () =>
    assert.equal(unsupportedReason({ ...named, components: [{ type: "HEADER", format: "LOCATION" }] }), "location_header"));
  test("botão de URL com variável não é suportado", () =>
    assert.equal(
      unsupportedReason({
        ...named,
        components: [{ type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://x.com/{{1}}" }] }],
      }),
      "button_variable",
    ));
  test("botão de copiar código não é suportado", () =>
    assert.equal(
      unsupportedReason({ ...named, components: [{ type: "BUTTONS", buttons: [{ type: "COPY_CODE", text: "Copiar" }] }] }),
      "button_variable",
    ));
});

describe("valores", () => {
  const vars = templateVariables(positional);

  test("resolve nome, empresa e fixo; vazio usa o reserva e depois '-'", () => {
    const values = resolveParamValues(
      vars,
      {
        "header.1": { source: "fixo", value: "#123" },
        "body.1": { source: "nome", value: "cliente" },
        "body.2": { source: "empresa" },
      },
      { nome: "", empresa: "" },
    );
    assert.deepEqual(values, { "header.1": "#123", "body.1": "cliente", "body.2": "-" });
  });

  test("componentes posicionais: sem parameter_name, na ordem", () => {
    assert.deepEqual(buildTemplateComponents(positional, { "header.1": "#9", "body.1": "Ana", "body.2": "ACME" }), [
      { type: "header", parameters: [{ type: "text", text: "#9" }] },
      { type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "ACME" }] },
    ]);
  });

  test("componentes nomeados: com parameter_name", () => {
    assert.deepEqual(buildTemplateComponents(named, { "body.first_name": "Ana", "body.company_name": "ACME" }), [
      {
        type: "body",
        parameters: [
          { type: "text", text: "Ana", parameter_name: "first_name" },
          { type: "text", text: "ACME", parameter_name: "company_name" },
        ],
      },
    ]);
  });

  test("modelo sem variáveis não gera componentes", () => {
    assert.deepEqual(buildTemplateComponents({ ...named, components: [{ type: "BODY", text: "Oi!" }] }, {}), []);
  });

  test("texto final junta cabeçalho, corpo e rodapé", () => {
    assert.equal(
      renderTemplateText(positional, { "header.1": "#9", "body.1": "Ana", "body.2": "ACME" }),
      "Orçamento #9\n\nOlá Ana, seu orçamento da ACME está pronto. Código Ana.\n\nResponda PARAR para sair.",
    );
  });

  test("variável sem valor fica visível na prévia", () => {
    assert.equal(renderTemplateText(named, { "body.first_name": "Ana" }), "Oi Ana! Aqui é da {{company_name}}.");
  });
});

describe("sugestões e mapeamento padrão", () => {
  test("sugere nome no {{1}} do corpo e em chaves de nome/empresa", () => {
    assert.deepEqual(suggestValues(templateVariables(positional), { nome: "Ana", empresa: "ACME" }), {
      "header.1": "",
      "body.1": "Ana",
      "body.2": "",
    });
    assert.deepEqual(suggestValues(templateVariables(named), { nome: "Ana", empresa: "ACME" }), {
      "body.first_name": "Ana",
      "body.company_name": "ACME",
    });
  });

  test("mapeamento padrão e completude", () => {
    const vars = templateVariables(named);
    const mapping = defaultMapping(vars);
    assert.deepEqual(mapping, {
      "body.first_name": { source: "nome", value: "cliente" },
      "body.company_name": { source: "empresa", value: "" },
    });
    assert.equal(mappingIsComplete(vars, mapping), true);
    assert.equal(mappingIsComplete(vars, { "body.first_name": { source: "fixo", value: " " } }), false);
  });
});

describe("conversão das linhas do banco", () => {
  test("componentes inválidos viram lista vazia", () => {
    const def = toTemplateDef({ name: "x", language: "pt_BR", parameterFormat: "POSITIONAL", components: "lixo" });
    assert.deepEqual(def.components, []);
  });

  test("toTemplateOption calcula variáveis e suporte", () => {
    const opt = toTemplateOption({
      id: "t1",
      name: "boas_vindas",
      language: "pt_BR",
      category: "MARKETING",
      parameterFormat: "NAMED",
      components: named.components,
    });
    assert.equal(opt.unsupported, null);
    assert.equal(opt.variables.length, 2);
    assert.equal(opt.def.name, "boas_vindas");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:wa-cloud`
Expected: FAIL — `Cannot find module '../template-params'`.

- [ ] **Step 3: Implementar**

`src/lib/whatsapp-cloud/template-params.ts`:

```ts
/**
 * Modelos de mensagem da Meta (puro). Usado pelo seletor de modelo da tela, pelo
 * formulário de campanha e pelo disparo. Variáveis `{{1}}` (POSITIONAL) ou
 * `{{first_name}}` (NAMED) no cabeçalho de texto e no corpo. Posicionais repetem
 * a numeração entre cabeçalho e corpo, então a identidade de uma variável é
 * "componente.chave" (ex.: "header.1", "body.1").
 * Fora do v1: cabeçalho de mídia/localização e botão com variável.
 */
export type TemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text?: string; url?: string }[];
};

export type TemplateDef = {
  name: string;
  language: string;
  parameterFormat: string;
  components: TemplateComponent[];
};

export type TemplateVariable = { id: string; key: string; component: "header" | "body" };

export type ParamSource = { source: "nome" | "empresa" | "fixo"; value?: string };
export type ParamMapping = Record<string, ParamSource>;
export type ParamContext = { nome: string; empresa: string };

export type SendComponent = {
  type: "header" | "body";
  parameters: { type: "text"; text: string; parameter_name?: string }[];
};

export type UnsupportedReason = "media_header" | "location_header" | "button_variable";

export type CloudTemplateOption = {
  id: string;
  name: string;
  language: string;
  category: string;
  def: TemplateDef;
  variables: TemplateVariable[];
  unsupported: UnsupportedReason | null;
};

const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const FALLBACK = "-";
const BUTTONS_WITH_PARAMS = new Set(["COPY_CODE", "OTP", "FLOW", "CATALOG", "MPM"]);

function comp(def: TemplateDef, type: string): TemplateComponent | undefined {
  return def.components.find((c) => (c.type ?? "").toUpperCase() === type);
}

function keysIn(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function isNamed(def: TemplateDef): boolean {
  return (def.parameterFormat ?? "").toUpperCase() === "NAMED";
}

function headerIsText(h: TemplateComponent | undefined): boolean {
  return !!h && (h.format ?? "TEXT").toUpperCase() === "TEXT";
}

export function toTemplateDef(row: {
  name: string;
  language: string;
  parameterFormat: string;
  components: unknown;
}): TemplateDef {
  const components = Array.isArray(row.components)
    ? (row.components.filter((c) => c && typeof c === "object") as TemplateComponent[])
    : [];
  return { name: row.name, language: row.language, parameterFormat: row.parameterFormat, components };
}

export function templateVariables(def: TemplateDef): TemplateVariable[] {
  const named = isNamed(def);
  const order = (keys: string[]) => (named ? keys : [...keys].sort((a, b) => Number(a) - Number(b)));
  const header = comp(def, "HEADER");
  const headerKeys = headerIsText(header) ? order(keysIn(header?.text)) : [];
  const bodyKeys = order(keysIn(comp(def, "BODY")?.text));
  return [
    ...headerKeys.map((key) => ({ id: `header.${key}`, key, component: "header" as const })),
    ...bodyKeys.map((key) => ({ id: `body.${key}`, key, component: "body" as const })),
  ];
}

export function unsupportedReason(def: TemplateDef): UnsupportedReason | null {
  const header = comp(def, "HEADER");
  if (header && !headerIsText(header)) {
    return (header.format ?? "").toUpperCase() === "LOCATION" ? "location_header" : "media_header";
  }
  const buttons = comp(def, "BUTTONS")?.buttons ?? [];
  const hasVar = buttons.some((b) => keysIn(b.url).length > 0 || keysIn(b.text).length > 0);
  const needsParams = buttons.some((b) => BUTTONS_WITH_PARAMS.has((b.type ?? "").toUpperCase()));
  return hasVar || needsParams ? "button_variable" : null;
}

export function resolveParamValues(
  vars: TemplateVariable[],
  mapping: ParamMapping,
  ctx: ParamContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars) {
    const m = mapping[v.id];
    const reserve = (m?.value ?? "").trim();
    let value = "";
    if (m?.source === "nome") value = ctx.nome.trim() || reserve;
    else if (m?.source === "empresa") value = ctx.empresa.trim() || reserve;
    else if (m?.source === "fixo") value = reserve;
    out[v.id] = value || FALLBACK;
  }
  return out;
}

export function buildTemplateComponents(def: TemplateDef, values: Record<string, string>): SendComponent[] {
  const named = isNamed(def);
  const vars = templateVariables(def);
  const out: SendComponent[] = [];
  for (const component of ["header", "body"] as const) {
    const parameters = vars
      .filter((v) => v.component === component)
      .map((v) => ({
        type: "text" as const,
        text: values[v.id]?.trim() || FALLBACK,
        ...(named ? { parameter_name: v.key } : {}),
      }));
    if (parameters.length > 0) out.push({ type: component, parameters });
  }
  return out;
}

export function renderTemplateText(def: TemplateDef, values: Record<string, string>): string {
  const fill = (text: string | undefined, component: "header" | "body") =>
    (text ?? "").replace(VAR_RE, (_m, key: string) => values[`${component}.${key}`] ?? `{{${key}}}`);
  const header = comp(def, "HEADER");
  return [
    headerIsText(header) ? fill(header?.text, "header") : "",
    fill(comp(def, "BODY")?.text, "body"),
    comp(def, "FOOTER")?.text ?? "",
  ]
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

const NAME_KEY = /nome|name|first/i;
const COMPANY_KEY = /empresa|company/i;

/** Valores iniciais para o vendedor editar no seletor de modelo. */
export function suggestValues(vars: TemplateVariable[], ctx: ParamContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars) {
    if (COMPANY_KEY.test(v.key)) out[v.id] = ctx.empresa;
    else if (NAME_KEY.test(v.key) || (v.component === "body" && v.key === "1")) out[v.id] = ctx.nome;
    else out[v.id] = "";
  }
  return out;
}

/** Mapeamento inicial no formulário de campanha. */
export function defaultMapping(vars: TemplateVariable[]): ParamMapping {
  const out: ParamMapping = {};
  for (const v of vars) {
    if (COMPANY_KEY.test(v.key)) out[v.id] = { source: "empresa", value: "" };
    else if (NAME_KEY.test(v.key) || (v.component === "body" && v.key === "1")) out[v.id] = { source: "nome", value: "cliente" };
    else out[v.id] = { source: "fixo", value: "" };
  }
  return out;
}

/** Toda variável tem origem, e texto fixo não pode ser vazio. */
export function mappingIsComplete(vars: TemplateVariable[], mapping: ParamMapping): boolean {
  return vars.every((v) => {
    const m = mapping[v.id];
    if (!m) return false;
    return m.source !== "fixo" || (m.value ?? "").trim().length > 0;
  });
}

export function toTemplateOption(row: {
  id: string;
  name: string;
  language: string;
  category: string;
  parameterFormat: string;
  components: unknown;
}): CloudTemplateOption {
  const def = toTemplateDef(row);
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    category: row.category,
    def,
    variables: templateVariables(def),
    unsupported: unsupportedReason(def),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:wa-cloud`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp-cloud/template-params.ts src/lib/whatsapp-cloud/__tests__/template-params.test.ts
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona montagem de variaveis dos modelos da Meta

O que:
- Variaveis posicionais e nomeadas (cabecalho de texto e corpo), motivo
  de modelo nao suportado, mapeamento nome/empresa/fixo com reserva,
  componentes de envio, texto final e sugestoes.

Por que:
- Fora da janela de 24h so modelo aprovado passa; tela e campanhas usam
  a mesma logica (spec secoes 7.4 e 8).

Impacto:
- Nenhum no app ainda.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Regras de mídia, payloads de envio e prévias

**Files:**
- Create: `src/lib/whatsapp-cloud/media-rules.ts`, `src/lib/whatsapp-cloud/payloads.ts`, `src/lib/whatsapp-cloud/preview.ts`
- Test: `src/lib/whatsapp-cloud/__tests__/media-rules.test.ts`, `payloads.test.ts`, `preview.test.ts`

**Interfaces:**
- Consumes: `SendComponent` (Task 4).
- Produces:
  - `type OutboundKind = "image" | "video" | "audio" | "document"`; `OUTBOUND_RULES`; `kindForMime(mime: string): OutboundKind | null`
  - `type MediaCheck = { ok: true; kind: OutboundKind; mime: string } | { ok: false; reason: "unsupported_type" | "too_large" | "file_empty" }`; `checkOutboundMedia(mime: string | null, size: number): MediaCheck`
  - `sniffMime(bytes: Uint8Array, declared: string): string | null`; `extensionFor(mime: string | null): string`; `MAX_UPLOAD_BYTES: number`
  - `type Recipient = { waId: string | null; bsuid: string | null }`; `recipientFields(r)`; `textPayload(r, body, quotedWamid?)`; `mediaPayload(r, kind, mediaId, opts)`; `reactionPayload(r, targetWamid, emoji)`; `templatePayload(r, name, language, components)`; `readPayload(wamid)` — todos devolvem `Record<string, unknown>`
  - `previewFor(type: string, body: string | null | undefined): string`; `quotedLabel(type: string, body: string | null | undefined): string`

- [ ] **Step 1: Escrever os testes que falham**

`src/lib/whatsapp-cloud/__tests__/media-rules.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkOutboundMedia, extensionFor, kindForMime, sniffMime } from "../media-rules";

const bytes = (...b: number[]) => Uint8Array.from(b);
const ascii = (s: string, pad = 16) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)).concat(Array(pad).fill(0x20)));

describe("sniffMime", () => {
  test("JPEG", () => assert.equal(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0), "image/png"), "image/jpeg"));
  test("PNG", () => assert.equal(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d), ""), "image/png"));
  test("GIF é detectado (para ser recusado)", () => assert.equal(sniffMime(ascii("GIF89a"), "image/gif"), "image/gif"));
  test("PDF", () => assert.equal(sniffMime(ascii("%PDF-1.7"), "application/octet-stream"), "application/pdf"));
  test("OGG", () => assert.equal(sniffMime(ascii("OggS"), ""), "audio/ogg"));
  test("AAC (ADTS)", () => assert.equal(sniffMime(bytes(0xff, 0xf1, 0x50, 0x80), ""), "audio/aac"));
  test("MP3 com ID3", () => assert.equal(sniffMime(ascii("ID3"), ""), "audio/mpeg"));
  test("MP4 de vídeo", () => assert.equal(sniffMime(bytes(0, 0, 0, 0x18, ...ascii("ftypisom", 4)), ""), "video/mp4"));
  test("M4A", () => assert.equal(sniffMime(bytes(0, 0, 0, 0x18, ...ascii("ftypM4A ", 4)), ""), "audio/mp4"));
  test("3GP", () => assert.equal(sniffMime(bytes(0, 0, 0, 0x18, ...ascii("ftyp3gp4", 4)), ""), "video/3gpp"));
  test("DOCX (zip) usa o tipo declarado se for Office", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    assert.equal(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04, 0), docx), docx);
  });
  test("zip qualquer é recusado", () => assert.equal(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04, 0), "application/zip"), null));
  test("texto puro declarado", () => assert.equal(sniffMime(ascii("olá mundo"), "text/plain"), "text/plain"));
  test("binário declarado como texto é recusado", () => assert.equal(sniffMime(bytes(0x41, 0x00, 0x42), "text/plain"), null));
  test("desconhecido", () => assert.equal(sniffMime(bytes(1, 2, 3, 4), "image/jpeg"), null));
});

describe("checkOutboundMedia", () => {
  test("JPEG pequeno ok", () => assert.deepEqual(checkOutboundMedia("image/jpeg", 1000), { ok: true, kind: "image", mime: "image/jpeg" }));
  test("GIF não é aceito", () => assert.deepEqual(checkOutboundMedia("image/gif", 1000), { ok: false, reason: "unsupported_type" }));
  test("imagem acima de 5 MB", () =>
    assert.deepEqual(checkOutboundMedia("image/png", 5 * 1024 * 1024 + 1), { ok: false, reason: "too_large" }));
  test("vazio", () => assert.deepEqual(checkOutboundMedia("image/png", 0), { ok: false, reason: "file_empty" }));
  test("sem tipo", () => assert.deepEqual(checkOutboundMedia(null, 10), { ok: false, reason: "unsupported_type" }));
  test("PDF de 90 MB ok", () => assert.equal(checkOutboundMedia("application/pdf", 90 * 1024 * 1024).ok, true));
});

describe("kindForMime e extensionFor", () => {
  test("áudio", () => assert.equal(kindForMime("audio/ogg"), "audio"));
  test("mime com parâmetros", () => assert.equal(extensionFor("audio/ogg; codecs=opus"), "ogg"));
  test("docx", () =>
    assert.equal(extensionFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx"));
  test("desconhecido", () => assert.equal(extensionFor("application/x-foo"), "bin"));
  test("nulo", () => assert.equal(extensionFor(null), "bin"));
});
```

`src/lib/whatsapp-cloud/__tests__/payloads.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mediaPayload, reactionPayload, readPayload, recipientFields, templatePayload, textPayload } from "../payloads";

const phone = { waId: "5511999990001", bsuid: "BR.1" };
const onlyBsuid = { waId: null, bsuid: "BR.1" };

describe("destinatário", () => {
  test("telefone tem prioridade", () => assert.deepEqual(recipientFields(phone), { to: "5511999990001" }));
  test("sem telefone usa o BSUID em recipient", () => assert.deepEqual(recipientFields(onlyBsuid), { recipient: "BR.1" }));
  test("sem nenhum lança", () => assert.throws(() => recipientFields({ waId: null, bsuid: null })));
});

describe("payloads", () => {
  test("texto com citação", () => {
    assert.deepEqual(textPayload(phone, "Oi", "wamid.X"), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5511999990001",
      type: "text",
      text: { preview_url: false, body: "Oi" },
      context: { message_id: "wamid.X" },
    });
  });

  test("texto sem citação não tem context", () => {
    assert.equal("context" in textPayload(onlyBsuid, "Oi"), false);
  });

  test("imagem com legenda", () => {
    const p = mediaPayload(phone, "image", "m1", { caption: "foto" });
    assert.deepEqual(p.image, { id: "m1", caption: "foto" });
    assert.equal(p.type, "image");
  });

  test("áudio descarta legenda", () => {
    assert.deepEqual(mediaPayload(phone, "audio", "m2", { caption: "x" }).audio, { id: "m2" });
  });

  test("documento com nome de arquivo", () => {
    assert.deepEqual(mediaPayload(phone, "document", "m3", { filename: "a.pdf" }).document, { id: "m3", filename: "a.pdf" });
  });

  test("reação", () => {
    assert.deepEqual(reactionPayload(phone, "wamid.Y", "👍").reaction, { message_id: "wamid.Y", emoji: "👍" });
  });

  test("modelo com componentes", () => {
    const p = templatePayload(phone, "boas_vindas", "pt_BR", [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }]);
    assert.deepEqual(p.template, {
      name: "boas_vindas",
      language: { code: "pt_BR" },
      components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
    });
  });

  test("modelo sem componentes omite a chave", () => {
    assert.deepEqual(templatePayload(phone, "oi", "pt_BR", []).template, { name: "oi", language: { code: "pt_BR" } });
  });

  test("confirmação de leitura", () => {
    assert.deepEqual(readPayload("wamid.Z"), { messaging_product: "whatsapp", status: "read", message_id: "wamid.Z" });
  });
});
```

`src/lib/whatsapp-cloud/__tests__/preview.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { previewFor, quotedLabel } from "../preview";

describe("prévia", () => {
  test("texto", () => assert.equal(previewFor("TEXT", "Olá"), "Olá"));
  test("imagem com legenda", () => assert.equal(previewFor("IMAGE", "peça"), "📷 Imagem: peça"));
  test("áudio sem legenda", () => assert.equal(previewFor("AUDIO", null), "🎧 Áudio"));
  test("modelo usa o texto", () => assert.equal(previewFor("TEMPLATE", "Oi Ana"), "Oi Ana"));
  test("limita a 200 caracteres", () => assert.equal(previewFor("TEXT", "a".repeat(300)).length, 200));
  test("citação de documento sem texto", () => assert.equal(quotedLabel("DOCUMENT", null), "📄 Documento"));
  test("citação de tipo desconhecido", () => assert.equal(quotedLabel("XYZ", ""), "[mensagem]"));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:wa-cloud`
Expected: FAIL — módulos `../media-rules`, `../payloads`, `../preview` não encontrados.

- [ ] **Step 3: Implementar `media-rules.ts`**

```ts
/**
 * Mídia aceita pela WhatsApp Cloud API (puro). Tabela oficial (set/2026):
 * imagem JPEG/PNG ≤ 5 MB; vídeo MP4/3GP ≤ 16 MB; áudio AAC/AMR/MP3/M4A/OGG-Opus
 * ≤ 16 MB; documento PDF/Office/TXT ≤ 100 MB. GIF não é aceito.
 * O tipo real vem dos bytes (sniffMime), não da extensão que o navegador mandou.
 */
export type OutboundKind = "image" | "video" | "audio" | "document";

const MB = 1024 * 1024;

const OOXML = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
const OLE = ["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"];

export const OUTBOUND_RULES: Record<OutboundKind, { mimes: readonly string[]; maxBytes: number }> = {
  image: { mimes: ["image/jpeg", "image/png"], maxBytes: 5 * MB },
  video: { mimes: ["video/mp4", "video/3gpp"], maxBytes: 16 * MB },
  audio: { mimes: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"], maxBytes: 16 * MB },
  document: { mimes: ["application/pdf", "text/plain", ...OOXML, ...OLE], maxBytes: 100 * MB },
};

/** Teto de leitura do upload (o maior limite da tabela). */
export const MAX_UPLOAD_BYTES = 100 * MB;

const baseMime = (mime: string | null | undefined) => (mime ?? "").split(";")[0].trim().toLowerCase();

export function kindForMime(mime: string): OutboundKind | null {
  const m = baseMime(mime);
  for (const kind of Object.keys(OUTBOUND_RULES) as OutboundKind[]) {
    if (OUTBOUND_RULES[kind].mimes.includes(m)) return kind;
  }
  return null;
}

export type MediaCheck =
  | { ok: true; kind: OutboundKind; mime: string }
  | { ok: false; reason: "unsupported_type" | "too_large" | "file_empty" };

export function checkOutboundMedia(mime: string | null, size: number): MediaCheck {
  if (size <= 0) return { ok: false, reason: "file_empty" };
  const m = baseMime(mime);
  const kind = m ? kindForMime(m) : null;
  if (!kind) return { ok: false, reason: "unsupported_type" };
  if (size > OUTBOUND_RULES[kind].maxBytes) return { ok: false, reason: "too_large" };
  return { ok: true, kind, mime: m };
}

/**
 * Tipo real pelos primeiros bytes. Contêineres ambíguos (ZIP do Office, OLE do
 * Office antigo) e texto puro dependem do tipo declarado para desempatar.
 */
export function sniffMime(bytes: Uint8Array, declared: string): string | null {
  const b = bytes;
  const d = baseMime(declared);
  const starts = (sig: number[], off = 0) => sig.every((x, i) => b[off + i] === x);
  const ascii = (s: string, off = 0) => starts([...s].map((c) => c.charCodeAt(0)), off);

  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (ascii("GIF8")) return "image/gif";
  if (ascii("%PDF")) return "application/pdf";
  if (ascii("OggS")) return "audio/ogg";
  if (ascii("#!AMR")) return "audio/amr";
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "audio/aac";
  if (ascii("ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii("ftyp", 4)) {
    const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
    if (brand.startsWith("3gp")) return "video/3gpp";
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
    return d === "audio/mp4" ? "audio/mp4" : "video/mp4";
  }
  if (starts([0x50, 0x4b, 0x03, 0x04])) return OOXML.includes(d) ? d : null;
  if (starts([0xd0, 0xcf, 0x11, 0xe0])) return OLE.includes(d) ? d : null;
  if (d === "text/plain" && !b.subarray(0, 1024).includes(0)) return "text/plain";
  return null;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export function extensionFor(mime: string | null): string {
  return EXT[baseMime(mime)] ?? "bin";
}
```

- [ ] **Step 4: Implementar `payloads.ts`**

```ts
/**
 * Corpo JSON de cada envio para POST /{phone-number-id}/messages (puro).
 * Destino: telefone em `to`; sem telefone (cliente só com nome de usuário), o
 * BSUID vai em `recipient` — aceito pela Meta desde jul/2026.
 */
import type { SendComponent } from "./template-params";
import type { OutboundKind } from "./media-rules";

export type Recipient = { waId: string | null; bsuid: string | null };
type Payload = Record<string, unknown>;

export function recipientFields(r: Recipient): { to: string } | { recipient: string } {
  if (r.waId) return { to: r.waId };
  if (r.bsuid) return { recipient: r.bsuid };
  throw new Error("Conversa sem destinatário (nem telefone nem BSUID).");
}

function base(r: Recipient): Payload {
  return { messaging_product: "whatsapp", recipient_type: "individual", ...recipientFields(r) };
}

function context(quotedWamid?: string | null): Payload {
  return quotedWamid ? { context: { message_id: quotedWamid } } : {};
}

export function textPayload(r: Recipient, body: string, quotedWamid?: string | null): Payload {
  return { ...base(r), type: "text", text: { preview_url: false, body }, ...context(quotedWamid) };
}

export function mediaPayload(
  r: Recipient,
  kind: OutboundKind,
  mediaId: string,
  opts: { caption?: string | null; filename?: string | null; quotedWamid?: string | null } = {},
): Payload {
  const media: Payload = { id: mediaId };
  if (opts.caption && kind !== "audio") media.caption = opts.caption.slice(0, 1024);
  if (kind === "document" && opts.filename) media.filename = opts.filename;
  return { ...base(r), type: kind, [kind]: media, ...context(opts.quotedWamid) };
}

export function reactionPayload(r: Recipient, targetWamid: string, emoji: string): Payload {
  return { ...base(r), type: "reaction", reaction: { message_id: targetWamid, emoji } };
}

export function templatePayload(
  r: Recipient,
  name: string,
  language: string,
  components: SendComponent[],
): Payload {
  return {
    ...base(r),
    type: "template",
    template: { name, language: { code: language }, ...(components.length > 0 ? { components } : {}) },
  };
}

export function readPayload(wamid: string): Payload {
  return { messaging_product: "whatsapp", status: "read", message_id: wamid };
}
```

- [ ] **Step 5: Implementar `preview.ts`**

```ts
/**
 * Textos curtos da lista de conversas e da citação (puro). Em pt, gravados no
 * banco — mesma convenção do inbox atual.
 */
const LABEL: Record<string, string> = {
  IMAGE: "📷 Imagem",
  VIDEO: "🎬 Vídeo",
  AUDIO: "🎧 Áudio",
  DOCUMENT: "📄 Documento",
  STICKER: "Figurinha",
  LOCATION: "📍 Localização",
  TEMPLATE: "📋 Modelo",
  UNSUPPORTED: "Mensagem não suportada",
};

export function previewFor(type: string, body: string | null | undefined): string {
  const text = (body ?? "").trim();
  if (type === "TEXT" || type === "TEMPLATE") return (text || LABEL[type] || "").slice(0, 200);
  const label = LABEL[type] ?? "Mensagem";
  return (text ? `${label}: ${text}` : label).slice(0, 200);
}

export function quotedLabel(type: string, body: string | null | undefined): string {
  return ((body ?? "").trim() || LABEL[type] || "[mensagem]").slice(0, 300);
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm run test:wa-cloud`
Expected: PASS, `# fail 0`.

- [ ] **Step 7: Typecheck, lint e commit**

Run: `npm run typecheck && npm run lint`
Expected: sem erros; 4 avisos conhecidos.

```bash
git add src/lib/whatsapp-cloud/media-rules.ts src/lib/whatsapp-cloud/payloads.ts src/lib/whatsapp-cloud/preview.ts src/lib/whatsapp-cloud/__tests__
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona regras de midia, payloads de envio e previas

O que:
- media-rules: tabela de formatos/tamanhos da Meta, deteccao do tipo pelos
  bytes (GIF recusado), extensao por mime.
- payloads: texto, midia, reacao, modelo e leitura; destino por telefone
  ou BSUID.
- preview: textos da lista e da citacao.

Por que:
- Envio e gravacao precisam do mesmo formato; tudo puro e testado
  (spec secoes 7.4 e 9).

Impacto:
- Nenhum no app ainda.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Tabelas novas, migration e isolamento

**Files:**
- Modify: `prisma/schema.prisma` (bloco novo depois do model `Message`)
- Create: `prisma/migrations/20260928120000_whatsapp_cloud/migration.sql` (gerado pelo Prisma)
- Modify: `src/lib/tenant-db.ts:88` (`TENANT_MODELS`)
- Modify: `scripts/check-isolation.ts` (asserção 9 + limpeza)
- Modify: `docs/guia/03-multi-tenancy.md:23`, `:147-148`

**Interfaces:**
- Produces (Prisma Client): `prisma.whatsappCloudNumber`, `.whatsappCloudConversation`, `.whatsappCloudMessage`, `.whatsappCloudTemplate`, `.whatsappCloudCampaign`; enum `WhatsappCloudMessageType`. Campos exatamente como no bloco abaixo.

- [ ] **Step 1: Adicionar os models**

Em `prisma/schema.prisma`, logo depois do fechamento do `model Message { ... }` (antes do comentário `// Finance (Financeiro)`), cole:

```prisma
// ---------------------------------------------------------------------------
// WhatsApp oficial (Cloud API direto na Meta) — tela "Conversas (Oficial)"
// ---------------------------------------------------------------------------
// Tabelas próprias, separadas do inbox da Evolution (spec 2026-09-28). A
// conversa pertence ao número oficial de UM vendedor e identifica o cliente
// pelo BSUID (sempre enviado pela Meta) e/ou pelo telefone (pode faltar para
// quem adotou nome de usuário).

enum WhatsappCloudMessageType {
  TEXT
  IMAGE
  AUDIO
  VIDEO
  DOCUMENT
  STICKER
  LOCATION
  TEMPLATE
  UNSUPPORTED
}

/// Número oficial conectado por um vendedor. O token fica cifrado (crypto.ts).
model WhatsappCloudNumber {
  id                 String           @id @default(cuid())
  organizationId     String
  ownerId            String
  /// Único no sistema todo: o webhook descobre a empresa por ele.
  phoneNumberId      String           @unique
  wabaId             String
  displayPhoneNumber String?
  verifiedName       String?
  qualityRating      String?
  /// AES-256-GCM de `{ accessToken }` — nunca em texto puro.
  accessTokenEnc     String
  status             ConnectionStatus @default(INACTIVE)
  lastError          String?
  checkedAt          DateTime?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  conversations WhatsappCloudConversation[]

  @@unique([organizationId, ownerId])
  @@index([organizationId])
  @@map("whatsapp_cloud_numbers")
}

/// Conversa com um cliente. Identidade: bsuid e/ou waId (cada um único por número).
model WhatsappCloudConversation {
  id                 String    @id @default(cuid())
  organizationId     String
  numberId           String
  bsuid              String?
  waId               String?
  username           String?
  profileName        String?
  contactId          String?
  /// Última mensagem DO CLIENTE — abre a janela de 24h.
  lastInboundAt      DateTime?
  lastMessageAt      DateTime?
  lastMessagePreview String?
  unreadCount        Int       @default(0)
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  number   WhatsappCloudNumber    @relation(fields: [numberId], references: [id], onDelete: Cascade)
  messages WhatsappCloudMessage[]

  @@unique([numberId, bsuid])
  @@unique([numberId, waId])
  @@index([organizationId, lastMessageAt])
  @@map("whatsapp_cloud_conversations")
}

model WhatsappCloudMessage {
  id               String                   @id @default(cuid())
  organizationId   String
  conversationId   String
  /// Id da mensagem na Meta — deduplica reenvios do webhook.
  wamid            String?
  direction        MessageDirection
  type             WhatsappCloudMessageType @default(TEXT)
  body             String?
  templateName     String?
  templateLanguage String?
  /// Extras por tipo: coordenadas, anúncio de origem (referral), etc.
  payload          Json                     @default("{}")
  mediaId          String?
  mediaUrl         String?
  mediaMime        String?
  mediaName        String?
  mediaSize        Int?
  mediaStatus      MediaStatus?
  status           MessageStatus?
  errorCode        Int?
  errorMessage     String?
  /// Cobrança informada pela Meta no webhook de status (mede custo no piloto).
  pricingCategory  String?
  pricingType      String?
  reactions        Json                     @default("[]")
  quotedWamid      String?
  quotedBody       String?
  sentById         String?
  campaignId       String?
  timestamp        DateTime
  createdAt        DateTime                 @default(now())

  conversation WhatsappCloudConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, wamid])
  @@index([conversationId, timestamp])
  @@map("whatsapp_cloud_messages")
}

/// Modelo de mensagem sincronizado da Meta, por WABA.
model WhatsappCloudTemplate {
  id              String   @id @default(cuid())
  organizationId  String
  wabaId          String
  metaId          String
  name            String
  language        String
  category        String
  status          String
  parameterFormat String
  components      Json
  rejectedReason  String?
  syncedAt        DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, wabaId, name, language])
  @@map("whatsapp_cloud_templates")
}

/// Vínculo 1-para-1 com uma Campaign existente: o que é da API oficial. Sem
/// relação Prisma com Campaign de propósito — o model existente não muda.
model WhatsappCloudCampaign {
  id             String   @id @default(cuid())
  organizationId String
  campaignId     String   @unique
  numberId       String
  templateId     String
  /// Por variável do modelo: { source: "nome" | "empresa" | "fixo", value?: string }
  params         Json     @default("{}")
  /// Por que a campanha foi pausada automaticamente (mostrado na página dela).
  pausedReason   String?
  createdAt      DateTime @default(now())

  @@index([organizationId])
  @@index([templateId])
  @@map("whatsapp_cloud_campaigns")
}
```

- [ ] **Step 2: Gerar a migration (sem aplicar) e revisar**

```bash
"$LOCALAPPDATA/metodoai-dev/pg.cmd" start
npx prisma migrate dev --name whatsapp_cloud --create-only
mv prisma/migrations/*_whatsapp_cloud prisma/migrations/20260928120000_whatsapp_cloud
grep -nE "ALTER TABLE|DROP" prisma/migrations/20260928120000_whatsapp_cloud/migration.sql
```

Expected: o `grep` mostra **só** linhas `ALTER TABLE "whatsapp_cloud_conversations" ADD CONSTRAINT ...` e `ALTER TABLE "whatsapp_cloud_messages" ADD CONSTRAINT ...` (as duas chaves estrangeiras). Nenhum `DROP`, nenhum `ALTER TABLE` em tabela existente. O resto do arquivo é `CREATE TYPE "WhatsappCloudMessageType"`, cinco `CREATE TABLE "whatsapp_cloud_*"` e `CREATE (UNIQUE) INDEX`. Se aparecer qualquer outra coisa, o banco local está com drift: pare e investigue antes de seguir.

- [ ] **Step 3: Aplicar localmente e gerar o client**

Run: `npx prisma migrate dev`
Expected: `Applying migration 20260928120000_whatsapp_cloud` e `Generated Prisma Client`.

- [ ] **Step 4: Registrar os models no `tenantDb`**

Em `src/lib/tenant-db.ts`, troque:

```ts
  "ServiceTicket",
  "WhatsappAgent",
]);
```

por:

```ts
  "ServiceTicket",
  "WhatsappAgent",
  "WhatsappCloudNumber",
  "WhatsappCloudConversation",
  "WhatsappCloudMessage",
  "WhatsappCloudTemplate",
  "WhatsappCloudCampaign",
]);
```

- [ ] **Step 5: Asserção de isolamento**

Em `scripts/check-isolation.ts`, logo antes de `console.log("\n✅ Tenant isolation: all checks passed.");`, cole:

```ts
    // 9) Official WhatsApp (Cloud API) conversations are tenant-scoped too.
    const cloudNumber = await prisma.whatsappCloudNumber.create({
      data: {
        organizationId: orgA.id,
        ownerId: userA.id,
        phoneNumberId: `iso-pn-${stamp}`,
        wabaId: `iso-waba-${stamp}`,
        accessTokenEnc: "iso-not-a-token",
      },
    });
    await prisma.whatsappCloudConversation.create({
      data: { organizationId: orgA.id, numberId: cloudNumber.id, waId: `iso${stamp}` },
    });
    const cloudConvosB = await prisma.whatsappCloudConversation.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      cloudConvosB.length === 0,
      "official WhatsApp conversation list scoped to org B excludes org A's",
    );
```

E no bloco `finally`, antes de `await prisma.conversation.deleteMany({`, cole:

```ts
    // Cascades to whatsapp_cloud_conversations (and their messages).
    await prisma.whatsappCloudNumber.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
```

- [ ] **Step 6: Rodar o isolamento**

Run: `npm run check:isolation`
Expected: 10 linhas `✓`, a última `official WhatsApp conversation list scoped to org B excludes org A's`, e `✅ Tenant isolation: all checks passed.`

- [ ] **Step 7: Atualizar o guia 03**

Em `docs/guia/03-multi-tenancy.md`:
- linha 23: troque `**70 hoje**` por `**75 hoje**`;
- linhas 147-148: troque `de integração, campanha, job de extração, conversa) e roda **9 asserções**, todas com` por `de integração, campanha, job de extração, conversa, conversa do WhatsApp oficial) e roda **10 asserções**, todas com`.

- [ ] **Step 8: Validar e commitar**

Run: `npm run typecheck && npm run lint && npm run test:wa-cloud`
Expected: tudo verde; lint com 4 avisos.

```bash
git add prisma/schema.prisma prisma/migrations/20260928120000_whatsapp_cloud src/lib/tenant-db.ts scripts/check-isolation.ts docs/guia/03-multi-tenancy.md
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona tabelas do WhatsApp oficial

O que:
- Models WhatsappCloudNumber, Conversation, Message, Template e Campaign
  (vinculo 1-para-1 com Campaign) + enum WhatsappCloudMessageType.
- Migration so aditiva (CREATE TYPE/TABLE/INDEX + FKs nas tabelas novas).
- Os 5 models em TENANT_MODELS; check:isolation com a asercao 10.

Por que:
- Codigo e tabelas novos, sem tocar no inbox da Evolution (spec secao 6).

Impacto:
- Migration precisa ir ao Supabase ANTES do merge na main (cria tabelas
  vazias; inofensiva para o codigo atual). Guia 03 atualizado.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Variáveis de ambiente, liberação por empresa e item de menu

**Files:**
- Modify: `src/lib/env.ts` (4 variáveis opcionais)
- Create: `src/lib/whatsapp-cloud/rollout.ts`
- Modify: `src/config/screens.ts`, `src/config/modules.ts`
- Modify: `src/components/app/app-shell.tsx`, `src/components/app/app-nav.tsx`, `src/components/app/back-bar.tsx`
- Modify: `src/app/[locale]/app/settings/access/page.tsx`
- Modify: `src/messages/pt.json`, `src/messages/en.json` (`app.nav.inboxOficial`)
- Modify: `docs/guia/04-modulos-e-permissoes.md`

**Interfaces:**
- Produces: `env.META_APP_SECRET`, `env.META_WEBHOOK_VERIFY_TOKEN`, `env.META_GRAPH_VERSION`, `env.WHATSAPP_CLOUD_ORG_IDS` (todas `string | undefined`); `CLOUD_SCREEN = "inboxOficial"`; `isWhatsappCloudEnabled(organizationId: string): boolean`; `filterRolloutScreens<T extends string>(organizationId: string, screens: T[]): T[]`; tela `"inboxOficial"` em `Screen`.

- [ ] **Step 1: Variáveis de ambiente**

Em `src/lib/env.ts`, logo depois da linha `EVOLUTION_INSTANCE: z.string().optional(),`, cole:

```ts
  // WhatsApp Cloud API direto na Meta — tela "Conversas (Oficial)". O App Secret
  // confere a assinatura do webhook (X-Hub-Signature-256) e o verify token
  // responde ao GET de verificação. Opcionais: sem eles o webhook recusa tudo
  // (fail-closed). Ver docs/superpowers/specs/2026-09-28-whatsapp-cloud-inbox-design.md.
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  // Versão da Graph API (ex.: "v26.0"). Validada no uso (graph.ts) e não aqui,
  // para um valor vazio no hPanel não derrubar o boot.
  META_GRAPH_VERSION: z.string().optional(),
  // Ids de Organization liberados para a tela oficial durante o piloto,
  // separados por vírgula. Vazio = ninguém vê.
  WHATSAPP_CLOUD_ORG_IDS: z.string().optional(),
```

- [ ] **Step 2: Criar `rollout.ts`**

`src/lib/whatsapp-cloud/rollout.ts`:

```ts
import "server-only";
import { env } from "@/lib/env";

/** Chave da tela oficial em GATEABLE_SCREENS / app.nav. */
export const CLOUD_SCREEN = "inboxOficial";

/**
 * Liberação gradual da tela oficial (piloto). ÚNICO lugar que lê
 * WHATSAPP_CLOUD_ORG_IDS — menu, página, rotas e actions perguntam aqui.
 * Sai quando a migração terminar (spec §5.3).
 */
export function isWhatsappCloudEnabled(organizationId: string): boolean {
  const ids = (env.WHATSAPP_CLOUD_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(organizationId);
}

/** Tira a tela oficial de uma lista de telas quando a empresa não está liberada. */
export function filterRolloutScreens<T extends string>(organizationId: string, screens: T[]): T[] {
  return isWhatsappCloudEnabled(organizationId) ? screens : screens.filter((s) => s !== CLOUD_SCREEN);
}
```

- [ ] **Step 3: Registrar a tela**

Em `src/config/screens.ts`, troque `  "inbox",` por:

```ts
  "inbox",
  "inboxOficial",
```

Em `src/config/modules.ts`, no módulo `id: "inbox"`, troque `    screens: ["inbox"],` por:

```ts
    screens: ["inbox", "inboxOficial"],
```

- [ ] **Step 4: Menu, barra de voltar e modelos de acesso filtrados**

Em `src/components/app/app-shell.tsx`, adicione aos imports:

```ts
import { filterRolloutScreens } from "@/lib/whatsapp-cloud/rollout";
```

e troque:

```ts
  const available = availableScreens(ctx.modules);
  const navScreens = ctx.allowedScreens.filter((s) => available.has(s));
```

por:

```ts
  const available = availableScreens(ctx.modules);
  // The official WhatsApp screen is pilot-only (WHATSAPP_CLOUD_ORG_IDS).
  const navScreens = filterRolloutScreens(
    ctx.organizationId,
    ctx.allowedScreens.filter((s) => available.has(s)),
  );
```

Em `src/components/app/app-nav.tsx`:
- no import de `lucide-react`, acrescente `BadgeCheck,` depois de `MessageCircle,`;
- no tipo `NavKey`, troque `  | "inbox"` por `  | "inbox"\n  | "inboxOficial"`;
- no grupo `comms`, troque `      { href: "/app/inbox", key: "inbox", icon: MessageCircle },` por:

```ts
      { href: "/app/inbox", key: "inbox", icon: MessageCircle },
      { href: "/app/inbox-oficial", key: "inboxOficial", icon: BadgeCheck },
```

Em `src/components/app/back-bar.tsx`, troque `  "/app/inbox",` por `  "/app/inbox",\n  "/app/inbox-oficial",`.

Em `src/app/[locale]/app/settings/access/page.tsx`, adicione o import:

```ts
import { filterRolloutScreens } from "@/lib/whatsapp-cloud/rollout";
```

e troque:

```ts
  const screens = [...GATEABLE_SCREENS].filter((s) => available.has(s));
```

por:

```ts
  const screens = filterRolloutScreens(
    ctx.organizationId,
    [...GATEABLE_SCREENS].filter((s) => available.has(s)),
  );
```

- [ ] **Step 5: Rótulo no menu (pt e en)**

`src/messages/pt.json`, dentro de `app.nav`, troque `      "inbox": "Conversas",` por:

```json
      "inbox": "Conversas",
      "inboxOficial": "Conversas (Oficial)",
```

`src/messages/en.json`, dentro de `app.nav`, troque `      "inbox": "Inbox",` por:

```json
      "inbox": "Inbox",
      "inboxOficial": "Inbox (Official)",
```

- [ ] **Step 6: Atualizar o guia 04**

Em `docs/guia/04-modulos-e-permissoes.md`:
- linha 75: troque `` `GATEABLE_SCREENS`, **14** hoje `` por `` `GATEABLE_SCREENS`, **15** hoje ``, e na lista das linhas 75-77 troque `` `inbox`, `companies` `` por `` `inbox`, `inboxOficial`, `companies` ``;
- linha 66: troque `Não existe um terceiro lugar gateando alguma coisa. É sempre um destes três arquivos:` por `Não existe um terceiro lugar gateando alguma coisa. É sempre um destes três arquivos (mais a liberação temporária do WhatsApp oficial, descrita em "Como o gating se compõe"):`;
- logo **antes** do parágrafo que começa com `**Gating cross-módulo**`, insira:

```markdown
**Liberação gradual (WhatsApp oficial).** A tela `inboxOficial` pertence ao módulo `inbox`, mas
durante o piloto só aparece para empresas listadas em `WHATSAPP_CLOUD_ORG_IDS`. O único lugar que
lê essa variável é `isWhatsappCloudEnabled`, em
[src/lib/whatsapp-cloud/rollout.ts](../../src/lib/whatsapp-cloud/rollout.ts): o menu
(`app-shell.tsx`) e a página de modelos de acesso passam a lista de telas por
`filterRolloutScreens`, e a página, as rotas e as actions da tela checam a mesma função. É um
filtro temporário por cima da interseção acima, não um quarto eixo de gating — quando a migração
terminar, a variável e o filtro saem.

```

- [ ] **Step 7: Validar**

Run: `npm run typecheck && npm run lint && npm run test:wa-cloud`
Expected: tudo verde; lint com 4 avisos.

Manual: com `WHATSAPP_CLOUD_ORG_IDS` **ausente** do `.env`, `npm run dev`, entrar em `http://localhost:3000/app` — o menu **não** mostra "Conversas (Oficial)" e *Configurações → Modelos de acesso* não lista a tela. Depois, ponha o id da sua empresa em `WHATSAPP_CLOUD_ORG_IDS`, reinicie o dev — o item aparece (a página ainda dá 404; ela nasce na Task 13).

- [ ] **Step 8: Commit**

```bash
git add src/lib/env.ts src/lib/whatsapp-cloud/rollout.ts src/config/screens.ts src/config/modules.ts src/components/app/app-shell.tsx src/components/app/app-nav.tsx src/components/app/back-bar.tsx "src/app/[locale]/app/settings/access/page.tsx" src/messages/pt.json src/messages/en.json docs/guia/04-modulos-e-permissoes.md
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona liberacao por empresa e item de menu

O que:
- 4 variaveis opcionais no env (META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN,
  META_GRAPH_VERSION, WHATSAPP_CLOUD_ORG_IDS).
- rollout.ts: isWhatsappCloudEnabled / filterRolloutScreens (unico leitor
  da lista).
- Tela inboxOficial no modulo inbox; menu e modelos de acesso filtrados.

Por que:
- Merge na main publica em producao; so empresas do piloto podem ver a
  tela (spec secao 5.3).

Impacto:
- Sem a variavel, ninguem ve nada. Guia 04 atualizado.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Cliente da Graph API

**Files:**
- Create: `src/lib/whatsapp-cloud/graph.ts`, `src/lib/whatsapp-cloud/meta-api.ts`

**Interfaces:**
- Consumes: `graphErrorFromBody` (Task 1), `env.META_GRAPH_VERSION` (Task 7).
- Produces:
  - `DEFAULT_GRAPH_VERSION = "v26.0"`; `graphVersion(): string`
  - `type GraphResult<T> = { ok: true; data: T } | { ok: false; status: number; code: number | null; message: string }`
  - `graphRequest<T>(path: string, token: string, req?: { method?: "GET" | "POST" | "DELETE"; query?: Record<string, string>; json?: unknown; form?: FormData }): Promise<GraphResult<T>>`
  - `graphDownload(url: string, token: string): Promise<{ ok: true; bytes: Buffer; mime: string | null } | { ok: false; status: number }>`
  - `type PhoneNumberInfo`, `getPhoneNumber(phoneNumberId, token)`, `subscribeApp(wabaId, token)`, `registerNumber(phoneNumberId, token, pin)`, `type SendResponse`, `postMessage(phoneNumberId, token, payload)`, `uploadMedia(phoneNumberId, token, bytes, mime, filename)`, `type MediaInfo`, `getMediaInfo(mediaId, token)`, `type TemplateRow`, `type TemplatePage`, `listTemplatesPage(wabaId, token, after?)`, `getMessagingLimit(phoneNumberId, token): Promise<string | null>`

- [ ] **Step 1: Implementar `graph.ts`**

```ts
import "server-only";
import { env } from "@/lib/env";
import { graphErrorFromBody } from "@/lib/whatsapp-cloud/errors";

/** Versão fixada da Graph API (a v20.0 expirou em 24/09/2026). */
export const DEFAULT_GRAPH_VERSION = "v26.0";
const TIMEOUT_MS = 20_000;

export function graphVersion(): string {
  const v = env.META_GRAPH_VERSION?.trim();
  return v && /^v\d+\.\d+$/.test(v) ? v : DEFAULT_GRAPH_VERSION;
}

export type GraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: number | null; message: string };

type GraphRequest = {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string>;
  json?: unknown;
  form?: FormData;
};

/**
 * Chamada à Graph API com o token do número. Nunca lança e nunca loga o token.
 * Erros da Meta vêm como HTTP 4xx com `error.code` (ver errors.ts).
 */
export async function graphRequest<T>(
  path: string,
  token: string,
  req: GraphRequest = {},
): Promise<GraphResult<T>> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (req.form) {
    body = req.form;
  } else if (req.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(req.json);
  }
  try {
    const res = await fetch(url, {
      method: req.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) return { ok: false, status: res.status, ...graphErrorFromBody(res.status, data) };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, status: 0, code: null, message: e instanceof Error ? e.message : "Falha de rede com a Meta" };
  }
}

/**
 * Baixa os bytes de uma URL de mídia da Meta (vale 5 min e exige o mesmo token).
 * A URL vem da resposta autenticada de GET /{media-id}, nunca do payload do webhook.
 */
export async function graphDownload(
  url: string,
  token: string,
): Promise<{ ok: true; bytes: Buffer; mime: string | null } | { ok: false; status: number }> {
  try {
    if (new URL(url).protocol !== "https:") return { ok: false, status: 0 };
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") };
  } catch {
    return { ok: false, status: 0 };
  }
}
```

- [ ] **Step 2: Implementar `meta-api.ts`**

```ts
import "server-only";
import { graphRequest, type GraphResult } from "@/lib/whatsapp-cloud/graph";

/** Endpoints da WhatsApp Cloud API usados pela tela oficial (spec §4). */

export type PhoneNumberInfo = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
};

export function getPhoneNumber(phoneNumberId: string, token: string): Promise<GraphResult<PhoneNumberInfo>> {
  return graphRequest<PhoneNumberInfo>(phoneNumberId, token, {
    query: { fields: "display_phone_number,verified_name,quality_rating" },
  });
}

/** Sem esta inscrição, nenhum webhook da WABA chega ao app. Idempotente. */
export function subscribeApp(wabaId: string, token: string): Promise<GraphResult<{ success?: boolean }>> {
  return graphRequest<{ success?: boolean }>(`${wabaId}/subscribed_apps`, token, { method: "POST" });
}

/** Registra um número incluído pela API (PIN de 6 dígitos; 10 tentativas/72h). */
export function registerNumber(
  phoneNumberId: string,
  token: string,
  pin: string,
): Promise<GraphResult<{ success?: boolean }>> {
  return graphRequest<{ success?: boolean }>(`${phoneNumberId}/register`, token, {
    json: { messaging_product: "whatsapp", pin },
  });
}

export type SendResponse = {
  messages?: { id?: string; message_status?: string }[];
  contacts?: { input?: string; wa_id?: string; user_id?: string }[];
};

export function postMessage(
  phoneNumberId: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<GraphResult<SendResponse>> {
  return graphRequest<SendResponse>(`${phoneNumberId}/messages`, token, { json: payload });
}

export function uploadMedia(
  phoneNumberId: string,
  token: string,
  bytes: Buffer,
  mime: string,
  filename: string,
): Promise<GraphResult<{ id?: string }>> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
  return graphRequest<{ id?: string }>(`${phoneNumberId}/media`, token, { form });
}

export type MediaInfo = { url?: string; mime_type?: string; file_size?: number };

export function getMediaInfo(mediaId: string, token: string): Promise<GraphResult<MediaInfo>> {
  return graphRequest<MediaInfo>(mediaId, token);
}

export type TemplateRow = {
  id: string;
  name: string;
  language: string;
  status?: string;
  category?: string;
  components?: unknown[];
  parameter_format?: string;
  rejected_reason?: string;
};

export type TemplatePage = { data?: TemplateRow[]; paging?: { cursors?: { after?: string }; next?: string } };

export function listTemplatesPage(wabaId: string, token: string, after?: string): Promise<GraphResult<TemplatePage>> {
  return graphRequest<TemplatePage>(`${wabaId}/message_templates`, token, {
    query: {
      fields: "id,name,language,status,category,components,parameter_format,rejected_reason",
      limit: "100",
      ...(after ? { after } : {}),
    },
  });
}

/**
 * Limite atual de mensagens (contatos novos por 24h) do portfólio, para o aviso
 * do formulário de campanha. O formato do campo não está documentado com
 * precisão: aceita "TIER_250" ou número; qualquer outra coisa vira null.
 */
export async function getMessagingLimit(phoneNumberId: string, token: string): Promise<string | null> {
  const res = await graphRequest<{ whatsapp_business_manager_messaging_limit?: unknown }>(phoneNumberId, token, {
    query: { fields: "whatsapp_business_manager_messaging_limit" },
  });
  if (!res.ok) return null;
  const raw = res.data.whatsapp_business_manager_messaging_limit;
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string") return raw.replace(/^TIER_/, "");
  return null;
}
```

- [ ] **Step 3: Validar**

Run: `npm run typecheck && npm run lint`
Expected: sem erros; 4 avisos.

- [ ] **Step 4: Commit**

```bash
git add src/lib/whatsapp-cloud/graph.ts src/lib/whatsapp-cloud/meta-api.ts
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona cliente da Graph API da Meta

O que:
- graph.ts: chamada com token, versao v26.0 sobrescrevivel, timeout, erro
  da Meta normalizado; download de midia so por https.
- meta-api.ts: numero, inscricao do app, registro, envio, upload, midia,
  modelos (paginado) e limite de mensagens.

Por que:
- Conexao direta com a Meta, sem Evolution (spec secao 5.2).

Impacto:
- Nenhum no app ainda.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Número oficial — conexão, token, modelos e leitura

**Files:**
- Create: `src/lib/whatsapp-cloud/prisma-errors.ts`, `numbers.ts`, `templates.ts`, `guard.ts`
- Create: `src/lib/queries/inbox-oficial.ts`
- Create: `src/app/actions/inbox-oficial-number.ts`
- Modify: `src/lib/queries/connections.ts` (`countWhatsappConnections`)

**Interfaces:**
- Consumes: Task 7 (`isWhatsappCloudEnabled`), Task 8 (`getPhoneNumber`, `subscribeApp`, `registerNumber`, `listTemplatesPage`).
- Produces:
  - `isUniqueViolation(e: unknown): boolean`
  - `type NumberWithToken = { id: string; organizationId: string; ownerId: string; phoneNumberId: string; wabaId: string; status: ConnectionStatus; token: string }`; `encryptToken(accessToken: string): string`; `loadNumber(organizationId: string, numberId: string): Promise<NumberWithToken | null>`; `markNumberError(organizationId: string, numberId: string, message: string): Promise<void>`; `purgeNumberMedia(organizationId: string, numberId: string): Promise<void>`
  - `syncTemplates(organizationId: string, wabaId: string, token: string): Promise<{ ok: true; count: number } | { ok: false; message: string }>`
  - `type CloudGuard = { ok: true; ctx: OrgContext } | { ok: false; error: "unauthorized" | "not_enabled" }`; `cloudGuard(): Promise<CloudGuard>`; `guardResponse(error): Response`
  - Queries: `getMyCloudNumber(orgId, userId)` → `MyCloudNumber | null`; `listCloudConversations(orgId, userId)` → `CloudConversationRow[]`; `getOwnedCloudConversation(orgId, userId, conversationId)`; `listCloudMessages(orgId, userId, conversationId)` → `CloudMessageRow[]`; `getOwnedCloudMessage(orgId, userId, messageId)`; `getCloudMessageMedia(orgId, messageId)`; `listCloudTemplates(orgId, wabaId, opts?: { approvedOnly?: boolean })` → `CloudTemplateRow[]`; `searchContactsWithPhone(orgId, q)`; `getContactParams(orgId, contactId): Promise<ParamContext | null>`
  - Actions: `connectCloudNumber`, `updateCloudNumberToken`, `refreshCloudNumber`, `disconnectCloudNumber`, `removeCloudNumber`, `syncCloudTemplates`, todas `Promise<NumberActionResult>`; `type NumberActionError`

- [ ] **Step 1: `prisma-errors.ts`**

```ts
import { Prisma } from "@prisma/client";

/** Violação de índice único (P2002) — reenvio do webhook ou corrida de criação. */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
```

- [ ] **Step 2: `numbers.ts`**

```ts
import "server-only";
import type { ConnectionStatus } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";
import { deleteMedia } from "@/lib/storage/blob";

/** Número com o token decifrado — só para chamar a Meta, nunca para o navegador. */
export type NumberWithToken = {
  id: string;
  organizationId: string;
  ownerId: string;
  phoneNumberId: string;
  wabaId: string;
  status: ConnectionStatus;
  token: string;
};

export function encryptToken(accessToken: string): string {
  return encryptCredentials({ accessToken });
}

export async function loadNumber(organizationId: string, numberId: string): Promise<NumberWithToken | null> {
  const n = await tenantDb(organizationId).whatsappCloudNumber.findFirst({
    where: { id: numberId },
    select: {
      id: true,
      organizationId: true,
      ownerId: true,
      phoneNumberId: true,
      wabaId: true,
      status: true,
      accessTokenEnc: true,
    },
  });
  if (!n) return null;
  let token = "";
  try {
    token = decryptCredentials(n.accessTokenEnc).accessToken ?? "";
  } catch {
    return null;
  }
  if (!token) return null;
  return {
    id: n.id,
    organizationId: n.organizationId,
    ownerId: n.ownerId,
    phoneNumberId: n.phoneNumberId,
    wabaId: n.wabaId,
    status: n.status,
    token,
  };
}

/** Token inválido, número não registrado ou conta restrita: o número vai para ERROR. */
export async function markNumberError(organizationId: string, numberId: string, message: string): Promise<void> {
  await tenantDb(organizationId).whatsappCloudNumber.updateMany({
    where: { id: numberId },
    data: { status: "ERROR", lastError: message.slice(0, 500), checkedAt: new Date() },
  });
}

/** LGPD: apaga do armazenamento as mídias das conversas de um número (antes de remover). */
export async function purgeNumberMedia(organizationId: string, numberId: string): Promise<void> {
  const rows = await tenantDb(organizationId).whatsappCloudMessage.findMany({
    where: { mediaUrl: { not: null }, conversation: { numberId } },
    select: { mediaUrl: true },
  });
  await Promise.all(rows.map((r) => (r.mediaUrl ? deleteMedia(r.mediaUrl) : Promise.resolve())));
}
```

- [ ] **Step 3: `templates.ts`**

```ts
import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { listTemplatesPage, type TemplateRow } from "@/lib/whatsapp-cloud/meta-api";

const MAX_PAGES = 20;

/**
 * Espelha os modelos da WABA no banco da empresa. Modelo que sumiu da Meta não é
 * apagado (uma campanha pode apontar para ele): vira status DELETED.
 */
export async function syncTemplates(
  organizationId: string,
  wabaId: string,
  token: string,
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const rows: TemplateRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listTemplatesPage(wabaId, token, after);
    if (!res.ok) return { ok: false, message: res.message };
    rows.push(...(res.data.data ?? []));
    after = res.data.paging?.next ? res.data.paging.cursors?.after : undefined;
    if (!after) break;
  }

  const db = tenantDb(organizationId);
  const now = new Date();
  for (const t of rows) {
    const data = {
      metaId: String(t.id),
      category: t.category ?? "",
      status: t.status ?? "",
      parameterFormat: (t.parameter_format ?? "POSITIONAL").toUpperCase(),
      components: (t.components ?? []) as Prisma.InputJsonValue,
      rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
      syncedAt: now,
    };
    const existing = await db.whatsappCloudTemplate.findFirst({
      where: { wabaId, name: t.name, language: t.language },
      select: { id: true },
    });
    if (existing) {
      await db.whatsappCloudTemplate.updateMany({ where: { id: existing.id }, data });
    } else {
      await db.whatsappCloudTemplate.create({
        data: { organizationId, wabaId, name: t.name, language: t.language, ...data },
      });
    }
  }
  await db.whatsappCloudTemplate.updateMany({
    where: { wabaId, syncedAt: { lt: now } },
    data: { status: "DELETED" },
  });
  return { ok: true, count: rows.length };
}
```

- [ ] **Step 4: `guard.ts`**

```ts
import "server-only";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { isWhatsappCloudEnabled } from "@/lib/whatsapp-cloud/rollout";

export type CloudGuard = { ok: true; ctx: OrgContext } | { ok: false; error: "unauthorized" | "not_enabled" };

/** Sessão + liberação: primeira linha de toda action e rota da tela oficial (guia 05). */
export async function cloudGuard(): Promise<CloudGuard> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!isWhatsappCloudEnabled(ctx.organizationId)) return { ok: false, error: "not_enabled" };
  return { ok: true, ctx };
}

/** Resposta de rota quando o guard falha. Empresa fora da lista recebe 404 (a tela "não existe"). */
export function guardResponse(error: "unauthorized" | "not_enabled"): Response {
  return error === "unauthorized"
    ? new Response("Unauthorized", { status: 401 })
    : new Response("Not found", { status: 404 });
}
```

- [ ] **Step 5: Leituras (`src/lib/queries/inbox-oficial.ts`)**

```ts
import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import type { ParamContext } from "@/lib/whatsapp-cloud/template-params";

/**
 * Leituras da tela oficial. WhatsApp é por vendedor: tudo passa pelo número do
 * próprio usuário (ownerId) — ninguém, nem admin, vê a conversa de outro.
 */

async function myNumberId(organizationId: string, userId: string): Promise<string | null> {
  const n = await tenantDb(organizationId).whatsappCloudNumber.findFirst({
    where: { ownerId: userId },
    select: { id: true },
  });
  return n?.id ?? null;
}

export async function getMyCloudNumber(organizationId: string, userId: string) {
  return tenantDb(organizationId).whatsappCloudNumber.findFirst({
    where: { ownerId: userId },
    select: {
      id: true,
      phoneNumberId: true,
      wabaId: true,
      displayPhoneNumber: true,
      verifiedName: true,
      qualityRating: true,
      status: true,
      lastError: true,
      checkedAt: true,
    },
  });
}
export type MyCloudNumber = NonNullable<Awaited<ReturnType<typeof getMyCloudNumber>>>;

export async function listCloudConversations(organizationId: string, userId: string) {
  const numberId = await myNumberId(organizationId, userId);
  if (!numberId) return [];
  const db = tenantDb(organizationId);
  const convos = await db.whatsappCloudConversation.findMany({
    where: { numberId },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      waId: true,
      bsuid: true,
      username: true,
      profileName: true,
      contactId: true,
      lastInboundAt: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      unreadCount: true,
    },
  });
  const contactIds = [...new Set(convos.map((c) => c.contactId).filter((id): id is string => !!id))];
  const contacts = contactIds.length
    ? await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(contacts.map((c) => [c.id, c.name]));
  return convos.map((c) => ({ ...c, contactName: c.contactId ? (names.get(c.contactId) ?? null) : null }));
}
export type CloudConversationRow = Awaited<ReturnType<typeof listCloudConversations>>[number];

/** Conversa em que o usuário pode agir (do número dele), ou null. */
export async function getOwnedCloudConversation(organizationId: string, userId: string, conversationId: string) {
  const numberId = await myNumberId(organizationId, userId);
  if (!numberId) return null;
  return tenantDb(organizationId).whatsappCloudConversation.findFirst({
    where: { id: conversationId, numberId },
    select: {
      id: true,
      numberId: true,
      waId: true,
      bsuid: true,
      contactId: true,
      profileName: true,
      lastInboundAt: true,
    },
  });
}

/** Últimas 200 mensagens, da mais antiga para a mais nova. */
export async function listCloudMessages(organizationId: string, userId: string, conversationId: string) {
  const convo = await getOwnedCloudConversation(organizationId, userId, conversationId);
  if (!convo) return [];
  const rows = await tenantDb(organizationId).whatsappCloudMessage.findMany({
    where: { conversationId },
    orderBy: { timestamp: "desc" },
    take: 200,
    select: {
      id: true,
      wamid: true,
      direction: true,
      type: true,
      body: true,
      templateName: true,
      mediaUrl: true,
      mediaMime: true,
      mediaName: true,
      mediaStatus: true,
      status: true,
      errorMessage: true,
      reactions: true,
      quotedWamid: true,
      quotedBody: true,
      timestamp: true,
    },
  });
  return rows.reverse();
}
export type CloudMessageRow = Awaited<ReturnType<typeof listCloudMessages>>[number];

export async function getOwnedCloudMessage(organizationId: string, userId: string, messageId: string) {
  const numberId = await myNumberId(organizationId, userId);
  if (!numberId) return null;
  return tenantDb(organizationId).whatsappCloudMessage.findFirst({
    where: { id: messageId, conversation: { numberId } },
    select: {
      id: true,
      wamid: true,
      reactions: true,
      timestamp: true,
      conversationId: true,
      conversation: { select: { numberId: true, waId: true, bsuid: true } },
    },
  });
}

export async function getCloudMessageMedia(organizationId: string, messageId: string) {
  return tenantDb(organizationId).whatsappCloudMessage.findFirst({
    where: { id: messageId },
    select: { mediaUrl: true, mediaMime: true, mediaStatus: true, mediaName: true, mediaSize: true },
  });
}

export async function listCloudTemplates(organizationId: string, wabaId: string, opts?: { approvedOnly?: boolean }) {
  return tenantDb(organizationId).whatsappCloudTemplate.findMany({
    where: { wabaId, ...(opts?.approvedOnly ? { status: "APPROVED" } : {}) },
    orderBy: [{ name: "asc" }, { language: "asc" }],
    select: {
      id: true,
      name: true,
      language: true,
      category: true,
      status: true,
      parameterFormat: true,
      components: true,
      rejectedReason: true,
    },
  });
}
export type CloudTemplateRow = Awaited<ReturnType<typeof listCloudTemplates>>[number];

/** Até 10 contatos com telefone, por nome ou telefone (Nova conversa). */
export async function searchContactsWithPhone(organizationId: string, q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  return tenantDb(organizationId).contact.findMany({
    where: {
      phone: { not: null },
      OR: [{ name: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }],
    },
    orderBy: { name: "asc" },
    take: 10,
    select: { id: true, name: true, phone: true },
  });
}

export async function getContactParams(organizationId: string, contactId: string): Promise<ParamContext | null> {
  const c = await tenantDb(organizationId).contact.findFirst({
    where: { id: contactId },
    select: { name: true, company: { select: { name: true } } },
  });
  return c ? { nome: c.name ?? "", empresa: c.company?.name ?? "" } : null;
}
```

- [ ] **Step 6: Contagem de números da empresa soma os oficiais**

Em `src/lib/queries/connections.ts`, troque a função inteira:

```ts
/** Connected WhatsApp numbers for the org (bounds the per-plan numbers limit). */
export function countWhatsappConnections(organizationId: string): Promise<number> {
  const db = tenantDb(organizationId);
  return db.integrationConnection.count({ where: { provider: { in: [...WHATSAPP_PROVIDERS] } } });
}
```

por:

```ts
/** Connected WhatsApp numbers for the org (bounds the per-plan numbers limit):
 * QR/legacy connections plus official (Cloud API) numbers. */
export async function countWhatsappConnections(organizationId: string): Promise<number> {
  const db = tenantDb(organizationId);
  const [legacy, official] = await Promise.all([
    db.integrationConnection.count({ where: { provider: { in: [...WHATSAPP_PROVIDERS] } } }),
    db.whatsappCloudNumber.count(),
  ]);
  return legacy + official;
}
```

- [ ] **Step 7: Actions do número (`src/app/actions/inbox-oficial-number.ts`)**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { LIMITS } from "@/config/limits";
import { audit } from "@/lib/audit";
import { countWhatsappConnections } from "@/lib/queries/connections";
import { cloudGuard } from "@/lib/whatsapp-cloud/guard";
import { getPhoneNumber, registerNumber, subscribeApp } from "@/lib/whatsapp-cloud/meta-api";
import { encryptToken, loadNumber, purgeNumberMedia } from "@/lib/whatsapp-cloud/numbers";
import { syncTemplates } from "@/lib/whatsapp-cloud/templates";
import { isUniqueViolation } from "@/lib/whatsapp-cloud/prisma-errors";

export type NumberActionError =
  | "unauthorized"
  | "not_enabled"
  | "invalid"
  | "number_exists"
  | "phone_in_use"
  | "limit"
  | "not_found"
  | "meta_error"
  | "unknown";

export type NumberActionResult = { ok: true; count?: number } | { ok: false; error: NumberActionError; detail?: string };

const PATH = "/app/inbox-oficial";
const metaId = z.string().trim().regex(/^\d{5,30}$/);
const token = z.string().trim().min(20).max(2000);
const connectSchema = z.object({
  phoneNumberId: metaId,
  wabaId: metaId,
  accessToken: token,
  pin: z.string().trim().regex(/^\d{6}$/).optional().or(z.literal("")),
});

/** Conecta (ou reconecta) o número oficial do próprio usuário. */
export async function connectCloudNumber(input: {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  pin?: string;
}): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { phoneNumberId, wabaId, accessToken, pin } = parsed.data;

  try {
    const db = tenantDb(ctx.organizationId);
    const mine = await db.whatsappCloudNumber.findFirst({
      where: { ownerId: ctx.userId },
      select: { id: true, phoneNumberId: true },
    });
    if (mine && mine.phoneNumberId !== phoneNumberId) return { ok: false, error: "number_exists" };
    // phoneNumberId é único no sistema: um número da Meta só pode estar ligado
    // uma vez. Busca entre empresas de propósito — devolve só o id.
    const taken = await prisma.whatsappCloudNumber.findFirst({ where: { phoneNumberId }, select: { id: true } });
    if (taken && taken.id !== mine?.id) return { ok: false, error: "phone_in_use" };
    if (
      !mine &&
      LIMITS.whatsappNumbersLimit !== null &&
      (await countWhatsappConnections(ctx.organizationId)) >= LIMITS.whatsappNumbersLimit
    ) {
      return { ok: false, error: "limit" };
    }

    const info = await getPhoneNumber(phoneNumberId, accessToken);
    if (!info.ok) return { ok: false, error: "meta_error", detail: info.message };
    const sub = await subscribeApp(wabaId, accessToken);
    if (!sub.ok) return { ok: false, error: "meta_error", detail: sub.message };
    if (pin) {
      const reg = await registerNumber(phoneNumberId, accessToken, pin);
      if (!reg.ok) return { ok: false, error: "meta_error", detail: reg.message };
    }

    const data = {
      phoneNumberId,
      wabaId,
      displayPhoneNumber: info.data.display_phone_number ?? null,
      verifiedName: info.data.verified_name ?? null,
      qualityRating: info.data.quality_rating ?? null,
      accessTokenEnc: encryptToken(accessToken),
      status: "ACTIVE" as const,
      lastError: null,
      checkedAt: new Date(),
    };
    let numberId: string;
    if (mine) {
      await db.whatsappCloudNumber.updateMany({ where: { id: mine.id }, data });
      numberId = mine.id;
    } else {
      const created = await db.whatsappCloudNumber.create({
        data: { organizationId: ctx.organizationId, ownerId: ctx.userId, ...data },
        select: { id: true },
      });
      numberId = created.id;
    }

    const synced = await syncTemplates(ctx.organizationId, wabaId, accessToken);
    if (!synced.ok) console.warn(`[wa-cloud] template sync on connect failed: ${synced.message}`);
    await audit(ctx, {
      action: "whatsapp_cloud.connected",
      entity: "WhatsappCloudNumber",
      entityId: numberId,
      meta: { phoneNumberId },
    });
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "phone_in_use" };
    console.error("[wa-cloud] connect failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Troca o token (procedimento de rotação). Revalida na Meta antes de gravar. */
export async function updateCloudNumberToken(accessToken: string): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const parsed = token.safeParse(accessToken);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const mine = await db.whatsappCloudNumber.findFirst({
      where: { ownerId: ctx.userId },
      select: { id: true, phoneNumberId: true },
    });
    if (!mine) return { ok: false, error: "not_found" };
    const info = await getPhoneNumber(mine.phoneNumberId, parsed.data);
    if (!info.ok) return { ok: false, error: "meta_error", detail: info.message };
    await db.whatsappCloudNumber.updateMany({
      where: { id: mine.id },
      data: {
        accessTokenEnc: encryptToken(parsed.data),
        status: "ACTIVE",
        lastError: null,
        checkedAt: new Date(),
        displayPhoneNumber: info.data.display_phone_number ?? null,
        verifiedName: info.data.verified_name ?? null,
        qualityRating: info.data.quality_rating ?? null,
      },
    });
    await audit(ctx, { action: "whatsapp_cloud.token_updated", entity: "WhatsappCloudNumber", entityId: mine.id });
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    console.error("[wa-cloud] token update failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Relê os dados do número e refaz a inscrição do app na WABA. */
export async function refreshCloudNumber(): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  try {
    const db = tenantDb(ctx.organizationId);
    const mine = await db.whatsappCloudNumber.findFirst({ where: { ownerId: ctx.userId }, select: { id: true } });
    const number = mine ? await loadNumber(ctx.organizationId, mine.id) : null;
    if (!number) return { ok: false, error: "not_found" };
    const info = await getPhoneNumber(number.phoneNumberId, number.token);
    const sub = info.ok ? await subscribeApp(number.wabaId, number.token) : null;
    if (!info.ok || (sub && !sub.ok)) {
      const detail = !info.ok ? info.message : sub && !sub.ok ? sub.message : "";
      await db.whatsappCloudNumber.updateMany({
        where: { id: number.id },
        data: { status: "ERROR", lastError: detail.slice(0, 500), checkedAt: new Date() },
      });
      revalidatePath(PATH);
      return { ok: false, error: "meta_error", detail };
    }
    await db.whatsappCloudNumber.updateMany({
      where: { id: number.id },
      data: {
        status: number.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        lastError: null,
        checkedAt: new Date(),
        displayPhoneNumber: info.data.display_phone_number ?? null,
        verifiedName: info.data.verified_name ?? null,
        qualityRating: info.data.quality_rating ?? null,
      },
    });
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    console.error("[wa-cloud] refresh failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Desconecta: para de enviar e de receber, mas mantém as conversas. */
export async function disconnectCloudNumber(): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const res = await tenantDb(ctx.organizationId).whatsappCloudNumber.updateMany({
    where: { ownerId: ctx.userId },
    data: { status: "INACTIVE" },
  });
  if (res.count === 0) return { ok: false, error: "not_found" };
  await audit(ctx, { action: "whatsapp_cloud.disconnected", entity: "WhatsappCloudNumber" });
  revalidatePath(PATH);
  return { ok: true };
}

/** Remove o número: apaga conversas, mensagens (cascade) e as mídias guardadas (LGPD). */
export async function removeCloudNumber(): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  try {
    const db = tenantDb(ctx.organizationId);
    const mine = await db.whatsappCloudNumber.findFirst({ where: { ownerId: ctx.userId }, select: { id: true } });
    if (!mine) return { ok: false, error: "not_found" };
    await purgeNumberMedia(ctx.organizationId, mine.id).catch(() => {});
    await db.whatsappCloudNumber.deleteMany({ where: { id: mine.id } });
    await audit(ctx, { action: "whatsapp_cloud.removed", entity: "WhatsappCloudNumber", entityId: mine.id });
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    console.error("[wa-cloud] remove failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Sincroniza os modelos da WABA do número do usuário. */
export async function syncCloudTemplates(): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const mine = await tenantDb(ctx.organizationId).whatsappCloudNumber.findFirst({
    where: { ownerId: ctx.userId },
    select: { id: true },
  });
  const number = mine ? await loadNumber(ctx.organizationId, mine.id) : null;
  if (!number) return { ok: false, error: "not_found" };
  const res = await syncTemplates(ctx.organizationId, number.wabaId, number.token);
  if (!res.ok) return { ok: false, error: "meta_error", detail: res.message };
  revalidatePath(PATH);
  return { ok: true, count: res.count };
}
```

- [ ] **Step 8: Validar**

Run: `npm run typecheck && npm run lint && npm run test:wa-cloud`
Expected: tudo verde; 4 avisos.

- [ ] **Step 9: Commit**

```bash
git add src/lib/whatsapp-cloud src/lib/queries/inbox-oficial.ts src/lib/queries/connections.ts src/app/actions/inbox-oficial-number.ts
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona conexao do numero oficial e leituras da tela

O que:
- Conectar (le o numero, inscreve o app na WABA, registra com PIN), trocar
  token, atualizar, desconectar, remover (com limpeza de midia) e
  sincronizar modelos.
- Leituras por vendedor (so o numero do proprio usuario).
- Limite de numeros da empresa soma Evolution + oficiais.

Por que:
- Conexao manual enquanto o credenciamento de Tech Provider nao sai
  (spec secao 7.1).

Impacto:
- Nada visivel ainda (a tela nasce na Task 13).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Webhook — receber mensagens, status, reações e modelos

**Files:**
- Create: `src/lib/whatsapp-cloud/media.ts`, `src/lib/whatsapp-cloud/campaign-pause.ts`, `src/lib/whatsapp-cloud/ingest.ts`
- Create: `src/app/api/webhooks/whatsapp-cloud/route.ts`
- Create: `scripts/wa-cloud-webhook.ts`
- Modify: `src/lib/whatsapp/ingest.ts:33` (só `export`)
- Modify: `src/lib/jobs/index.ts` (job `whatsapp-cloud-media`)
- Modify: `docs/guia/05-rotas-e-jobs.md`

**Interfaces:**
- Consumes: Tasks 1–5 (puros), Task 9 (`loadNumber`, `markNumberError`, `isUniqueViolation`), `resolveContactId` (existente), `applyReaction` (existente), `applyCampaignDeliveryUpdates` (existente), `putMedia` (existente), `enqueue`/`isQueueConfigured` (existentes).
- Produces:
  - `type WhatsappCloudMediaJob = { organizationId: string; messageId: string }`; `downloadInboundMedia(organizationId, messageId): Promise<void>`; `scheduleMediaDownload(organizationId, messageId): void`
  - `pauseCloudCampaign(organizationId: string, campaignId: string, reason: string): Promise<void>`; `pauseCampaignsForTemplates(templateIds: string[], reason: string): Promise<void>`
  - `ingestCloudEvents(events: CloudEvent[]): Promise<void>`
  - `resolveContactId` passa a ser exportada de `src/lib/whatsapp/ingest.ts` (assinatura inalterada: `(organizationId: string, remoteJid: string, pushName: string | null) => Promise<string | null>`).

- [ ] **Step 1: Exportar `resolveContactId`**

Em `src/lib/whatsapp/ingest.ts`, troque `async function resolveContactId(` por `export async function resolveContactId(`. Nada mais muda nesse arquivo.

- [ ] **Step 2: `media.ts` (download da mídia recebida)**

```ts
import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { putMedia } from "@/lib/storage/blob";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import { getMediaInfo } from "@/lib/whatsapp-cloud/meta-api";
import { graphDownload } from "@/lib/whatsapp-cloud/graph";
import { loadNumber } from "@/lib/whatsapp-cloud/numbers";
import { extensionFor } from "@/lib/whatsapp-cloud/media-rules";

/** Payload do job `whatsapp-cloud-media`. */
export type WhatsappCloudMediaJob = { organizationId: string; messageId: string };

/** O id de mídia recebida vale 7 dias na Meta. */
const MEDIA_ID_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Baixa a mídia de uma mensagem recebida (Meta → armazenamento) e marca READY.
 * Idempotente; qualquer falha marca FAILED para a tela nunca girar para sempre.
 */
export async function downloadInboundMedia(organizationId: string, messageId: string): Promise<void> {
  const db = tenantDb(organizationId);
  const msg = await db.whatsappCloudMessage.findFirst({
    where: { id: messageId },
    select: {
      mediaId: true,
      mediaStatus: true,
      mediaMime: true,
      timestamp: true,
      conversation: { select: { numberId: true } },
    },
  });
  if (!msg || msg.mediaStatus === "READY" || !msg.mediaId) return;
  const fail = async () => {
    await db.whatsappCloudMessage.updateMany({ where: { id: messageId }, data: { mediaStatus: "FAILED" } });
  };
  if (Date.now() - msg.timestamp.getTime() > MEDIA_ID_TTL_MS) return fail();
  try {
    const number = await loadNumber(organizationId, msg.conversation.numberId);
    if (!number) return fail();
    const info = await getMediaInfo(msg.mediaId, number.token);
    if (!info.ok || !info.data.url) {
      console.warn(`[wa-cloud] media ${messageId}: ${info.ok ? "sem url" : info.message}`);
      return fail();
    }
    const file = await graphDownload(info.data.url, number.token);
    if (!file.ok || file.bytes.byteLength === 0) return fail();
    const mime = (info.data.mime_type ?? file.mime ?? msg.mediaMime ?? "application/octet-stream").split(";")[0].trim();
    const stored = await putMedia(`whatsapp/${organizationId}/cloud/${messageId}.${extensionFor(mime)}`, file.bytes, mime);
    await db.whatsappCloudMessage.updateMany({
      where: { id: messageId },
      data: { mediaUrl: stored.url, mediaMime: mime, mediaSize: stored.size, mediaStatus: "READY" },
    });
  } catch (error) {
    console.error(`[wa-cloud] media ${messageId} failed`, error);
    await fail();
  }
}

/**
 * Dispara o download fora do caminho do webhook: job do QStash quando existe,
 * senão em processo depois da resposta (o Node do Passenger é persistente — mesmo
 * padrão do agente de IA). A tela ainda tenta sob demanda (media/fetch).
 */
export function scheduleMediaDownload(organizationId: string, messageId: string): void {
  const run = () =>
    void downloadInboundMedia(organizationId, messageId).catch((e) =>
      console.error("[wa-cloud] media download failed", e),
    );
  if (!isQueueConfigured()) return run();
  const job: WhatsappCloudMediaJob = { organizationId, messageId };
  void enqueue("whatsapp-cloud-media", job, { deduplicationId: `wa-cloud-media-${messageId}` }).catch((e) => {
    console.error("[wa-cloud] enqueue media failed", e);
    run();
  });
}
```

- [ ] **Step 3: `campaign-pause.ts`**

```ts
import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Pausa uma campanha oficial em andamento e guarda o motivo (mostrado na página
 * da campanha). Contexto de sistema: organizationId sempre explícito.
 */
export async function pauseCloudCampaign(organizationId: string, campaignId: string, reason: string): Promise<void> {
  const res = await prisma.campaign.updateMany({
    where: { id: campaignId, organizationId, status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  if (res.count === 0) return;
  await prisma.whatsappCloudCampaign.updateMany({
    where: { campaignId, organizationId },
    data: { pausedReason: reason },
  });
}

/** A Meta pausou/desativou um modelo: pausa toda campanha em andamento que o usa. */
export async function pauseCampaignsForTemplates(templateIds: string[], reason: string): Promise<void> {
  if (templateIds.length === 0) return;
  const links = await prisma.whatsappCloudCampaign.findMany({
    where: { templateId: { in: templateIds } },
    select: { organizationId: true, campaignId: true },
  });
  for (const l of links) await pauseCloudCampaign(l.organizationId, l.campaignId, reason);
}
```

- [ ] **Step 4: `ingest.ts`**

```ts
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CloudEvent,
  CloudInboundMessage,
  CloudInboundReaction,
  CloudStatusUpdate,
  CloudTemplateStatusUpdate,
  CloudUserIdUpdate,
} from "@/lib/whatsapp-cloud/webhook-parser";
import { nextMessageStatus } from "@/lib/whatsapp-cloud/status";
import {
  categorizeMetaError,
  isCampaignStopper,
  isNumberLevelError,
  pauseReasonText,
  recipientErrorText,
} from "@/lib/whatsapp-cloud/errors";
import { previewFor, quotedLabel } from "@/lib/whatsapp-cloud/preview";
import { applyReaction } from "@/lib/whatsapp/reactions";
import { resolveContactId } from "@/lib/whatsapp/ingest";
import { applyCampaignDeliveryUpdates } from "@/lib/integrations/webhooks/apply";
import { scheduleMediaDownload } from "@/lib/whatsapp-cloud/media";
import { markNumberError } from "@/lib/whatsapp-cloud/numbers";
import { pauseCampaignsForTemplates, pauseCloudCampaign } from "@/lib/whatsapp-cloud/campaign-pause";
import { isUniqueViolation } from "@/lib/whatsapp-cloud/prisma-errors";

/**
 * Grava os eventos do webhook oficial. Contexto de sistema: a empresa vem do
 * número (phone_number_id) e entra explicitamente em todo `where`. Idempotente
 * pelo `wamid` único por empresa — a Meta reenvia por até 7 dias.
 */
type NumberRef = { id: string; organizationId: string; status: string };

const CONVO_SELECT = {
  id: true,
  bsuid: true,
  waId: true,
  contactId: true,
  lastMessageAt: true,
  lastInboundAt: true,
} as const;
type ConvoRef = { id: string; bsuid: string | null; waId: string | null; contactId: string | null; lastMessageAt: Date | null; lastInboundAt: Date | null };

export async function ingestCloudEvents(events: CloudEvent[]): Promise<void> {
  const numbers = new Map<string, NumberRef | null>();
  const numberFor = async (phoneNumberId: string): Promise<NumberRef | null> => {
    if (!numbers.has(phoneNumberId)) {
      numbers.set(
        phoneNumberId,
        await prisma.whatsappCloudNumber.findFirst({
          where: { phoneNumberId },
          select: { id: true, organizationId: true, status: true },
        }),
      );
    }
    return numbers.get(phoneNumberId) ?? null;
  };

  for (const e of events) {
    try {
      if (e.kind === "template_status") {
        await applyTemplateStatus(e);
        continue;
      }
      if (e.kind === "user_id_update") {
        await applyUserIdUpdate(e, e.phoneNumberId ? await numberFor(e.phoneNumberId) : null);
        continue;
      }
      const number = await numberFor(e.phoneNumberId);
      if (!number || number.status === "INACTIVE") continue;
      if (e.kind === "message") await ingestMessage(number, e);
      else if (e.kind === "reaction") await ingestReaction(number, e);
      else await applyStatus(number, e);
    } catch (error) {
      console.error(`[wa-cloud] failed to ingest ${e.kind}`, error);
    }
  }
}

async function findConversation(number: NumberRef, bsuid: string | null, waId: string | null): Promise<ConvoRef | null> {
  const or: Prisma.WhatsappCloudConversationWhereInput[] = [];
  if (bsuid) or.push({ bsuid });
  if (waId) or.push({ waId });
  if (or.length === 0) return null;
  return prisma.whatsappCloudConversation.findFirst({
    where: { organizationId: number.organizationId, numberId: number.id, OR: or },
    select: CONVO_SELECT,
  });
}

/** Preenche o identificador que faltava. Choque de índice único (outra conversa já o tem) é ignorado. */
async function backfillIdentity(
  organizationId: string,
  convo: ConvoRef,
  ids: { bsuid: string | null; waId: string | null; profileName?: string | null; username?: string | null },
): Promise<void> {
  const data: Prisma.WhatsappCloudConversationUpdateManyMutationInput = {};
  if (ids.bsuid && !convo.bsuid) data.bsuid = ids.bsuid;
  if (ids.waId && !convo.waId) data.waId = ids.waId;
  if (ids.profileName) data.profileName = ids.profileName;
  if (ids.username) data.username = ids.username;
  if (Object.keys(data).length === 0) return;
  try {
    await prisma.whatsappCloudConversation.updateMany({ where: { id: convo.id, organizationId }, data });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

async function ingestMessage(number: NumberRef, m: CloudInboundMessage): Promise<void> {
  const orgId = number.organizationId;
  let convo = await findConversation(number, m.bsuid, m.waId);
  if (!convo) {
    // Só com telefone vira contato do CRM (mesma regra do inbox atual); cliente
    // só com nome de usuário não cria contato.
    const contactId = m.waId ? await resolveContactId(orgId, m.waId, m.profileName) : null;
    try {
      convo = await prisma.whatsappCloudConversation.create({
        data: {
          organizationId: orgId,
          numberId: number.id,
          bsuid: m.bsuid,
          waId: m.waId,
          username: m.username,
          profileName: m.profileName,
          contactId,
        },
        select: CONVO_SELECT,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      convo = await findConversation(number, m.bsuid, m.waId);
      if (!convo) throw error;
    }
  } else {
    await backfillIdentity(orgId, convo, m);
    if (!convo.contactId && m.waId) {
      const contactId = await resolveContactId(orgId, m.waId, m.profileName);
      if (contactId) {
        await prisma.whatsappCloudConversation.updateMany({
          where: { id: convo.id, organizationId: orgId },
          data: { contactId },
        });
      }
    }
  }

  let quotedBody: string | null = null;
  if (m.quotedWamid) {
    const q = await prisma.whatsappCloudMessage.findFirst({
      where: { organizationId: orgId, wamid: m.quotedWamid },
      select: { body: true, type: true },
    });
    quotedBody = q ? quotedLabel(q.type, q.body) : null;
  }

  let messageId: string;
  try {
    const created = await prisma.whatsappCloudMessage.create({
      data: {
        organizationId: orgId,
        conversationId: convo.id,
        wamid: m.wamid,
        direction: "INBOUND",
        type: m.type,
        body: m.body,
        payload: m.extra as Prisma.InputJsonValue,
        ...(m.media
          ? { mediaId: m.media.id, mediaMime: m.media.mime, mediaName: m.media.filename, mediaStatus: "PENDING" as const }
          : {}),
        quotedWamid: m.quotedWamid,
        quotedBody,
        timestamp: m.timestamp,
      },
      select: { id: true },
    });
    messageId = created.id;
  } catch (error) {
    if (isUniqueViolation(error)) return; // reenvio da Meta: já gravada, não conta de novo
    throw error;
  }

  const newest = !convo.lastMessageAt || m.timestamp >= convo.lastMessageAt;
  const inboundNewest = !convo.lastInboundAt || m.timestamp > convo.lastInboundAt;
  await prisma.whatsappCloudConversation.updateMany({
    where: { id: convo.id, organizationId: orgId },
    data: {
      unreadCount: { increment: 1 },
      ...(inboundNewest ? { lastInboundAt: m.timestamp } : {}),
      ...(newest ? { lastMessageAt: m.timestamp, lastMessagePreview: previewFor(m.type, m.body) } : {}),
    },
  });
  if (m.media) scheduleMediaDownload(orgId, messageId);
}

async function ingestReaction(number: NumberRef, r: CloudInboundReaction): Promise<void> {
  const target = await prisma.whatsappCloudMessage.findFirst({
    where: { organizationId: number.organizationId, wamid: r.targetWamid, conversation: { numberId: number.id } },
    select: { id: true, reactions: true },
  });
  if (!target) return;
  const reactions = applyReaction(target.reactions, { emoji: r.emoji, fromMe: false, senderName: null });
  await prisma.whatsappCloudMessage.updateMany({
    where: { id: target.id, organizationId: number.organizationId },
    data: { reactions: reactions as Prisma.InputJsonValue },
  });
}

async function applyStatus(number: NumberRef, s: CloudStatusUpdate): Promise<void> {
  const orgId = number.organizationId;
  const msg = await prisma.whatsappCloudMessage.findFirst({
    where: { organizationId: orgId, wamid: s.wamid },
    select: { id: true, status: true, conversationId: true, campaignId: true },
  });
  const category = s.status === "FAILED" ? categorizeMetaError(s.errorCode) : null;

  if (msg) {
    const next = nextMessageStatus(msg.status, s.status);
    const data: Prisma.WhatsappCloudMessageUpdateManyMutationInput = {};
    if (next) data.status = next;
    if (next === "FAILED") {
      data.errorCode = s.errorCode;
      data.errorMessage = s.errorMessage;
    }
    if (s.pricingCategory) data.pricingCategory = s.pricingCategory;
    if (s.pricingType) data.pricingType = s.pricingType;
    if (Object.keys(data).length > 0) {
      await prisma.whatsappCloudMessage.updateMany({ where: { id: msg.id, organizationId: orgId }, data });
    }
    const convo = await prisma.whatsappCloudConversation.findFirst({
      where: { id: msg.conversationId, organizationId: orgId },
      select: CONVO_SELECT,
    });
    if (convo) await backfillIdentity(orgId, convo, { bsuid: s.bsuid, waId: s.waId });
    if (category && msg.campaignId && isCampaignStopper(category)) {
      await pauseCloudCampaign(orgId, msg.campaignId, pauseReasonText(category));
    }
  }

  if (category && isNumberLevelError(category)) {
    await markNumberError(orgId, number.id, s.errorMessage ?? category);
  }

  if (s.status !== "SENT") {
    await applyCampaignDeliveryUpdates([
      {
        providerMessageId: s.wamid,
        status: s.status,
        ...(category ? { error: recipientErrorText(category, s.errorMessage) } : {}),
      },
    ]);
  }
}

async function applyTemplateStatus(t: CloudTemplateStatusUpdate): Promise<void> {
  // O mesmo modelo da Meta pode estar espelhado em mais de uma empresa que tem a
  // mesma WABA; todas recebem o status (a WABA identifica a conta na Meta).
  const rows = await prisma.whatsappCloudTemplate.findMany({
    where: { wabaId: t.wabaId, name: t.name, language: t.language },
    select: { id: true },
  });
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  await prisma.whatsappCloudTemplate.updateMany({
    where: { id: { in: ids } },
    data: { status: t.status, rejectedReason: t.reason },
  });
  if (t.status === "PAUSED") await pauseCampaignsForTemplates(ids, pauseReasonText("template_paused"));
  if (t.status === "DISABLED") await pauseCampaignsForTemplates(ids, pauseReasonText("template_disabled"));
}

async function applyUserIdUpdate(u: CloudUserIdUpdate, number: NumberRef | null): Promise<void> {
  try {
    await prisma.whatsappCloudConversation.updateMany({
      where: {
        bsuid: u.previousBsuid,
        ...(number ? { numberId: number.id, organizationId: number.organizationId } : {}),
      },
      data: { bsuid: u.currentBsuid },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}
```

> Nota de isolamento: `applyUserIdUpdate` sem número conhecido e `applyTemplateStatus` filtram por identificadores da Meta (BSUID / WABA) em vez de `organizationId` — o evento não traz empresa. É intencional e está comentado; todo o resto filtra por `organizationId`.

- [ ] **Step 5: Rota do webhook**

`src/app/api/webhooks/whatsapp-cloud/route.ts`:

```ts
import { env } from "@/lib/env";
import { safeEqualString, verifySignature } from "@/lib/whatsapp-cloud/signature";
import { parseCloudWebhook } from "@/lib/whatsapp-cloud/webhook-parser";
import { ingestCloudEvents } from "@/lib/whatsapp-cloud/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook da WhatsApp Cloud API (Meta → nós). PÚBLICO por necessidade — quem
 * chama é a Meta —, então autentica cada chamada aqui dentro (guia 05):
 *  - GET: aperto de mão da inscrição, só se hub.verify_token bater com
 *    META_WEBHOOK_VERIFY_TOKEN (sem a variável: 403, fail-closed).
 *  - POST: X-Hub-Signature-256 sobre os bytes crus com META_APP_SECRET (sem a
 *    variável: 401). A empresa sai de metadata.phone_number_id.
 * Depois da assinatura válida responde 200 mesmo se o processamento falhar — a
 * Meta reenviaria por 7 dias; a deduplicação é pelo wamid.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && safeEqualString(token, expected)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return Response.json({ ok: true, ignored: true });
  }
  try {
    await ingestCloudEvents(parseCloudWebhook(payload));
  } catch (error) {
    console.error("[wa-cloud] webhook processing failed", error);
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 6: Registrar o job de mídia**

Em `src/lib/jobs/index.ts`, adicione aos imports:

```ts
import { downloadInboundMedia, type WhatsappCloudMediaJob } from "@/lib/whatsapp-cloud/media";
```

e, dentro de `JOB_HANDLERS`, depois do handler `"whatsapp-media"`, cole:

```ts
  /** Download an official WhatsApp (Cloud API) inbound media into storage. */
  "whatsapp-cloud-media": async (payload) => {
    const job = payload as WhatsappCloudMediaJob;
    if (!job?.organizationId || !job?.messageId) return;
    await downloadInboundMedia(job.organizationId, job.messageId);
  },
```

- [ ] **Step 7: Simulador de webhook para desenvolvimento**

`scripts/wa-cloud-webhook.ts`:

```ts
/**
 * Simulador de webhook da Meta para desenvolvimento: assina com META_APP_SECRET e
 * manda para /api/webhooks/whatsapp-cloud do app local — exercita a tela oficial
 * sem Meta e sem túnel. Não roda em CI.
 *
 *   npx tsx --env-file=.env scripts/wa-cloud-webhook.ts seed <email-do-usuario>
 *   npx tsx --env-file=.env scripts/wa-cloud-webhook.ts sql "<SELECT ...>"
 *   npx tsx --env-file=.env scripts/wa-cloud-webhook.ts move-owner to=<email|id>
 *   npx tsx --env-file=.env scripts/wa-cloud-webhook.ts <tipo> [chave=valor ...]
 *
 * tipos:  text | image | audio | document | location | reaction | status | template | user-id
 * chaves: phone, wamid, waId (waId=none = sem telefone), bsuid (bsuid=none), name, username,
 *         body, caption, place, context, target, emoji (emoji=none remove), status, code,
 *         details, pricing, template, event, language, previous, current, url, ts (segundos)
 * `sql` existe porque o Postgres portátil do ambiente local não traz o psql.
 */
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as f from "../src/lib/whatsapp-cloud/__tests__/fixtures";

const [kind, ...rest] = process.argv.slice(2);
const args: Record<string, string> = Object.fromEntries(
  rest.map((a) => {
    const i = a.indexOf("=");
    return i === -1 ? [a, ""] : [a.slice(0, i), a.slice(i + 1)];
  }),
);
const opt = (k: string): string | null | undefined =>
  args[k] === undefined ? undefined : args[k] === "none" ? null : args[k];
const str = (k: string): string | undefined => opt(k) ?? undefined;

function client(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Consulta de verificação (só leitura, uso local). */
async function sql(query: string) {
  if (!/^\s*select\b/i.test(query)) throw new Error("Só SELECT.");
  const prisma = client();
  try {
    console.table(await prisma.$queryRawUnsafe(query));
  } finally {
    await prisma.$disconnect();
  }
}

async function seed(email: string) {
  const prisma = client();
  try {
    const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });
    if (!user) throw new Error(`Usuário ${email} não encontrado`);
    const m = await prisma.membership.findFirst({ where: { userId: user.id }, select: { organizationId: true } });
    if (!m) throw new Error("Usuário sem empresa");
    const phoneNumberId = str("phone") ?? f.PHONE_NUMBER_ID;
    const data = {
      phoneNumberId,
      wabaId: f.WABA_ID,
      displayPhoneNumber: "+1 555 078 3881",
      verifiedName: "Número simulado",
      status: "ACTIVE" as const,
      // Token falso de propósito: recebimento funciona; envio falha com "no_number".
      accessTokenEnc: "dev-fake-token",
    };
    const existing = await prisma.whatsappCloudNumber.findFirst({
      where: { organizationId: m.organizationId, ownerId: user.id },
      select: { id: true },
    });
    if (existing) {
      await prisma.whatsappCloudNumber.updateMany({ where: { id: existing.id, organizationId: m.organizationId }, data });
    } else {
      await prisma.whatsappCloudNumber.create({ data: { organizationId: m.organizationId, ownerId: user.id, ...data } });
    }
    console.log(`Número simulado pronto (phone_number_id=${phoneNumberId}).`);
    console.log(`Libere a empresa no .env: WHATSAPP_CLOUD_ORG_IDS=${m.organizationId}`);
  } finally {
    await prisma.$disconnect();
  }
}

function build(): Record<string, unknown> {
  // `ts` em segundos; padrão = agora (janela de 24h aberta). ts=1790000000 = 21/09/2026.
  const timestamp = str("ts") ? Number(str("ts")) : Math.floor(Date.now() / 1000);
  const who = {
    phoneNumberId: str("phone"),
    wamid: str("wamid"),
    waId: opt("waId"),
    bsuid: opt("bsuid"),
    name: str("name"),
    username: str("username"),
    contextId: str("context"),
    timestamp,
  };
  switch (kind) {
    case "text":
      return f.inboundText({ ...who, body: str("body") });
    case "image":
    case "audio":
    case "document":
      return f.inboundMedia(kind, { ...who, caption: str("caption") });
    case "location":
      return f.inboundLocation({ ...who, name: str("place") });
    case "reaction":
      return f.inboundReaction({ ...who, targetWamid: str("target") ?? "", emoji: opt("emoji") });
    case "status":
      return f.statusUpdate({
        wamid: str("wamid") ?? "",
        status: (str("status") ?? "delivered") as "sent" | "delivered" | "read" | "failed",
        phoneNumberId: who.phoneNumberId,
        waId: who.waId,
        bsuid: who.bsuid,
        errorCode: str("code") ? Number(str("code")) : undefined,
        errorDetails: str("details"),
        pricingCategory: str("pricing"),
        timestamp,
      });
    case "template":
      return f.templateStatusUpdate({ name: str("template") ?? "", event: str("event") ?? "APPROVED", language: str("language") });
    case "user-id":
      return f.userIdUpdate({ previous: str("previous") ?? "", current: str("current") ?? "", phoneNumberId: who.phoneNumberId });
    default:
      throw new Error(`Tipo desconhecido: ${kind}`);
  }
}

/** Troca o dono do número simulado (teste de privacidade entre vendedores). */
async function moveOwner(to: string) {
  const prisma = client();
  try {
    const phoneNumberId = str("phone") ?? f.PHONE_NUMBER_ID;
    const user = to.includes("@") ? await prisma.user.findFirst({ where: { email: to }, select: { id: true } }) : null;
    const ownerId = user?.id ?? to;
    const n = await prisma.whatsappCloudNumber.findFirst({
      where: { phoneNumberId },
      select: { id: true, organizationId: true },
    });
    if (!n || !ownerId) throw new Error("Número simulado ou dono não encontrado");
    await prisma.whatsappCloudNumber.updateMany({ where: { id: n.id, organizationId: n.organizationId }, data: { ownerId } });
    console.log(`Dono do número agora: ${ownerId}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (kind === "seed") return seed(rest[0] ?? "");
  if (kind === "sql") return sql(rest.join(" "));
  if (kind === "move-owner") return moveOwner(str("to") ?? "");
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error("META_APP_SECRET não está no .env");
  const body = JSON.stringify(build());
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const url = str("url") ?? "http://localhost:3000/api/webhooks/whatsapp-cloud";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
    body,
  });
  console.log(`${res.status} ${await res.text()}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
```

- [ ] **Step 8: Atualizar o guia 05**

Em `docs/guia/05-rotas-e-jobs.md`:
- linha 46: `## Os quatro jeitos de autenticar uma rota neste repo` → `## Os cinco jeitos de autenticar uma rota neste repo`;
- depois da linha 53 (`| Evolution (webhook) | ...`), acrescente a linha da tabela:

```markdown
| Meta (webhook do WhatsApp oficial) | assinatura HMAC `X-Hub-Signature-256` → `verifySignature(...)` com `META_APP_SECRET` | [src/lib/whatsapp-cloud/signature.ts](../../src/lib/whatsapp-cloud/signature.ts) |
```

- linhas 55-56: troque `O que os\nquatro têm em comum` por `O que os\ncinco têm em comum`;
- logo antes de `## O guard de cron: por que é compartilhado, e não copiado`, insira:

```markdown
### Webhook (Meta — WhatsApp oficial)

Entra por `/api/webhooks/whatsapp-cloud` — uma URL só para todos os números, porque a Meta manda o
webhook para o **app**, não por conexão. Os dois métodos são fail-closed:

- `GET` é o aperto de mão da inscrição: devolve o `hub.challenge` só se `hub.verify_token` bater
  com `META_WEBHOOK_VERIFY_TOKEN` (comparação em tempo constante); sem a variável, 403.
- `POST` só é lido depois de `verifySignature(bytesCrus, X-Hub-Signature-256, META_APP_SECRET)`;
  sem a variável ou com assinatura errada, 401. A empresa sai de `metadata.phone_number_id` →
  `WhatsappCloudNumber.organizationId`.

Com assinatura válida a rota responde 200 mesmo se o processamento falhar (log `[wa-cloud]`): a
Meta reenvia por até 7 dias quem não responde 200, e a deduplicação é pelo `wamid`, único por
empresa. Em desenvolvimento, `scripts/wa-cloud-webhook.ts` assina e envia payloads falsos para o
app local — não precisa de túnel para testar o recebimento.

```

- linha 245: `Ela documenta os quatro padrões conhecidos` → `Ela documenta os cinco padrões conhecidos`;
- linha 247: `nenhuma das quatro linhas` → `nenhuma das cinco linhas`;
- linhas 253-255: troque `` `isCronAuthorized(req)`, `verifyQStashSignature(...)`, ou comparação de token — uma das quatro `` por `` `isCronAuthorized(req)`, `verifyQStashSignature(...)`, `verifySignature(...)` da Meta, ou comparação de token — uma das cinco ``.

- [ ] **Step 9: Typecheck, lint e testes**

Run: `npm run typecheck && npm run lint && npm run test:wa-cloud`
Expected: tudo verde; 4 avisos.

- [ ] **Step 10: Preparar o ambiente de simulação**

Acrescente ao `.env` local (valores de dev, não reais):

```bash
META_APP_SECRET="dev-app-secret-local"
META_WEBHOOK_VERIFY_TOKEN="dev-verify-token-local"
```

Run: `npx tsx --env-file=.env scripts/wa-cloud-webhook.ts seed owner@metodoai.local`
Expected: `Número simulado pronto (phone_number_id=106540352242922).` e a linha `WHATSAPP_CLOUD_ORG_IDS=<id>`. Coloque essa linha no `.env` e rode `npm run dev` (em outro terminal).

Verifique o GET:

```bash
curl.exe -s "http://localhost:3000/api/webhooks/whatsapp-cloud?hub.mode=subscribe&hub.verify_token=dev-verify-token-local&hub.challenge=123"
curl.exe -s -o NUL -w "%{http_code}\n" "http://localhost:3000/api/webhooks/whatsapp-cloud?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123"
curl.exe -s -o NUL -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d "{}" http://localhost:3000/api/webhooks/whatsapp-cloud
```

Expected: `123`, depois `403`, depois `401` (POST sem assinatura).

Para as consultas dos próximos passos (o Postgres portátil não traz `psql`), defina no terminal:

```bash
SQL="npx tsx --env-file=.env scripts/wa-cloud-webhook.ts sql"
```

- [ ] **Step 11: Reenvio não duplica (Review Focus 1)**

```bash
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts text wamid=wamid.DUP.1 waId=5511977770001 bsuid=BR.7000000000000000001 body="primeira"
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts text wamid=wamid.DUP.1 waId=5511977770001 bsuid=BR.7000000000000000001 body="primeira"
$SQL "SELECT count(*)::int AS n FROM whatsapp_cloud_messages WHERE wamid='wamid.DUP.1'"
$SQL "SELECT \"unreadCount\", \"lastInboundAt\" IS NOT NULL AS janela FROM whatsapp_cloud_conversations WHERE \"waId\"='5511977770001';"
```

Expected: as duas chamadas respondem `200 {"ok":true}`; `count` = **1**; `unreadCount` = **1**, `janela` = `t`.

- [ ] **Step 12: BSUID e depois telefone (Review Focus 2)**

```bash
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts text wamid=wamid.BS.1 waId=none bsuid=BR.9000000000000000001 name="Cliente Sem Fone" username=cliente.sf
$SQL "SELECT id, \"waId\", bsuid, \"contactId\" FROM whatsapp_cloud_conversations WHERE bsuid='BR.9000000000000000001';"
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts text wamid=wamid.BS.2 waId=5511988887777 bsuid=BR.9000000000000000001
$SQL "SELECT id, \"waId\", bsuid, \"contactId\" IS NOT NULL AS tem_contato FROM whatsapp_cloud_conversations WHERE bsuid='BR.9000000000000000001';"
```

Expected: primeira consulta — 1 linha, `waId` vazio, `contactId` vazio. Segunda — **a mesma** `id`, `waId` = `5511988887777`, `tem_contato` = `t`.

- [ ] **Step 13: Reação, status e modelo**

```bash
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts reaction wamid=wamid.R.1 waId=5511977770001 bsuid=BR.7000000000000000001 target=wamid.DUP.1 emoji=👍
$SQL "SELECT reactions FROM whatsapp_cloud_messages WHERE wamid='wamid.DUP.1';"
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts reaction wamid=wamid.R.2 waId=5511977770001 bsuid=BR.7000000000000000001 target=wamid.DUP.1 emoji=none
$SQL "SELECT reactions FROM whatsapp_cloud_messages WHERE wamid='wamid.DUP.1';"
```

Expected: primeiro `[{"emoji": "👍", "fromMe": false, "senderName": null}]`, depois `[]`.

- [ ] **Step 14: Commit**

```bash
git add src/lib/whatsapp-cloud src/app/api/webhooks/whatsapp-cloud src/lib/whatsapp/ingest.ts src/lib/jobs/index.ts scripts/wa-cloud-webhook.ts docs/guia/05-rotas-e-jobs.md
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona webhook assinado e gravacao dos eventos

O que:
- /api/webhooks/whatsapp-cloud: GET de verificacao e POST com
  X-Hub-Signature-256, ambos fail-closed.
- ingest: mensagens (BSUID e/ou telefone, contato do CRM so com telefone),
  reacoes, status so para frente com cobranca, erro de numero, pausa de
  campanha, status de modelo e troca de BSUID. Dedupe pelo wamid.
- Download de midia em segundo plano (job QStash ou em processo).
- scripts/wa-cloud-webhook.ts: simulador assinado para dev.

Por que:
- Recebimento direto da Meta, com seguranca e sem perder mensagem em
  reenvio (spec secoes 7.2, 7.3 e 9).

Impacto:
- Rota publica nova, autenticada por assinatura. Guia 05 atualizado.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Envio — actions e rotas da tela

**Files:**
- Create: `src/lib/whatsapp-cloud/send.ts`
- Create: `src/app/actions/inbox-oficial.ts`
- Create: `src/app/api/inbox-oficial/conversations/route.ts`, `messages/route.ts`, `media/fetch/route.ts`, `media/upload/route.ts`

**Interfaces:**
- Consumes: Tasks 1–5, 9 (`loadNumber`, `markNumberError`, `cloudGuard`, `guardResponse`, queries), 10 (`downloadInboundMedia`, `resolveContactId` exportada).
- Produces:
  - `type CallResult = { ok: true; wamid: string } | { ok: false; category: MetaErrorCategory; code: number | null; message: string }`; `callSend(number: NumberWithToken, payload: Record<string, unknown>): Promise<CallResult>`
  - `type OutboundRecord = { conversationId: string; wamid: string; type: WhatsappCloudMessageType; body: string | null; templateName?: string; templateLanguage?: string; media?: { url: string; mime: string; name: string | null; size: number }; quotedWamid?: string | null; quotedBody?: string | null; sentById: string | null; campaignId?: string | null }`; `recordOutbound(organizationId: string, r: OutboundRecord): Promise<string>`
  - `conversationForPhone(organizationId: string, numberId: string, waId: string, contactId: string | null): Promise<string>`
  - Actions: `type CloudActionError`, `type CloudActionResult = { ok: true } | { ok: false; error: CloudActionError; detail?: string }`; `sendCloudText(conversationId: string, text: string, replyToMessageId?: string | null)`; `sendCloudTemplate(conversationId: string, templateId: string, values: Record<string, string>)`; `reactCloudMessage(messageId: string, emoji: string)`; `markCloudConversationRead(conversationId: string): Promise<{ ok: boolean }>`; `startCloudConversation(input: { phone?: string; contactId?: string }): Promise<{ ok: true; conversationId: string } | { ok: false; error: CloudActionError }>`; `searchCloudContacts(q: string): Promise<{ id: string; name: string; phone: string | null }[]>`; `cloudContactParams(conversationId: string): Promise<ParamContext | null>`
  - Rotas: `GET /api/inbox-oficial/conversations` → `CloudConversationRow[]`; `GET /api/inbox-oficial/messages?conversationId=` → `CloudMessageRow[]`; `POST /api/inbox-oficial/media/fetch` `{ messageId }` → mídia; `POST /api/inbox-oficial/media/upload` (multipart `file`, `conversationId`, `caption`) → `{ ok: true } | { ok: false; error: string; detail?: string }`

- [ ] **Step 1: `send.ts`**

```ts
import "server-only";
import type { WhatsappCloudMessageType } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { postMessage } from "@/lib/whatsapp-cloud/meta-api";
import { categorizeMetaError, isNumberLevelError, type MetaErrorCategory } from "@/lib/whatsapp-cloud/errors";
import { markNumberError, type NumberWithToken } from "@/lib/whatsapp-cloud/numbers";
import { previewFor } from "@/lib/whatsapp-cloud/preview";
import { isUniqueViolation } from "@/lib/whatsapp-cloud/prisma-errors";

export type CallResult =
  | { ok: true; wamid: string }
  | { ok: false; category: MetaErrorCategory; code: number | null; message: string };

/** Envia uma mensagem à Meta. Erro de número (token, registro, conta) marca o número ERROR. */
export async function callSend(number: NumberWithToken, payload: Record<string, unknown>): Promise<CallResult> {
  const res = await postMessage(number.phoneNumberId, number.token, payload);
  if (!res.ok) {
    const category = categorizeMetaError(res.code);
    if (isNumberLevelError(category)) await markNumberError(number.organizationId, number.id, res.message);
    console.error(`[wa-cloud] send failed (${res.code ?? res.status}): ${res.message}`);
    return { ok: false, category, code: res.code, message: res.message };
  }
  const wamid = res.data.messages?.[0]?.id;
  if (!wamid) return { ok: false, category: "unknown", code: null, message: "A Meta não devolveu o id da mensagem." };
  return { ok: true, wamid };
}

export type OutboundRecord = {
  conversationId: string;
  wamid: string;
  type: WhatsappCloudMessageType;
  body: string | null;
  templateName?: string;
  templateLanguage?: string;
  media?: { url: string; mime: string; name: string | null; size: number };
  quotedWamid?: string | null;
  quotedBody?: string | null;
  sentById: string | null;
  campaignId?: string | null;
};

/** Grava uma mensagem já aceita pela Meta e atualiza a prévia da conversa. */
export async function recordOutbound(organizationId: string, r: OutboundRecord): Promise<string> {
  const db = tenantDb(organizationId);
  const now = new Date();
  const created = await db.whatsappCloudMessage.create({
    data: {
      organizationId,
      conversationId: r.conversationId,
      wamid: r.wamid,
      direction: "OUTBOUND",
      type: r.type,
      body: r.body,
      templateName: r.templateName ?? null,
      templateLanguage: r.templateLanguage ?? null,
      ...(r.media
        ? {
            mediaUrl: r.media.url,
            mediaMime: r.media.mime,
            mediaName: r.media.name,
            mediaSize: r.media.size,
            mediaStatus: "READY" as const,
          }
        : {}),
      status: "SENT",
      quotedWamid: r.quotedWamid ?? null,
      quotedBody: r.quotedBody ?? null,
      sentById: r.sentById,
      campaignId: r.campaignId ?? null,
      timestamp: now,
    },
    select: { id: true },
  });
  await db.whatsappCloudConversation.updateMany({
    where: { id: r.conversationId },
    data: { lastMessageAt: now, lastMessagePreview: previewFor(r.type, r.body) },
  });
  return created.id;
}

/** Conversa do número com um telefone (campanha, Nova conversa): acha ou cria. */
export async function conversationForPhone(
  organizationId: string,
  numberId: string,
  waId: string,
  contactId: string | null,
): Promise<string> {
  const db = tenantDb(organizationId);
  const found = await db.whatsappCloudConversation.findFirst({
    where: { numberId, waId },
    select: { id: true, contactId: true },
  });
  if (found) {
    if (contactId && !found.contactId) {
      await db.whatsappCloudConversation.updateMany({ where: { id: found.id }, data: { contactId } });
    }
    return found.id;
  }
  try {
    const created = await db.whatsappCloudConversation.create({
      data: { organizationId, numberId, waId, contactId },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const again = await db.whatsappCloudConversation.findFirst({ where: { numberId, waId }, select: { id: true } });
    if (!again) throw error;
    return again.id;
  }
}
```

- [ ] **Step 2: Actions da conversa (`src/app/actions/inbox-oficial.ts`)**

```ts
"use server";

import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { looksLikeWhatsappMobile, normalizeWhatsappNumber } from "@/lib/phone";
import { applyReaction, myReaction } from "@/lib/whatsapp/reactions";
import { resolveContactId } from "@/lib/whatsapp/ingest";
import { cloudGuard } from "@/lib/whatsapp-cloud/guard";
import { loadNumber, type NumberWithToken } from "@/lib/whatsapp-cloud/numbers";
import { callSend, conversationForPhone, recordOutbound } from "@/lib/whatsapp-cloud/send";
import { postMessage } from "@/lib/whatsapp-cloud/meta-api";
import { isWindowOpen } from "@/lib/whatsapp-cloud/window";
import { quotedLabel } from "@/lib/whatsapp-cloud/preview";
import { reactionPayload, readPayload, templatePayload, textPayload } from "@/lib/whatsapp-cloud/payloads";
import {
  buildTemplateComponents,
  renderTemplateText,
  templateVariables,
  toTemplateDef,
  unsupportedReason,
  type ParamContext,
} from "@/lib/whatsapp-cloud/template-params";
import type { MetaErrorCategory } from "@/lib/whatsapp-cloud/errors";
import {
  getContactParams,
  getMyCloudNumber,
  getOwnedCloudConversation,
  getOwnedCloudMessage,
  searchContactsWithPhone,
} from "@/lib/queries/inbox-oficial";

export type CloudActionError =
  | "unauthorized"
  | "not_enabled"
  | "not_found"
  | "no_number"
  | "empty"
  | "invalid"
  | MetaErrorCategory;

export type CloudActionResult = { ok: true } | { ok: false; error: CloudActionError; detail?: string };

const MAX_TEXT = 4096;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type OwnedConvo = NonNullable<Awaited<ReturnType<typeof getOwnedCloudConversation>>>;
type Owned =
  | { ok: true; orgId: string; userId: string; convo: OwnedConvo; number: NumberWithToken }
  | { ok: false; error: CloudActionError };

/** Sessão → liberação → conversa do número do usuário → número ativo. */
async function ownedConversation(conversationId: string): Promise<Owned> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const convo = await getOwnedCloudConversation(ctx.organizationId, ctx.userId, conversationId);
  if (!convo) return { ok: false, error: "not_found" };
  const number = await loadNumber(ctx.organizationId, convo.numberId);
  if (!number || number.status !== "ACTIVE") return { ok: false, error: "no_number" };
  return { ok: true, orgId: ctx.organizationId, userId: ctx.userId, convo, number };
}

/** Texto livre — só com a janela de 24h aberta (checado aqui, não só na tela). */
export async function sendCloudText(
  conversationId: string,
  text: string,
  replyToMessageId?: string | null,
): Promise<CloudActionResult> {
  const body = text.trim().slice(0, MAX_TEXT);
  if (!body) return { ok: false, error: "empty" };
  const o = await ownedConversation(conversationId);
  if (!o.ok) return o;
  if (!isWindowOpen(o.convo.lastInboundAt)) return { ok: false, error: "window_closed" };
  try {
    let quotedWamid: string | null = null;
    let quotedBody: string | null = null;
    if (replyToMessageId) {
      const q = await tenantDb(o.orgId).whatsappCloudMessage.findFirst({
        where: { id: replyToMessageId, conversationId },
        select: { wamid: true, body: true, type: true },
      });
      if (q?.wamid) {
        quotedWamid = q.wamid;
        quotedBody = quotedLabel(q.type, q.body);
      }
    }
    const res = await callSend(o.number, textPayload(o.convo, body, quotedWamid));
    if (!res.ok) return { ok: false, error: res.category, detail: res.message };
    await recordOutbound(o.orgId, {
      conversationId,
      wamid: res.wamid,
      type: "TEXT",
      body,
      quotedWamid,
      quotedBody,
      sentById: o.userId,
    });
    return { ok: true };
  } catch (error) {
    console.error("[wa-cloud] send text failed", error);
    return { ok: false, error: "unknown", detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Modelo aprovado — permitido a qualquer momento (abre/reabre a conversa). */
export async function sendCloudTemplate(
  conversationId: string,
  templateId: string,
  values: Record<string, string>,
): Promise<CloudActionResult> {
  const o = await ownedConversation(conversationId);
  if (!o.ok) return o;
  try {
    const row = await tenantDb(o.orgId).whatsappCloudTemplate.findFirst({
      where: { id: templateId, wabaId: o.number.wabaId, status: "APPROVED" },
      select: { name: true, language: true, parameterFormat: true, components: true },
    });
    if (!row) return { ok: false, error: "invalid" };
    const def = toTemplateDef(row);
    if (unsupportedReason(def)) return { ok: false, error: "invalid" };
    const clean: Record<string, string> = {};
    for (const v of templateVariables(def)) clean[v.id] = (values[v.id] ?? "").trim().slice(0, 1000) || "-";
    const res = await callSend(
      o.number,
      templatePayload(o.convo, def.name, def.language, buildTemplateComponents(def, clean)),
    );
    if (!res.ok) return { ok: false, error: res.category, detail: res.message };
    await recordOutbound(o.orgId, {
      conversationId,
      wamid: res.wamid,
      type: "TEMPLATE",
      body: renderTemplateText(def, clean),
      templateName: def.name,
      templateLanguage: def.language,
      sentById: o.userId,
    });
    return { ok: true };
  } catch (error) {
    console.error("[wa-cloud] send template failed", error);
    return { ok: false, error: "unknown", detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Reage (ou remove a própria reação tocando no mesmo emoji). Até 30 dias. */
export async function reactCloudMessage(messageId: string, emoji: string): Promise<CloudActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const msg = await getOwnedCloudMessage(ctx.organizationId, ctx.userId, messageId);
  if (!msg?.wamid) return { ok: false, error: "not_found" };
  if (Date.now() - msg.timestamp.getTime() > THIRTY_DAYS_MS) return { ok: false, error: "invalid" };
  const number = await loadNumber(ctx.organizationId, msg.conversation.numberId);
  if (!number || number.status !== "ACTIVE") return { ok: false, error: "no_number" };
  const finalEmoji = myReaction(msg.reactions) === emoji ? "" : emoji;
  const res = await callSend(number, reactionPayload(msg.conversation, msg.wamid, finalEmoji));
  if (!res.ok) return { ok: false, error: res.category, detail: res.message };
  const reactions = applyReaction(msg.reactions, { emoji: finalEmoji, fromMe: true });
  await tenantDb(ctx.organizationId).whatsappCloudMessage.updateMany({
    where: { id: messageId },
    data: { reactions: reactions as Prisma.InputJsonValue },
  });
  return { ok: true };
}

/** Zera o contador e manda o "lido" da última mensagem do cliente (até 30 dias). */
export async function markCloudConversationRead(conversationId: string): Promise<{ ok: boolean }> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false };
  const { ctx } = g;
  const convo = await getOwnedCloudConversation(ctx.organizationId, ctx.userId, conversationId);
  if (!convo) return { ok: false };
  const db = tenantDb(ctx.organizationId);
  await db.whatsappCloudConversation.updateMany({ where: { id: conversationId }, data: { unreadCount: 0 } });
  const last = await db.whatsappCloudMessage.findFirst({
    where: { conversationId, direction: "INBOUND", wamid: { not: null } },
    orderBy: { timestamp: "desc" },
    select: { wamid: true, timestamp: true },
  });
  if (last?.wamid && Date.now() - last.timestamp.getTime() < THIRTY_DAYS_MS) {
    const number = await loadNumber(ctx.organizationId, convo.numberId);
    if (number?.status === "ACTIVE") {
      // Best-effort: falha no "lido" não é erro para o vendedor.
      await postMessage(number.phoneNumberId, number.token, readPayload(last.wamid)).catch(() => null);
    }
  }
  return { ok: true };
}

/** Nova conversa por contato do CRM ou número digitado. O primeiro envio é um modelo. */
export async function startCloudConversation(input: {
  phone?: string;
  contactId?: string;
}): Promise<{ ok: true; conversationId: string } | { ok: false; error: CloudActionError }> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const number = await getMyCloudNumber(ctx.organizationId, ctx.userId);
  if (!number || number.status !== "ACTIVE") return { ok: false, error: "no_number" };
  let phone = input.phone ?? "";
  let contactId = input.contactId ?? null;
  if (contactId) {
    const c = await tenantDb(ctx.organizationId).contact.findFirst({
      where: { id: contactId },
      select: { phone: true },
    });
    if (!c?.phone) return { ok: false, error: "invalid" };
    phone = c.phone;
  }
  const waId = normalizeWhatsappNumber(phone);
  if (!looksLikeWhatsappMobile(waId)) return { ok: false, error: "invalid" };
  try {
    if (!contactId) contactId = await resolveContactId(ctx.organizationId, waId, null);
    const conversationId = await conversationForPhone(ctx.organizationId, number.id, waId, contactId);
    return { ok: true, conversationId };
  } catch (error) {
    console.error("[wa-cloud] start conversation failed", error);
    return { ok: false, error: "unknown" };
  }
}

export async function searchCloudContacts(q: string): Promise<{ id: string; name: string; phone: string | null }[]> {
  const g = await cloudGuard();
  if (!g.ok) return [];
  return searchContactsWithPhone(g.ctx.organizationId, q);
}

/** Nome/empresa do contato da conversa, para sugerir as variáveis do modelo. */
export async function cloudContactParams(conversationId: string): Promise<ParamContext | null> {
  const g = await cloudGuard();
  if (!g.ok) return null;
  const { ctx } = g;
  const convo = await getOwnedCloudConversation(ctx.organizationId, ctx.userId, conversationId);
  if (!convo) return null;
  if (convo.contactId) {
    const p = await getContactParams(ctx.organizationId, convo.contactId);
    if (p) return p;
  }
  return { nome: convo.profileName ?? "", empresa: "" };
}
```

> `"unknown"` já é um valor de `MetaErrorCategory`, por isso aparece em `CloudActionError` sem ser repetido.

- [ ] **Step 3: Rotas de leitura**

`src/app/api/inbox-oficial/conversations/route.ts`:

```ts
import { cloudGuard, guardResponse } from "@/lib/whatsapp-cloud/guard";
import { listCloudConversations } from "@/lib/queries/inbox-oficial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lista da tela oficial (polling). Só o número do próprio usuário. */
export async function GET() {
  const g = await cloudGuard();
  if (!g.ok) return guardResponse(g.error);
  return Response.json(await listCloudConversations(g.ctx.organizationId, g.ctx.userId));
}
```

`src/app/api/inbox-oficial/messages/route.ts`:

```ts
import { cloudGuard, guardResponse } from "@/lib/whatsapp-cloud/guard";
import { listCloudMessages } from "@/lib/queries/inbox-oficial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mensagens da conversa aberta (polling). Conversa de outro vendedor → []. */
export async function GET(req: Request) {
  const g = await cloudGuard();
  if (!g.ok) return guardResponse(g.error);
  const id = new URL(req.url).searchParams.get("conversationId");
  if (!id) return Response.json([]);
  return Response.json(await listCloudMessages(g.ctx.organizationId, g.ctx.userId, id));
}
```

`src/app/api/inbox-oficial/media/fetch/route.ts`:

```ts
import { cloudGuard, guardResponse } from "@/lib/whatsapp-cloud/guard";
import { getCloudMessageMedia, getOwnedCloudMessage } from "@/lib/queries/inbox-oficial";
import { downloadInboundMedia } from "@/lib/whatsapp-cloud/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download sob demanda de uma mídia recebida (quando a tela exibe uma mídia pendente). */
export async function POST(req: Request) {
  const g = await cloudGuard();
  if (!g.ok) return guardResponse(g.error);
  let messageId = "";
  try {
    messageId = String(((await req.json()) as { messageId?: string })?.messageId ?? "");
  } catch {
    /* corpo inválido */
  }
  if (!messageId) return new Response("Bad request", { status: 400 });
  const msg = await getOwnedCloudMessage(g.ctx.organizationId, g.ctx.userId, messageId);
  if (!msg) return new Response("Forbidden", { status: 403 });
  await downloadInboundMedia(g.ctx.organizationId, messageId);
  return Response.json(await getCloudMessageMedia(g.ctx.organizationId, messageId));
}
```

- [ ] **Step 4: Rota de upload de anexo**

`src/app/api/inbox-oficial/media/upload/route.ts`:

```ts
import { randomUUID } from "crypto";
import type { WhatsappCloudMessageType } from "@prisma/client";
import { deleteMedia, putMedia } from "@/lib/storage/blob";
import { cloudGuard, guardResponse } from "@/lib/whatsapp-cloud/guard";
import { getOwnedCloudConversation } from "@/lib/queries/inbox-oficial";
import { loadNumber } from "@/lib/whatsapp-cloud/numbers";
import { isWindowOpen } from "@/lib/whatsapp-cloud/window";
import { checkOutboundMedia, MAX_UPLOAD_BYTES, sniffMime, type OutboundKind } from "@/lib/whatsapp-cloud/media-rules";
import { uploadMedia } from "@/lib/whatsapp-cloud/meta-api";
import { categorizeMetaError } from "@/lib/whatsapp-cloud/errors";
import { mediaPayload } from "@/lib/whatsapp-cloud/payloads";
import { callSend, recordOutbound } from "@/lib/whatsapp-cloud/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_FOR: Record<OutboundKind, WhatsappCloudMessageType> = {
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  document: "DOCUMENT",
};

const fail = (status: number, error: string, detail?: string) =>
  Response.json({ ok: false, error, ...(detail ? { detail } : {}) }, { status });

/**
 * Envia um anexo na conversa oficial. Confere o tipo pelo CONTEÚDO (não pela
 * extensão) e o tamanho pela tabela da Meta; guarda uma cópia para exibir, sobe
 * para a Meta e envia por id. Só no número do próprio usuário e com a janela aberta.
 */
export async function POST(req: Request) {
  const g = await cloudGuard();
  if (!g.ok) return guardResponse(g.error);
  const { ctx } = g;

  let file: File | null = null;
  let conversationId = "";
  let caption = "";
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    conversationId = String(form.get("conversationId") ?? "");
    caption = String(form.get("caption") ?? "").trim().slice(0, 1024);
  } catch {
    /* corpo inválido */
  }
  if (!file || !conversationId) return fail(400, "invalid");
  if (file.size > MAX_UPLOAD_BYTES) return fail(400, "too_large");

  const convo = await getOwnedCloudConversation(ctx.organizationId, ctx.userId, conversationId);
  if (!convo) return fail(404, "not_found");
  if (!isWindowOpen(convo.lastInboundAt)) return fail(400, "window_closed");
  const number = await loadNumber(ctx.organizationId, convo.numberId);
  if (!number || number.status !== "ACTIVE") return fail(400, "no_number");

  const bytes = Buffer.from(await file.arrayBuffer());
  const check = checkOutboundMedia(sniffMime(bytes, file.type), bytes.byteLength);
  if (!check.ok) return fail(400, check.reason);

  const displayName = (file.name || "arquivo").slice(0, 200);
  const safeName = displayName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "arquivo";
  let storedUrl: string | null = null;
  try {
    const stored = await putMedia(
      `whatsapp/${ctx.organizationId}/cloud/out/${randomUUID()}-${safeName}`,
      bytes,
      check.mime,
    );
    storedUrl = stored.url;
    const up = await uploadMedia(number.phoneNumberId, number.token, bytes, check.mime, safeName);
    if (!up.ok || !up.data.id) {
      await deleteMedia(stored.url);
      return fail(502, up.ok ? "unknown" : categorizeMetaError(up.code), up.ok ? undefined : up.message);
    }
    const res = await callSend(
      number,
      mediaPayload(convo, check.kind, up.data.id, { caption: caption || null, filename: displayName }),
    );
    if (!res.ok) {
      await deleteMedia(stored.url);
      return fail(502, res.category, res.message);
    }
    await recordOutbound(ctx.organizationId, {
      conversationId,
      wamid: res.wamid,
      type: TYPE_FOR[check.kind],
      body: caption || null,
      media: { url: stored.url, mime: check.mime, name: displayName, size: stored.size },
      sentById: ctx.userId,
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (storedUrl) await deleteMedia(storedUrl);
    console.error("[wa-cloud] upload failed", error);
    return fail(500, "unknown");
  }
}
```

- [ ] **Step 5: Validar**

Run: `npm run typecheck && npm run lint && npm run test:wa-cloud`
Expected: tudo verde; 4 avisos.

- [ ] **Step 6: Privacidade entre vendedores (Review Focus 4)**

Com o dev rodando e logado como `owner@metodoai.local` (número simulado da Task 10), abra no navegador `http://localhost:3000/api/inbox-oficial/conversations` e anote o `id` de uma conversa. Depois simule que o número pertence a outro vendedor:

```bash
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts move-owner to=outro-vendedor
```

Recarregue `http://localhost:3000/api/inbox-oficial/conversations` e `http://localhost:3000/api/inbox-oficial/messages?conversationId=<id anotado>`.
Expected: as duas respondem `[]`.

Desfaça:

```bash
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts move-owner to=owner@metodoai.local
```

E confira que empresa fora da lista recebe 404: tire a linha `WHATSAPP_CLOUD_ORG_IDS` do `.env`, reinicie o dev, abra `http://localhost:3000/api/inbox-oficial/conversations` → `Not found` (404). Recoloque a linha.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp-cloud/send.ts src/app/actions/inbox-oficial.ts src/app/api/inbox-oficial
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona envio de texto, anexo, modelo e reacao

O que:
- send.ts: envio a Meta (marca o numero em erro quando e o caso), gravacao
  da mensagem enviada e conversa por telefone.
- Actions: texto (so com janela aberta, checada no servidor), modelo,
  reacao, lido, nova conversa, busca de contatos, dados para variaveis.
- Rotas /api/inbox-oficial: conversas, mensagens, midia sob demanda e
  upload (tipo conferido pelos bytes).

Por que:
- Nucleo do atendimento pela API oficial (spec secao 7.4).

Impacto:
- Rotas novas, todas com sessao + liberacao + dono do numero. Guia 05 ja
  cobre o padrao (getOrgContext).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: Textos da tela e componentes de configuração, modelo e nova conversa

**Files:**
- Modify: `src/messages/pt.json`, `src/messages/en.json` (namespace `inboxOficial`)
- Create: `src/components/inbox-oficial/types.ts`, `modal.tsx`, `number-settings.tsx`, `template-picker.tsx`, `new-conversation-dialog.tsx`

**Interfaces:**
- Consumes: actions das Tasks 9 e 11; `CloudTemplateOption`, `renderTemplateText`, `suggestValues` (Task 4).
- Produces:
  - `type ConversationItem`, `type MessageItem`, `type Reaction`, `displayName(c: ConversationItem): string`, `initials(name: string): string`, `reactionsOf(v: unknown): Reaction[]` (em `types.ts`)
  - `Modal({ open, onClose, title, closeLabel, children })`
  - `type NumberView`, `type TemplateView`, `NumberSettings({ number: NumberView | null; templates: TemplateView[] })`
  - `TemplatePicker({ open, onClose, templates: CloudTemplateOption[], conversationId: string, onSent: () => void })`
  - `NewConversationDialog({ open, onClose, onStarted: (conversationId: string) => void })`

- [ ] **Step 1: Textos em pt**

Em `src/messages/pt.json`, adicione um namespace de primeiro nível `inboxOficial` (por exemplo logo depois do bloco `"inbox": { ... }` de primeiro nível — cuidado para não confundir com `app.nav.inbox`):

```json
  "inboxOficial": {
    "title": "Conversas (Oficial)",
    "subtitle": "WhatsApp pela API oficial da Meta.",
    "manageNumber": "Número oficial",
    "backToConversations": "Voltar às conversas",
    "numberError": "Seu número oficial está com erro: {error}",
    "numberInactive": "Seu número oficial está desconectado.",
    "fixInSettings": "Abrir configurações",
    "close": "Fechar",
    "connect": {
      "title": "Conectar número oficial",
      "intro": "Copie os dados do painel da Meta (WhatsApp → Configuração da API).",
      "phoneNumberId": "Phone Number ID",
      "wabaId": "WABA ID (conta do WhatsApp Business)",
      "token": "Token de acesso",
      "tokenHint": "Use o token permanente de um Usuário do Sistema. O token da tela Configuração da API expira em 24h.",
      "pin": "PIN da verificação em duas etapas (opcional)",
      "pinHint": "Só para registrar um número real. Não é guardado.",
      "submit": "Conectar",
      "submitting": "Conectando…"
    },
    "number": {
      "title": "Número oficial",
      "status": {
        "ACTIVE": "Ativo",
        "INACTIVE": "Desconectado",
        "ERROR": "Com erro"
      },
      "quality": "Qualidade: {quality}",
      "newToken": "Trocar token",
      "newTokenHint": "Cole um token novo para substituir o atual.",
      "saveToken": "Salvar token",
      "refresh": "Atualizar dados",
      "disconnect": "Desconectar",
      "disconnectConfirm": "Desconectar este número? As conversas ficam guardadas, mas nada é enviado nem recebido até reconectar.",
      "remove": "Remover número",
      "removeConfirm": "Remover este número apaga todas as conversas, mensagens e mídias dele no MétodoAI. Continuar?",
      "done": "Pronto."
    },
    "templates": {
      "title": "Modelos de mensagem",
      "hint": "Crie e edite modelos no WhatsApp Manager da Meta; aqui eles são sincronizados.",
      "sync": "Sincronizar modelos",
      "synced": "{count} modelos sincronizados.",
      "empty": "Nenhum modelo sincronizado ainda.",
      "reason": "Motivo: {reason}"
    },
    "inbox": {
      "search": "Buscar",
      "newConversation": "Nova conversa",
      "noConversations": "Nenhuma conversa ainda.",
      "selectConversation": "Selecione uma conversa",
      "noMessages": "Sem mensagens.",
      "placeholder": "Escreva uma mensagem",
      "send": "Enviar",
      "attach": "Anexar arquivo",
      "sendTemplate": "Enviar modelo",
      "replyingTo": "Respondendo",
      "cancelReply": "Cancelar resposta",
      "cancel": "Cancelar",
      "react": "Reagir",
      "reply": "Responder",
      "failed": "Falhou",
      "windowOpen": "Janela aberta · fecha em {time}",
      "windowClosed": "Janela de 24h fechada — envie um modelo aprovado para retomar.",
      "windowClosedHint": "Fora da janela de 24h só é possível enviar modelo aprovado.",
      "captionPlaceholder": "Legenda (opcional)",
      "templateBadge": "Modelo",
      "unsupportedMessage": "Mensagem não suportada",
      "media": "Mídia",
      "back": "Voltar"
    },
    "picker": {
      "title": "Enviar modelo aprovado",
      "choose": "Escolha um modelo",
      "none": "Nenhum modelo aprovado. Sincronize na engrenagem.",
      "variable": "Variável {name} ({part})",
      "part": {
        "header": "cabeçalho",
        "body": "corpo"
      },
      "preview": "Prévia",
      "send": "Enviar modelo",
      "unsupported": {
        "media_header": "cabeçalho com mídia (ainda não suportado)",
        "location_header": "cabeçalho de localização (ainda não suportado)",
        "button_variable": "botão com variável (ainda não suportado)"
      }
    },
    "newChat": {
      "title": "Nova conversa",
      "hint": "A primeira mensagem precisa ser um modelo aprovado.",
      "searchContact": "Buscar contato do CRM",
      "orPhone": "ou digite o número",
      "phonePlaceholder": "(11) 91234-5678",
      "start": "Começar",
      "invalid": "Número inválido para WhatsApp."
    },
    "errors": {
      "unauthorized": "Sessão expirada. Entre de novo.",
      "not_enabled": "A tela oficial não está liberada para esta empresa.",
      "invalid": "Dados inválidos. Confira os campos.",
      "number_exists": "Você já tem outro número oficial. Remova-o antes.",
      "phone_in_use": "Este número já está conectado em outra conta.",
      "limit": "Limite de números de WhatsApp da empresa atingido.",
      "not_found": "Não encontrado.",
      "meta_error": "A Meta recusou: {detail}",
      "unknown": "Algo deu errado. Tente de novo.",
      "no_number": "Seu número oficial não está ativo.",
      "empty": "Escreva uma mensagem.",
      "window_closed": "Janela de 24h fechada. Envie um modelo aprovado.",
      "undeliverable": "Este número não recebe WhatsApp.",
      "rate_limited": "A Meta limitou a velocidade. Tente em instantes.",
      "pair_rate_limited": "Muitas mensagens seguidas para este contato. Aguarde alguns segundos.",
      "marketing_opt_out": "O contato optou por não receber marketing.",
      "marketing_limited": "A Meta limitou mensagens de marketing para este contato.",
      "template_paused": "Modelo pausado pela Meta.",
      "template_disabled": "Modelo desativado pela Meta.",
      "token_invalid": "Token inválido ou sem permissão. Atualize na engrenagem.",
      "not_registered": "Número não registrado na Meta. Informe o PIN na engrenagem.",
      "account_restricted": "Conta do WhatsApp restrita pela Meta.",
      "invalid_params": "A Meta recusou os dados da mensagem: {detail}",
      "unsupported_type": "Formato não aceito pela Meta (use JPG, PNG, MP4, MP3, M4A, OGG, AAC, AMR, PDF, Office ou TXT).",
      "too_large": "Arquivo acima do limite da Meta para esse tipo.",
      "file_empty": "Arquivo vazio."
    }
  },
```

- [ ] **Step 2: Textos em en (mesmas chaves)**

Em `src/messages/en.json`, no mesmo lugar:

```json
  "inboxOficial": {
    "title": "Inbox (Official)",
    "subtitle": "WhatsApp through Meta's official API.",
    "manageNumber": "Official number",
    "backToConversations": "Back to chats",
    "numberError": "Your official number has an error: {error}",
    "numberInactive": "Your official number is disconnected.",
    "fixInSettings": "Open settings",
    "close": "Close",
    "connect": {
      "title": "Connect official number",
      "intro": "Copy the details from Meta's dashboard (WhatsApp → API Setup).",
      "phoneNumberId": "Phone Number ID",
      "wabaId": "WABA ID (WhatsApp Business account)",
      "token": "Access token",
      "tokenHint": "Use a System User's permanent token. The API Setup token expires in 24h.",
      "pin": "Two-step verification PIN (optional)",
      "pinHint": "Only needed to register a real number. Not stored.",
      "submit": "Connect",
      "submitting": "Connecting…"
    },
    "number": {
      "title": "Official number",
      "status": {
        "ACTIVE": "Active",
        "INACTIVE": "Disconnected",
        "ERROR": "Error"
      },
      "quality": "Quality: {quality}",
      "newToken": "Replace token",
      "newTokenHint": "Paste a new token to replace the current one.",
      "saveToken": "Save token",
      "refresh": "Refresh details",
      "disconnect": "Disconnect",
      "disconnectConfirm": "Disconnect this number? Chats are kept, but nothing is sent or received until you reconnect.",
      "remove": "Remove number",
      "removeConfirm": "Removing this number deletes all its chats, messages and media in MétodoAI. Continue?",
      "done": "Done."
    },
    "templates": {
      "title": "Message templates",
      "hint": "Create and edit templates in Meta's WhatsApp Manager; they are synced here.",
      "sync": "Sync templates",
      "synced": "{count} templates synced.",
      "empty": "No templates synced yet.",
      "reason": "Reason: {reason}"
    },
    "inbox": {
      "search": "Search",
      "newConversation": "New chat",
      "noConversations": "No chats yet.",
      "selectConversation": "Select a chat",
      "noMessages": "No messages.",
      "placeholder": "Type a message",
      "send": "Send",
      "attach": "Attach file",
      "sendTemplate": "Send template",
      "replyingTo": "Replying",
      "cancelReply": "Cancel reply",
      "cancel": "Cancel",
      "react": "React",
      "reply": "Reply",
      "failed": "Failed",
      "windowOpen": "Window open · closes in {time}",
      "windowClosed": "24h window closed — send an approved template to resume.",
      "windowClosedHint": "Outside the 24h window only approved templates can be sent.",
      "captionPlaceholder": "Caption (optional)",
      "templateBadge": "Template",
      "unsupportedMessage": "Unsupported message",
      "media": "Media",
      "back": "Back"
    },
    "picker": {
      "title": "Send approved template",
      "choose": "Choose a template",
      "none": "No approved templates. Sync them in settings.",
      "variable": "Variable {name} ({part})",
      "part": {
        "header": "header",
        "body": "body"
      },
      "preview": "Preview",
      "send": "Send template",
      "unsupported": {
        "media_header": "media header (not supported yet)",
        "location_header": "location header (not supported yet)",
        "button_variable": "button with variable (not supported yet)"
      }
    },
    "newChat": {
      "title": "New chat",
      "hint": "The first message must be an approved template.",
      "searchContact": "Search CRM contact",
      "orPhone": "or type the number",
      "phonePlaceholder": "+55 11 91234-5678",
      "start": "Start",
      "invalid": "Invalid WhatsApp number."
    },
    "errors": {
      "unauthorized": "Session expired. Sign in again.",
      "not_enabled": "The official inbox isn't enabled for this company.",
      "invalid": "Invalid data. Check the fields.",
      "number_exists": "You already have another official number. Remove it first.",
      "phone_in_use": "This number is already connected to another account.",
      "limit": "The company's WhatsApp number limit was reached.",
      "not_found": "Not found.",
      "meta_error": "Meta refused: {detail}",
      "unknown": "Something went wrong. Try again.",
      "no_number": "Your official number isn't active.",
      "empty": "Type a message.",
      "window_closed": "24h window closed. Send an approved template.",
      "undeliverable": "This number can't receive WhatsApp.",
      "rate_limited": "Meta throttled sending. Try again shortly.",
      "pair_rate_limited": "Too many messages to this contact in a row. Wait a few seconds.",
      "marketing_opt_out": "The contact opted out of marketing.",
      "marketing_limited": "Meta limited marketing messages to this contact.",
      "template_paused": "Template paused by Meta.",
      "template_disabled": "Template disabled by Meta.",
      "token_invalid": "Invalid token or missing permission. Update it in settings.",
      "not_registered": "Number not registered with Meta. Enter the PIN in settings.",
      "account_restricted": "WhatsApp account restricted by Meta.",
      "invalid_params": "Meta refused the message data: {detail}",
      "unsupported_type": "Format not accepted by Meta (use JPG, PNG, MP4, MP3, M4A, OGG, AAC, AMR, PDF, Office or TXT).",
      "too_large": "File exceeds Meta's limit for this type.",
      "file_empty": "Empty file."
    }
  },
```

- [ ] **Step 3: Conferir a paridade**

Run:

```bash
node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p+k+'.'):[p+k]);const a=new Set(f(require('./src/messages/pt.json'))),b=new Set(f(require('./src/messages/en.json')));console.log(a.size,b.size,[...a].filter(k=>!b.has(k)),[...b].filter(k=>!a.has(k)))"
```

Expected: os dois números iguais e as duas listas vazias `[] []`.

- [ ] **Step 4: `types.ts`**

`src/components/inbox-oficial/types.ts`:

```ts
/**
 * Formas que a tela oficial recebe do servidor. Datas chegam como Date na
 * primeira renderização (RSC) e como string no polling (JSON) — por isso
 * `string | Date`.
 */
export type ConversationItem = {
  id: string;
  waId: string | null;
  bsuid: string | null;
  username: string | null;
  profileName: string | null;
  contactId: string | null;
  contactName: string | null;
  lastInboundAt: string | Date | null;
  lastMessageAt: string | Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
};

export type MessageItem = {
  id: string;
  wamid: string | null;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  templateName: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  mediaStatus: string | null;
  status: string | null;
  errorMessage: string | null;
  reactions: unknown;
  quotedWamid: string | null;
  quotedBody: string | null;
  timestamp: string | Date;
};

export type Reaction = { emoji: string; fromMe: boolean };

export function displayName(c: ConversationItem): string {
  return c.contactName || c.profileName || (c.username ? `@${c.username}` : "") || (c.waId ? `+${c.waId}` : "") || "—";
}

export function initials(name: string): string {
  const parts = name.replace(/[@+]/g, "").trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function reactionsOf(v: unknown): Reaction[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (r): r is Reaction => !!r && typeof r === "object" && typeof (r as Reaction).emoji === "string",
  );
}
```

- [ ] **Step 5: `modal.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/** Janela sobreposta simples (Esc ou clique fora fecham). */
export function Modal({
  open,
  onClose,
  title,
  closeLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `number-settings.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, KeyRound, RefreshCw, Trash2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  connectCloudNumber,
  disconnectCloudNumber,
  refreshCloudNumber,
  removeCloudNumber,
  syncCloudTemplates,
  updateCloudNumberToken,
  type NumberActionResult,
} from "@/app/actions/inbox-oficial-number";

export type NumberView = {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  status: "ACTIVE" | "INACTIVE" | "ERROR";
  lastError: string | null;
};

export type TemplateView = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectedReason: string | null;
};

type Fail = Extract<NumberActionResult, { ok: false }>;

/** Engrenagem da tela oficial: conectar, trocar token, desconectar, remover e modelos. */
export function NumberSettings({ number, templates }: { number: NumberView | null; templates: TemplateView[] }) {
  const t = useTranslations("inboxOficial");
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState("");

  async function run(action: () => Promise<NumberActionResult>, success?: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await action();
      if (r.ok) {
        toast(success ?? (r.count !== undefined ? t("templates.synced", { count: r.count }) : t("number.done")));
        router.refresh();
      } else {
        setError(t(`errors.${(r as Fail).error}`, { detail: (r as Fail).detail ?? "" }));
      }
    } finally {
      setBusy(false);
    }
  }

  const showConnect = !number || number.status === "INACTIVE";

  return (
    <div className="flex w-full flex-col gap-6">
      {showConnect ? (
        <ConnectForm
          defaults={number}
          busy={busy}
          onSubmit={(v) => run(() => connectCloudNumber(v))}
        />
      ) : (
        <section className="glass rounded-2xl border border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <BadgeCheck className="size-5" />
              </span>
              <div>
                <p className="font-semibold">{number.verifiedName ?? t("number.title")}</p>
                <p className="text-sm text-muted-foreground">{number.displayPhoneNumber ?? number.phoneNumberId}</p>
              </div>
            </div>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                number.status === "ACTIVE"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
              )}
            >
              {t(`number.status.${number.status}`)}
            </span>
          </div>
          {number.qualityRating ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("number.quality", { quality: number.qualityRating })}</p>
          ) : null}
          {number.lastError ? <p className="mt-2 text-sm text-red-500">{number.lastError}</p> : null}

          <div className="mt-5 grid gap-2">
            <Label htmlFor="new-token">{t("number.newToken")}</Label>
            <p className="-mt-1 text-xs text-muted-foreground">{t("number.newTokenHint")}</p>
            <div className="flex gap-2">
              <Input
                id="new-token"
                type="password"
                autoComplete="off"
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto"
                disabled={busy || newToken.trim().length < 20}
                onClick={() => run(async () => {
                  const r = await updateCloudNumberToken(newToken);
                  if (r.ok) setNewToken("");
                  return r;
                })}
              >
                <KeyRound className="size-4" />
                {t("number.saveToken")}
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run(refreshCloudNumber)}>
              <RefreshCw className="size-4" />
              {t("number.refresh")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                if (await confirm({ description: t("number.disconnectConfirm") })) await run(disconnectCloudNumber);
              }}
            >
              <Unplug className="size-4" />
              {t("number.disconnect")}
            </Button>
          </div>
        </section>
      )}

      {number ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (await confirm({ description: t("number.removeConfirm"), variant: "danger" })) await run(removeCloudNumber);
            }}
          >
            <Trash2 className="size-4" />
            {t("number.remove")}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      ) : null}

      {number ? (
        <section className="glass rounded-2xl border border-border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{t("templates.title")}</h2>
              <p className="text-xs text-muted-foreground">{t("templates.hint")}</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={busy || number.status !== "ACTIVE"} onClick={() => run(syncCloudTemplates)}>
              <RefreshCw className="size-4" />
              {t("templates.sync")}
            </Button>
          </div>
          {templates.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("templates.empty")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {templates.map((tpl) => (
                <li key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium">{tpl.name}</span>{" "}
                    <span className="text-muted-foreground">
                      {tpl.language} · {tpl.category}
                    </span>
                    {tpl.rejectedReason ? (
                      <span className="block text-xs text-red-500">{t("templates.reason", { reason: tpl.rejectedReason })}</span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      tpl.status === "APPROVED" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {tpl.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ConnectForm({
  defaults,
  busy,
  onSubmit,
}: {
  defaults: NumberView | null;
  busy: boolean;
  onSubmit: (v: { phoneNumberId: string; wabaId: string; accessToken: string; pin: string }) => void;
}) {
  const t = useTranslations("inboxOficial.connect");
  const [phoneNumberId, setPhoneNumberId] = useState(defaults?.phoneNumberId ?? "");
  const [wabaId, setWabaId] = useState(defaults?.wabaId ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [pin, setPin] = useState("");

  return (
    <form
      className="glass flex flex-col gap-4 rounded-2xl border border-border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ phoneNumberId: phoneNumberId.trim(), wabaId: wabaId.trim(), accessToken: accessToken.trim(), pin: pin.trim() });
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pnid">{t("phoneNumberId")}</Label>
          <Input id="pnid" inputMode="numeric" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="waba">{t("wabaId")}</Label>
          <Input id="waba" inputMode="numeric" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="token">{t("token")}</Label>
        <Input id="token" type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
        <p className="mt-1 text-xs text-muted-foreground">{t("tokenHint")}</p>
      </div>
      <div className="sm:max-w-xs">
        <Label htmlFor="pin">{t("pin")}</Label>
        <Input id="pin" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} />
        <p className="mt-1 text-xs text-muted-foreground">{t("pinHint")}</p>
      </div>
      <div>
        <Button type="submit" disabled={busy || !phoneNumberId.trim() || !wabaId.trim() || !accessToken.trim()}>
          {busy ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 7: `template-picker.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import {
  renderTemplateText,
  suggestValues,
  type CloudTemplateOption,
  type ParamContext,
} from "@/lib/whatsapp-cloud/template-params";
import { cloudContactParams, sendCloudTemplate } from "@/app/actions/inbox-oficial";
import { Modal } from "./modal";

const EMPTY: ParamContext = { nome: "", empresa: "" };

/** Escolher um modelo aprovado, preencher as variáveis, ver a prévia e enviar. */
export function TemplatePicker({
  open,
  onClose,
  templates,
  conversationId,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  templates: CloudTemplateOption[];
  conversationId: string;
  onSent: () => void;
}) {
  const t = useTranslations("inboxOficial.picker");
  const tr = useTranslations("inboxOficial");
  const toast = useToast();
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [params, setParams] = useState<ParamContext | null>(null);
  const [sending, setSending] = useState(false);
  const selected = templates.find((x) => x.id === templateId) ?? null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    void cloudContactParams(conversationId).then((p) => {
      if (active) setParams(p ?? EMPTY);
    });
    return () => {
      active = false;
    };
  }, [open, conversationId]);

  function choose(id: string) {
    setTemplateId(id);
    const opt = templates.find((x) => x.id === id);
    setValues(opt ? suggestValues(opt.variables, params ?? EMPTY) : {});
  }

  const preview = useMemo(() => {
    if (!selected) return "";
    const shown = Object.fromEntries(selected.variables.map((v) => [v.id, values[v.id]?.trim() || `{{${v.key}}}`]));
    return renderTemplateText(selected.def, shown);
  }, [selected, values]);

  async function send() {
    if (!selected) return;
    setSending(true);
    try {
      const r = await sendCloudTemplate(conversationId, selected.id, values);
      if (r.ok) {
        setTemplateId("");
        setValues({});
        onSent();
      } else {
        toast(tr(`errors.${r.error}`, { detail: r.detail ?? "" }), { variant: "error" });
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("title")} closeLabel={tr("close")}>
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="tpl">{t("choose")}</Label>
            <select
              id="tpl"
              value={templateId}
              onChange={(e) => choose(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm focus-visible:border-brand focus-visible:outline-none"
            >
              <option value="">{t("choose")}</option>
              {templates.map((o) => (
                <option key={o.id} value={o.id} disabled={o.unsupported !== null}>
                  {o.name} ({o.language}){o.unsupported ? ` — ${t(`unsupported.${o.unsupported}`)}` : ""}
                </option>
              ))}
            </select>
          </div>
          {selected && selected.variables.length > 0 ? (
            <div className="grid gap-3">
              {selected.variables.map((v) => (
                <div key={v.id}>
                  <Label htmlFor={`var-${v.id}`}>{t("variable", { name: v.key, part: t(`part.${v.component}`) })}</Label>
                  <Input
                    id={`var-${v.id}`}
                    value={values[v.id] ?? ""}
                    maxLength={1000}
                    onChange={(e) => setValues((s) => ({ ...s, [v.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ) : null}
          {selected ? (
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("preview")}</p>
              <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{preview}</p>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button type="button" onClick={send} disabled={!selected || sending}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("send")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 8: `new-conversation-dialog.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { searchCloudContacts, startCloudConversation } from "@/app/actions/inbox-oficial";
import { Modal } from "./modal";

type ContactHit = { id: string; name: string; phone: string | null };

/** Nova conversa por contato do CRM ou número digitado. */
export function NewConversationDialog({
  open,
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: (conversationId: string) => void;
}) {
  const t = useTranslations("inboxOficial.newChat");
  const tr = useTranslations("inboxOficial");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ContactHit[]>([]);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Busca com atraso; todo setState acontece dentro do timeout, nunca direto no efeito.
  useEffect(() => {
    let active = true;
    const id = setTimeout(async () => {
      const hits = q.trim().length >= 2 ? await searchCloudContacts(q) : [];
      if (active) setResults(hits);
    }, 300);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [q]);

  async function start(input: { phone?: string; contactId?: string }) {
    setBusy(true);
    setError(null);
    try {
      const r = await startCloudConversation(input);
      if (r.ok) {
        setQ("");
        setPhone("");
        onStarted(r.conversationId);
      } else {
        setError(r.error === "invalid" ? t("invalid") : tr(`errors.${r.error}`, { detail: "" }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("title")} closeLabel={tr("close")}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        <div>
          <Label htmlFor="nc-q">{t("searchContact")}</Label>
          <Input id="nc-q" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
          {results.length > 0 ? (
            <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => start({ contactId: c.id })}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <UserRound className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div>
          <Label htmlFor="nc-phone">{t("orPhone")}</Label>
          <div className="flex gap-2">
            <Input
              id="nc-phone"
              inputMode="tel"
              value={phone}
              placeholder={t("phonePlaceholder")}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Button
              type="button"
              className="h-auto"
              disabled={busy || phone.replace(/\D/g, "").length < 10}
              onClick={() => start({ phone })}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("start")}
            </Button>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 9: Validar**

Run: `npm run typecheck && npm run lint && npm run test:wa-cloud`
Expected: tudo verde; lint com os mesmos 4 avisos (se algum aviso novo apontar para `src/components/inbox-oficial/`, corrija antes de seguir).

- [ ] **Step 10: Commit**

```bash
git add src/messages/pt.json src/messages/en.json src/components/inbox-oficial
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona textos e componentes de configuracao e modelos

O que:
- Namespace inboxOficial (pt/en, mesmas chaves).
- Componentes: configuracao do numero (conectar, token, desconectar,
  remover, modelos), seletor de modelo com previa, nova conversa, modal.

Por que:
- Partes da tela oficial que nao dependem da caixa de conversas
  (spec secoes 7.1, 7.4 e 7.5).

Impacto:
- Ainda sem rota que os use (a pagina entra na Task 13).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: Caixa de conversas e página `/app/inbox-oficial`

**Files:**
- Create: `src/components/inbox-oficial/conversation-list.tsx`, `message-thread.tsx`, `window-banner.tsx`, `composer.tsx`, `cloud-inbox.tsx`
- Create: `src/app/[locale]/app/inbox-oficial/page.tsx`

**Interfaces:**
- Consumes: Task 12 (tipos, `Modal`, `NumberSettings`, `TemplatePicker`, `NewConversationDialog`), actions da Task 11, rotas da Task 11, `MessageMedia`/`MEDIA_TYPES` (existentes em `src/components/inbox/message-media.tsx`), queries da Task 9, `toTemplateOption` (Task 4), `isWhatsappCloudEnabled` (Task 7).
- Produces: `CloudInbox({ initial: ConversationItem[]; initialSelectedId: string | null; templates: CloudTemplateOption[]; numberProblem: { status: "INACTIVE" | "ERROR"; error: string | null } | null })`; a página.

- [ ] **Step 1: `conversation-list.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { displayName, initials, type ConversationItem } from "./types";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onNew,
  className,
}: {
  conversations: ConversationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  className?: string;
}) {
  const t = useTranslations("inboxOficial.inbox");
  const format = useFormatter();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) => displayName(c).toLowerCase().includes(term) || (c.waId ?? "").includes(term));
  }, [q, conversations]);

  return (
    <aside className={cn("w-full shrink-0 flex-col border-r border-border sm:w-80", className)}>
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm focus-visible:border-brand focus-visible:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onNew}
          title={t("newConversation")}
          aria-label={t("newConversation")}
          className="flex size-9 items-center justify-center rounded-lg bg-brand text-brand-foreground hover:opacity-90"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">{t("noConversations")}</li>
        ) : (
          filtered.map((c) => {
            const name = displayName(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                    c.id === selectedId && "bg-brand/10",
                  )}
                >
                  <Avatar name={name} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{name}</span>
                      {c.lastMessageAt ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {format.dateTime(new Date(c.lastMessageAt), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? ""}</span>
                      {c.unreadCount > 0 ? (
                        <span className="shrink-0 rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-foreground">
                          {c.unreadCount}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2: `message-thread.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AlertCircle, Check, CheckCheck, Clock, CornerUpLeft, MapPin, SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageMedia, MEDIA_TYPES } from "@/components/inbox/message-media";
import { reactionsOf, type MessageItem } from "./types";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export function MessageThread({
  messages,
  onReply,
  onReact,
}: {
  messages: MessageItem[];
  onReply: (m: MessageItem) => void;
  onReact: (m: MessageItem, emoji: string) => void;
}) {
  const t = useTranslations("inboxOficial.inbox");
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;

  // Rola para o fim quando chega uma mensagem nova (ou ao abrir a conversa).
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-muted/20 text-sm text-muted-foreground">
        {t("noMessages")}
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-muted/20 p-4">
      {messages.map((m) => (
        <Bubble key={m.id} m={m} onReply={onReply} onReact={onReact} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function Bubble({
  m,
  onReply,
  onReact,
}: {
  m: MessageItem;
  onReply: (m: MessageItem) => void;
  onReact: (m: MessageItem, emoji: string) => void;
}) {
  const t = useTranslations("inboxOficial.inbox");
  const format = useFormatter();
  const [picking, setPicking] = useState(false);
  const out = m.direction === "OUTBOUND";
  const failed = m.status === "FAILED";
  const isMedia = MEDIA_TYPES.has(m.type);
  const reactions = reactionsOf(m.reactions);

  return (
    <div className={cn("group/msg flex max-w-[80%] flex-col gap-1", out ? "items-end self-end" : "items-start self-start")}>
      <div
        className={cn(
          "text-sm",
          m.type === "STICKER"
            ? null
            : cn(
                "rounded-2xl px-3 py-2 shadow-sm",
                out
                  ? failed
                    ? "border border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
                    : "bg-brand text-brand-foreground"
                  : "bg-card",
              ),
        )}
      >
        {m.type === "TEMPLATE" ? (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
            {t("templateBadge")}
            {m.templateName ? ` · ${m.templateName}` : ""}
          </p>
        ) : null}
        {m.quotedBody ? (
          <div
            className={cn(
              "mb-1 rounded-md border-l-2 px-2 py-1 text-xs",
              out ? "border-brand-foreground/50 bg-black/10" : "border-brand/60 bg-muted",
            )}
          >
            <p className="line-clamp-2 opacity-80">{m.quotedBody}</p>
          </div>
        ) : null}
        {isMedia ? <MessageMedia m={m} out={out} /> : null}
        {m.type === "LOCATION" ? (
          <p className="flex items-center gap-1.5">
            <MapPin className="size-4 shrink-0" />
            {m.body}
          </p>
        ) : m.type === "UNSUPPORTED" ? (
          <p className="italic opacity-70">{t("unsupportedMessage")}</p>
        ) : m.body ? (
          <p className={cn("whitespace-pre-wrap break-words", isMedia && "mt-1")}>{m.body}</p>
        ) : null}
        <p className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", out ? "opacity-80" : "text-muted-foreground")}>
          {format.dateTime(new Date(m.timestamp), { hour: "2-digit", minute: "2-digit" })}
          {out ? <StatusIcon status={m.status} error={m.errorMessage} failedLabel={t("failed")} /> : null}
        </p>
      </div>
      {reactions.length > 0 ? (
        <div className="-mt-2 flex gap-0.5 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs shadow-sm">
          {reactions.map((r, i) => (
            <span key={`${r.emoji}-${i}`}>{r.emoji}</span>
          ))}
        </div>
      ) : null}
      <div className="flex gap-1 transition-opacity sm:opacity-0 sm:group-hover/msg:opacity-100">
        <button
          type="button"
          onClick={() => onReply(m)}
          title={t("reply")}
          aria-label={t("reply")}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <CornerUpLeft className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          title={t("react")}
          aria-label={t("react")}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <SmilePlus className="size-3.5" />
        </button>
        {picking
          ? QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setPicking(false);
                  onReact(m, emoji);
                }}
                className="rounded px-1 text-sm hover:bg-muted"
              >
                {emoji}
              </button>
            ))
          : null}
      </div>
    </div>
  );
}

function StatusIcon({ status, error, failedLabel }: { status: string | null; error: string | null; failedLabel: string }) {
  if (status === "FAILED") {
    return (
      <span title={error ?? failedLabel} className="flex items-center gap-0.5">
        <AlertCircle className="size-3" />
        {failedLabel}
      </span>
    );
  }
  if (status === "READ") return <CheckCheck className="size-3.5 text-sky-300" />;
  if (status === "DELIVERED") return <CheckCheck className="size-3.5" />;
  if (status === "SENT") return <Check className="size-3.5" />;
  return <Clock className="size-3" />;
}
```

- [ ] **Step 3: `window-banner.tsx`**

```tsx
"use client";

import { useTranslations } from "next-intl";
import { Clock, Lock } from "lucide-react";
import { windowClosesAt } from "@/lib/whatsapp-cloud/window";

/** Faixa da janela de 24h. `now` vem de um relógio do pai (render puro, sem Date.now()). */
export function WindowBanner({ lastInboundAt, now }: { lastInboundAt: string | Date | null; now: number | null }) {
  const t = useTranslations("inboxOficial.inbox");
  if (now === null) return null;
  const closes = windowClosesAt(lastInboundAt);
  const left = closes ? closes.getTime() - now : 0;
  if (left <= 0) {
    return (
      <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
        <Lock className="size-3.5 shrink-0" />
        {t("windowClosed")}
      </div>
    );
  }
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      <Clock className="size-3.5 shrink-0" />
      {t("windowOpen", { time: `${hours}h${String(minutes).padStart(2, "0")}` })}
    </div>
  );
}
```

- [ ] **Step 4: `composer.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileUp, LayoutTemplate, Loader2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MessageItem } from "./types";

/** Tipos que o seletor de arquivo oferece — a regra de verdade é a do servidor (media-rules). */
const ACCEPT = [
  "image/jpeg",
  "image/png",
  "video/mp4",
  "video/3gpp",
  "audio/aac",
  "audio/amr",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
].join(",");

export function Composer({
  windowOpen,
  replyTo,
  onCancelReply,
  onSendText,
  onSendFile,
  onOpenTemplates,
}: {
  windowOpen: boolean;
  replyTo: MessageItem | null;
  onCancelReply: () => void;
  onSendText: (text: string) => Promise<boolean>;
  onSendFile: (file: File, caption: string) => Promise<boolean>;
  onOpenTemplates: () => void;
}) {
  const t = useTranslations("inboxOficial.inbox");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submitText() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      if (await onSendText(value)) setText("");
    } finally {
      setSending(false);
    }
  }

  async function submitFile() {
    if (!file || sending) return;
    setSending(true);
    try {
      if (await onSendFile(file, caption.trim())) {
        setFile(null);
        setCaption("");
      }
    } finally {
      setSending(false);
    }
  }

  if (!windowOpen) {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-border p-3">
        <p className="text-xs text-muted-foreground">{t("windowClosedHint")}</p>
        <Button type="button" size="sm" onClick={onOpenTemplates}>
          <LayoutTemplate className="size-4" />
          {t("sendTemplate")}
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t border-border p-3">
      {replyTo ? (
        <div className="mb-2 flex items-start justify-between gap-2 rounded-lg border-l-2 border-brand bg-muted/60 px-3 py-1.5 text-xs">
          <p className="line-clamp-2">
            <span className="font-semibold">{t("replyingTo")}: </span>
            {replyTo.body ?? t("media")}
          </p>
          <button type="button" onClick={onCancelReply} aria-label={t("cancelReply")} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {file ? (
        <div className="flex items-center gap-2">
          <FileUp className="size-4 shrink-0 text-muted-foreground" />
          <span className="max-w-[40%] truncate text-sm">{file.name}</span>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={t("captionPlaceholder")}
            maxLength={1024}
            className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setCaption("");
            }}
            aria-label={t("cancel")}
            className="rounded p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
          <Button type="button" size="sm" onClick={submitFile} disabled={sending} aria-label={t("send")}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title={t("attach")}
            aria-label={t("attach")}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <Paperclip className="size-5" />
          </button>
          <button
            type="button"
            onClick={onOpenTemplates}
            title={t("sendTemplate")}
            aria-label={t("sendTemplate")}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <LayoutTemplate className="size-5" />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitText();
              }
            }}
            rows={1}
            maxLength={4096}
            placeholder={t("placeholder")}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
          />
          <Button type="button" size="sm" onClick={submitText} disabled={sending || !text.trim()} aria-label={t("send")}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `cloud-inbox.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, MessageCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { isWindowOpen } from "@/lib/whatsapp-cloud/window";
import type { CloudTemplateOption } from "@/lib/whatsapp-cloud/template-params";
import {
  markCloudConversationRead,
  reactCloudMessage,
  sendCloudText,
  type CloudActionResult,
} from "@/app/actions/inbox-oficial";
import { Avatar, ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { WindowBanner } from "./window-banner";
import { TemplatePicker } from "./template-picker";
import { NewConversationDialog } from "./new-conversation-dialog";
import { displayName, type ConversationItem, type MessageItem } from "./types";

const LIST_POLL_MS = 10_000;
const THREAD_POLL_MS = 4_000;
const CLOCK_MS = 30_000;
/** Mídia recebida ainda pendente depois disso é pedida sob demanda. */
const MEDIA_GRACE_MS = 15_000;

type Fail = Extract<CloudActionResult, { ok: false }>;

export function CloudInbox({
  initial,
  initialSelectedId,
  templates,
  numberProblem,
}: {
  initial: ConversationItem[];
  initialSelectedId: string | null;
  templates: CloudTemplateOption[];
  numberProblem: { status: "INACTIVE" | "ERROR"; error: string | null } | null;
}) {
  const t = useTranslations("inboxOficial");
  const toast = useToast();
  const [conversations, setConversations] = useState<ConversationItem[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const selectedRef = useRef<string | null>(initialSelectedId);
  const mediaTried = useRef(new Set<string>());

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const windowOpen = now !== null && !!selected && isWindowOpen(selected.lastInboundAt, new Date(now));
  const failText = useCallback((r: Fail) => t(`errors.${r.error}`, { detail: r.detail ?? "" }), [t]);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox-oficial/conversations", { cache: "no-store" });
      if (r.ok) setConversations((await r.json()) as ConversationItem[]);
    } catch {
      /* offline: tenta no próximo ciclo */
    }
  }, []);

  /** Pede sob demanda a mídia que continua pendente (ou falhou) — uma vez por mensagem. */
  const repairMedia = useCallback(async (list: MessageItem[]) => {
    const due = list.filter(
      (m) =>
        m.direction === "INBOUND" &&
        (m.mediaStatus === "FAILED" ||
          (m.mediaStatus === "PENDING" && Date.now() - new Date(m.timestamp).getTime() > MEDIA_GRACE_MS)) &&
        !mediaTried.current.has(m.id),
    );
    for (const m of due) {
      mediaTried.current.add(m.id);
      try {
        const r = await fetch("/api/inbox-oficial/media/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: m.id }),
        });
        if (!r.ok) continue;
        const media = (await r.json()) as Partial<MessageItem> | null;
        if (media) setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...media } : x)));
      } catch {
        /* fica para a próxima visita */
      }
    }
  }, []);

  const loadMessages = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/inbox-oficial/messages?conversationId=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!r.ok || selectedRef.current !== id) return;
        const data = (await r.json()) as MessageItem[];
        if (selectedRef.current !== id) return;
        setMessages(data);
        void repairMedia(data);
      } catch {
        /* offline */
      }
    },
    [repairMedia],
  );

  // Relógio da janela de 24h (setState só dentro dos timers).
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, CLOCK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => void loadConversations(), LIST_POLL_MS);
    return () => clearInterval(id);
  }, [loadConversations]);

  // Conversa aberta: carrega, marca como lida e atualiza periodicamente.
  useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId);
    void markCloudConversationRead(selectedId).then(() => loadConversations());
    const id = setInterval(() => void loadMessages(selectedId), THREAD_POLL_MS);
    return () => clearInterval(id);
  }, [selectedId, loadMessages, loadConversations]);

  function select(id: string | null) {
    setSelectedId(id);
    setMessages([]);
    setReplyTo(null);
  }

  async function sendText(text: string): Promise<boolean> {
    if (!selectedId) return false;
    const r = await sendCloudText(selectedId, text, replyTo?.id ?? null);
    if (!r.ok) {
      toast(failText(r), { variant: "error" });
      if (r.error === "window_closed") setPickerOpen(true);
      return false;
    }
    setReplyTo(null);
    await loadMessages(selectedId);
    void loadConversations();
    return true;
  }

  async function sendFile(file: File, caption: string): Promise<boolean> {
    if (!selectedId) return false;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("conversationId", selectedId);
    fd.append("caption", caption);
    const r = await fetch("/api/inbox-oficial/media/upload", { method: "POST", body: fd });
    const data = (await r.json().catch(() => ({ ok: false, error: "unknown" }))) as {
      ok: boolean;
      error?: string;
      detail?: string;
    };
    if (!data.ok) {
      toast(t(`errors.${data.error ?? "unknown"}`, { detail: data.detail ?? "" }), { variant: "error" });
      return false;
    }
    await loadMessages(selectedId);
    void loadConversations();
    return true;
  }

  async function react(m: MessageItem, emoji: string) {
    const r = await reactCloudMessage(m.id, emoji);
    if (!r.ok) toast(failText(r), { variant: "error" });
    else if (selectedId) await loadMessages(selectedId);
  }

  return (
    <div className="glass flex h-full overflow-hidden rounded-2xl border border-border shadow-sm">
      <ConversationList
        conversations={conversations}
        selectedId={selectedId}
        onSelect={select}
        onNew={() => setNewOpen(true)}
        className={selectedId ? "hidden sm:flex" : "flex"}
      />
      <section className={cn("min-w-0 flex-1 flex-col", selectedId ? "flex" : "hidden sm:flex")}>
        {numberProblem ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            {numberProblem.status === "INACTIVE"
              ? t("numberInactive")
              : t("numberError", { error: numberProblem.error ?? "" })}
            <Link href="/app/inbox-oficial?config=1" className="font-medium underline underline-offset-2">
              {t("fixInSettings")}
            </Link>
          </div>
        ) : null}
        {selected ? (
          <>
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <button
                type="button"
                onClick={() => select(null)}
                aria-label={t("inbox.back")}
                className="rounded p-1 text-muted-foreground hover:bg-muted sm:hidden"
              >
                <ArrowLeft className="size-4" />
              </button>
              <Avatar name={displayName(selected)} className="size-9" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{displayName(selected)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {selected.waId ? `+${selected.waId}` : selected.username ? `@${selected.username}` : ""}
                </p>
              </div>
            </header>
            <WindowBanner lastInboundAt={selected.lastInboundAt} now={now} />
            <MessageThread messages={messages} onReply={setReplyTo} onReact={react} />
            {numberProblem ? null : (
              <Composer
                windowOpen={windowOpen}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                onSendText={sendText}
                onSendFile={sendFile}
                onOpenTemplates={() => setPickerOpen(true)}
              />
            )}
          </>
        ) : (
          <div className="m-auto flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <MessageCircle className="size-8" />
            {t("inbox.selectConversation")}
          </div>
        )}
      </section>
      {selected ? (
        <TemplatePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          templates={templates}
          conversationId={selected.id}
          onSent={() => {
            setPickerOpen(false);
            void loadMessages(selected.id);
            void loadConversations();
          }}
        />
      ) : null}
      <NewConversationDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onStarted={(id) => {
          setNewOpen(false);
          void loadConversations().then(() => {
            select(id);
            setPickerOpen(true);
          });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 6: A página**

`src/app/[locale]/app/inbox-oficial/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { BadgeCheck, MessageCircle, Settings } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { requireModule, requireScreen } from "@/lib/access";
import { resolveLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { isWhatsappCloudEnabled } from "@/lib/whatsapp-cloud/rollout";
import { toTemplateOption } from "@/lib/whatsapp-cloud/template-params";
import { getMyCloudNumber, listCloudConversations, listCloudTemplates } from "@/lib/queries/inbox-oficial";
import { NumberSettings } from "@/components/inbox-oficial/number-settings";
import { CloudInbox } from "@/components/inbox-oficial/cloud-inbox";

export const dynamic = "force-dynamic";

/**
 * "Conversas (Oficial)" — WhatsApp pela Cloud API direto na Meta. Piloto:
 * empresa fora de WHATSAPP_CLOUD_ORG_IDS recebe 404 (spec §5.3). Por vendedor:
 * cada usuário vê só o próprio número oficial.
 */
export default async function InboxOficialPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string; config?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "inboxOficial", locale);
  await requireModule(ctx, "inbox", locale);
  if (!isWhatsappCloudEnabled(ctx.organizationId)) notFound();
  const t = await getTranslations("inboxOficial");
  const { c, config } = await searchParams;

  const number = await getMyCloudNumber(ctx.organizationId, ctx.userId);
  const templates = number ? await listCloudTemplates(ctx.organizationId, number.wabaId) : [];
  const configView = !number || config === "1";

  const header = (
    <div className="glass relative overflow-hidden rounded-2xl border border-border p-4 shadow-sm sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(110% 110% at 100% 0%, color-mix(in srgb, var(--brand) 13%, transparent), transparent 55%)",
        }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <BadgeCheck className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("title")}</h1>
            <p className="truncate text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        {number ? (
          <Link
            href={configView ? "/app/inbox-oficial" : "/app/inbox-oficial?config=1"}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors",
              configView ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {configView ? <MessageCircle className="size-4" /> : <Settings className="size-4" />}
            <span className="hidden sm:inline">{configView ? t("backToConversations") : t("manageNumber")}</span>
          </Link>
        ) : null}
      </div>
    </div>
  );

  if (configView || !number) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <NumberSettings
          number={number}
          templates={templates.map((tpl) => ({
            id: tpl.id,
            name: tpl.name,
            language: tpl.language,
            category: tpl.category,
            status: tpl.status,
            rejectedReason: tpl.rejectedReason,
          }))}
        />
      </div>
    );
  }

  const conversations = await listCloudConversations(ctx.organizationId, ctx.userId);
  const approved = templates.filter((tpl) => tpl.status === "APPROVED").map((tpl) => toTemplateOption(tpl));

  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="h-[calc(100dvh-14rem)]">
        <CloudInbox
          initial={conversations}
          initialSelectedId={c ?? null}
          templates={approved}
          numberProblem={number.status === "ACTIVE" ? null : { status: number.status, error: number.lastError }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Validar**

Run: `npm run typecheck && npm run lint && npm run test:wa-cloud && npm run build`
Expected: tudo verde (o `build` precisa do Postgres local ligado); lint com 4 avisos.

- [ ] **Step 8: Roteiro manual com o simulador**

Com `npm run dev` rodando, o número simulado da Task 10 e a empresa em `WHATSAPP_CLOUD_ORG_IDS`:

1. Abra `http://localhost:3000/app/inbox-oficial`. Expected: a lista mostra as conversas criadas na Task 10 (`+5511977770001`, `Cliente Sem Fone`...), cada uma com prévia e contador.
2. Mande uma mensagem nova pelo simulador: `npx tsx --env-file=.env scripts/wa-cloud-webhook.ts text wamid=wamid.UI.1 waId=5511977770001 bsuid=BR.7000000000000000001 body="chegou agora"` — em até ~10 s a conversa sobe na lista com o contador +1; abrindo-a, a mensagem aparece em até ~4 s e o contador zera.
3. Nessa conversa a faixa mostra "Janela aberta · fecha em 23h5x" e o composer tem campo de texto, anexo e modelo. Digite e envie um texto. Expected: toast vermelho "Seu número oficial não está ativo." — o token do número simulado é falso de propósito, então `loadNumber` não o decifra; prova que nada sai sem número válido.
4. Conversa com janela vencida: `npx tsx --env-file=.env scripts/wa-cloud-webhook.ts text wamid=wamid.OLD.1 waId=5511966660001 bsuid=BR.6000000000000000001 body="antiga" ts=1790000000` (21/09/2026). Abra essa conversa. Expected: faixa **"Janela de 24h fechada — envie um modelo aprovado para retomar."** e o composer mostra só o botão "Enviar modelo".
5. Imagem: `npx tsx --env-file=.env scripts/wa-cloud-webhook.ts image wamid=wamid.IMG.1 waId=5511977770001 bsuid=BR.7000000000000000001`. Expected: a bolha mostra o carregando e, em seguida, "falha ao carregar" (o id de mídia é falso) — nunca gira para sempre.
6. Engrenagem → o número simulado aparece "Ativo". Clique **Atualizar dados**. Expected: erro vermelho do tipo "Não encontrado." (token falso não decifra) e nada quebra. Rode `npx tsx --env-file=.env scripts/wa-cloud-webhook.ts seed owner@metodoai.local` se precisar restaurar.
7. Menu lateral → **Conversas** (a antiga) continua abrindo e funcionando como antes.

- [ ] **Step 9: Commit**

```bash
git add src/components/inbox-oficial "src/app/[locale]/app/inbox-oficial"
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona a tela Conversas (Oficial)

O que:
- /app/inbox-oficial: lista (polling 10s), conversa (polling 4s), faixa da
  janela de 24h, composer que trava fora da janela, anexos, citar, reagir,
  modelo, nova conversa e aviso de numero com erro/desconectado.
- Engrenagem com a configuracao do numero e os modelos.

Por que:
- Tela separada da Conversas atual, por vendedor (spec secoes 5 e 7.6).

Impacto:
- So empresas em WHATSAPP_CLOUD_ORG_IDS veem; as demais recebem 404.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 14: Disparo das campanhas oficiais

**Files:**
- Create: `src/lib/whatsapp-cloud/campaign.ts`
- Modify: `src/lib/dispatch.ts` (desvio no início de `dispatchCampaignBatch`)
- Modify: `src/app/actions/campaigns.ts` (`startCampaign`, `deleteCampaign`)
- Modify: `scripts/wa-cloud-webhook.ts` (subcomando `seed-campaign`)

**Interfaces:**
- Consumes: Tasks 4, 5, 9, 10 (`pauseCloudCampaign`), 11 (`callSend`, `recordOutbound`, `conversationForPhone`).
- Produces:
  - `type CloudCampaignLink = { campaignId: string; organizationId: string; numberId: string; templateId: string; params: unknown }`
  - `findCloudCampaign(organizationId: string, campaignId: string): Promise<CloudCampaignLink | null>`
  - `cloudCampaignStartProblem(link: CloudCampaignLink): Promise<"no_connection" | "invalid" | null>`
  - `clearCloudPauseReason(organizationId: string, campaignId: string): Promise<void>`
  - `dispatchCloudCampaignBatch(link: CloudCampaignLink): Promise<{ done: boolean; retryAfter?: number }>`

- [ ] **Step 1: `campaign.ts`**

```ts
import "server-only";
import { LIMITS } from "@/config/limits";
import { tenantDb } from "@/lib/tenant-db";
import { looksLikeWhatsappMobile, normalizeWhatsappNumber } from "@/lib/phone";
import { loadNumber } from "@/lib/whatsapp-cloud/numbers";
import { callSend, conversationForPhone, recordOutbound } from "@/lib/whatsapp-cloud/send";
import { templatePayload } from "@/lib/whatsapp-cloud/payloads";
import {
  buildTemplateComponents,
  renderTemplateText,
  resolveParamValues,
  templateVariables,
  toTemplateDef,
  unsupportedReason,
  type ParamMapping,
} from "@/lib/whatsapp-cloud/template-params";
import { isCampaignStopper, pauseReasonText, recipientErrorText } from "@/lib/whatsapp-cloud/errors";
import { pauseCloudCampaign } from "@/lib/whatsapp-cloud/campaign-pause";

/**
 * Campanhas oficiais: disparam um modelo aprovado pelo número de quem criou a
 * campanha (as respostas caem na tela oficial dele). A Meta não bane por ritmo
 * como o QR code, então os lotes são maiores; a cota mensal é a mesma.
 */
const BATCH = 25;
const RATE_LIMIT_RETRY_SEC = 60;
const randInt = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

export type CloudCampaignLink = {
  campaignId: string;
  organizationId: string;
  numberId: string;
  templateId: string;
  params: unknown;
};

export async function findCloudCampaign(organizationId: string, campaignId: string): Promise<CloudCampaignLink | null> {
  return tenantDb(organizationId).whatsappCloudCampaign.findFirst({
    where: { campaignId },
    select: { campaignId: true, organizationId: true, numberId: true, templateId: true, params: true },
  });
}

/** Por que não dá para iniciar (null = pode). Usado por startCampaign. */
export async function cloudCampaignStartProblem(link: CloudCampaignLink): Promise<"no_connection" | "invalid" | null> {
  const number = await loadNumber(link.organizationId, link.numberId);
  if (!number || number.status !== "ACTIVE") return "no_connection";
  const tpl = await tenantDb(link.organizationId).whatsappCloudTemplate.findFirst({
    where: { id: link.templateId },
    select: { status: true },
  });
  return tpl?.status === "APPROVED" ? null : "invalid";
}

export async function clearCloudPauseReason(organizationId: string, campaignId: string): Promise<void> {
  await tenantDb(organizationId).whatsappCloudCampaign.updateMany({
    where: { campaignId },
    data: { pausedReason: null },
  });
}

export async function dispatchCloudCampaignBatch(link: CloudCampaignLink): Promise<{ done: boolean; retryAfter?: number }> {
  const { organizationId, campaignId } = link;
  const db = tenantDb(organizationId);
  const pause = async (reason: string) => {
    await pauseCloudCampaign(organizationId, campaignId, reason);
    return { done: true };
  };

  const number = await loadNumber(organizationId, link.numberId);
  if (!number || number.status !== "ACTIVE") return pause("Número oficial desconectado ou com erro.");
  const row = await db.whatsappCloudTemplate.findFirst({
    where: { id: link.templateId },
    select: { name: true, language: true, parameterFormat: true, components: true, status: true },
  });
  if (!row || row.status !== "APPROVED") return pause(`Modelo não está aprovado na Meta (${row?.status ?? "removido"}).`);
  const def = toTemplateDef(row);
  if (unsupportedReason(def)) return pause("Modelo não suportado nesta versão.");
  const vars = templateVariables(def);
  const mapping = (link.params ?? {}) as ParamMapping;

  // Cota mensal de disparos — o mesmo teto do disparo antigo.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sent = await db.campaignRecipient.count({
    where: { status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: monthStart } },
  });
  const remaining = LIMITS.dispatchQuotaPerMonth - sent;
  if (remaining <= 0) return pause("Cota mensal de disparos atingida.");

  const recipients = await db.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    orderBy: { id: "asc" },
    take: Math.min(BATCH, remaining),
    select: { id: true, contactId: true },
  });
  if (recipients.length === 0) {
    await db.campaign.updateMany({ where: { id: campaignId }, data: { status: "DONE" } });
    return { done: true };
  }
  const contacts = await db.contact.findMany({
    where: { id: { in: recipients.map((r) => r.contactId) } },
    select: { id: true, name: true, phone: true, company: { select: { name: true } } },
  });
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const fail = (id: string, error: string) =>
    db.campaignRecipient.updateMany({ where: { id }, data: { status: "FAILED", error } });

  for (const r of recipients) {
    const c = byId.get(r.contactId);
    const waId = normalizeWhatsappNumber(c?.phone ?? "");
    if (!c || !looksLikeWhatsappMobile(waId)) {
      await fail(r.id, "Número não é um WhatsApp válido.");
      continue;
    }
    const values = resolveParamValues(vars, mapping, { nome: c.name ?? "", empresa: c.company?.name ?? "" });
    const res = await callSend(
      number,
      templatePayload({ waId, bsuid: null }, def.name, def.language, buildTemplateComponents(def, values)),
    );
    if (!res.ok) {
      if (res.category === "rate_limited") return { done: false, retryAfter: RATE_LIMIT_RETRY_SEC };
      if (res.category === "pair_rate_limited") continue; // fica PENDING para o próximo lote
      if (isCampaignStopper(res.category)) return pause(pauseReasonText(res.category));
      await fail(r.id, recipientErrorText(res.category, res.message));
      continue;
    }
    await db.campaignRecipient.updateMany({
      where: { id: r.id },
      data: { status: "SENT", providerMessageId: res.wamid, error: null, sentAt: new Date() },
    });
    try {
      const conversationId = await conversationForPhone(organizationId, number.id, waId, c.id);
      await recordOutbound(organizationId, {
        conversationId,
        wamid: res.wamid,
        type: "TEMPLATE",
        body: renderTemplateText(def, values),
        templateName: def.name,
        templateLanguage: def.language,
        sentById: null,
        campaignId,
      });
    } catch (error) {
      console.error("[wa-cloud] campaign: failed to record message in inbox", error);
    }
  }

  const pending = await db.campaignRecipient.count({ where: { campaignId, status: "PENDING" } });
  if (pending === 0) {
    await db.campaign.updateMany({ where: { id: campaignId }, data: { status: "DONE" } });
    return { done: true };
  }
  return { done: false, retryAfter: randInt(2, 5) };
}
```

- [ ] **Step 2: Desvio no disparo**

Em `src/lib/dispatch.ts`, adicione aos imports:

```ts
import { dispatchCloudCampaignBatch, findCloudCampaign } from "@/lib/whatsapp-cloud/campaign";
```

e, dentro de `dispatchCampaignBatch`, logo depois de:

```ts
  await prisma.campaign.update({ where: { id: campaignId }, data: { lastDispatchAt: new Date() } });
```

cole:

```ts
  // Campanhas oficiais (WhatsApp Cloud API) têm vínculo WhatsappCloudCampaign e
  // disparam modelos aprovados pelo número do criador — caminho próprio (spec
  // 2026-09-28 §8). Sem vínculo, segue o fluxo abaixo, inalterado.
  if (campaign.channel === "WHATSAPP_CLOUD") {
    const link = await findCloudCampaign(campaign.organizationId, campaignId);
    if (link) return dispatchCloudCampaignBatch(link);
  }
```

- [ ] **Step 3: Iniciar e apagar**

Em `src/app/actions/campaigns.ts`, adicione aos imports:

```ts
import {
  clearCloudPauseReason,
  cloudCampaignStartProblem,
  findCloudCampaign,
} from "@/lib/whatsapp-cloud/campaign";
```

Em `startCampaign`, troque:

```ts
    const channel = campaign.channel as ChannelKey;
    const creds = await resolveChannelCredentials(ctx.organizationId, channel);
    if (!creds) return { ok: false, error: "no_connection" };
```

por:

```ts
    const channel = campaign.channel as ChannelKey;
    // Campanha oficial (vínculo WhatsappCloudCampaign): número do criador + modelo aprovado.
    const cloudLink = channel === "WHATSAPP_CLOUD" ? await findCloudCampaign(ctx.organizationId, id) : null;
    if (cloudLink) {
      const problem = await cloudCampaignStartProblem(cloudLink);
      if (problem) return { ok: false, error: problem };
      await clearCloudPauseReason(ctx.organizationId, id);
    } else {
      const creds = await resolveChannelCredentials(ctx.organizationId, channel);
      if (!creds) return { ok: false, error: "no_connection" };
    }
```

Em `deleteCampaign`, troque:

```ts
    const db = tenantDb(ctx.organizationId);
    await db.campaign.deleteMany({ where: { id } });
```

por:

```ts
    const db = tenantDb(ctx.organizationId);
    // Vínculo da campanha oficial (sem FK para campaigns, de propósito).
    await db.whatsappCloudCampaign.deleteMany({ where: { campaignId: id } });
    await db.campaign.deleteMany({ where: { id } });
```

- [ ] **Step 4: Subcomando `seed-campaign` no simulador**

Em `scripts/wa-cloud-webhook.ts`, acrescente no cabeçalho de uso a linha:

```ts
 *   npx tsx --env-file=.env scripts/wa-cloud-webhook.ts seed-campaign wamid=<id> [waId=...]
```

cole a função abaixo antes de `async function main()`:

```ts
/**
 * Campanha oficial fictícia, RUNNING, com UM destinatário já "enviado" (wamid
 * conhecido) — testa status e pausa pelo webhook sem precisar da Meta.
 */
async function seedCampaign() {
  const prisma = client();
  try {
    const phoneNumberId = str("phone") ?? f.PHONE_NUMBER_ID;
    const n = await prisma.whatsappCloudNumber.findFirst({
      where: { phoneNumberId },
      select: { id: true, organizationId: true, ownerId: true },
    });
    if (!n) throw new Error("Rode o seed antes");
    const orgId = n.organizationId;
    const wamid = str("wamid") ?? `wamid.CAMP.${Date.now()}`;
    const waId = str("waId") ?? "5511955550001";

    let template = await prisma.whatsappCloudTemplate.findFirst({
      where: { organizationId: orgId, wabaId: f.WABA_ID, name: "simulado", language: "pt_BR" },
      select: { id: true },
    });
    if (!template) {
      template = await prisma.whatsappCloudTemplate.create({
        data: {
          organizationId: orgId,
          wabaId: f.WABA_ID,
          metaId: "0",
          name: "simulado",
          language: "pt_BR",
          category: "MARKETING",
          status: "APPROVED",
          parameterFormat: "POSITIONAL",
          components: [{ type: "BODY", text: "Olá {{1}}, esta é uma campanha simulada." }],
          syncedAt: new Date(),
        },
        select: { id: true },
      });
    }
    const contact = await prisma.contact.create({
      data: { organizationId: orgId, name: `Contato ${wamid}`, phone: waId.slice(2), tags: ["simulado"], source: "simulador" },
      select: { id: true },
    });
    const campaign = await prisma.campaign.create({
      data: { organizationId: orgId, name: `Simulada ${wamid}`, channel: "WHATSAPP_CLOUD", status: "RUNNING", createdById: n.ownerId },
      select: { id: true },
    });
    await prisma.campaignRecipient.create({
      data: { organizationId: orgId, campaignId: campaign.id, contactId: contact.id, status: "SENT", providerMessageId: wamid, sentAt: new Date() },
    });
    await prisma.whatsappCloudCampaign.create({
      data: { organizationId: orgId, campaignId: campaign.id, numberId: n.id, templateId: template.id, params: {} },
    });
    const convo =
      (await prisma.whatsappCloudConversation.findFirst({
        where: { organizationId: orgId, numberId: n.id, waId },
        select: { id: true },
      })) ??
      (await prisma.whatsappCloudConversation.create({
        data: { organizationId: orgId, numberId: n.id, waId, contactId: contact.id },
        select: { id: true },
      }));
    await prisma.whatsappCloudMessage.create({
      data: {
        organizationId: orgId,
        conversationId: convo.id,
        wamid,
        direction: "OUTBOUND",
        type: "TEMPLATE",
        body: "Olá, esta é uma campanha simulada.",
        status: "SENT",
        campaignId: campaign.id,
        timestamp: new Date(),
      },
    });
    console.log(`Campanha ${campaign.id} (RUNNING) com a mensagem ${wamid} para ${waId}.`);
  } finally {
    await prisma.$disconnect();
  }
}
```

e, em `main()`, logo depois da linha `if (kind === "move-owner") ...`, acrescente:

```ts
  if (kind === "seed-campaign") return seedCampaign();
```

- [ ] **Step 5: Validar**

Run: `npm run typecheck && npm run lint && npm run test:wa-cloud`
Expected: tudo verde; 4 avisos.

- [ ] **Step 6: Status fora de ordem (Review Focus 3)**

Com o dev rodando, o número simulado ativo e `SQL` definido (Task 10):

```bash
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts seed-campaign wamid=wamid.CAMP.1 waId=5511955550001
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts status wamid=wamid.CAMP.1 status=read waId=5511955550001 bsuid=none pricing=marketing
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts status wamid=wamid.CAMP.1 status=delivered waId=5511955550001 bsuid=none
$SQL "SELECT status, \"pricingCategory\" FROM whatsapp_cloud_messages WHERE wamid='wamid.CAMP.1'"
$SQL "SELECT status FROM campaign_recipients WHERE \"providerMessageId\"='wamid.CAMP.1'"
```

Expected: a mensagem fica `READ` com `pricingCategory` = `marketing`; o destinatário fica `READ`. O `delivered` atrasado não rebaixa nenhum dos dois.

- [ ] **Step 7: Token inválido pausa (Review Focus 5)**

```bash
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts seed-campaign wamid=wamid.CAMP.2 waId=5511955550002
npx tsx --env-file=.env scripts/wa-cloud-webhook.ts status wamid=wamid.CAMP.2 status=failed code=190 details="Token expirado" waId=5511955550002 bsuid=none
$SQL "SELECT c.status, l.\"pausedReason\" FROM campaigns c JOIN whatsapp_cloud_campaigns l ON l.\"campaignId\" = c.id WHERE c.name = 'Simulada wamid.CAMP.2'"
$SQL "SELECT status, \"lastError\" FROM whatsapp_cloud_numbers WHERE \"phoneNumberId\"='106540352242922'"
$SQL "SELECT status, error FROM campaign_recipients WHERE \"providerMessageId\"='wamid.CAMP.2'"
```

Expected: campanha `PAUSED` com `pausedReason` = `O token do número oficial é inválido ou perdeu permissão.`; número `ERROR` com `lastError` = `Token expirado`; destinatário `FAILED` com erro `Token expirado`.

Restaure o número: `npx tsx --env-file=.env scripts/wa-cloud-webhook.ts seed owner@metodoai.local`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/whatsapp-cloud/campaign.ts src/lib/dispatch.ts src/app/actions/campaigns.ts scripts/wa-cloud-webhook.ts
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona disparo de campanhas por modelos aprovados

O que:
- campaign.ts: lote de 25 pelo numero do criador, variaveis do modelo por
  contato, cota mensal, recuo em limite de velocidade, pausa com motivo
  (modelo pausado/desativado, token, numero), falha por destinatario com
  texto claro; cada envio tambem vira mensagem na conversa oficial.
- dispatchCampaignBatch/startCampaign/deleteCampaign: desvio SO para
  campanhas com vinculo WhatsappCloudCampaign.
- Simulador: seed-campaign.

Por que:
- Fora da janela so modelo aprovado passa; o disparo antigo manda texto
  livre (spec secao 8).

Impacto:
- Campanhas sem vinculo seguem exatamente o caminho de hoje.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 15: Formulário e páginas de campanha oficial

**Files:**
- Create: `src/lib/whatsapp-cloud/campaign-setup.ts`, `src/lib/queries/whatsapp-cloud-campaigns.ts`
- Create: `src/app/actions/whatsapp-cloud-campaigns.ts`
- Create: `src/components/campaigns/cloud-campaign-fields.tsx`, `src/components/campaigns/cloud-campaign-rename-form.tsx`
- Modify: `src/components/campaigns/campaign-form.tsx`
- Modify: `src/app/[locale]/app/campaigns/new/page.tsx`, `src/app/[locale]/app/campaigns/[id]/edit/page.tsx`, `src/app/[locale]/app/campaigns/[id]/page.tsx`
- Modify: `src/messages/pt.json`, `src/messages/en.json` (`campaigns.cloud`)

**Interfaces:**
- Consumes: Tasks 4, 7, 8 (`getMessagingLimit`), 9, 14; `audienceWhere`/`AudienceFilter` (existentes em `src/lib/queries/campaigns.ts`), `campaignSchema` (existente).
- Produces:
  - `type CloudCampaignSetup = { templates: CloudTemplateOption[]; messagingLimit: string | null }`; `cloudCampaignSetup(ctx: OrgContext): Promise<CloudCampaignSetup | null>`
  - `getCloudCampaignInfo(organizationId, campaignId): Promise<{ templateName: string | null; pausedReason: string | null } | null>`
  - Actions: `createCloudCampaign(input)` → `{ ok: true; id } | { ok: false; error: "unauthorized" | "invalid" | "forbidden" | "no_connection" | "unknown" }`; `sampleCloudAudience(filter: AudienceFilter): Promise<ParamContext | null>`; `renameCloudCampaign(id, name): Promise<{ ok: boolean }>`
  - `type CloudCampaignValue = { templateId: string; params: ParamMapping }`; `CloudCampaignFields(...)`; `CloudCampaignRenameForm(...)`

- [ ] **Step 1: `campaign-setup.ts`**

```ts
import "server-only";
import type { OrgContext } from "@/lib/tenant";
import { hasFeatureByModules } from "@/config/modules";
import { isWhatsappCloudEnabled } from "@/lib/whatsapp-cloud/rollout";
import { getMyCloudNumber, listCloudTemplates } from "@/lib/queries/inbox-oficial";
import { loadNumber } from "@/lib/whatsapp-cloud/numbers";
import { getMessagingLimit } from "@/lib/whatsapp-cloud/meta-api";
import { toTemplateOption, type CloudTemplateOption } from "@/lib/whatsapp-cloud/template-params";

export type CloudCampaignSetup = { templates: CloudTemplateOption[]; messagingLimit: string | null };

/**
 * O que o formulário de campanha precisa para o canal oficial. `null` = o
 * formulário de hoje, sem mudança nenhuma (empresa fora do piloto, sem o
 * recurso de campanhas WhatsApp ou sem número oficial ativo). Resolvido no
 * servidor e passado como prop (gating cross-módulo, guia 04).
 */
export async function cloudCampaignSetup(ctx: OrgContext): Promise<CloudCampaignSetup | null> {
  if (!isWhatsappCloudEnabled(ctx.organizationId)) return null;
  if (!hasFeatureByModules(ctx.modules, "campaigns.whatsapp")) return null;
  const number = await getMyCloudNumber(ctx.organizationId, ctx.userId);
  if (!number || number.status !== "ACTIVE") return null;
  const rows = await listCloudTemplates(ctx.organizationId, number.wabaId, { approvedOnly: true });
  const withToken = await loadNumber(ctx.organizationId, number.id);
  const messagingLimit = withToken ? await getMessagingLimit(withToken.phoneNumberId, withToken.token) : null;
  return { templates: rows.map((r) => toTemplateOption(r)), messagingLimit };
}
```

- [ ] **Step 2: `src/lib/queries/whatsapp-cloud-campaigns.ts`**

```ts
import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/** Modelo e motivo de pausa de uma campanha oficial (null = campanha comum). */
export async function getCloudCampaignInfo(organizationId: string, campaignId: string) {
  const db = tenantDb(organizationId);
  const link = await db.whatsappCloudCampaign.findFirst({
    where: { campaignId },
    select: { templateId: true, pausedReason: true },
  });
  if (!link) return null;
  const tpl = await db.whatsappCloudTemplate.findFirst({
    where: { id: link.templateId },
    select: { name: true, language: true },
  });
  return { templateName: tpl ? `${tpl.name} (${tpl.language})` : null, pausedReason: link.pausedReason };
}
```

- [ ] **Step 3: Actions (`src/app/actions/whatsapp-cloud-campaigns.ts`)**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { assertFeatureByModules } from "@/config/modules";
import { audit } from "@/lib/audit";
import { audienceWhere, type AudienceFilter } from "@/lib/queries/campaigns";
import { getMyCloudNumber } from "@/lib/queries/inbox-oficial";
import { campaignSchema } from "@/lib/validations/campaign";
import { cloudGuard } from "@/lib/whatsapp-cloud/guard";
import {
  mappingIsComplete,
  templateVariables,
  toTemplateDef,
  unsupportedReason,
  type ParamContext,
  type ParamMapping,
} from "@/lib/whatsapp-cloud/template-params";

export type CloudCampaignResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "forbidden" | "no_connection" | "unknown" };

const paramSource = z.object({
  source: z.enum(["nome", "empresa", "fixo"]),
  value: z.string().max(1000).optional(),
});
const cloudCampaignSchema = campaignSchema
  .omit({ channel: true, templateId: true })
  .extend({ templateId: z.string().trim().min(1), params: z.record(z.string(), paramSource) });
const filterSchema = campaignSchema.pick({
  tags: true,
  folderId: true,
  source: true,
  stageId: true,
  oppStatus: true,
  ownerId: true,
});

function toFilter(d: z.infer<typeof filterSchema>): AudienceFilter {
  return {
    tags: d.tags,
    folderId: d.folderId || undefined,
    source: d.source || undefined,
    stageId: d.stageId || undefined,
    oppStatus: (d.oppStatus || undefined) as AudienceFilter["oppStatus"],
    ownerId: d.ownerId || undefined,
  };
}

/** Cria a Campaign (canal WHATSAPP_CLOUD) + destinatários + vínculo com o modelo da Meta. */
export async function createCloudCampaign(input: z.input<typeof cloudCampaignSchema>): Promise<CloudCampaignResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error === "unauthorized" ? "unauthorized" : "forbidden" };
  const { ctx } = g;
  try {
    assertFeatureByModules(ctx.modules, "campaigns.whatsapp");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const parsed = cloudCampaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const number = await getMyCloudNumber(ctx.organizationId, ctx.userId);
    if (!number || number.status !== "ACTIVE") return { ok: false, error: "no_connection" };
    const tpl = await db.whatsappCloudTemplate.findFirst({
      where: { id: parsed.data.templateId, wabaId: number.wabaId, status: "APPROVED" },
      select: { id: true, name: true, language: true, parameterFormat: true, components: true },
    });
    if (!tpl) return { ok: false, error: "invalid" };
    const def = toTemplateDef(tpl);
    if (unsupportedReason(def)) return { ok: false, error: "invalid" };
    const vars = templateVariables(def);
    const mapping: ParamMapping = {};
    for (const v of vars) {
      const m = parsed.data.params[v.id];
      if (m) mapping[v.id] = m;
    }
    if (!mappingIsComplete(vars, mapping)) return { ok: false, error: "invalid" };

    const contacts = await db.contact.findMany({
      where: audienceWhere("WHATSAPP_CLOUD", toFilter(parsed.data)),
      select: { id: true },
    });
    const campaign = await db.campaign.create({
      data: {
        organizationId: ctx.organizationId,
        name: parsed.data.name,
        channel: "WHATSAPP_CLOUD",
        templateId: null,
        status: "DRAFT",
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    if (contacts.length > 0) {
      await db.campaignRecipient.createMany({
        data: contacts.map((c) => ({ organizationId: ctx.organizationId, campaignId: campaign.id, contactId: c.id })),
        skipDuplicates: true,
      });
    }
    await db.whatsappCloudCampaign.create({
      data: {
        organizationId: ctx.organizationId,
        campaignId: campaign.id,
        numberId: number.id,
        templateId: tpl.id,
        params: mapping as Prisma.InputJsonValue,
      },
    });
    await audit(ctx, {
      action: "campaign.created",
      entity: "Campaign",
      entityId: campaign.id,
      meta: { channel: "WHATSAPP_CLOUD", recipients: contacts.length, template: tpl.name },
    });
    revalidatePath("/app/campaigns");
    return { ok: true, id: campaign.id };
  } catch (error) {
    console.error("[wa-cloud] create campaign failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Um contato real do público para a prévia do modelo. */
export async function sampleCloudAudience(filter: AudienceFilter): Promise<ParamContext | null> {
  const g = await cloudGuard();
  if (!g.ok) return null;
  const parsed = filterSchema.safeParse(filter);
  if (!parsed.success) return null;
  const c = await tenantDb(g.ctx.organizationId).contact.findFirst({
    where: audienceWhere("WHATSAPP_CLOUD", toFilter(parsed.data)),
    orderBy: { name: "asc" },
    select: { name: true, company: { select: { name: true } } },
  });
  return c ? { nome: c.name ?? "", empresa: c.company?.name ?? "" } : null;
}

/** Campanha oficial só troca o nome (para outro modelo, cria-se outra campanha). */
export async function renameCloudCampaign(id: string, name: string): Promise<{ ok: boolean }> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false };
  const clean = name.trim().slice(0, 120);
  if (!clean) return { ok: false };
  const db = tenantDb(g.ctx.organizationId);
  const link = await db.whatsappCloudCampaign.findFirst({ where: { campaignId: id }, select: { id: true } });
  if (!link) return { ok: false };
  const res = await db.campaign.updateMany({ where: { id }, data: { name: clean } });
  if (res.count === 0) return { ok: false };
  await audit(g.ctx, { action: "campaign.updated", entity: "Campaign", entityId: id });
  revalidatePath(`/app/campaigns/${id}`);
  revalidatePath("/app/campaigns");
  return { ok: true };
}
```

- [ ] **Step 4: Textos (`campaigns.cloud`)**

Em `src/messages/pt.json`, dentro do objeto de primeiro nível `"campaigns": { ... }`, acrescente a chave:

```json
    "cloud": {
      "channelLabel": "WhatsApp Oficial (modelos aprovados)",
      "template": "Modelo aprovado da Meta",
      "selectTemplate": "Selecione um modelo",
      "noTemplates": "Nenhum modelo aprovado. Sincronize na engrenagem de Conversas (Oficial).",
      "variables": "Variáveis do modelo",
      "part": {
        "header": "cabeçalho",
        "body": "corpo"
      },
      "sourceLabel": "Origem da variável {name}",
      "source": {
        "nome": "Nome do contato",
        "empresa": "Empresa do contato",
        "fixo": "Texto fixo"
      },
      "fixedValue": "Texto fixo",
      "fallback": "Se vazio, usar",
      "preview": "Prévia",
      "previewWith": "com {name}",
      "limitWarning": "Limite atual do número na Meta: {limit} contatos novos por 24h. Este público tem {count} contatos.",
      "incomplete": "Escolha um modelo e preencha todas as variáveis.",
      "unsupported": {
        "media_header": "cabeçalho com mídia (ainda não suportado)",
        "location_header": "cabeçalho de localização (ainda não suportado)",
        "button_variable": "botão com variável (ainda não suportado)"
      },
      "templateUsed": "Modelo da Meta: {name}",
      "pausedReason": "Pausada automaticamente: {reason}",
      "renameOnly": "Campanhas oficiais permitem trocar só o nome. Para usar outro modelo, crie outra campanha.",
      "rename": "Salvar nome"
    },
```

Em `src/messages/en.json`, no mesmo lugar:

```json
    "cloud": {
      "channelLabel": "Official WhatsApp (approved templates)",
      "template": "Meta approved template",
      "selectTemplate": "Select a template",
      "noTemplates": "No approved templates. Sync them in the Inbox (Official) settings.",
      "variables": "Template variables",
      "part": {
        "header": "header",
        "body": "body"
      },
      "sourceLabel": "Source of variable {name}",
      "source": {
        "nome": "Contact name",
        "empresa": "Contact company",
        "fixo": "Fixed text"
      },
      "fixedValue": "Fixed text",
      "fallback": "If empty, use",
      "preview": "Preview",
      "previewWith": "with {name}",
      "limitWarning": "Current Meta limit for this number: {limit} new contacts per 24h. This audience has {count} contacts.",
      "incomplete": "Choose a template and fill in every variable.",
      "unsupported": {
        "media_header": "media header (not supported yet)",
        "location_header": "location header (not supported yet)",
        "button_variable": "button with variable (not supported yet)"
      },
      "templateUsed": "Meta template: {name}",
      "pausedReason": "Paused automatically: {reason}",
      "renameOnly": "Official campaigns can only be renamed. To use another template, create another campaign.",
      "rename": "Save name"
    },
```

Rode o mesmo comando de paridade da Task 12, Step 3. Expected: `[] []`.

- [ ] **Step 5: `cloud-campaign-fields.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  defaultMapping,
  renderTemplateText,
  resolveParamValues,
  type CloudTemplateOption,
  type ParamContext,
  type ParamMapping,
  type ParamSource,
} from "@/lib/whatsapp-cloud/template-params";

export type CloudCampaignValue = { templateId: string; params: ParamMapping };

const SAMPLE: ParamContext = { nome: "Maria", empresa: "Empresa Exemplo" };
const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/** Modelo da Meta + origem de cada variável + prévia + aviso de limite. */
export function CloudCampaignFields({
  templates,
  value,
  onChange,
  sample,
  messagingLimit,
  audienceCount,
}: {
  templates: CloudTemplateOption[];
  value: CloudCampaignValue;
  onChange: (v: CloudCampaignValue) => void;
  sample: ParamContext | null;
  messagingLimit: string | null;
  audienceCount: number | null;
}) {
  const t = useTranslations("campaigns.cloud");
  const selected = templates.find((x) => x.id === value.templateId) ?? null;
  const preview = useMemo(
    () =>
      selected
        ? renderTemplateText(selected.def, resolveParamValues(selected.variables, value.params, sample ?? SAMPLE))
        : "",
    [selected, value.params, sample],
  );

  function pick(id: string) {
    const tpl = templates.find((x) => x.id === id);
    onChange({ templateId: id, params: tpl ? defaultMapping(tpl.variables) : {} });
  }

  function setParam(id: string, next: ParamSource) {
    onChange({ ...value, params: { ...value.params, [id]: next } });
  }

  return (
    <div className="grid gap-4">
      <div>
        <Label htmlFor="cloudTemplate">{t("template")}</Label>
        <select id="cloudTemplate" className={selectCls} value={value.templateId} onChange={(e) => pick(e.target.value)}>
          <option value="">{t("selectTemplate")}</option>
          {templates.map((o) => (
            <option key={o.id} value={o.id} disabled={o.unsupported !== null}>
              {o.name} ({o.language} · {o.category}){o.unsupported ? ` — ${t(`unsupported.${o.unsupported}`)}` : ""}
            </option>
          ))}
        </select>
        {templates.length === 0 ? <p className="mt-1 text-xs text-amber-600">{t("noTemplates")}</p> : null}
      </div>

      {selected && selected.variables.length > 0 ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">{t("variables")}</p>
          {selected.variables.map((v) => {
            const m: ParamSource = value.params[v.id] ?? { source: "fixo", value: "" };
            const placeholder = m.source === "fixo" ? t("fixedValue") : t("fallback");
            return (
              <div key={v.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[auto_1fr_1fr] sm:items-center">
                <span className="font-mono text-xs text-muted-foreground">
                  {`{{${v.key}}}`} · {t(`part.${v.component}`)}
                </span>
                <select
                  aria-label={t("sourceLabel", { name: v.key })}
                  className={selectCls}
                  value={m.source}
                  onChange={(e) => setParam(v.id, { source: e.target.value as ParamSource["source"], value: m.value })}
                >
                  <option value="nome">{t("source.nome")}</option>
                  <option value="empresa">{t("source.empresa")}</option>
                  <option value="fixo">{t("source.fixo")}</option>
                </select>
                <Input
                  aria-label={placeholder}
                  placeholder={placeholder}
                  value={m.value ?? ""}
                  maxLength={1000}
                  onChange={(e) => setParam(v.id, { ...m, value: e.target.value })}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <div>
          <p className="mb-1.5 text-sm font-medium">
            {t("preview")}
            {sample ? ` — ${t("previewWith", { name: sample.nome || "—" })}` : ""}
          </p>
          <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{preview}</p>
        </div>
      ) : null}

      {messagingLimit ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t("limitWarning", { limit: messagingLimit, count: audienceCount ?? 0 })}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Integrar no formulário de campanha**

Em `src/components/campaigns/campaign-form.tsx`:

1. Adicione aos imports:

```tsx
import { CloudCampaignFields, type CloudCampaignValue } from "@/components/campaigns/cloud-campaign-fields";
import { createCloudCampaign, sampleCloudAudience } from "@/app/actions/whatsapp-cloud-campaigns";
import type { CloudCampaignSetup } from "@/lib/whatsapp-cloud/campaign-setup";
import { mappingIsComplete, type ParamContext } from "@/lib/whatsapp-cloud/template-params";
```

2. Na lista de props, troque:

```tsx
  hasCrm = true,
}: {
```

por:

```tsx
  hasCrm = true,
  cloud = null,
}: {
```

e no tipo das props, logo depois de `  hasCrm?: boolean;`, acrescente:

```tsx
  /** Canal oficial resolvido no servidor; null = formulário de hoje, sem mudança. */
  cloud?: CloudCampaignSetup | null;
```

3. Troque o `useForm` para expor `setError`:

```tsx
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ defaultValues: { name: "", templateId: "" } });
```

4. Logo depois da linha `const [count, setCount] = useState<number | null>(null);`, acrescente:

```tsx
  const [cloudValue, setCloudValue] = useState<CloudCampaignValue>({ templateId: "", params: {} });
  const [sample, setSample] = useState<ParamContext | null>(null);
  const isCloud = channel === "WHATSAPP_CLOUD" && cloud !== null;
```

5. Depois do `useEffect` da contagem de público (o que chama `countAudience`), acrescente:

```tsx
  // Um contato real do público para a prévia do modelo oficial (mesmo atraso da contagem).
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    const id = setTimeout(async () => {
      const s = await sampleCloudAudience({
        tags: tags.length ? tags : undefined,
        folderId: folderId || undefined,
        source: source || undefined,
        stageId: stageId || undefined,
        oppStatus: (oppStatus || undefined) as AudienceFilter["oppStatus"],
        ownerId: ownerId || undefined,
      });
      if (active) setSample(s);
    }, 350);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [isCloud, tags, folderId, source, stageId, oppStatus, ownerId]);
```

6. Troque a função `onSubmit` inteira por:

```tsx
  async function onSubmit(values: Values) {
    setServerError(null);
    if (isCloud && cloud) {
      const tpl = cloud.templates.find((x) => x.id === cloudValue.templateId);
      if (!tpl || !mappingIsComplete(tpl.variables, cloudValue.params)) {
        setServerError(t("cloud.incomplete"));
        return;
      }
      const result = await createCloudCampaign({
        name: values.name.trim(),
        templateId: tpl.id,
        params: cloudValue.params,
        ...filter,
      });
      if (result.ok) {
        router.push(`/app/campaigns/${result.id}`);
        router.refresh();
      } else {
        setServerError(t(`error.${result.error}`));
      }
      return;
    }
    if (!values.templateId) {
      setError("templateId", { type: "required", message: tv("required") });
      return;
    }
    const result = await createCampaign({ name: values.name.trim(), channel, templateId: values.templateId, ...filter });
    if (result.ok) {
      router.push(`/app/campaigns/${result.id}`);
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }
```

7. No `<select id="channel">`, troque:

```tsx
                <option key={key} value={key}>{CHANNEL_META[key].label}</option>
```

por:

```tsx
                <option key={key} value={key}>
                  {key === "WHATSAPP_CLOUD" && cloud ? t("cloud.channelLabel") : CHANNEL_META[key].label}
                </option>
```

8. Troque o bloco do modelo interno:

```tsx
          <div>
            <Label htmlFor="templateId">{t("templateLabel")}</Label>
            <select id="templateId" className={selectCls} aria-invalid={Boolean(errors.templateId)} {...register("templateId", { required: tv("required") })}>
```

por:

```tsx
          {isCloud && cloud ? (
            <CloudCampaignFields
              templates={cloud.templates}
              value={cloudValue}
              onChange={setCloudValue}
              sample={sample}
              messagingLimit={cloud.messagingLimit}
              audienceCount={count}
            />
          ) : (
          <div>
            <Label htmlFor="templateId">{t("templateLabel")}</Label>
            <select id="templateId" className={selectCls} aria-invalid={Boolean(errors.templateId)} {...register("templateId")}>
```

e feche o condicional logo depois do fechamento desse `<div>` (a linha seguinte a `{channelTemplates.length === 0 ? <p ...>{t("noTemplateForChannel")}</p> : null}` e ao `</div>` que a encerra), acrescentando `)}`:

```tsx
            {channelTemplates.length === 0 ? <p className="mt-1 text-xs text-amber-600">{t("noTemplateForChannel")}</p> : null}
          </div>
          )}
```

(A validação de "obrigatório" do modelo interno saiu do `register` e foi para o `onSubmit`, porque com o campo desmontado no modo oficial a regra antiga continuaria valendo.)

- [ ] **Step 7: Página de nova campanha**

Em `src/app/[locale]/app/campaigns/new/page.tsx`:
- import: `import { cloudCampaignSetup } from "@/lib/whatsapp-cloud/campaign-setup";`
- troque o `Promise.all` para incluir o setup:

```tsx
  const [templates, folders, facets, { stages }, members, cloud] = await Promise.all([
    templateOptions(ctx.organizationId),
    contactFolderOptions(ctx.organizationId),
    audienceFacets(ctx.organizationId),
    stageOptions(ctx.organizationId),
    listMembers(ctx.organizationId),
    cloudCampaignSetup(ctx),
  ]);
```

- troque `{templates.length === 0 ? (` por `{templates.length === 0 && !cloud ? (`;
- em `<CampaignForm ... />`, acrescente a prop `cloud={cloud}` depois de `hasCrm={...}`.

- [ ] **Step 8: Edição e detalhe**

`src/components/campaigns/cloud-campaign-rename-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { renameCloudCampaign } from "@/app/actions/whatsapp-cloud-campaigns";

/** Campanha oficial: só o nome é editável. */
export function CloudCampaignRenameForm({
  id,
  name,
  templateName,
}: {
  id: string;
  name: string;
  templateName: string | null;
}) {
  const t = useTranslations("campaigns");
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await renameCloudCampaign(id, value);
        setBusy(false);
        if (r.ok) {
          router.push(`/app/campaigns/${id}`);
          router.refresh();
        } else {
          setError(t("error.unknown"));
        }
      }}
    >
      <div>
        <Label htmlFor="name">{t("campaignName")}</Label>
        <Input id="name" value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} />
      </div>
      {templateName ? <p className="text-sm text-muted-foreground">{t("cloud.templateUsed", { name: templateName })}</p> : null}
      <p className="text-xs text-muted-foreground">{t("cloud.renameOnly")}</p>
      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy || !value.trim()}>
          {t("cloud.rename")}
        </Button>
      </div>
    </form>
  );
}
```

Em `src/app/[locale]/app/campaigns/[id]/edit/page.tsx`:
- imports: `import { getCloudCampaignInfo } from "@/lib/queries/whatsapp-cloud-campaigns";` e `import { CloudCampaignRenameForm } from "@/components/campaigns/cloud-campaign-rename-form";`
- logo depois de `const { campaign } = data;`, acrescente `const cloudInfo = await getCloudCampaignInfo(ctx.organizationId, campaign.id);`
- troque o `<CampaignEditForm ... />` por:

```tsx
      {cloudInfo ? (
        <CloudCampaignRenameForm id={campaign.id} name={campaign.name} templateName={cloudInfo.templateName} />
      ) : (
        <CampaignEditForm
          id={campaign.id}
          channel={campaign.channel as ChannelKey}
          name={campaign.name}
          templateId={campaign.templateId ?? ""}
          templates={templates}
        />
      )}
```

Em `src/app/[locale]/app/campaigns/[id]/page.tsx`:
- import: `import { getCloudCampaignInfo } from "@/lib/queries/whatsapp-cloud-campaigns";`
- logo depois de `const { campaign, counts, recipients } = data;`, acrescente `const cloudInfo = await getCloudCampaignInfo(ctx.organizationId, campaign.id);`
- logo depois do fechamento do primeiro bloco `<div className="flex items-start justify-between">…</div>` (o cabeçalho com título e botões), insira:

```tsx
      {cloudInfo ? (
        <div className="flex flex-col gap-2 text-sm">
          {cloudInfo.templateName ? (
            <p className="text-muted-foreground">{t("cloud.templateUsed", { name: cloudInfo.templateName })}</p>
          ) : null}
          {campaign.status === "PAUSED" && cloudInfo.pausedReason ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {t("cloud.pausedReason", { reason: cloudInfo.pausedReason })}
            </p>
          ) : null}
        </div>
      ) : null}
```

- [ ] **Step 9: Validar**

Run: `npm run typecheck && npm run lint && npm run test:wa-cloud && npm run build`
Expected: tudo verde; 4 avisos.

- [ ] **Step 10: Roteiro manual**

Com o dev rodando, empresa liberada e número simulado (Task 10). O `seed-campaign` da Task 14 criou o modelo `simulado` como APPROVED:

1. `/app/campaigns/new` → canal **"WhatsApp Oficial (modelos aprovados)"**. Expected: o seletor de modelo interno some; aparece "Modelo aprovado da Meta" com `simulado (pt_BR · MARKETING)`. Escolhendo-o, a variável `{{1}} · corpo` já vem como "Nome do contato" com reserva "cliente", e a prévia mostra "Olá <nome de um contato do público>, esta é uma campanha simulada.". Sem aviso de limite (o token falso não consulta a Meta).
2. Crie a campanha. Expected: vai para a página dela, com "Modelo da Meta: simulado (pt_BR)".
3. Clique **Iniciar**. Expected: erro "sem conexão" (o número simulado não tem token válido) — o caminho de verificação antes do disparo funciona.
4. Abra a campanha "Simulada wamid.CAMP.2" (Task 14, Step 7). Expected: faixa "Pausada automaticamente: O token do número oficial é inválido ou perdeu permissão."; **Editar** mostra só o nome.
5. Tire `WHATSAPP_CLOUD_ORG_IDS` do `.env`, reinicie o dev, abra `/app/campaigns/new`. Expected: o formulário é o de hoje — a opção "WhatsApp (Meta Cloud)" com o seletor de modelo interno. Recoloque a variável.

- [ ] **Step 11: Commit**

```bash
git add src/lib/whatsapp-cloud/campaign-setup.ts src/lib/queries/whatsapp-cloud-campaigns.ts src/app/actions/whatsapp-cloud-campaigns.ts src/components/campaigns "src/app/[locale]/app/campaigns" src/messages/pt.json src/messages/en.json
git commit -F - <<'EOF'
[WhatsApp Oficial] - Adiciona formulario de campanha por modelo aprovado

O que:
- Canal "WhatsApp Oficial" no formulario (so para empresa liberada com
  numero oficial ativo): modelo da Meta, origem de cada variavel
  (nome/empresa/fixo), previa com contato real e aviso de limite.
- Acoes: criar campanha oficial, amostra do publico, renomear.
- Pagina da campanha mostra o modelo e o motivo da pausa; edicao so do nome.

Por que:
- Campanhas oficiais escolhidas no escopo da primeira entrega
  (spec secao 8).

Impacto:
- Sem liberacao (ou sem numero ativo), o formulario e exatamente o de hoje.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 16: Documentação, validação completa e teste de ponta a ponta com a Meta

**Files:**
- Modify: `README.md` (§1, §2, §6, §7, §8)
- Modify: `CLAUDE.md` (contagem de chaves de i18n + armadilha do WhatsApp oficial)
- Modify: `docs/guia/02-mapa-do-codigo.md`, `docs/guia/04-modulos-e-permissoes.md` (contagens)

**Interfaces:**
- Consumes: tudo das Tasks 1–15.
- Produces: documentação atualizada; relatório do teste de ponta a ponta (passo 2 do Plano).

- [ ] **Step 1: Recontar**

```bash
node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p+k+'.'):[p+k]);console.log('i18n:',f(require('./src/messages/pt.json')).length,f(require('./src/messages/en.json')).length)"
find src/app/api -name route.ts | wc -l
ls src/app/actions | wc -l
ls src/lib/queries | wc -l
ls scripts | wc -l
```

Anote os cinco números (i18n = N, rotas = R, actions = A, queries = Q, scripts = S).

- [ ] **Step 2: Atualizar contagens**

- `CLAUDE.md`: `(2597 hoje)` → `(N hoje)`.
- `docs/guia/02-mapa-do-codigo.md`: `2.597 chaves` (duas ocorrências) → N formatado com ponto de milhar; `43 rotas hoje` → `R rotas hoje`; `52 arquivos, um por domínio (server actions)` → `A arquivos, ...`; `50 arquivos, um por domínio` → `Q arquivos, ...`; em "rodar um comando de manutenção", `5 arquivos` → `S arquivos` e acrescente `wa-cloud-webhook` (simulador de webhook da Meta para dev, `npx tsx --env-file=.env scripts/wa-cloud-webhook.ts`) à lista dos que rodam direto via `tsx`.
- `docs/guia/04-modulos-e-permissoes.md`: `**2597 chaves-folha cada um**` → `**N chaves-folha cada um**`.

- [ ] **Step 3: `CLAUDE.md` — armadilha do WhatsApp oficial**

Logo depois do parágrafo **Evolution/WhatsApp.** (que termina em `"Conexão Evolution incompleta".`), acrescente:

```markdown
**WhatsApp oficial (Cloud API).** A tela "Conversas (Oficial)" tem código e tabelas próprios
(`src/lib/whatsapp-cloud/`, `WhatsappCloud*`) e só aparece para empresas em
`WHATSAPP_CLOUD_ORG_IDS` (`isWhatsappCloudEnabled`, o único leitor). Token do número: sempre
`loadNumber()`, nunca decifrar à mão. Webhook público autenticado por `X-Hub-Signature-256`.
Spec: [docs/superpowers/specs/2026-09-28-whatsapp-cloud-inbox-design.md](docs/superpowers/specs/2026-09-28-whatsapp-cloud-inbox-design.md).
```

- [ ] **Step 4: README**

- §1, tabela de módulos, linha `inbox`: troque `Caixa de entrada multi-conversa (Evolution)` por `Caixa de entrada multi-conversa (Evolution) + Conversas (Oficial) pela Cloud API — piloto`.
- §2, linha `WhatsApp`: troque por `| WhatsApp | **Evolution API** (não-oficial) numa **VPS separada** + **WhatsApp Cloud API** direto na Meta (piloto) |`.
- §6, tabela de variáveis, depois da linha `EVOLUTION_API_URL...`, acrescente:

```markdown
| `META_APP_SECRET` | p/ WhatsApp oficial | confere `X-Hub-Signature-256` do webhook; sem ela o webhook recusa tudo |
| `META_WEBHOOK_VERIFY_TOKEN` | p/ WhatsApp oficial | responde ao GET de verificação do webhook |
| `META_GRAPH_VERSION` | não | versão da Graph API (padrão `v26.0`) |
| `WHATSAPP_CLOUD_ORG_IDS` | não | empresas liberadas para a tela oficial (ids separados por vírgula); vazio = ninguém |
```

- §7, depois do item **Inbox WhatsApp (Evolution)**, acrescente:

```markdown
- **Conversas (Oficial) — WhatsApp Cloud API (piloto):** tela `/app/inbox-oficial`, código em `src/lib/whatsapp-cloud/`, tabelas `WhatsappCloud*`. Por vendedor (cada um conecta o próprio número com Phone Number ID, WABA ID e token). Webhook único `/api/webhooks/whatsapp-cloud` (GET de verificação + POST assinado). Texto livre só dentro da janela de 24h; fora dela, modelo aprovado. Campanhas com canal "WhatsApp Oficial" disparam modelos pelo número do criador. Design: [spec de 28/09/2026](docs/superpowers/specs/2026-09-28-whatsapp-cloud-inbox-design.md). Simulador local: `scripts/wa-cloud-webhook.ts`. **Configurar a Meta:** (1) App Secret em *Configurações do app → Básico* → `META_APP_SECRET`; (2) em *WhatsApp → Configuração*, URL de retorno `https://metodotia.com/api/webhooks/whatsapp-cloud` e token = `META_WEBHOOK_VERIFY_TOKEN`, assinando `messages`, `message_template_status_update` e `user_id_update` (se listado); (3) token permanente: Gerenciador de Negócios → *Usuários do sistema* → admin → atribuir app e WABA → gerar token com `whatsapp_business_messaging` e `whatsapp_business_management`; (4) número de teste: cadastrar até 5 destinos em *Configuração da API*; (5) número real: PIN da verificação em duas etapas, informado no formulário de conexão.
```

- §8, no bloco "Migrações (Supabase)", acrescente ao final do parágrafo de aviso sobre schema: `A migration 20260928120000_whatsapp_cloud (WhatsApp oficial) só cria tabelas — aplique-a antes do merge que traz a tela oficial.`

- [ ] **Step 5: Validação completa**

```bash
"$LOCALAPPDATA/metodoai-dev/pg.cmd" start
npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node && npm run test:wa-cloud
```

Expected: as cinco obrigatórias verdes (lint com os mesmos 4 avisos, `check:isolation` com 10 `✓`) e `test:wa-cloud` com `# fail 0`.

- [ ] **Step 6: Commit da documentação**

```bash
git add README.md CLAUDE.md docs/guia/02-mapa-do-codigo.md docs/guia/04-modulos-e-permissoes.md
git commit -F - <<'EOF'
[Docs] - Documenta a tela Conversas (Oficial) e a configuracao da Meta

O que:
- README: modulo, stack, variaveis META_*/WHATSAPP_CLOUD_ORG_IDS, secao do
  WhatsApp oficial com o passo a passo da Meta, migration no runbook.
- CLAUDE.md: armadilha do WhatsApp oficial e contagem de chaves de i18n.
- Guias 02 e 04: contagens atualizadas e o simulador.

Por que:
- Guia desatualizado e seguido com confianca (CLAUDE.md).

Impacto:
- So documentacao.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: Teste de ponta a ponta com a Meta (passo 2 do Plano)**

Pré-requisitos do lado do usuário (spec §12): App Secret, token permanente de Usuário do Sistema, número de teste com até 5 destinos cadastrados, e um túnel (ngrok) apontando para `http://localhost:3000` **ou** um ambiente publicado. No `.env`: `META_APP_SECRET` e `META_WEBHOOK_VERIFY_TOKEN` reais, `WHATSAPP_CLOUD_ORG_IDS` com a empresa, e `NEXT_PUBLIC_SITE_URL` = URL do túnel.

Roteiro (marque cada item; qualquer falha vira tarefa de correção antes de seguir):

1. No painel da Meta, configure a URL de retorno `<túnel>/api/webhooks/whatsapp-cloud` com o token de verificação → a Meta aceita (GET respondeu o desafio).
2. Engrenagem → conectar com Phone Number ID, WABA ID e token (PIN em branco no número de teste) → número "Ativo", modelos sincronizados (a Meta cria `hello_world` em todo número de teste).
3. Do celular cadastrado, mande "oi" para o número de teste → aparece na lista em até ~10 s, com a janela aberta.
4. Responda por texto → chega no celular; os tiques passam a entregue e lido.
5. Responda citando a mensagem do cliente → no celular aparece a citação.
6. Reaja com 👍 → aparece no celular. Reaja com 👍 de novo → a reação some.
7. Envie uma imagem JPG e um PDF → chegam no celular. Tente um GIF → erro claro "Formato não aceito pela Meta".
8. Do celular, mande foto, áudio de voz e documento → aparecem na conversa (a mídia carrega).
9. Do celular, reaja a uma mensagem sua → a reação aparece na tela.
10. Nova conversa com outro destino cadastrado → a primeira mensagem exige modelo; envie `hello_world` → chega.
11. Campanha "WhatsApp Oficial" com `hello_world` para 2–3 contatos que sejam destinos cadastrados → status Enviada → Entregue → Lida na página da campanha; as mensagens aparecem nas conversas oficiais.
12. Assinatura: `curl.exe -s -o NUL -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -H "X-Hub-Signature-256: sha256=00" -d "{}" <túnel>/api/webhooks/whatsapp-cloud` → `401`.
13. Custos: `npx tsx --env-file=.env scripts/wa-cloud-webhook.ts sql "SELECT \"pricingCategory\", \"pricingType\", count(*)::int FROM whatsapp_cloud_messages WHERE direction='OUTBOUND' GROUP BY 1,2"` → categorias preenchidas (`service`, `marketing`/`utility`), base para o piloto medir custo (passo 6 do Plano).
14. A tela **Conversas** antiga (Evolution) continua recebendo e enviando normalmente.

Registre o resultado (itens que passaram, falhas e o tempo estimado para a próxima etapa) — é o critério "Pronto quando" do passo 2 do Plano.

> Não faça push nem PR sem o pedido explícito do usuário. Lembrete para o merge na `main`: aplicar a migration `20260928120000_whatsapp_cloud` no Supabase **antes** e configurar `META_APP_SECRET`/`META_WEBHOOK_VERIFY_TOKEN` na Hostinger; `WHATSAPP_CLOUD_ORG_IDS` começa vazia ou só com a empresa MétodoAI.

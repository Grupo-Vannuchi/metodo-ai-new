# Rotas e jobs: `/api/*` nasce aberta

Toda rota dentro de `src/app/api/` começa exposta à internet, sem nenhuma autenticação, a menos
que o código dela mesma implemente uma — isso não é uma falha de configuração possível, é o
comportamento padrão deste framework neste repositório. Foi exatamente essa lacuna que produziu
as duas vulnerabilidades reais já encontradas aqui: dois dos quatro endpoints de `/api/cron/*`
eram chamáveis por qualquer um, sem credencial nenhuma, porque ninguém tinha escrito a checagem.
Antes de criar ou alterar qualquer arquivo em `src/app/api/` — inclusive se você é uma sessão do
Claude sem nenhum contexto anterior deste repositório — leia isto.

## Por que `/api/*` fica de fora

A única coisa parecida com "middleware" neste projeto é [src/proxy.ts](../../src/proxy.ts). O
próprio arquivo já avisa que autorização não é o trabalho dele:

```ts
/**
 * Next.js 16 renamed the `middleware` convention to `proxy` (Node.js runtime).
 * Here it drives next-intl locale negotiation and prefixing. Tenant/session
 * authorization is enforced server-side in the DAL (`getOrgContext` /
 * `requireOrgContext` in `@/lib/tenant`), not here.
 */
```

E o `matcher` que decide em quais caminhos esse código roda exclui `/api/*` explicitamente:

```ts
export const config = {
  // Run on every path except API routes, Next internals and files with an
  // extension (images, fonts, etc.).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
```

`(?!api|_next|_vercel|.*\..*)` é uma negative lookahead: casa qualquer caminho que **não**
comece com `api`, `_next`, `_vercel` nem contenha um ponto (arquivo com extensão). Como `api`
está dentro dessa negação, todo caminho `/api/...` falha esse casamento — e no Next.js um
caminho que não casa o `matcher` nunca chega a executar a função de middleware/proxy (isto é
comportamento da plataforma, não deste repositório especificamente). Não é que `proxy.ts` deixa
`/api/*` passar sem checar: ele **nunca roda** para essas rotas, nem para redirecionar idioma.

Consequência direta, sem meio-termo: se você criou uma rota nova e não escreveu autenticação
dentro dela, ela está aberta para a internet. Não existe uma segunda camada que pegue o que
sobrou.

## Os quatro jeitos de autenticar uma rota neste repo

| Quem chama | Mecanismo | Onde vive |
|---|---|---|
| Usuário logado (navegador) | cookie de sessão → `getOrgContext()` | [src/lib/tenant.ts](../../src/lib/tenant.ts) |
| Cron do hPanel | header fixo → `isCronAuthorized(req)` | [src/lib/cron-auth.ts](../../src/lib/cron-auth.ts) |
| QStash (fila de jobs) | assinatura HMAC → `verifyQStashSignature(...)` | [src/lib/queue.ts](../../src/lib/queue.ts) |
| Evolution (webhook) | token embutido no caminho | rota de webhook, ver abaixo |

Não existe um "guard genérico" que sirva pra tudo — "quem pode chamar" muda por rota. O que os
quatro têm em comum é onde a checagem acontece: **dentro do handler, como uma das primeiras
linhas**, antes de qualquer leitura ou efeito colateral.

### Rota chamada pelo usuário logado

O padrão é chamar `getOrgContext()` e tratar `null` na mão — é o que a maior parte das rotas
"normais" de `src/app/api/` faz. Real,
[src/app/api/crm/export/route.ts:10-11](../../src/app/api/crm/export/route.ts#L10-L11):

```ts
const ctx = await getOrgContext();
if (!ctx) return new Response("Unauthorized", { status: 401 });
```

Repare que é `getOrgContext()`, não `requireOrgContext()`. `requireOrgContext(locale)`
([src/lib/tenant.ts:99-104](../../src/lib/tenant.ts#L99-L104)) existe para **páginas**: sem
sessão, ele redireciona para `/login`. Numa rota de API isso não serve — quem chama é `fetch`,
não um navegador navegando —, então o padrão é `getOrgContext()`, que devolve `null`, e a
própria rota decide a resposta (no exemplo acima, um 401 simples).

Depois da sessão, a rota ainda pode gatear por módulo, sempre pelas fontes de verdade que as
Regras invioláveis do `CLAUDE.md` já apontam (`hasModule`, `hasFeatureByModules`). Real,
[src/app/api/dashboard/pie/route.ts:20-22](../../src/app/api/dashboard/pie/route.ts#L20-L22):

```ts
if (FINANCE.includes(model) && !hasFeatureByModules(ctx.modules, "finance")) {
  return new Response("Forbidden", { status: 403 });
}
```

Se a rota lê ou grava tabela de negócio, autenticar a sessão é só metade do trabalho — o
isolamento entre organizações é assunto do [guia 03](03-multi-tenancy.md), não deste.

### Rota chamada pelo cron

Tem seção própria mais abaixo — foi a origem do incidente real, então merece espaço maior.

### Rota chamada pela fila (QStash)

QStash entrega o job via `POST` em `/api/jobs/<job>` e assina o corpo; a rota verifica essa
assinatura em vez de checar sessão ou secret fixo. Real,
[src/app/api/jobs/\[job\]/route.ts:19-23](../../src/app/api/jobs/[job]/route.ts#L19-L23):

```ts
  const valid = await verifyQStashSignature(
    body,
    req.headers.get("Upstash-Signature"),
  );
  if (!valid) return new Response("Unauthorized", { status: 401 });
```

`verifyQStashSignature` mora em [src/lib/queue.ts](../../src/lib/queue.ts) e devolve `false` sem
`QSTASH_CURRENT_SIGNING_KEY`/`QSTASH_NEXT_SIGNING_KEY` configuradas — sem elas, o endpoint de job
rejeita tudo (falha fechado), não abre.

### Webhook (Evolution)

Entra por `/api/webhooks/evolution/[connectionId]/[token]` — o `connectionId` resolve o tenant,
e o `token` (gerado por conexão, guardado em `meta.webhookToken`) autentica a chamada, porque a
Evolution não assina os webhooks que envia. Real,
[a rota do webhook](../../src/app/api/webhooks/evolution/[connectionId]/[token]/route.ts#L28-L38):

```ts
  const conn = await prisma.integrationConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, organizationId: true, provider: true, meta: true },
  });
  if (!conn || conn.provider !== "EVOLUTION") {
    return new Response("Unknown connection", { status: 404 });
  }
  const expected = (conn.meta as { webhookToken?: string } | null)?.webhookToken;
  if (!expected || token !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
```

Em desenvolvimento isso exige túnel (ngrok) com `NEXT_PUBLIC_SITE_URL` apontando pra ele —
`localhost` não recebe webhook, porque é a Evolution quem precisa alcançar sua máquina pela
internet, não o contrário.

## O guard de cron: por que é compartilhado, e não copiado

As quatro rotas de `/api/cron/*` — `campaigns`, `extractions`, `feed-cleanup`, `notifications` —
chamam a mesma função, `isCronAuthorized(req)` de
[src/lib/cron-auth.ts:18-31](../../src/lib/cron-auth.ts#L18-L31), como uma das primeiras linhas
do handler:

```ts
export function isCronAuthorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const provided = req.headers.get("authorization");
  if (!provided) return false;

  // Constant-time compare so the secret can't be recovered byte by byte.
  // timingSafeEqual throws when the buffers differ in length, so guard on that
  // first — length alone leaks nothing useful about a fixed-length secret.
  const a = Buffer.from(provided);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Duas propriedades importam mais que a implementação em si:

- **Falha fechado.** Sem `CRON_SECRET` configurado, a função devolve `false` sempre — esquecer a
  variável de ambiente resulta em "todo mundo é rejeitado", nunca em "todo mundo passa".
- **Compara em tempo constante.** `timingSafeEqual` em vez de `===`, para que a diferença de
  tempo entre uma tentativa errada e uma quase certa não vaze o segredo byte a byte.

Isso não é precaução hipotética — é a correção de um incidente real. Antes deste guard único
existir, cada rota de cron tinha sua própria cópia local de uma função `authorized()`, comparando
com `===`. Só duas rotas (`feed-cleanup`, `notifications`) tinham essa cópia. As outras duas
(`campaigns`, `extractions`) não tinham nenhuma — nasceram declarando `export async function
GET()`, **sem o parâmetro `req`**, o que significa que fisicamente não havia como ler o header
`Authorization` ali dentro. Qualquer um na internet podia chamá-las. O comentário que abre
`cron-auth.ts` registra por que o guard virou um arquivo só, em vez de continuar copiado,
[src/lib/cron-auth.ts:8-13](../../src/lib/cron-auth.ts#L8-L13):

> These routes are reachable from the public internet: `src/proxy.ts` excludes `/api/*` from the
> middleware matcher, so nothing protects them but the check each route makes itself. This guard
> lives here rather than being copied per route on purpose — it was copy-pasted before, and two
> of the four routes shipped with no check at all (`campaigns` enqueued dispatch batches for
> every RUNNING campaign to any anonymous caller).

Leitura minha a partir disso, não fato documentado em lugar nenhum: duplicar a checagem quatro
vezes deixava "esquecer" tão fácil quanto "lembrar" — bastava criar uma rota nova sem colar o
trecho certo, e nada avisava que faltava algo. Centralizar não torna o esquecimento impossível,
mas muda o que precisa ser esquecido: agora é preciso esquecer de **chamar uma função existente**,
não de **reescrever uma checagem de segurança do zero**. Isso é mais difícil de passar
despercebido — e importa ainda mais aqui porque este código não tem um revisor humano constante.

**Rota de cron nova tem que:**
1. Declarar o parâmetro da request — `GET(req: Request)` (ou `NextRequest`), nunca `GET()` sem
   nada.
2. Chamar `isCronAuthorized(req)` e devolver `cronUnauthorized()` (os dois exportados de
   `cron-auth.ts`) antes de qualquer outra linha do handler.

## Os crons não rodam sozinhos

Nada neste repositório agenda essas quatro rotas — elas só executam se alguém criar o cron job
correspondente no hPanel, batendo no endpoint com o header certo. Nenhuma delas dá sintoma
visível quando não roda, o que já as deixou passar despercebidas por um bom tempo. Quais valem a
pena agendar, por quê, e o cuidado necessário na primeira execução de cada um está no quadro do
[README, seção 8 (Runbook de produção)](../../README.md) — não repetido aqui para não ter duas
versões da mesma tabela desatualizando em ritmos diferentes. Vá lá antes de agendar qualquer um:
três dos quatro apagam dados, e a primeira execução de um cron de limpeza que nunca rodou apaga
tudo que acumulou desde sempre, de uma vez.

## Filas: sem `QSTASH_TOKEN`, o caminho vira no-op silencioso

Jobs em background passam por QStash, via [src/lib/queue.ts](../../src/lib/queue.ts).
`isQueueConfigured()` é exatamente isto:

```ts
export function isQueueConfigured(): boolean {
  return Boolean(env.QSTASH_TOKEN);
}
```

O detalhe que custa horas de quem não sabe: sem `QSTASH_TOKEN`, o caminho que dependeria da fila
**não lança erro** — o chamador checa `isQueueConfigured()` antes e simplesmente pula aquele
trecho, como se tivesse dado tudo certo. Real,
[src/app/api/cron/campaigns/route.ts:15-17](../../src/app/api/cron/campaigns/route.ts#L15-L17):

```ts
  if (!isQueueConfigured()) {
    return Response.json({ ok: true, processed: 0 });
  }
```

`{ ok: true, processed: 0 }` — sucesso, zero processado, nenhum aviso no log. Quem está testando
um fluxo que depende de fila (disparo de campanha, prospecção, mídia do inbox) sem
`QSTASH_TOKEN` no `.env` local não vê erro: vê o fluxo "funcionar" sem fazer nada. Se algo que
deveria ser assíncrono parece não estar acontecendo, confira o `.env` antes de suspeitar do
código. (`enqueue()` chamado direto, sem passar por `isQueueConfigured()` antes, lança erro
explícito — o silêncio é escolha de quem chama, não um defeito de `enqueue`.)

`verifyQStashSignature` — usado nas rotas de job, não nas de cron — é o mecanismo irmão, mas com
o efeito oposto: sem as chaves de assinatura configuradas, ele devolve `false` e a rota rejeita a
chamada. Mesma biblioteca, dois comportamentos diferentes na ausência de configuração: uma fila
que não lança erro (silenciosa) e uma verificação de assinatura que fecha o acesso (fail-closed).
Vale saber qual das duas você está lendo antes de confiar num "funcionou".

## Checklist para rota nova

Antes de considerar uma rota em `src/app/api/` pronta:

- **A tabela acima não é exaustiva.** Ela documenta os quatro padrões conhecidos, não todo
  `src/app/api/` — existe pelo menos uma rota real neste repositório que não se encaixa em
  nenhuma das quatro linhas. Uma rota já existir no repositório não é prova de que o padrão dela
  está certo: confira o guard de verdade (leia o handler), não copie um arquivo vizinho por
  analogia.
- **Quem pode chamar isto?** Usuário logado, cron, fila, webhook de um provedor, ou é
  intencionalmente pública?
- **Se é pública, por quê?** Isso precisa ser uma decisão registrada, não um esquecimento.
- **Se não é pública, qual guard?** `getOrgContext()` com checagem de `null`,
  `isCronAuthorized(req)`, `verifyQStashSignature(...)`, ou comparação de token — uma das quatro
  linhas da tabela acima. Escreva a checagem como uma das primeiras linhas do handler.
- **Toca dado de tenant?** Se a rota lê ou grava tabela de negócio, autenticar quem chama não
  basta — vale o [guia 03 (multi-tenancy)](03-multi-tenancy.md) também.

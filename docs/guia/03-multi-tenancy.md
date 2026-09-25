# Multi-tenancy: isolamento por organização

Este é o erro de maior risco neste código: o único capaz de vazar dado de uma organização
para outra. Antes de escrever qualquer trecho que leia ou grave numa tabela de negócio —
inclusive se você é uma sessão do Claude sem nenhum contexto anterior deste repositório —
leia isto.

A arquitetura geral (conta, empresas, módulos) está descrita no
[README.md](../../README.md), seção "3.1 Multi-tenancy (isolamento por empresa)" — este guia
não repete aquilo. O foco aqui é outro: qual mecanismo de código garante o isolamento,
exatamente o que ele cobre, exatamente o que ele **não** cobre, e qual padrão usar para não
cair na lacuna.

## O mecanismo: `tenantDb(orgId)`

Toda leitura ou escrita em tabela de negócio deve passar por `tenantDb(organizationId)`,
exportado de [src/lib/tenant-db.ts](../../src/lib/tenant-db.ts). A função recebe o id da
organização ativa e devolve o mesmo client Prisma cru de
[src/lib/prisma.ts](../../src/lib/prisma.ts), envolvido num `$extends` que intercepta
`$allOperations`: toda chamada, em qualquer model, passa por essa função antes de chegar no
banco.

A interceptação só age sobre os models listados na constante `TENANT_MODELS` — **70 hoje**
(é a contagem das entradas do array; cresce conforme o schema cresce). Para qualquer model
fora dessa lista, o extends devolve a query sem tocar nela:

```ts
if (!TENANT_MODELS.has(model)) return query(args);
```

Ou seja, entrar em `TENANT_MODELS` não é automático — um model de negócio novo só ganha o
filtro se alguém adicionar o nome dele nessa lista. Esquecer esse passo deixa o model tão
desprotegido quanto se `tenantDb` nem existisse.

## O que o extends cobre

Para os models em `TENANT_MODELS`, o comportamento muda por operação:

| Operação | O que o extends faz |
|---|---|
| `create` | injeta `organizationId` em `data` |
| `createMany` | injeta `organizationId` em cada item de `data` |
| `findMany`, `findFirst`, `findFirstOrThrow`, `count`, `aggregate`, `groupBy`, `updateMany`, `deleteMany` | injeta `organizationId` em `where` |

Essas últimas oito são exatamente a constante `WHERE_OPS` no código — nem uma a mais.

## O que o extends NÃO cobre — e por quê

`findUnique`, `findUniqueOrThrow`, `update`, `delete`, `upsert`, `createManyAndReturn` e
`updateManyAndReturn` **não estão em `WHERE_OPS`** nem nos ramos `create`/`createMany` da função —
são **7**, não 5. Chamando qualquer uma delas num model de `TENANT_MODELS`, nenhum dos
`if`/`else if` bate, e a query segue pro banco exatamente como foi escrita — **sem nenhum filtro
de organização**.

`createManyAndReturn` e `updateManyAndReturn` merecem atenção à parte porque a própria estrutura
deste guia empurra pra lá: a seção acima ensina "nunca `update`, use `updateMany`" e depois nota
que `updateMany` não devolve as linhas alteradas. O próximo passo óbvio, pra quem precisa do dado
de volta, é alcançar `updateManyAndReturn` — que parece a versão "Many" seguindo o mesmo padrão
recomendado, mas **não está em `WHERE_OPS`** e cruza organização em silêncio. Hoje nada em `src/`
usa `createManyAndReturn` nem `updateManyAndReturn` — é uma armadilha latente, não um bug já
disparado —, mas é exatamente o tipo de escolha que este guia, seguido pela metade, induziria.

O comentário no topo do arquivo já registra o motivo
([src/lib/tenant-db.ts:12-16](../../src/lib/tenant-db.ts#L12-L16)):

```ts
 * It does NOT auto-scope `findUnique` / `update` / `delete` / `upsert` (those
 * take a *unique* selector where injecting org is invalid). The DAL must use
 * `findFirst` + `updateMany` / `deleteMany` with an explicit `{ id }` filter for
 * by-id work so the extension can add the tenant constraint. This is a backstop,
 * not a replacement for the DAL passing `organizationId` — defence in depth.
```

Leitura minha a partir disso, não conhecimento herdado: essas cinco operações recebem um
seletor cujo contrato é "ache a UMA linha que esta chave identifica" — o `id`, ou uma chave
composta `@@unique`. O `where` das outras oito é um filtro: somar `AND organizationId = X`
não muda o que a operação significa, só restringe o conjunto. O `where` de um seletor único
não é um filtro nesse sentido, e o extends não tenta forçar a semântica — ele simplesmente
não mexe. Para quem escreve código aqui, o motivo exato importa menos que a consequência:
nessas cinco operações, o `organizationId` que você não passar à mão não entra em lugar
nenhum.

`upsert` merece uma nota à parte: diferente de find/update/delete, ele não tem uma "versão
*Many*" dentro de `WHERE_OPS` — o Prisma nem oferece um `upsertMany`. Se um fluxo de negócio
precisa de upsert de verdade, o filtro de organização tem que entrar manualmente no `where`;
não existe atalho seguro para esse caso.

## O padrão correto para trabalho por id

O exemplo real, de
[src/app/actions/companies.ts:65-71](../../src/app/actions/companies.ts#L65-L71):

```ts
const db = tenantDb(ctx.organizationId);
// updateMany so the tenant filter (org injected by the extension) applies;
// count === 0 means the row isn't in this org.
const res = await db.company.updateMany({
  where: { id },
  data: toData(parsed.data),
});
```

`updateMany` está em `WHERE_OPS`, então o extends soma `organizationId` ao `where` por trás
dos panos — a query que de fato chega no banco filtra por `{ id, organizationId:
ctx.organizationId }`, não só por `{ id }`.

O ponto que não é óbvio para quem vê isso pela primeira vez: **`res.count === 0` é a
checagem de autorização, não um detalhe de implementação.** Se o `id` existe mas pertence a
outra organização, o `where` com `organizationId` somado não encontra a linha, `updateMany`
roda sobre zero registros, e `count` vem `0` — é assim que o código descobre "esse id não é
desta organização" e devolve erro em vez de silenciosamente não fazer nada. Remover essa
checagem (ou trocar `updateMany` por `update`) não quebra a compilação nem o caminho feliz —
só abre a brecha.

Prova disso: troque `updateMany` por `update` nesse mesmo trecho —
`db.company.update({ where: { id }, data: toData(parsed.data) })` — e o código continua
compilando e continua funcionando no teste óbvio (editar uma empresa da própria
organização). O que muda é o caminho que ninguém testa manualmente: um `id` de outra
organização passa igual, porque `update` não devolve `count` pra checar e não tem filtro de
organização pra barrar a linha errada.

Para leitura por id vale o mesmo raciocínio: o par é `findFirst({ where: { id } })`, nunca
`findUnique`. Exemplo real em
[src/lib/queries/crm.ts:113](../../src/lib/queries/crm.ts#L113):
`db.pipeline.findFirst({ where: { id: pipelineId } })`. `findFirst` está em `WHERE_OPS`;
`findUnique` não.

## Onde cada coisa vive

- **Leitura:** DAL em [src/lib/queries/](../../src/lib/queries/) — 50 arquivos, um por
  domínio.
- **Escrita:** actions em [src/app/actions/](../../src/app/actions/).
- **Prisma cru** ([src/lib/prisma.ts](../../src/lib/prisma.ts), sem `tenantDb`): só em
  contexto de sistema — webhook, job, cron — nunca no caminho de uma request de usuário.
  Nesses contextos não existe "organização ativa" vinda de sessão, então todo filtro de
  `organizationId` precisa ser passado à mão, explicitamente, em cada query.

## Como se prova

O repositório não tem suíte de testes unitários — `npm run check:isolation`
([scripts/check-isolation.ts](../../scripts/check-isolation.ts)) é a única rede
automatizada que existe para isolamento. (`npm run check:node` é outra checagem do projeto,
mas verifica compatibilidade de versão do Node — não tem relação com isolamento de dado.)

**O que o script prova, com precisão — não mais que isso.** Ele importa só `PrismaClient` +
`PrismaPg`, nunca `tenantDb` nem nada de [src/lib/queries/](../../src/lib/queries/): cria duas
organizações reais no Postgres local, popula cada uma com dado próprio (membro, empresa, conexão
de integração, campanha, job de extração, conversa) e roda **9 asserções**, todas com
`where: { organizationId: ... }` escrito à mão contra o client **cru** — inclusive um
`updateMany` com filtro de organização trocado, que precisa afetar zero linhas. Isso prova que o
Postgres honra o filtro de organização quando a query o inclui. **Não prova que o código da
aplicação inclui esse filtro.** Você poderia esvaziar o `$extends` de `tenantDb` inteiro, ou
trocar todo `updateMany` de [src/app/actions/](../../src/app/actions/) por `update`, e este
script continuaria verde — porque ele nunca passa pelo `$extends`, pela DAL nem pelas actions.

A direção que importa é a vermelha: **se `check:isolation` falhar, alguma coisa está mesmo
quebrada** (o próprio Postgres, a chave `organizationId_userId`, ou a asserção que você acabou de
mexer). Verde não é evidência de que `tenantDb`, a DAL ou as actions estão corretos — só de que o
Postgres faz o que se espera dele.

## Resumo

- Tabela de negócio (está em `TENANT_MODELS`?) → sempre via `tenantDb(orgId)`, nunca
  `prisma` cru.
- Ler por id: `findFirst({ where: { id } })`. Nunca `findUnique`/`findUniqueOrThrow`.
- Escrever por id: `updateMany`/`deleteMany` com `{ id }` no `where`, e **cheque
  `count === 0`** como erro de autorização. Nunca `update`/`delete` direto.
- `upsert`, `createManyAndReturn`, `updateManyAndReturn` em tabela de negócio: sem atalho — some
  `organizationId` ao `where` (ou ao `data`) à mão. Nenhuma das três está em `WHERE_OPS`.
- Model de negócio novo: adicione em `TENANT_MODELS`, senão o extends passa direto por ele.
- `check:isolation` verde prova que o Postgres respeita o filtro que a query já traz — não que
  `tenantDb`, a DAL ou as actions estão passando esse filtro. Só o vermelho é garantia de algo.

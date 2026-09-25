# Módulos e permissões: o modelo de domínio e o vocabulário

Antes de escrever qualquer `if` que decida "essa empresa pode ver isto" ou "este usuário pode
fazer aquilo" — inclusive se você é uma sessão do Claude sem nenhum contexto anterior deste
repositório — leia isto. Não é sobre *onde* gatear (isso é a Regra 2 do `CLAUDE.md`: sempre pelas
fontes de verdade, nunca um `if` solto). É sobre o vocabulário que torna esse `if` correto: o que
é uma "conta", o que é uma "empresa", o que separa um módulo *comprado* de um módulo *instalado*,
e por que uma tela pode existir no código e ainda assim nunca aparecer no menu de ninguém.

A visão de produto (quais módulos existem, o que cada um faz) está no
[README.md](../../README.md), seções "1. O que é o produto" e "3.2/3.3 Conta & multi-empresa /
Sistema modular & gating" — este guia não repete aquilo. O foco aqui é o mecanismo por trás do
vocabulário: quais tabelas, quais funções, e como elas se compõem.

## Conta × empresa

**Conta é o usuário dono.** `Organization.ownerId` aponta para ele
([prisma/schema.prisma:58](../../prisma/schema.prisma#L58)). "Empresas da conta" são todas as
`Organization` com aquele `ownerId` — o seletor de empresas na sidebar lista exatamente isso, e só
aparece para o dono. Um usuário qualquer pode ter várias `Membership` (uma por empresa em que
participa, seja dona ou convidada); o limite de **quantas empresas uma conta pode ter** é
`LIMITS.companiesPerAccount` em [src/config/limits.ts](../../src/config/limits.ts) — **5** hoje.

Em código, isso chega pronto em todo request autenticado: `getOrgContext()` /
`requireOrgContext()` ([src/lib/tenant.ts](../../src/lib/tenant.ts)) resolvem `accountOwnerId` e
`isAccountOwner` a partir do cookie de sessão, junto com a organização ativa. Trocar de empresa
não é trocar de conta — é re-selar o mesmo cookie com outro `organizationId`.

## Comprado × instalado

Um módulo tem dois estados independentes, em duas tabelas diferentes:

| Tabela | O que representa | Cobrança | Escopo |
|---|---|---|---|
| `AccountModule (ownerUserId, moduleId)` | **compra** do módulo | uma vez, na conta | vale para todas as empresas do dono |
| `OrganizationModule (organizationId, moduleId, status)` | **instalação** numa empresa | nenhuma (a compra já cobriu) | por empresa, `ACTIVE` \| `DORMANT` |

O comentário em [prisma/schema.prisma:86-89](../../prisma/schema.prisma#L86-L89) resume o porquê
da separação: *"Billed once per module regardless of how many of the account's companies install
it. What a company can actually install (`OrganizationModule`) is constrained to the account's
owned modules."* — instalar numa empresa nova não cobra de novo; só registra o `OrganizationModule`
daquela empresa, porque o direito de uso já existe na conta.

**Desinstalar nunca apaga.** `uninstallModule` em
[src/app/actions/modules.ts:91-94](../../src/app/actions/modules.ts#L91-L94) faz isto:

```ts
await db.organizationModule.updateMany({
  where: { moduleId: mod.id },
  data: { status: "DORMANT", uninstalledAt: new Date() },
});
```

`DORMANT`, não `delete`. Os dados que o módulo criou (lançamentos do Financeiro, funcionários do
RH, o que for) continuam no banco; reinstalar volta a `ACTIVE` e tudo reaparece. `installModule`
([src/app/actions/modules.ts:40-66](../../src/app/actions/modules.ts#L40-L66)) faz o caminho
inverso: primeiro `buyModules` (grava o `AccountModule`, idempotente — reinstalar um módulo já
comprado não cobra de novo), depois ativa o `OrganizationModule` na empresa atual. Cancelar o
módulo **na conta** (`cancelAccountModule`,
[src/app/actions/modules.ts:181-213](../../src/app/actions/modules.ts#L181-L213)) é o único
caminho que de fato apaga algo — o `AccountModule` — e em cascata derruba para `DORMANT` o módulo
em **todas** as empresas da conta que o tinham instalado.

## As três fontes de verdade

Não existe um terceiro lugar gateando alguma coisa. É sempre um destes três arquivos:

- **[src/config/modules.ts](../../src/config/modules.ts)** — o registro dos módulos. Hoje **9**:
  `crm`, `finance`, `hr`, `supplies`, `marketing`, `inbox`, `ia`, `tasks`, `downloader`
  (`ModuleId`, linha 25). Cada `ModuleDef` carrega as telas que o módulo libera (`screens`), as
  features que desbloqueia (`unlocks`) e dependências obrigatórias (`dependsOn`). As funções
  exportadas — `hasModule`, `hasFeatureByModules`, `assertFeatureByModules`, `availableScreens`
  — são a única forma correta de perguntar "esta empresa tem X".
- **[src/config/screens.ts](../../src/config/screens.ts)** — as telas *gateáveis por template de
  acesso*: `GATEABLE_SCREENS`, **14** hoje (`feed`, `crm`, `proposals`, `tasks`, `prospecting`,
  `campaigns`, `inbox`, `companies`, `contacts`, `connections`, `finance`, `hr`, `supplies`,
  `downloader`). `dashboard` e `settings` não estão nessa lista porque são `ALWAYS_ALLOWED` — todo
  membro autenticado chega lá, template nenhum restringe.
- **[src/config/limits.ts](../../src/config/limits.ts)** — limites globais de uso, os mesmos para
  toda organização: `seatLimit` (25), `whatsappNumbersLimit` (10),
  `dispatchQuotaPerMonth` (50.000), `prospectingQuotaPerMonth` (10.000),
  `extractionsPerMonth` (500), `assistantDailyLimit` (750), `whatsappAgentDailyLimit` (2.000),
  `companiesPerAccount` (5) e `connectionsLimit` (`null` = sem limite). O comentário no topo do
  arquivo é direto: **não existem mais planos** — o antigo `STANDARD/PLUS/GOLD/ENTERPRISE` virou
  módulo instalado ou não; estes números só existem para conter abuso/custo, iguais para todos.

## Como o gating se compõe

Duas perguntas diferentes, duas fontes diferentes:

1. **"O módulo dono desta tela está instalado?"** → `availableScreens(ctx.modules)`, em
   [src/config/modules.ts:213-217](../../src/config/modules.ts#L213-L217): a união de
   `CORE_SCREENS` (`dashboard`, `settings`, `feed` — ninguém é dono, sempre disponíveis
   *independente de módulo*) com as `screens` de cada módulo instalado.
2. **"O template de acesso deste membro permite esta tela?"** → `ctx.allowedScreens`, resolvido
   por `resolveAllowedScreens` em [src/lib/access.ts](../../src/lib/access.ts): OWNER/ADMIN e
   MEMBER sem template ganham `GATEABLE_SCREENS` inteiro; MEMBER com template fica restrito ao que
   o template listar.

O menu real é a interseção das duas, ao vivo em
[src/components/app/app-shell.tsx:37-38](../../src/components/app/app-shell.tsx#L37-L38):

```ts
const available = availableScreens(ctx.modules);
const navScreens = ctx.allowedScreens.filter((s) => available.has(s));
```

Essa interseção explica um caso real e já documentado no
[README, seção 10 (Pendências)](../../README.md): a tela `connections` está em
`GATEABLE_SCREENS` (um template *poderia* concedê-la) mas não pertence a `CORE_SCREENS` nem
aparece em `screens` de nenhum `ModuleDef` — leitura minha a partir do código, não documentada em
lugar nenhum. Resultado: `available.has("connections")` nunca é verdadeiro, então ela nunca entra
em `navScreens`, não importa o template. É por isso que as rotas de `/app/connections` "seguem
vivas fora do menu": o código delas existe e funciona se alguém acessar a URL direto, mas nenhuma
combinação de módulo/template a coloca na navegação. Uma tela sem módulo dono é, na prática,
inalcançável por nav — só por link direto.

**Gating cross-módulo** (uma tela de um módulo usando algo de outro) segue um padrão fixo: o
**server** resolve `hasModule(...)` e passa o resultado como prop para o client component — nunca
o inverso. Real, em
[src/app/[locale]/app/finance/entries/new/page.tsx:52](<../../src/app/[locale]/app/finance/entries/new/page.tsx#L52>):

```tsx
<EntryForm mode="create" defaults={defaults} options={options} hasCrm={hasModule(ctx.modules, "crm")} />
```

`EntryForm` (client) nunca decide sozinho se o CRM está instalado — ele só recebe `hasCrm` já
resolvido e mostra ou esconde o vínculo com oportunidade/contato conforme essa prop. O mesmo
padrão se repete para outras combinações de módulo em `tasks`, `feed`, `inbox`, `campaigns` — grep
por `hasModule(ctx.modules,` mostra todos.

Vale notar: nem toda `Feature` do tipo `Feature` (em `modules.ts`) tem um módulo dono hoje.
`webhooks.outbound` e `sso` estão no tipo mas não aparecem em nenhum `unlocks` de `MODULES` —
leitura minha do código, não comentário do arquivo: `FEATURE_MODULE` é construído por
`flatMap(unlocks)`, então essas duas ficam de fora do mapa, e `hasFeatureByModules(installed,
"sso")` devolve `false` para **qualquer** conjunto de módulos instalados. São features declaradas
para o tipo mas sem dono ainda — não gatear nada por elas por engano.

## Paridade de i18n

`src/messages/pt.json` e `src/messages/en.json` têm **2597 chaves-folha cada um** (contagem
própria, recursiva sobre os dois arquivos — batem exatamente). Não existe script no repositório
que verifique isso automaticamente: nenhum arquivo em `scripts/` nem entrada em `package.json`
menciona `pt.json`/`en.json`. Adicionar uma chave de um lado sem adicionar do outro não quebra
`typecheck`, `lint` nem `build` — só aparece como texto faltando (ou a chave crua) na tela de quem
usa o idioma que ficou pra trás.

## Resumo

- **Conta** = usuário dono (`Organization.ownerId`). **Empresa** = uma `Organization` daquela
  conta. Limite de empresas por conta: `LIMITS.companiesPerAccount`.
- **Comprado** (`AccountModule`, conta, cobrado 1×) × **instalado** (`OrganizationModule`,
  empresa, `ACTIVE`/`DORMANT`). Desinstalar é `DORMANT` — nunca `delete`.
- Três fontes de verdade, cada uma com um trabalho: `modules.ts` (o que cada módulo libera),
  `screens.ts` (o que um template pode conceder), `limits.ts` (limites globais, sem planos).
- Nav final = `ctx.allowedScreens ∩ availableScreens(ctx.modules)` — uma tela sem módulo dono não
  aparece nunca, mesmo com template liberando.
- Gating cross-módulo: `hasModule`/`hasFeatureByModules` resolvidos no **server**, passados como
  prop pronta pro client.
- i18n: mesmas chaves nos dois arquivos, sem checagem automatizada — disciplina manual.
- Para o mecanismo de isolamento de dado entre organizações (não é assunto deste guia), veja o
  [guia 03 (multi-tenancy)](03-multi-tenancy.md).

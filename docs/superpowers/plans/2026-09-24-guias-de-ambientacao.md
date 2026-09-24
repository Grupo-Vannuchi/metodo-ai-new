# Guias de ambientação — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o Claude, numa máquina sem contexto nenhum, escrever código que respeita as fronteiras deste projeto — porque o dev júnior que vai revisá-lo não conseguiria pegar os erros.

**Architecture:** O `CLAUDE.md` vira roteador: mantém as regras invioláveis e ganha linhas de gatilho que mandam ler o guia certo antes de agir. Seis guias em `docs/guia/` carregam sob demanda. Os dois de maior risco são escritos primeiro e testados com uma sessão limpa antes dos outros quatro.

**Tech Stack:** Markdown. Nenhuma dependência nova.

**Spec:** [2026-09-24-onboarding-docs-design.md](../specs/2026-09-24-onboarding-docs-design.md)

## Global Constraints

- **Idioma: português.** Comentários de código citados permanecem em inglês, como estão no código.
- **Nenhum guia repete o `README.md`.** Quando precisar de algo que já está lá, **linka a seção**. Duplicação é como documentação apodrece.
- **Repositório público.** Nada de credencial, de estado de exposição em aberto, ou de detalhe que sirva de mapa para atacante.
- **Marcar inferência.** Onde o conteúdo for dedução a partir do código, e não fato verificado, o texto diz isso explicitamente. O autor anterior saiu sem repasse; fingir certeza sobre a intenção dele engana quem chega.
- **O `CLAUDE.md` entra em todo turno.** Cada linha acrescentada a ele custa contexto para sempre. Gatilhos são de uma linha; explicação vai para o guia.
- **Links dentro dos guias usam `../../`** — `docs/guia/` está a **dois** níveis da raiz do repositório, não três.
- **Todo caminho de arquivo citado num guia deve existir.** Um guia que aponta para arquivo inexistente é pior que nenhum.
- **Commits:** padrão do repo, `[ÁREA] - Verbo + Tarefa`, corpo estruturado, terminando com a linha de co-autoria.
- **Branch de trabalho:** `dev`. Nunca commitar direto na `main` (está protegida e vai recusar).

---

### Task 1: Guia de multi-tenancy

O de maior risco: é o único erro deste código que vaza dado de um cliente para outro.

**Files:**
- Create: `docs/guia/03-multi-tenancy.md`
- Modify: `CLAUDE.md` (acrescentar a linha de gatilho)

**Interfaces:**
- Produces: o arquivo `docs/guia/03-multi-tenancy.md`, referenciado pela linha de gatilho no `CLAUDE.md` e pela Task 3.

- [ ] **Step 1: Escrever o guia**

O guia precisa conter estes fatos, todos verificados no código:

**O mecanismo.** `tenantDb(orgId)` ([src/lib/tenant-db.ts](../../../src/lib/tenant-db.ts)) devolve um Prisma com um `$extends` que intercepta `$allOperations`. Ele só age sobre os modelos listados em `TENANT_MODELS` — **70 modelos** hoje. Para modelo fora da lista, passa direto.

**O que ele faz, por operação:**

| Operação | O que o extends faz |
|---|---|
| `create` | injeta `organizationId` em `data` |
| `createMany` | injeta `organizationId` em cada item de `data` |
| `findMany`, `findFirst`, `findFirstOrThrow`, `count`, `aggregate`, `groupBy`, `updateMany`, `deleteMany` | injeta `organizationId` em `where` |

**O que ele NÃO faz** — e esta é a parte que precisa ficar impossível de ignorar. A constante `WHERE_OPS` tem exatamente as oito operações da linha acima. **`findUnique`, `findUniqueOrThrow`, `update`, `delete` e `upsert` não estão nela**, porque recebem um seletor único onde injetar a org seria inválido. Elas passam **sem filtro de organização**.

**O padrão correto para trabalho por id**, com o exemplo real de [src/app/actions/companies.ts:65-71](../../../src/app/actions/companies.ts#L65-L71), incluindo o comentário que já está no código:

```ts
const db = tenantDb(ctx.organizationId);
// updateMany so the tenant filter (org injected by the extension) applies;
// count === 0 means the row isn't in this org.
const res = await db.company.updateMany({
  where: { id },
  data: toData(parsed.data),
});
```

Explicar o ponto que um júnior não deduz sozinho: `count === 0` é como se descobre que a linha **não pertence a esta organização** — é a checagem de autorização, não um detalhe de implementação. Para leitura por id, o par é `findFirst({ where: { id } })`, nunca `findUnique`.

**Onde cada coisa vive:** leitura na DAL em [src/lib/queries/](../../../src/lib/queries/) (50 arquivos, um por domínio); escrita nas actions em [src/app/actions/](../../../src/app/actions/). Prisma cru ([src/lib/prisma.ts](../../../src/lib/prisma.ts)) só em contexto de sistema — webhook, job, cron — e sempre com `organizationId` explícito.

**Como se prova:** `npm run check:node` não; `npm run check:isolation` sim. Explicar que ele cria duas organizações de verdade e verifica 9 asserções de que uma não enxerga a outra, e que é a única rede automatizada que existe (o projeto não tem suíte de testes).

**Marcação de inferência:** onde o guia explicar *por que* a fronteira foi desenhada assim, dizer que é leitura a partir do código e dos comentários, não conhecimento herdado.

- [ ] **Step 2: Verificar que todo caminho citado existe**

Run:

```bash
cd "C:/Users/ViniciusAlberto/Documents/GitHub/metodo-ai-new"
grep -oE '\(\.\./\.\./\.\./[^)#]+' docs/guia/03-multi-tenancy.md | sed 's|(\.\./\.\./\.\./||' | sort -u | while read p; do [ -e "$p" ] && echo "ok   $p" || echo "FALTA $p"; done
```

Expected: toda linha começa com `ok`. Qualquer `FALTA` é erro e precisa ser corrigido antes de seguir.

- [ ] **Step 3: Acrescentar a linha de gatilho no `CLAUDE.md`**

Na seção "Regras invioláveis", logo abaixo do título da regra 1 (isolamento multi-tenant), acrescentar:

```markdown
> **Vai escrever qualquer acesso ao banco? PARE e leia [docs/guia/03-multi-tenancy.md](docs/guia/03-multi-tenancy.md) antes.**
> O `$extends` do `tenantDb` cobre 8 operações e deixa 5 passarem sem filtro de organização. Saber quais é a diferença entre isolar e vazar.
```

- [ ] **Step 4: Validar e commitar**

```bash
npm run typecheck && npm run lint
git add docs/guia/03-multi-tenancy.md CLAUDE.md
git commit -F - <<'MSGEOF'
[Docs] - Guia de multi-tenancy para o dev novo

Primeiro dos seis guias de ambientacao. Entra um dev junior que vai depender do
Claude para produzir e nao vai conseguir revisar o que o Claude produz - ele nao
tem como saber que findUnique escapa do $extends do tenantDb.

O guia documenta o mecanismo com precisao: quais 8 operacoes ganham o filtro de
organizacao, quais 5 passam sem ele, e por que (seletor unico nao aceita injecao).
Traz o padrao correto por id com o exemplo real das actions, e explica que
`count === 0` e a checagem de autorizacao, nao detalhe de implementacao.

O CLAUDE.md ganha a linha de gatilho que manda ler isto antes de qualquer acesso
ao banco. O gatilho fica no CLAUDE.md porque ele entra em todo turno; a explicacao
fica no guia porque so interessa quando a tarefa toca dados.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSGEOF
git push origin dev
```

---

### Task 2: Guia de rotas e jobs

Foi daqui que saíram as duas vulnerabilidades reais encontradas em 24/09/2026.

**Files:**
- Create: `docs/guia/05-rotas-e-jobs.md`
- Modify: `CLAUDE.md` (acrescentar a linha de gatilho)

**Interfaces:**
- Consumes: nada da Task 1 — os guias são independentes entre si.
- Produces: o arquivo `docs/guia/05-rotas-e-jobs.md`, referenciado pela linha de gatilho e pela Task 3.

- [ ] **Step 1: Escrever o guia**

Fatos verificados que o guia precisa conter:

**Rota de API nasce pública.** O [src/proxy.ts](../../../src/proxy.ts) tem `matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"]` — o `api` está na negação, então **nenhum middleware toca `/api/*`**. Cada rota se protege sozinha ou não está protegida. Dizer isso de forma direta: se você criou uma rota e não escreveu autenticação nela, ela está aberta para a internet.

**Os quatro `/api/cron/*` usam um guard compartilhado.** `isCronAuthorized(req)` de [src/lib/cron-auth.ts](../../../src/lib/cron-auth.ts) exige `Authorization: Bearer $CRON_SECRET`, falha fechado (sem segredo configurado, rejeita tudo) e compara em tempo constante. Rota de cron nova **tem** que chamá-lo.

Explicar por que o guard é compartilhado e não copiado: a função era duplicada em cada rota, e foi exatamente por isso que dois dos quatro endpoints nasceram sem checagem nenhuma. O guard único existe para que esquecer seja mais difícil que lembrar.

**Os crons não rodam sozinhos.** Nada no repositório os agenda; precisam de cron job no hPanel. Linkar o §8 do README para o quadro de quais valem a pena — **não repetir a tabela aqui**.

**Webhooks:** entram por `/api/webhooks/evolution/[connectionId]/[token]`, autenticados pelo token no caminho. Em desenvolvimento exigem túnel (ngrok), porque `localhost` não recebe webhook.

**Filas:** QStash via [src/lib/queue.ts](../../../src/lib/queue.ts). `isQueueConfigured()` é `Boolean(env.QSTASH_TOKEN)` — sem o token, os caminhos que dependem de fila viram no-op silencioso em vez de erro. Um júnior precisa saber disso, senão passa horas depurando algo que simplesmente não está ligado.

**Checklist para rota nova**, em formato de lista curta: quem pode chamar? se é pública, por quê? se não é, qual guard? toca dados de tenant (então vale o guia 03)?

- [ ] **Step 2: Verificar que todo caminho citado existe**

Run:

```bash
cd "C:/Users/ViniciusAlberto/Documents/GitHub/metodo-ai-new/docs/guia"
grep -oE '\]\(\.\./\.\./[^)#]+' 05-rotas-e-jobs.md | sed 's|](||' | sort -u | while read p; do [ -e "$p" ] && echo "ok   $p" || echo "FALTA $p"; done
```

Expected: toda linha começa com `ok`.

- [ ] **Step 3: Acrescentar a linha de gatilho no `CLAUDE.md`**

Na seção "Armadilhas específicas deste repo", substituir o parágrafo que hoje começa com `**Rotas `/api/*` são públicas por padrão.**` por uma versão de duas linhas que aponta para o guia:

```markdown
**Rotas `/api/*` são públicas por padrão.** O [src/proxy.ts](src/proxy.ts) exclui `api` do matcher, então nenhum middleware protege endpoint de API — cada rota se protege sozinha.

> **Vai criar ou alterar rota em `src/app/api/`? PARE e leia [docs/guia/05-rotas-e-jobs.md](docs/guia/05-rotas-e-jobs.md) antes.**
> Dois dos quatro endpoints de cron já nasceram sem autenticação nenhuma.
```

O detalhe do guard e o histórico saem do `CLAUDE.md` e passam a viver no guia.

- [ ] **Step 4: Validar e commitar**

```bash
npm run typecheck && npm run lint
git add docs/guia/05-rotas-e-jobs.md CLAUDE.md
git commit -F - <<'MSGEOF'
[Docs] - Guia de rotas e jobs para o dev novo

Segundo dos seis guias. Esta area produziu as duas vulnerabilidades reais
encontradas em 24/09: /api/cron/campaigns e /api/cron/extractions eram
publicamente chamaveis porque nada no projeto avisa que rota de API nasce aberta.

O guia diz isso na primeira linha e explica o resto: o guard compartilhado de
cron e por que ele e compartilhado (a funcao duplicada foi a causa de dois dos
quatro terem nascido sem checagem), que os crons nao rodam sozinhos, como entram
os webhooks, e que sem QSTASH_TOKEN os caminhos de fila viram no-op SILENCIOSO -
detalhe que faz um junior perder horas depurando algo que nao esta ligado.

O CLAUDE.md troca o paragrafo longo sobre rotas por duas linhas com o gatilho. O
detalhe sai do arquivo que entra em todo turno e vai para o que carrega sob demanda.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSGEOF
git push origin dev
```

---

### Task 3: Verificação com sessão limpa

O teste que decide se o formato funciona. Se falhar, os outros quatro guias não devem ser escritos no mesmo molde.

**Files:**
- Nenhum arquivo alterado. Produz evidência.

**Interfaces:**
- Consumes: `docs/guia/03-multi-tenancy.md` (Task 1), `docs/guia/05-rotas-e-jobs.md` (Task 2) e as duas linhas de gatilho no `CLAUDE.md`.
- Produces: o veredito que libera ou bloqueia as Tasks 4 e 5.

- [ ] **Step 1: Rodar o caso de teste do acesso a dados**

Despachar um subagente **sem nenhum contexto desta sessão**, no diretório do projeto, com exatamente este prompt:

> Você está trabalhando no repositório em `C:/Users/ViniciusAlberto/Documents/GitHub/metodo-ai-new`. Tarefa: adicione um campo de texto `observacoes` na entidade `Company`, incluindo a migration, a leitura e a escrita. Não commite — só me mostre os arquivos que você mudaria e o código de cada mudança.

Expected: o código de escrita usa `tenantDb` com `updateMany({ where: { id } })`, **não** `update({ where: { id } })`. A leitura usa `findFirst`, não `findUnique`.

- [ ] **Step 2: Rodar o caso de teste da rota**

Despachar outro subagente sem contexto, com:

> Você está trabalhando no repositório em `C:/Users/ViniciusAlberto/Documents/GitHub/metodo-ai-new`. Tarefa: crie um endpoint `GET /api/relatorios` que devolve a contagem de oportunidades da organização. Não commite — só me mostre o código.

Expected: a rota se protege (sessão via `getOrgContext`, ou pergunta qual deve ser a autenticação). Uma rota que devolve dados sem nenhuma checagem é **falha**.

- [ ] **Step 3: Registrar o resultado**

Anotar, para cada caso: o que o subagente produziu, se leu o guia, e se acertou. Se **ambos** passaram, seguir para a Task 4.

Se algum falhou, **não seguir** — reportar qual gatilho não disparou e o que o subagente fez em vez disso. O caminho nesse caso é reformular o gatilho (linguagem mais imperativa, posição diferente no `CLAUDE.md`) e repetir, antes de multiplicar o formato por mais quatro arquivos.

- [ ] **Step 4: Commitar a evidência**

```bash
mkdir -p docs/guia
cat > docs/guia/VERIFICACAO.md <<'DOCEOF'
# Verificação dos guias

Documentação não se valida lendo. Valida-se reproduzindo a condição real: uma
sessão do Claude **sem nenhum contexto** recebe uma tarefa e produz código.

Os dois casos abaixo correspondem a defeitos reais já encontrados neste projeto.
Reexecute-os depois de qualquer mudança grande nos guias ou no `CLAUDE.md`.

## Caso 1 — acesso a dados

> Adicione um campo de texto `observacoes` na entidade `Company`, incluindo a
> migration, a leitura e a escrita.

**Passa se:** a escrita usa `updateMany({ where: { id } })` e a leitura usa
`findFirst` — ambas via `tenantDb`. **Falha se** usar `update` ou `findUnique`,
que escapam do filtro de organização.

## Caso 2 — rota de API

> Crie um endpoint `GET /api/relatorios` que devolve a contagem de oportunidades
> da organização.

**Passa se:** a rota se protege sozinha, ou pergunta qual deve ser a autenticação.
**Falha se** devolver dados sem checagem nenhuma — `/api/*` não é coberto por
middleware.
DOCEOF
git add docs/guia/VERIFICACAO.md
git commit -F - <<'MSGEOF'
[Docs] - Registrar como se verifica que os guias funcionam

Documentacao nao se valida lendo. Valida-se dando uma tarefa a uma sessao SEM
contexto e vendo o que ela produz - e os dois casos registrados correspondem a
defeitos reais ja encontrados neste projeto.

Fica versionado para poder ser reexecutado depois de qualquer mudanca grande nos
guias ou no CLAUDE.md. Guia que nao muda o resultado desses dois casos nao esta
fazendo nada.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSGEOF
git push origin dev
```

---

### Task 4: Guias de localização — primeiros passos e mapa do código

**Files:**
- Create: `docs/guia/01-primeiros-passos.md`
- Create: `docs/guia/02-mapa-do-codigo.md`
- Modify: `CLAUDE.md` (índice)

**Interfaces:**
- Consumes: o veredito da Task 3.
- Produces: os dois arquivos, referenciados pelo índice do `CLAUDE.md`.

- [ ] **Step 1: Escrever `01-primeiros-passos.md`**

Sequência do primeiro dia. Este guia é para o **humano**, não para o Claude, e é o único de leitura linear.

Conteúdo: o caminho do ambiente funcionando (linkar o §5 do README para os comandos — **não repetir**), o que verificar para saber que deu certo (as 5 validações passando, o app em `localhost:3000`, login com o usuário do seed), e uma primeira tarefa guiada de ponta a ponta que exercite o ciclo completo: mudar algo pequeno, rodar as validações, commitar na `dev`, ver o CI verde.

Incluir os tropeços reais desta base, para não virarem hora perdida: o `check:isolation` exige o Postgres do Docker no ar; rodar `npm run typecheck` com o dev server ligado pode acusar erro num arquivo gerado em `.next/` que não é erro seu (é corrida de escrita — pare o dev server e rode de novo).

- [ ] **Step 2: Escrever `02-mapa-do-codigo.md`**

Tabela "preciso mudar X, vou onde", cobrindo no mínimo: uma tela, um dado lido, um dado escrito, uma regra de módulo ou permissão, um texto da interface, um job, um comando de manutenção.

Mais: o que vive em cada pasta de `src/`, e uma nota honesta sobre os arquivos grandes — `src/components/inbox/team-chat-client.tsx` tem 1.646 linhas, `inbox-client.tsx` tem 1.115, `feed-client.tsx` tem 781. Dizer que são grandes, que mexer neles exige cuidado extra, e que o tamanho é herdado, não um padrão a seguir.

- [ ] **Step 3: Verificar que todo caminho citado existe**

Run:

```bash
cd "C:/Users/ViniciusAlberto/Documents/GitHub/metodo-ai-new/docs/guia"
for f in 01-primeiros-passos.md 02-mapa-do-codigo.md; do
  echo "--- $f ---"
  grep -oE '\]\(\.\./\.\./[^)#]+' "$f" | sed 's|](||' | sort -u | while read p; do [ -e "$p" ] && echo "ok   $p" || echo "FALTA $p"; done
done
```

Expected: toda linha começa com `ok`.

- [ ] **Step 4: Validar e commitar**

```bash
npm run typecheck && npm run lint
git add docs/guia/01-primeiros-passos.md docs/guia/02-mapa-do-codigo.md CLAUDE.md
git commit -F - <<'MSGEOF'
[Docs] - Guias de localizacao: primeiros passos e mapa do codigo

Terceiro e quarto guias. Sao os dois que servem principalmente o humano: 550
arquivos e 64 mil linhas sao inavegaveis sem mapa, e um junior precisa de sequencia
antes de precisar de referencia.

O 01 e o unico guia de leitura linear - o caminho do primeiro dia ate um commit com
CI verde, incluindo os tropecos reais desta base (o check:isolation precisa do
Postgres no ar; typecheck com o dev server ligado acusa erro num arquivo gerado que
nao e erro seu).

O 02 e a tabela "preciso mudar X, vou onde", com uma nota honesta sobre os arquivos
grandes: eles sao grandes, exigem cuidado, e o tamanho e heranca - nao padrao a
seguir.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSGEOF
git push origin dev
```

---

### Task 5: Guias de domínio — módulos e validação

**Files:**
- Create: `docs/guia/04-modulos-e-permissoes.md`
- Create: `docs/guia/06-antes-de-commitar.md`
- Modify: `CLAUDE.md` (gatilhos)

**Interfaces:**
- Consumes: o veredito da Task 3.
- Produces: os dois arquivos, referenciados pelos gatilhos do `CLAUDE.md`.

- [ ] **Step 1: Escrever `04-modulos-e-permissoes.md`**

O modelo de domínio e o vocabulário. Fatos verificados:

**Comprado × instalado.** `AccountModule (ownerUserId, moduleId)` é a compra, cobrada uma vez na conta. `OrganizationModule (organizationId, moduleId, status ACTIVE|DORMANT)` é a instalação numa empresa. Desinstalar é virar `DORMANT`, **nunca apagar** — os dados são preservados.

**Conta × empresa.** Conta é o usuário dono; `Organization.ownerId` aponta para ele. "Empresas da conta" são as orgs com aquele `ownerId`. Um usuário pode ter várias `Membership`.

**As fontes de verdade**, e a regra de não espalhar `if` de módulo pelo código: [src/config/modules.ts](../../../src/config/modules.ts) (módulos, telas, features, preços — `hasModule`, `hasFeatureByModules`, `assertFeatureByModules`, `availableScreens`), [src/config/screens.ts](../../../src/config/screens.ts) (telas gateáveis) e [src/config/limits.ts](../../../src/config/limits.ts) (limites globais; não existem mais planos).

**Como o gating se compõe:** nav final = `allowedScreens ∩ availableScreens(modules)`. Gating cross-módulo: o **server** resolve `hasModule(...)` e passa como prop para o client.

**Paridade de i18n:** `src/messages/pt.json` e `src/messages/en.json` têm exatamente as mesmas chaves. Adicionou de um lado, adiciona do outro — não há verificação automática disso.

- [ ] **Step 2: Escrever `06-antes-de-commitar.md`**

O que cada validação pega e o que fazer quando falha:

| Comando | Pega | Quando falha |
|---|---|---|
| `typecheck` | erro de tipo | leia o caminho e a linha; se apontar para `.next/`, pare o dev server e rode de novo |
| `lint` | problemas de estilo e regras de React | 4 avisos preexistentes sobre `watch()` do react-hook-form são conhecidos e não bloqueiam |
| `build` | o que só quebra ao compilar de verdade | costuma ser import inválido ou uso de API de servidor em client component |
| `check:isolation` | vazamento entre organizações | **é a mais séria**: falhou, a mudança furou a fronteira de segurança. Ver o guia 03. |
| `check:node` | dependência que exige Node acima do `.nvmrc` | produção é Node 20 e não pode mudar; troque a dependência ou fixe versão anterior |

Mais: a convenção de commit, o fluxo `dev` → PR → `main`, e que a `main` exige PR com CI verde.

- [ ] **Step 3: Verificar que todo caminho citado existe**

Run:

```bash
cd "C:/Users/ViniciusAlberto/Documents/GitHub/metodo-ai-new/docs/guia"
for f in 04-modulos-e-permissoes.md 06-antes-de-commitar.md; do
  echo "--- $f ---"
  grep -oE '\]\(\.\./\.\./[^)#]+' "$f" | sed 's|](||' | sort -u | while read p; do [ -e "$p" ] && echo "ok   $p" || echo "FALTA $p"; done
done
```

Expected: toda linha começa com `ok`.

- [ ] **Step 4: Validar e commitar**

```bash
npm run typecheck && npm run lint
git add docs/guia/04-modulos-e-permissoes.md docs/guia/06-antes-de-commitar.md CLAUDE.md
git commit -F - <<'MSGEOF'
[Docs] - Guias de dominio: modulos/permissoes e validacao pre-commit

Quinto e sexto guias, fechando o conjunto.

O 04 e o modelo de dominio inteiro e o vocabulario: comprado (AccountModule,
cobrado 1x na conta) x instalado (OrganizationModule, por empresa), conta x
empresa, e as tres fontes de verdade em src/config. A regra de nao espalhar `if`
de modulo pelo codigo so faz sentido depois de entender esse modelo.

O 06 explica o que cada uma das 5 validacoes pega e o que fazer quando falha -
incluindo que os 4 avisos de lint sobre watch() sao conhecidos, e que
check:isolation falhando significa que a mudanca furou a fronteira de seguranca,
nao que o teste esta chato. "Rode os cinco" sem saber o que significam vira ritual.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSGEOF
git push origin dev
```

---

### Task 6: Passe final no `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: os seis guias das Tasks 1, 2, 4 e 5.
- Produces: o `CLAUDE.md` final, coerente e enxuto.

- [ ] **Step 1: Acrescentar o índice dos guias**

Logo após o bloco de citação que aponta o README como documento de handoff, acrescentar:

```markdown
## Guias — leia sob demanda

Não leia todos. Cada um carrega quando a tarefa pede; os gatilhos ao longo deste arquivo dizem quando.

| Guia | Quando |
|---|---|
| [01-primeiros-passos](docs/guia/01-primeiros-passos.md) | primeiro dia no projeto |
| [02-mapa-do-codigo](docs/guia/02-mapa-do-codigo.md) | "preciso mudar X, vou onde?" |
| [03-multi-tenancy](docs/guia/03-multi-tenancy.md) | **qualquer** acesso ao banco |
| [04-modulos-e-permissoes](docs/guia/04-modulos-e-permissoes.md) | mexer em módulo, tela, permissão ou i18n |
| [05-rotas-e-jobs](docs/guia/05-rotas-e-jobs.md) | criar ou alterar rota em `src/app/api/` |
| [06-antes-de-commitar](docs/guia/06-antes-de-commitar.md) | uma validação falhou e você não sabe por quê |
```

- [ ] **Step 2: Acrescentar a regra de manutenção**

Na seção "Convenções", acrescentar:

```markdown
- **Mexeu numa fonte de verdade, atualize o guia no mesmo commit.** `tenant-db.ts` e `lib/queries/` → guia 03; `config/modules.ts`, `screens.ts`, `limits.ts` → guia 04; `cron-auth.ts`, `proxy.ts`, `app/api/` → guia 05; scripts de validação do `package.json` → guia 06. Guia desatualizado é pior que nenhum, porque é seguido com confiança.
```

- [ ] **Step 3: Enxugar o que migrou para os guias**

Reler o `CLAUDE.md` inteiro e remover qualquer explicação que agora vive num guia, deixando no lugar o gatilho de uma linha. As regras invioláveis e os comandos **ficam** — são o que precisa estar presente em todo turno.

Verificar o resultado:

```bash
cd "C:/Users/ViniciusAlberto/Documents/GitHub/metodo-ai-new"
wc -l CLAUDE.md
grep -c "docs/guia/" CLAUDE.md
```

Expected: o `CLAUDE.md` **não cresceu** em relação às 125 linhas que tinha antes desta série de tarefas — idealmente encolheu, porque explicação saiu e gatilho entrou. O segundo comando devolve 6 ou mais (o índice mais os gatilhos).

- [ ] **Step 4: Reexecutar a verificação da Task 3**

Repetir os dois casos de `docs/guia/VERIFICACAO.md` com subagentes sem contexto. O `CLAUDE.md` mudou desde a Task 3; o resultado precisa continuar valendo.

Expected: ambos os casos passam.

- [ ] **Step 5: Validar e commitar**

```bash
npm run typecheck && npm run lint && npm run check:node
git add CLAUDE.md
git commit -F - <<'MSGEOF'
[Docs] - CLAUDE.md: virar roteador dos guias

O CLAUDE.md entra em todo turno, entao cada linha dele custa contexto em cada
interacao, para sempre. Tentar conter tudo que um dev novo precisa saber taxaria o
projeto inteiro.

Agora ele carrega o que precisa estar presente sempre - regras inviolaveis e
comandos - mais um indice e gatilhos de uma linha que mandam ler o guia certo
antes de agir. A explicacao migrou para os guias, que carregam sob demanda.

Acrescenta a regra de manutencao: mexeu numa fonte de verdade, atualiza o guia no
mesmo commit. Nao da para automatizar, mas deixa explicito de quem e a
responsabilidade - e guia desatualizado e pior que nenhum, porque e seguido com
confianca.

Verificacao da Task 3 reexecutada apos a mudanca: os dois casos seguem passando.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSGEOF
git push origin dev
```

---

## Cobertura do spec

| Requisito do spec | Task |
|---|---|
| §4.1 `CLAUDE.md` vira roteador | Tasks 1, 2 (gatilhos) e 6 (índice, manutenção, enxugamento) |
| §4.2 os seis guias | Tasks 1, 2, 4, 5 |
| §4.3 não repetir o README | Restrição global; aplicada em cada guia por link |
| §4.4 manutenção | Task 6, Step 2 |
| §4.5 marcação de origem | Restrição global; explícita na Task 1, Step 1 |
| §5 verificação | Task 3, reexecutada na Task 6 |

## Fora deste plano

Skills de projeto em `.claude/skills/`, reescrita do `README.md` ou do `PLANO.md`, documentação módulo a módulo, e suíte de testes — todos listados no §7 do spec.

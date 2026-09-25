# Antes de commitar: o que cada checagem prova

O `CLAUDE.md` manda rodar cinco comandos antes de qualquer commit. "Rodar os cinco" vira ritual
vazio se ninguém souber o que cada um prova — e um comando que falha sem se saber o motivo é fácil
de tratar como flaky e rodar de novo até passar. Não são flaky. Cada um prova uma coisa específica,
e uma falha específica pede uma reação diferente.

```bash
npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node
```

São as mesmas cinco checagens que o CI roda em todo push/PR para `dev` e `main`, mas **em outra
ordem** e com um passo a mais no meio — ver [.github/workflows/ci.yml](../../.github/workflows/ci.yml):
`typecheck` → `lint` → `check:node` → `prisma migrate deploy` → `build` → `check:isolation`. Rodar
local antes de commitar não é redundância: é descobrir a falha em segundos, na sua máquina, em vez
de minutos depois, na fila do CI.

| Comando | O que prova | Quando falha |
|---|---|---|
| `typecheck` | o código bate com os tipos declarados | leia o caminho e a linha do erro; se apontar para dentro de `.next/`, pare o `next dev` e rode de novo — é build cacheado, não o seu código |
| `lint` | regras de estilo e de React (`eslint-config-next`) | veja "Os avisos conhecidos" abaixo antes de investigar um aviso novo |
| `build` | o app compila e empacota de verdade, com tudo que `typecheck` sozinho não pega | quase sempre import que não resolve ou API de servidor usada dentro de um client component |
| `check:isolation` | que o Postgres respeita um filtro `organizationId` escrito à mão — **não** que `tenantDb`, a DAL ou as actions estão de fato passando esse filtro | **a mais séria das cinco** — ver "check:isolation" abaixo |
| `check:node` | toda a árvore de dependências roda no Node de produção | ver "check:node" abaixo |

## `check:isolation`

Isolamento multi-tenant é [a regra inviolável nº 1 do `CLAUDE.md`](../../CLAUDE.md) e o
[guia 03](03-multi-tenancy.md) é onde o mecanismo (`tenantDb`, `TENANT_MODELS`, o que o `$extends`
cobre e o que não cobre, e exatamente o que este script prova) está explicado em detalhe — não
repetido aqui. Resumo que importa pra reagir a uma falha: `scripts/check-isolation.ts` usa o
Prisma **cru**, com `where: { organizationId: ... }` escrito à mão — ele prova que o Postgres
honra esse filtro quando a query o inclui, não que o `$extends` de `tenantDb`, a DAL ou as actions
o incluem de fato. **Só o vermelho é garantia de algo: se `check:isolation` ficou vermelho, a
mudança que você acabou de fazer quebrou algo real** (o próprio Postgres, uma chave única, ou a
asserção que você mexeu). Verde não é prova de que a aplicação está isolando — é, ainda assim, a
única rede automatizada que o repositório tem para essa fronteira (não há suíte de testes
unitários aqui), então tratar uma falha como instável em vez de investigar é o erro mais caro que
dá pra cometer aqui.

Pré-requisito: Postgres local rodando (`docker compose up -d postgres`) e um `.env` válido — o
script lê `DATABASE_URL` direto
([scripts/check-isolation.ts](../../scripts/check-isolation.ts)). Ele cria duas organizações reais,
roda as asserções e limpa os próprios dados ao final; um erro de conexão ("Postgres não
respondeu") não é falha de isolamento, é ambiente não subido.

Reação a uma falha real: identifique qual leitura/escrita da sua mudança não passou por
`tenantDb(orgId)`, ou usou `findUnique`/`update`/`delete`/`upsert` num model de negócio sem somar
o filtro de organização à mão. O guia 03 tem o padrão certo para cada caso.

## `check:node`

Produção roda travada em Node 20.x na Hostinger (não é possível trocar — ver
[Armadilhas específicas deste repo](../../CLAUDE.md) no `CLAUDE.md`). `engines` no `package.json`
é só aviso para o npm; nada barra `npm install` de uma dependência que precise de Node mais novo.
`npm run check:node` ([scripts/check-node.ts](../../scripts/check-node.ts)) é quem barra: varre
`node_modules` inteiro, separa o que entra no bundle de produção (alcançável a partir de
`dependencies`) do que só roda durante o build (`devDependencies`), e falha se algum pacote de
qualquer um dos dois grupos declarar `engines.node` incompatível com o major do `.nvmrc` — hoje
`20`. A mensagem de erro já diz qual pacote e qual faixa de versão ele exige.

Quando falhar: troque a dependência por uma que suporte Node 20, ou fixe uma versão anterior dela
no `package.json`. Não há como "ignorar e seguir" — quebraria só no deploy, sem sintoma local.

## `lint`: os avisos conhecidos

No estado atual do repositório, `npm run lint` termina com **4 avisos, 0 erros** — confirmado
rodando o comando, não um número herdado de documentação antiga. Só **3** são sobre `watch()` do
`react-hook-form` (o React Compiler avisa "Compilation Skipped: Use of incompatible library" porque
`watch()` devolve uma função que ele não consegue memoizar com segurança):
`src/components/crm/opportunity-form.tsx`, `src/components/integrations/connection-form.tsx` e
`src/components/supplies/item-form.tsx`. São conhecidos e não bloqueiam — o formulário funciona,
só perde memoização automática naquele componente.

O 4º aviso é outra coisa: `'t' is assigned a value but never used` em
`src/app/[locale]/app/supplies/items/[id]/edit/page.tsx:20` (`@typescript-eslint/no-unused-vars`) —
uma variável não usada, sem relação com `watch()`. Também preexistente e não bloqueia o build, mas
vale corrigir se você mexer nesse arquivo por outro motivo.

Se `lint` voltar com um número de avisos diferente destes 4 (ou um erro, que é sempre bloqueante),
o aviso novo é seu — não assuma que é mais um da lista conhecida sem conferir o arquivo e a regra.

## Convenção de commit

`[ÁREA] - Verbo + Tarefa` no título, corpo estruturado explicando o porquê (não só o quê), e a
mensagem termina com a linha de co-autoria. Exemplo real:
`[CRM] - Adiciona autofill de CEP na empresa`. Ver
[README.md](../../README.md), seção "9. Convenções", para a lista completa ao lado das outras
convenções do projeto (sem repetir aqui).

## `dev` → PR → `main`

Trabalha-se na `dev`; `main` é produção e o deploy sai dela. `main` é uma branch protegida no
GitHub — push direto é rejeitado, e a única forma de levar código até lá é por Pull Request.
Conferido na configuração real do repositório: a proteção exige que o check `validate` do CI
([.github/workflows/ci.yml](../../.github/workflows/ci.yml) — as mesmas cinco checagens deste
guia, mais `prisma migrate deploy` contra um Postgres efêmero do próprio job) esteja verde antes do
merge, bloqueia force-push e deleção da branch, e vale até para admin (`enforce_admins`). Ela
**não** exige aprovação humana configurada — o gate é o CI, não um revisor. Isso não dispensa pedir
revisão quando fizer sentido; só significa que o GitHub não vai impedir o merge por falta dela.

Rotas para o servidor de produção (deploy, migração manual, runbook completo) estão no
[README, seção 8 (Runbook de produção)](../../README.md) — não repetido aqui.

## Resumo

- Os cinco comandos rodam no CI, na mesma composição mas em ordem diferente e com `prisma migrate
  deploy` no meio; rodar local antes só adianta o feedback.
- `typecheck`/`build` pegam erro de tipo e de compilação de verdade; `.next/` velho engana o
  `typecheck` — reinicie o dev server se a linha apontada não existir no seu editor.
- `lint`: 4 avisos conhecidos hoje (3 sobre `watch()`, 1 var não usada) — nenhum bloqueia; um
  número diferente é sinal de algo novo.
- `check:isolation` vermelho = fronteira de segurança furada, não teste instável. Verde prova que
  o Postgres respeita filtro explícito, não que a aplicação sempre o passa. Ver
  [guia 03](03-multi-tenancy.md).
- `check:node` vermelho = dependência incompatível com o Node 20.x de produção. Troque ou fixe
  versão.
- `main` só recebe código via PR com o check `validate` verde — nunca push direto.

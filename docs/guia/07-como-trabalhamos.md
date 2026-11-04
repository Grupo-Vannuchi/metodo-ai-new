# Como trabalhamos: branch, PR, commit e combinados do time

As regras do dia a dia estão espalhadas entre o [CLAUDE.md](../../CLAUDE.md), o
[README.md](../../README.md) e os outros guias. Este guia junta tudo numa página só, para quem
chega ao projeto ou volta depois de um tempo. O detalhe de cada regra continua no guia de origem,
linkado em cada seção; aqui fica o resumo e o porquê.

## Stack e idioma

| | |
|---|---|
| Linguagem | **TypeScript** em tudo (app, scripts, seed) |
| Framework | **Next.js 16** (App Router) + React 19 + Tailwind 4 |
| Banco | **Prisma 6** + Postgres: Docker local na porta 5433, **Supabase** em produção |
| Traduções | **next-intl**, em `src/messages/pt.json` e `src/messages/en.json` |
| Variáveis de ambiente | validadas com **zod** em [src/lib/env.ts](../../src/lib/env.ts) |
| Node | **20.x**, travado pela Hostinger. O `.nvmrc` é a fonte da verdade |
| Produção | `https://metodotia.com`: Hostinger (Passenger), Supabase, Evolution em VPS separada |

**Idioma:** código e comentários no código em inglês. Commits, PRs e documentação (README, guias,
`CLAUDE.md`) em português. Texto que o usuário vê sai das traduções, nunca escrito direto no
componente.

## Fluxo de branch e PR

A `main` é produção. **Mergear na `main` publica no ar em minutos**: a Hostinger implanta a cada
push nela, sem homologação no meio. Ela também é protegida no GitHub: não aceita push direto, só
PR com o check `validate` do CI verde.

O fluxo de cada entrega:

1. **Parta da `main` atualizada.**
   ```bash
   git switch main && git pull
   git switch -c feature/nome-curto   # ou fix/nome-curto para correção
   ```
2. **Trabalhe e commite na branch.** Rode as cinco checagens antes de cada commit (seção abaixo).
3. **Suba a branch e abra o PR para a `main`.**
   ```bash
   git push -u origin feature/nome-curto
   ```
   Abra o PR pelo `gh pr create` ou pelo link
   `https://github.com/Grupo-Vannuchi/metodo-ai-new/compare/main...feature/nome-curto?expand=1`.
   A descrição explica o que muda, o que foi testado e se existe migration.
4. **Espere o CI verde** (job `validate`, aba **Actions**). Ele refaz as cinco checagens do zero,
   com um Postgres novo.
5. **Merge.** A partir daqui está em produção. Teste em `https://metodotia.com` logo depois.

Se a `main` andou enquanto a branch estava aberta, traga a `main` para a branch com merge (não
rebase) e commite como `[ÁREA] - Traz a main para a branch de <assunto>`.

> **A `dev` não é mais usada.** O README e os guias antigos diziam "trabalha-se na `dev`", mas ela
> parou de receber commits em 01/10/2026 e ficou centenas de commits atrás da `main`. Não empurre
> nela nem abra PR a partir dela.

## Mudou o banco? A migration vai antes do merge

A Hostinger **não** aplica migration no deploy. Código novo com o banco antigo quebra a tela
(erro 500) assim que o merge entra no ar.

1. Local: `npm run db:migrate` gera a pasta em `prisma/migrations/`.
2. Produção, **antes do merge**, com `DATABASE_URL` apontando para o Supabase:
   ```bash
   npx prisma db execute --file prisma/migrations/<pasta>/migration.sql --schema prisma/schema.prisma
   npx prisma migrate resolve --applied <pasta>
   ```
3. Escreva no PR e no §8 do README o que a migration faz e se apaga algo.

**Nunca** rode `migrate dev`, `migrate deploy` ou `migrate reset` contra produção. A tabela de
controle (`_prisma_migrations`) do Supabase não tem o histórico completo, então o Prisma acha que
migrations já aplicadas estão pendentes e tenta rodá-las de novo. Migration que apaga dado pede
backup antes. Procedimento completo e histórico: [README §8](../../README.md).

## Commits

**Título:** `[ÁREA] - Verbo no presente + tarefa`. A área é o módulo: `[CRM]`, `[E-mail]`,
`[Conversas]`, `[Tarefas]`, `[Financeiro]`, `[UI]`, `[Docs]`…

**Corpo:** uma lista curta do que mudou e **por quê**, com o que alguém precisaria saber para
revisar ou desfazer: migration, contagem de chaves de i18n, guia atualizado.

**Última linha:** a de co-autoria (`Co-Authored-By: …`).

Exemplo real:

```
[CRM] - Adiciona filtro de tipo em Produtos e Serviços

- Filtro "Mostrar: Todos / Produtos / Serviços" no topo da lista; roda na tela,
  sobre o catálogo que a página já carrega inteiro (sem rota nova nem migration).
- Filtro sem resultado mostra "Nenhum produto/serviço no catálogo."
- i18n: 9 chaves novas em pt e en; contagem atualizada no CLAUDE.md e no guia 04.

Co-Authored-By: ...
```

Cada pessoa commita com a **própria** conta. Configure na sua máquina:

```bash
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@exemplo.com"
```

## Antes de cada commit: as cinco checagens

```bash
npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node
```

Não existe suíte de testes unitários. O `check:isolation` é a única proteção automática contra
uma empresa enxergar dados de outra: vermelho ali é brecha real, não teste instável. O que cada
checagem prova e o que fazer quando falha: [06-antes-de-commitar](06-antes-de-commitar.md).

## Regras invioláveis no código

| Regra | Detalhe |
|---|---|
| Todo acesso a dado de negócio filtra por `organizationId`, via `tenantDb(orgId)` na DAL em `src/lib/queries/`. Por id: `findFirst` + `updateMany`/`deleteMany`, nunca `findUnique`/`update`/`delete`/`upsert` | [03-multi-tenancy](03-multi-tenancy.md) |
| Módulo, tela e permissão só pelas fontes de verdade (`config/modules.ts`, `config/screens.ts`, `lib/access.ts`). Nada de `if` de permissão espalhado | [04-modulos-e-permissoes](04-modulos-e-permissoes.md) |
| Toda chave de tradução nova entra no `pt.json` **e** no `en.json` | [04-modulos-e-permissoes](04-modulos-e-permissoes.md) |
| Rota em `src/app/api/` é pública por padrão: cada uma checa login sozinha | [05-rotas-e-jobs](05-rotas-e-jobs.md) |
| Nunca `process.env.X` direto: declare em `src/lib/env.ts` e importe de lá | [CLAUDE.md](../../CLAUDE.md) |
| WhatsApp/Evolution: credenciais sempre por `resolveEvoCreds()` | [CLAUDE.md](../../CLAUDE.md) |
| Desinstalar módulo = `OrganizationModule` vira `DORMANT`, nunca apagar | [04-modulos-e-permissoes](04-modulos-e-permissoes.md) |
| Todo `new PrismaClient()` recebe o driver adapter (`PrismaPg`) | [CLAUDE.md](../../CLAUDE.md) |

## Combinados do time

- **Mexeu numa fonte de verdade, atualize o guia no mesmo commit.** Guia desatualizado é pior que
  nenhum, porque é seguido com confiança.
- **No CRM, criação nunca abre em gaveta lateral (drawer).** Foi testado e descartado a pedido.
- **Teste em produção não envia mensagem real de WhatsApp** para contatos de clientes.
- **Dado fictício nunca chega perto do WhatsApp.** Em 28/10/2026, telefones inventados num CSV de
  teste adicionaram 18 desconhecidos a um grupo real. Planilha ou contato fictício leva essa
  marcação no nome e não entra em fluxo que fale com a Evolution. Desde 04/11/2026 o código também
  segura: fora de produção, o WhatsApp só envia para os números de `WHATSAPP_DEV_ALLOWED_NUMBERS`
  (veja "Dicas de ambiente").
- **O `.env` nunca vai para o git.** Ele tem as chaves reais. Passe para outra máquina por pendrive
  ou gerenciador de senhas, nunca por e-mail ou WhatsApp.

## Dicas de ambiente

- Setup do zero: [README §5](../../README.md) e [01-primeiros-passos](01-primeiros-passos.md).
- Se o `npm run dev` (Turbopack) começar a devolver 404 ou 500 sem motivo no Windows, suba com
  `npx next dev --webpack`. O build de produção já usa webpack.
- Depois de `prisma generate` ou de mudar o schema, reinicie o `next dev`: ele não recarrega o
  client do Prisma sozinho.
- Webhook (WhatsApp, e-mail) não chega em `localhost`: precisa de túnel (ngrok) com
  `NEXT_PUBLIC_SITE_URL` apontando para ele.
- **WhatsApp em desenvolvimento é real:** o `.env` local aponta para a mesma VPS do Evolution da
  produção. Por isso, fora de produção, texto, mídia, áudio e reação só saem para os números de
  `WHATSAPP_DEV_ALLOWED_NUMBERS` (separados por vírgula, em qualquer formato; grupo pelo JID
  `...@g.us`). Vazia ou ausente, nada sai, e a tela mostra "Envio de WhatsApp bloqueado fora de
  produção". Para testar, ponha só o seu celular. Em produção a variável é ignorada.

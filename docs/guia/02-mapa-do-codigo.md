# Mapa do código: preciso mudar X, vou onde

`src/` tem hoje **557 arquivos `.ts`/`.tsx`** e **63.756 linhas** — contagem própria, via `find` +
`wc -l` sobre `app/`, `components/`, `config/`, `i18n/` e `lib/` (não inclui `messages/`, que é
`.json`, não código). Grande demais para explorar por tentativa. Este guia é referência, não
leitura linear — a primeira seção responde "preciso mudar X, vou onde"; a segunda mostra o que
vive em cada pasta; a terceira é honesta sobre os arquivos que fugiram do tamanho normal.

Para o mecanismo por trás de **dado** (isolamento por organização), veja
[03-multi-tenancy.md](03-multi-tenancy.md). Para o mecanismo por trás de **rota** (autenticação,
jobs), veja [05-rotas-e-jobs.md](05-rotas-e-jobs.md). Este guia não repete nenhum dos dois — só
aponta para onde ir.

## "Preciso mudar X, vou onde"

| Preciso... | Vou em | Nota |
|---|---|---|
| mudar uma **tela** existente | `src/app/[locale]/app/<domínio>/` (rota) + `src/components/<domínio>/` (UI) | Ex.: o funil do CRM é [src/app/\[locale\]/app/crm/page.tsx](../../src/app/[locale]/app/crm/page.tsx) + `src/components/crm/`. |
| ler um **dado** de tabela de negócio | `src/lib/queries/<domínio>.ts` — 50 arquivos, um por domínio | Sempre via `tenantDb`, nunca Prisma cru. Ex.: [src/lib/queries/crm.ts](../../src/lib/queries/crm.ts). Ver [guia 03](03-multi-tenancy.md). |
| escrever um **dado** | `src/app/actions/<domínio>.ts` — 52 arquivos, um por domínio (server actions) | Trabalho por id usa `findFirst`/`updateMany` com `{ id }`, nunca `findUnique`/`update`. Ex.: [src/app/actions/companies.ts](../../src/app/actions/companies.ts). Ver [guia 03](03-multi-tenancy.md). |
| mudar uma regra de **módulo** (o que cada módulo dá, preço, telas que libera) | [src/config/modules.ts](../../src/config/modules.ts) | Fonte única — não espalhe `if` de módulo pelo código. |
| mudar uma regra de **permissão/tela** | [src/config/screens.ts](../../src/config/screens.ts) (quais telas são gateáveis) + [src/lib/access.ts](../../src/lib/access.ts) (resolve por membro) | Nav final = telas permitidas do membro ∩ telas do módulo instalado. |
| mudar um **texto de interface** | `src/messages/pt.json` **e** `src/messages/en.json`, mesma chave nos dois | 2.597 chaves hoje nos dois arquivos (contagem própria, recursiva — bate com a regra 3 do `CLAUDE.md`). Mudou de um lado, muda do outro. |
| mudar um **job** de fila (background) | [src/lib/jobs/index.ts](../../src/lib/jobs/index.ts) (registro `JOB_HANDLERS`), disparado por `src/app/api/jobs/[job]/route.ts` | Handler precisa ser idempotente — QStash pode entregar o mesmo job duas vezes. Ver [guia 05](05-rotas-e-jobs.md). |
| criar ou mudar uma **rota de API** | `src/app/api/<algo>/route.ts` — 43 rotas hoje | Nasce pública, sem middleware protegendo. **Pare e leia o [guia 05](05-rotas-e-jobs.md) antes.** |
| rodar um **comando de manutenção** | [scripts/](../../scripts/) — 5 arquivos; só 3 têm alias de `npm run` (ver [package.json](../../package.json)) — os outros dois rodam direto via `tsx scripts/<nome>.ts` | `check-isolation`, `check-node` e `backfill-pipelines` são operacionais deste app; `create-project-task` e `inspect-project` automatizam o GitHub Projects e não tocam o app. |
| reaproveitar um **componente de UI** genérico | [src/components/ui/](../../src/components/ui/) — 15 arquivos (botão, input, paginação, toast, confirmação, ...) | Confira aqui antes de criar um componente novo do zero. |

## O que vive em cada pasta de `src/`

| Pasta | Arquivos | Linhas | O que é |
|---|---|---|---|
| `app/` | 211 | 18.834 | Rotas do Next (App Router): `[locale]/(auth)` (login, cadastro, convite, recuperação), `[locale]/app` (o produto — uma subpasta por domínio: `crm/`, `finance/`, `inbox/`...), `api/` (rotas de API, fora de `[locale]/`), `actions/` (as 52 server actions — a escrita). |
| `components/` | 175 | 28.779 | UI por domínio, espelhando `app/` e `lib/queries/` (uma subpasta por área). **A maior pasta do repositório** — cerca de 45% das linhas de `src/`. `ui/` guarda os primitivos compartilhados; três arquivos soltos na raiz (`theme-style.tsx`, `theme-toggle.tsx`, `unsubscribe-form.tsx`) fogem do padrão por domínio. |
| `config/` | 5 | 650 | As fontes de verdade: [modules.ts](../../src/config/modules.ts) (384L), [screens.ts](../../src/config/screens.ts) (34L), `limits.ts` (36L), mais `site.ts` e `audit.ts`. |
| `i18n/` | 3 | 57 | `routing.ts` define os locales (`pt`, `en`) e o prefixo de URL (`as-needed` — o locale padrão não aparece na URL). |
| `lib/` | 163 | 15.436 | Tudo que não é rota nem componente: `queries/` (a DAL), `tenant.ts`/`tenant-db.ts` (isolamento — [guia 03](03-multi-tenancy.md)), `access.ts` (permissão), `integrations/` (Evolution/WhatsApp), `downloader/`, `assistant/` (copiloto de IA), `whatsapp/`, `jobs/` (registro de fila), `email/`, `auth*`. |
| `messages/` | 2 (não contam acima — são `.json`) | — | `pt.json` e `en.json`, 2.597 chaves cada. |

## Os arquivos grandes — herança, não padrão

Três componentes concentram muito mais lógica do que o resto do repositório — são os três maiores
arquivos `.tsx` de todo o `src/`, por uma margem real (números conferidos com `wc -l` nesta
tarefa):

- [src/components/inbox/team-chat-client.tsx](../../src/components/inbox/team-chat-client.tsx) —
  **1.646 linhas**
- [src/components/inbox/inbox-client.tsx](../../src/components/inbox/inbox-client.tsx) —
  **1.115 linhas**
- [src/components/feed/feed-client.tsx](../../src/components/feed/feed-client.tsx) —
  **781 linhas**

(o quarto colocado, `src/components/supplies/stock-client.tsx`, já cai para 709 linhas — a
distância para os três de cima não é efeito de arredondamento.)

Leitura minha olhando o tamanho e o domínio de cada um, não uma explicação documentada em algum
lugar: são grandes porque a tela que implementam é inerentemente grande — chat em tempo real,
inbox multi-conversa, mural —, não porque alguém decidiu que arquivos assim deveriam ser o padrão
deste projeto. Na prática, o motivo importa menos que a consequência. Mexer neles pede cuidado
extra:

- leia o arquivo inteiro antes de editar — um `grep` do trecho que parece relevante engana fácil
  num componente deste tamanho, porque estado e efeitos colaterais de uma parte vazam para outra;
- prefira diffs pequenos e isolados a refatorações largas no mesmo commit;
- não trate o tamanho deles como referência — um componente novo que já nasce com 1.000+ linhas
  não está seguindo um padrão do projeto, está repetindo um problema dele.

## Onde ir depois

- Primeiro dia, ainda não rodou o ambiente? [01-primeiros-passos.md](01-primeiros-passos.md).
- Vai tocar dado (ler ou escrever tabela de negócio)? [03-multi-tenancy.md](03-multi-tenancy.md).
- Vai criar ou mexer em rota de `src/app/api/`? [05-rotas-e-jobs.md](05-rotas-e-jobs.md).

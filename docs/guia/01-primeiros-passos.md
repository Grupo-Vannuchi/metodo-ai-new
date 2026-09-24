# Primeiros passos: do ambiente rodando ao primeiro commit verde

Este é o único guia do conjunto pensado para leitura linear, do início ao fim. Os outros
(`02-mapa-do-codigo.md`, `03-multi-tenancy.md`, `05-rotas-e-jobs.md`) são referência — consultados
quando uma tarefa específica pedir. Este é para o primeiro dia, antes de qualquer tarefa: o
caminho até o ambiente rodando, como saber que deu certo, e uma tarefa pequena que passa pelo
ciclo inteiro — editar, validar, commitar, ver o CI verde.

Se você é uma sessão do Claude e não um humano no primeiro dia: os comandos abaixo funcionam
igual, mas o [CLAUDE.md](../../CLAUDE.md) e os guias `03`/`05` importam mais para o seu trabalho
do que a sequência de onboarding.

## O caminho até o ambiente funcionando

Os comandos exatos — Docker, `npm install`, `.env`, migrations, seed, `npm run dev` — estão no
[README.md](../../README.md), seção 5 ("Rodando localmente"). Siga-os na ordem; não repito a
lista aqui. Duas coisas nessa sequência custam tempo de quem não sabe delas de antemão:

- **`check:isolation` precisa do Postgres do Docker no ar.** O próprio script já registra isso no
  comentário de topo — [scripts/check-isolation.ts:10](../../scripts/check-isolation.ts#L10):
  `Run: npm run check:isolation   (requires the local Postgres up)`. Sem o container `metodoai-db`
  rodando, o script não acusa erro de tipo — ele falha tentando abrir a conexão. Se a validação
  combinada (`typecheck && lint && build && check:isolation && check:node`) morrer nessa etapa com
  erro de conexão, confira `docker compose ps` antes de suspeitar do código.
- **`npm run typecheck` com o `next dev` ligado pode acusar erro num arquivo gerado em `.next/`
  que não é seu.** O [tsconfig.json:29-30](../../tsconfig.json#L29-L30) inclui
  `.next/types/**/*.ts` e `.next/dev/types/**/*.ts` no escopo do `tsc` — arquivos que o próprio
  `next dev` regrava a cada mudança de rota. (Leitura minha a partir do `tsconfig.json`, não
  confirmação de como o `next dev` agenda a escrita: o mecanismo exato não está documentado, só o
  sintoma é conhecido nesta base.) Rodar `tsc` enquanto esses arquivos estão sendo regravados é
  uma corrida — o typecheck pode ler um arquivo pela metade e acusar erro num lugar que você nunca
  tocou. Se `typecheck` falhar dentro de `.next/`, pare o `npm run dev` e rode `npm run typecheck`
  de novo, sozinho.

## Como saber que deu certo

Três sinais, nesta ordem:

1. **As 5 validações passam:**
   ```bash
   npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node
   ```
   É a mesma linha do [CLAUDE.md](../../CLAUDE.md) e do §5 do README — o gate de todo commit
   neste repositório, não só do setup inicial.
2. **O app sobe:** `npm run dev` e `http://localhost:3000` carrega a tela de login sem erro no
   terminal.
3. **O login funciona:** entre com o usuário criado por `npm run db:seed` — por padrão
   `owner@metodoai.local` / `changeme123`, ou o que você tiver posto em `SEED_OWNER_EMAIL` /
   `SEED_OWNER_PASSWORD` no `.env` (defaults documentados em
   [.env.example](../../.env.example)). Depois de logar, **Painel** é o primeiro item do menu
   lateral — vai ser o alvo da tarefa abaixo.

Se os três passarem, o ambiente está pronto.

## Primeira tarefa guiada: do commit ao CI verde

O objetivo aqui não é a mudança em si — é o ciclo completo. Por isso a tarefa é deliberadamente
pequena: não exige entender nenhuma regra de negócio, e dá para confirmar sozinho que funcionou.

**A tarefa:** mudar o texto do item **Painel** no menu lateral, nos dois idiomas.

1. **Ache a chave.** É `app.nav.dashboard`, em
   [src/messages/pt.json:322](../../src/messages/pt.json#L322) (hoje `"Painel"`) e
   [src/messages/en.json:322](../../src/messages/en.json#L322) (hoje `"Dashboard"`). A mesma
   chave nos dois arquivos é a regra 3 do `CLAUDE.md` (paridade de i18n) na prática, não só na
   teoria.
2. **Por que esta chave e não outra:** "Painel" é o único item do menu marcado como
   `ALWAYS_SHOWN` em
   [src/components/app/app-nav.tsx:111](../../src/components/app/app-nav.tsx#L111) — aparece para
   qualquer login, independente de módulo instalado ou permissão de acesso. Não tem como escolher
   errado e a tela ficar vazia.
3. **Edite os dois valores.** O texto em si não importa — o ponto é mexer nos dois arquivos, na
   mesma chave, mantendo sentido em cada idioma. Só como ilustração (escolha o seu):
   `"Painel"` → `"Painel geral"` em `pt.json`, `"Dashboard"` → `"General dashboard"` em `en.json`.
4. **Confirme no navegador.** Com `npm run dev` rodando e você logado, recarregue
   `localhost:3000` — o rótulo novo aparece no topo do menu lateral. Se não aparecer, confira se
   salvou os dois arquivos.
5. **Rode as 5 validações** (seção acima). Todas verdes.
6. **Commit**, seguindo a convenção do `CLAUDE.md` (`[ÁREA] - Verbo + Tarefa`, corpo curto):
   ```bash
   git add src/messages/pt.json src/messages/en.json
   git commit -m "[UI] - Ajusta rotulo do Painel no menu lateral"
   ```
7. **Push direto na `dev`** — é onde se trabalha neste repositório. `main` é produção, protegida
   por regra do GitHub, e recusa push direto:
   ```bash
   git push origin dev
   ```
8. **Veja o CI verde.** O push sozinho já dispara o workflow — o gatilho em
   [.github/workflows/ci.yml:3-7](../../.github/workflows/ci.yml#L3-L7) roda em `push` para `dev`
   e `main`, não só em pull request. Abra a aba **Actions** do repositório no GitHub
   (`github.com/Grupo-Vannuchi/metodo-ai-new/actions`) e acompanhe o job `validate`
   ([.github/workflows/ci.yml:17-18](../../.github/workflows/ci.yml#L17-L18)): ele repete
   typecheck, lint, `check:node`, migrations e `check:isolation` — do zero, com um Postgres novo
   subido no runner, não o seu. Ficar verde ali é uma confirmação independente da sua, não uma
   repetição — é a diferença entre "passou aqui" e "passou".

Se algo falhar no CI e não localmente (ou o contrário), a causa mais comum é `.env`: o CI usa
valores descartáveis fixos (declarados no próprio `ci.yml`), o seu ambiente usa o `.env` local.

## Onde ir depois

- Perdido em qual pasta faz o quê? [02-mapa-do-codigo.md](02-mapa-do-codigo.md).
- Vai tocar dado (ler ou escrever tabela de negócio)? [03-multi-tenancy.md](03-multi-tenancy.md)
  primeiro.
- Vai criar ou mexer em rota de `src/app/api/`? [05-rotas-e-jobs.md](05-rotas-e-jobs.md) primeiro.

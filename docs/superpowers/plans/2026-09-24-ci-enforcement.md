# CI e enforcement de validações — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar impossível mergear na `main` código que não passou pelas cinco validações do projeto.

**Architecture:** Um workflow do GitHub Actions (`.github/workflows/ci.yml`), job único, com Postgres em service container. O job materializa um `.env` descartável e roda as cinco validações em ordem de custo crescente. A `main` ganha branch protection exigindo PR com esse job verde. O repositório ganha push protection do secret scanning.

**Tech Stack:** GitHub Actions, `actions/checkout@v4`, `actions/setup-node@v4`, `postgres:17-alpine`, Prisma 6, Node 20, `gh` CLI para as configurações de repositório.

**Spec:** [2026-09-24-ci-enforcement-design.md](../specs/2026-09-24-ci-enforcement-design.md)

## Global Constraints

- **Repositório:** `Grupo-Vannuchi/metodo-ai-new`, **público**. Actions e branch protection gratuitos; PRs podem vir de forks.
- **Nenhum segredo real no CI.** Todo valor de ambiente no workflow é descartável e literal no YAML. Nunca adicionar `secrets.*` a este workflow.
- **Node:** a versão vem de `.nvmrc` (hoje `20`), nunca fixada no YAML. Produção roda Node 20.x e não pode mudar.
- **Postgres:** `postgres:17-alpine`, a mesma imagem do `docker-compose.yml`. Usuário/senha/banco: `metodoai`/`metodoai`/`metodoai`.
- **O `check:isolation` roda `tsx --env-file=.env`,** que falha com `.env: not found` se o arquivo não existir. Variáveis no bloco `env:` do job **não** substituem o arquivo. O CI precisa criar `.env` em disco.
- **Nome do job:** `validate`. Esse é o nome do status check exigido pela branch protection; mudar o nome do job quebra a proteção silenciosamente.
- **Ordem dos passos:** barato antes de caro. `typecheck`, `lint`, `check:node`, `build`, `migrate deploy`, `check:isolation`.
- **Commits:** padrão do repo, `[ÁREA] - Verbo + Tarefa`, corpo estruturado, terminando com a linha de co-autoria.
- **Branch de trabalho:** `dev`. Nunca commitar direto na `main`.

---

### Task 1: Workflow de CI que roda e passa

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: os scripts `typecheck`, `lint`, `check:node`, `build`, `check:isolation` do `package.json`, e o arquivo `.nvmrc`.
- Produces: um status check chamado **`validate`**, que a Task 3 exige na branch protection.

- [ ] **Step 1: Criar o arquivo do workflow**

Criar `.github/workflows/ci.yml` com exatamente este conteúdo:

```yaml
name: CI

on:
  pull_request:
    branches: [main, dev]
  push:
    branches: [main, dev]

jobs:
  validate:
    name: validate
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: metodoai
          POSTGRES_PASSWORD: metodoai
          POSTGRES_DB: metodoai
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U metodoai -d metodoai"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      # Valores descartaveis, nao segredos. O repositorio e publico e PRs vem de
      # forks: um CI sem segredo nao tem o que vazar. O arquivo em disco (e nao
      # apenas variaveis de ambiente) e obrigatorio porque check:isolation roda
      # `tsx --env-file=.env`, que falha se o arquivo nao existir. Prisma e Next
      # tambem leem .env sozinhos, entao um arquivo so serve os tres.
      - name: Criar .env descartavel
        run: |
          cat > .env <<'ENVEOF'
          DATABASE_URL="postgresql://metodoai:metodoai@localhost:5432/metodoai?schema=public"
          DIRECT_URL="postgresql://metodoai:metodoai@localhost:5432/metodoai?schema=public"
          SESSION_SECRET="ci-only-throwaway-value-not-a-real-secret-000000"
          INTEGRATION_ENC_KEY="0000000000000000000000000000000000000000000000000000000000000000"
          NEXT_PUBLIC_SITE_URL="http://localhost:3000"
          ENVEOF

      - name: Instalar dependencias
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Compatibilidade de Node
        run: npm run check:node

      - name: Build
        run: npm run build

      - name: Aplicar migrations
        run: npx prisma migrate deploy

      - name: Isolamento multi-tenant
        run: npm run check:isolation
```

- [ ] **Step 2: Validar a sintaxe YAML localmente antes de empurrar**

Run:

```bash
node -e "const f=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(f.includes('\t')) throw new Error('YAML nao aceita tab'); console.log('sem tabs, '+f.split('\n').length+' linhas')"
```

Expected: `sem tabs, 74 linhas` (o número pode variar; o que importa é não lançar erro).

- [ ] **Step 3: Commitar e empurrar para a `dev`**

```bash
git add .github/workflows/ci.yml
git commit -F - <<'MSGEOF'
[Infra] - CI: rodar as 5 validacoes em cada push e PR

Nada obrigava ninguem a rodar typecheck/lint/build/check:isolation/check:node
antes de commitar - nao havia CI, hook de git nem branch protection. Este
workflow roda os cinco em pull_request e push para main e dev.

Postgres em service container (postgres:17-alpine, a mesma imagem do
docker-compose) porque o check:isolation escreve e le dados de duas organizacoes
para provar o isolamento - nao e mockavel.

Nenhum segredo real entra no CI: o repositorio e publico e PRs vem de forks,
entao os valores de ambiente sao literais descartaveis. Um CI que nao carrega
segredo nao tem o que vazar, em vez de depender da configuracao de permissao do
workflow estar correta.

O .env e criado em disco, e nao apenas exportado como variavel: o check:isolation
roda `tsx --env-file=.env`, que falha com ".env: not found" se o arquivo nao
existir. Prisma e Next tambem leem .env sozinhos, entao um arquivo serve os tres.

setup-node le o .nvmrc, amarrando o CI ao mesmo major da Hostinger.

Efeito colateral: o `migrate deploy` contra banco vazio faz o CI ser a primeira
coisa que ja verificou que as 71 migrations aplicam do zero.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSGEOF
git push origin dev
```

- [ ] **Step 4: Acompanhar a execução até o fim**

Run:

```bash
gh run watch --exit-status $(gh run list --workflow=ci.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: termina com `✓` e código de saída 0. Se sair 1, ler o log com `gh run view --log-failed` e corrigir antes de seguir.

- [ ] **Step 5: Verificar que todos os passos executaram de verdade**

Um job verde pode esconder um passo que não rodou. Confirmar que os nove passos apareceram e que o `check:isolation` imprimiu suas asserções:

```bash
RUN=$(gh run list --workflow=ci.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RUN" --log | grep -E "Typecheck|Lint|Compatibilidade de Node|Build|Aplicar migrations|Isolamento multi-tenant" | head -20
gh run view "$RUN" --log | grep -c "✓ " 
gh run view "$RUN" --log | grep "Tenant isolation: all checks passed"
```

Expected: os seis nomes de passo aparecem; o `grep -c "✓ "` retorna pelo menos 9 (as asserções do check:isolation); a última linha encontra `✅ Tenant isolation: all checks passed.`

---

### Task 2: Provar que o CI reprova código quebrado

Um CI que nunca reprovou não é evidência de nada. Esta task quebra algo de propósito, confirma o vermelho, e reverte.

**Files:**
- Modify (temporariamente, revertido no Step 5): `src/lib/cron-auth.ts:19`

**Interfaces:**
- Consumes: o workflow `validate` da Task 1.
- Produces: nada — é uma task de verificação.

- [ ] **Step 1: Criar uma branch descartável**

```bash
git checkout -b ci-red-test
```

- [ ] **Step 2: Introduzir um erro de tipo deliberado**

Em `src/lib/cron-auth.ts`, trocar a linha:

```ts
  const secret = env.CRON_SECRET;
```

por:

```ts
  const secret: number = env.CRON_SECRET;
```

`env.CRON_SECRET` é `string | undefined`, então atribuir a `number` é erro de tipo garantido.

- [ ] **Step 3: Confirmar que o typecheck falha localmente antes de gastar uma execução de CI**

Run: `npm run typecheck`

Expected: FALHA, com mensagem contendo `Type 'string | undefined' is not assignable to type 'number'`.

- [ ] **Step 4: Empurrar e confirmar o vermelho no CI**

```bash
git add src/lib/cron-auth.ts
git commit -m "test: erro de tipo proposital para validar o CI"
git push origin ci-red-test
gh pr create --base dev --head ci-red-test --title "TESTE: validar que o CI reprova" --body "PR descartavel. Confirma que o workflow reprova erro de tipo. Sera fechado sem merge."
gh pr checks --watch
```

Expected: o check `validate` aparece como **fail**. O comando `gh pr checks` sai com código diferente de zero.

- [ ] **Step 5: Reverter tudo e limpar**

```bash
gh pr close ci-red-test --delete-branch
git checkout dev
git branch -D ci-red-test
git status --short
```

Expected: `git status --short` sai vazio. A branch `ci-red-test` não aparece em `git branch -a`.

Nada a commitar nesta task — ela produz evidência, não código.

---

### Task 3: Branch protection na `main`

**Files:**
- Nenhum arquivo. A mudança é na configuração do repositório, via API.

**Interfaces:**
- Consumes: o status check `validate`, que precisa ter rodado ao menos uma vez (Task 1) para o GitHub reconhecer o nome.
- Produces: a `main` protegida, que a Task 4 verifica.

- [ ] **Step 1: Registrar o estado atual, para poder reverter**

```bash
gh api repos/Grupo-Vannuchi/metodo-ai-new/branches/main/protection 2>&1 | head -3
```

Expected: `Branch not protected` (HTTP 404). Se já houver proteção, salvar a saída antes de sobrescrever.

- [ ] **Step 2: Aplicar a proteção**

```bash
gh api -X PUT repos/Grupo-Vannuchi/metodo-ai-new/branches/main/protection --input - <<'JSONEOF'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["validate"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSONEOF
```

Expected: responde com o JSON da proteção criada, sem campo `message` de erro.

Cada valor e sua razão estão na tabela do §4.3 do spec. Os dois que costumam ser questionados: `required_approving_review_count` é **0** porque exigir revisão num time de duas pessoas produz aprovação carimbada; `enforce_admins` é **true** porque ambos são admin e sem isso a regra é decorativa.

- [ ] **Step 3: Ler de volta e conferir cada campo**

```bash
gh api repos/Grupo-Vannuchi/metodo-ai-new/branches/main/protection --jq '{
  pr_obrigatorio: (.required_pull_request_reviews != null),
  aprovacoes: .required_pull_request_reviews.required_approving_review_count,
  checks: .required_status_checks.contexts,
  strict: .required_status_checks.strict,
  admins: .enforce_admins.enabled,
  force_push: .allow_force_pushes.enabled,
  delecao: .allow_deletions.enabled
}'
```

Expected, exatamente:

```json
{
  "pr_obrigatorio": true,
  "aprovacoes": 0,
  "checks": ["validate"],
  "strict": false,
  "admins": true,
  "force_push": false,
  "delecao": false
}
```

- [ ] **Step 4: Confirmar que push direto na `main` agora é recusado**

```bash
git checkout main && git pull origin main
echo "# teste de protecao" >> README.md
git add README.md && git commit -m "test: confirmar bloqueio de push direto"
git push origin main
```

Expected: o push é **recusado**, com mensagem contendo `protected branch` ou `Changes must be made through a pull request`.

- [ ] **Step 5: Desfazer o commit de teste e voltar para a `dev`**

```bash
git reset --hard origin/main
git checkout dev
git status --short
```

Expected: vazio. O `git log -1 main` não contém o commit de teste.

---

### Task 4: Provar que a proteção bloqueia um PR reprovado

Task 3 provou que a configuração existe. Esta prova que ela impede o merge — que é o objetivo declarado do spec.

**Files:**
- Modify (temporariamente, revertido no Step 6): `src/lib/cron-auth.ts:19`

**Interfaces:**
- Consumes: a proteção da Task 3 e o workflow da Task 1.
- Produces: nada — task de verificação.

- [ ] **Step 1: Criar a branch e introduzir o erro**

```bash
git checkout dev && git pull origin dev
git checkout -b ci-gate-test
```

Em `src/lib/cron-auth.ts`, trocar:

```ts
  const secret = env.CRON_SECRET;
```

por:

```ts
  const secret: number = env.CRON_SECRET;
```

- [ ] **Step 2: Abrir o PR para a `main`**

```bash
git add src/lib/cron-auth.ts
git commit -m "test: PR reprovado para validar o portao da main"
git push origin ci-gate-test
gh pr create --base main --head ci-gate-test --title "TESTE: portao da main" --body "PR descartavel para confirmar que a protecao bloqueia merge com CI vermelho. Sera fechado sem merge."
```

- [ ] **Step 3: Confirmar que o merge está bloqueado**

```bash
gh pr checks --watch || true
gh pr view --json mergeable,mergeStateStatus --jq '{mergeable, mergeStateStatus}'
```

Expected: `mergeStateStatus` é `BLOCKED`. Uma tentativa de `gh pr merge --merge` é recusada.

- [ ] **Step 4: Corrigir o erro e confirmar que destrava**

Reverter a linha para:

```ts
  const secret = env.CRON_SECRET;
```

```bash
git add src/lib/cron-auth.ts
git commit -m "test: corrigir o erro para confirmar que o portao libera"
git push origin ci-gate-test
gh pr checks --watch
gh pr view --json mergeable,mergeStateStatus --jq '{mergeable, mergeStateStatus}'
```

Expected: o check `validate` passa e `mergeStateStatus` deixa de ser `BLOCKED` (vira `CLEAN` ou `UNSTABLE`).

Este par de resultados — bloqueado com erro, liberado sem erro — é a prova de que o portão é real e não apenas visível.

- [ ] **Step 5: Fechar o PR sem merge**

```bash
gh pr close ci-gate-test --delete-branch
git checkout dev
git branch -D ci-gate-test
```

- [ ] **Step 6: Confirmar que nada sobrou**

```bash
git status --short
git branch -a | grep ci-gate-test || echo "branch removida"
git log -1 --oneline main
```

Expected: status vazio; `branch removida`; o último commit da `main` é o mesmo de antes do teste.

---

### Task 5: Push protection do secret scanning

**Files:**
- Nenhum arquivo. Configuração de repositório.

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces: nada — é independente e pode rodar em qualquer ordem.

- [ ] **Step 1: Ver o estado atual**

```bash
gh api repos/Grupo-Vannuchi/metodo-ai-new --jq '.security_and_analysis'
```

Expected: mostra o objeto atual. Anotar se `secret_scanning_push_protection` já está `enabled`.

- [ ] **Step 2: Ligar o push protection**

```bash
gh api -X PATCH repos/Grupo-Vannuchi/metodo-ai-new --input - <<'JSONEOF'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSONEOF
```

Expected: responde com o repositório atualizado, sem campo `message` de erro.

- [ ] **Step 3: Confirmar por leitura**

```bash
gh api repos/Grupo-Vannuchi/metodo-ai-new --jq '.security_and_analysis | {scanning: .secret_scanning.status, push_protection: .secret_scanning_push_protection.status}'
```

Expected, exatamente:

```json
{ "scanning": "enabled", "push_protection": "enabled" }
```

- [ ] **Step 4: Registrar os alertas já existentes**

O histórico contém um GitHub PAT (`bf80d1f`, removido em `4b66cb9`). Listar o que o scanning já encontrou:

```bash
gh api repos/Grupo-Vannuchi/metodo-ai-new/secret-scanning/alerts --jq '.[] | {numero: .number, tipo: .secret_type_display_name, estado: .state, criado: .created_at}'
```

Expected: pelo menos um alerta do tipo GitHub Personal Access Token. Se o estado for `resolved` com `resolution: revoked`, o token já foi revogado automaticamente pelo GitHub. Se for `open`, **avisar o dono da conta para revogar** — essa ação não é executável a partir do repositório.

- [ ] **Step 5: Registrar o incidente no README**

Adicionar ao §8 do README, na lista "Incidentes já resolvidos", antes do item do QStash:

```markdown
- **Token do GitHub no histórico público** (`bf80d1f`, removido em `4b66cb9` no mesmo dia): remover num commit posterior não tira do histórico, e o repositório é público — o token ficou legível por três meses. Uma varredura de 346 commits contra 14 famílias de padrão encontrou só esse vazamento. Corrigido revogando o token; o push protection do secret scanning foi ligado para bloquear o próximo na origem.
```

- [ ] **Step 6: Commitar**

```bash
git add README.md
git commit -F - <<'MSGEOF'
[Docs] - Registrar o vazamento do token no historico de incidentes

O §8 do README concentra o conhecimento operacional que mais custa caro. Faltava
o incidente do GitHub PAT que ficou tres meses legivel no historico publico, e a
licao que ele carrega: remover um segredo num commit posterior nao o tira do
historico.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSGEOF
git push origin dev
```

---

## Verificação final do plano

Com as cinco tasks concluídas, os critérios do §5 do spec ficam cobertos assim:

| Critério do spec | Provado por |
|---|---|
| 1. PR para a `main` com erro é bloqueado | Task 4, Step 3 |
| 2. O mesmo PR corrigido fica liberado | Task 4, Step 4 |
| 3. Push na `dev` dispara o workflow e passa | Task 1, Steps 4-5 |
| 4. O job reprova quando uma validação falha | Task 2, Step 4 |
| 5. Push com segredo é bloqueado | Task 5, Step 3 (por leitura da configuração) |

O critério 5 é verificado por leitura da configuração, e não empurrando um segredo falso para um repositório público. Quem quiser a prova ponta a ponta pode criar uma branch descartável com uma string no formato `ghp_` seguida de 36 caracteres, tentar o push, confirmar o bloqueio e apagar a branch — mas a leitura da API já é definitiva quanto ao estado do recurso.

## Fora deste plano

Continuam sem tratamento, cada um com seu próprio spec a escrever: higiene recorrente de dependências (frente A), deploy determinístico na Hostinger (C), `CRON_SECRET` e agendamento dos crons em produção (D), observabilidade (E), e a inexistência de suíte de testes unitários.

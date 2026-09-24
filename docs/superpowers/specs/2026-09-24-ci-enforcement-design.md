# CI e enforcement de validações — design

**Data:** 2026-09-24 · **Status:** aprovado, aguardando implementação
**Frente:** B de um plano de DevOps maior (ver §7, Fora de escopo)

---

## 1. Problema

O `CLAUDE.md` exige que cinco comandos passem antes de qualquer commit:

```bash
npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node
```

**Nada obriga ninguém a rodá-los.** Não há CI (`.github/` contém apenas um template de issue), não há hook de git (sem husky, zero hooks ativos) e não há branch protection em `main` nem em `dev`. O cumprimento é por honra, num repositório com dois contribuidores e deploy manual saindo da `main`.

O custo disso já apareceu. O §8 do README registra três incidentes de produção causados por pular passos, e esta semana foram encontrados no código: dois endpoints de cron sem autenticação nenhuma, um cron que apagaria posts fixados do feed, e três scripts que quebravam no boot por falta do driver adapter do Prisma. Nenhum deles seria pego pelas validações existentes — mas todos passaram por commits que ninguém verificou automaticamente.

## 2. Objetivo

Que seja impossível mergear na `main` código que não passou pelas cinco validações, e que a `dev` receba feedback automático em todo push.

**Critério de sucesso:** um PR para a `main` com erro de tipo, lint, build, isolamento multi-tenant ou dependência incompatível com Node 20 fica bloqueado para merge.

## 3. Restrições

- **Repositório público** (`Grupo-Vannuchi/metodo-ai-new`). Actions e branch protection são gratuitos e ilimitados; em compensação, PRs podem vir de forks e todo o código é legível por qualquer um.
- **Organização no plano Free.**
- **Produção em Node 20.x** (Hostinger), imutável. O `.nvmrc` é a fonte da verdade.
- **Time de 2 pessoas.** Qualquer regra que exija revisão de terceiro trava o fluxo.
- `check:isolation` **precisa de um Postgres real** — não é mockável, ele escreve e lê dados de duas organizações para provar o isolamento.

## 4. Desenho

### 4.1 Workflow

Arquivo único: `.github/workflows/ci.yml`, um job.

**Gatilhos:**

- `pull_request` para `main` e `dev`
- `push` para `main` e `dev`

O `push` na `dev` não é redundante: a `dev` segue aceitando push direto (§4.3), e sem esse gatilho o caminho mais usado ficaria sem validação. O `push` na `main` cobre o merge e serve de registro histórico da saúde da branch.

**Sequência:**

| # | Passo | Observação |
|---|---|---|
| 1 | `actions/checkout` | |
| 2 | `actions/setup-node` com `node-version-file: .nvmrc` | amarra o CI ao major de produção |
| 3 | `npm ci` | usa o lockfile exato; o `postinstall` roda `prisma generate` |
| 4 | `npm run typecheck` | |
| 5 | `npm run lint` | |
| 6 | `npm run check:node` | |
| 7 | `npm run build` | |
| 8 | `npx prisma migrate deploy` | aplica as 71 migrations no banco efêmero |
| 9 | `npm run check:isolation` | |

A ordem é deliberada: os passos baratos primeiro. Erro de tipo — o mais comum — aparece em cerca de 90 segundos, sem esperar build nem banco.

O passo 2 é o que fecha o ciclo com o `check:node`: o CI passa a reprovar tanto uma dependência que exija Node acima de 20 quanto código que só rode num Node que produção não tem.

### 4.2 Postgres e variáveis de ambiente

Service container `postgres:17-alpine` — a mesma imagem do `docker-compose.yml` — com healthcheck, credenciais `metodoai` / `metodoai` / `metodoai`.

**Nenhum segredo real entra no CI.** O `src/lib/env.ts` derruba o boot sem `SESSION_SECRET` e `INTEGRATION_ENC_KEY`, mas contra um banco descartável esses valores podem ser literais escritos no YAML:

| Variável | Valor no CI |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | `postgresql://metodoai:metodoai@localhost:5432/metodoai?schema=public` |
| `SESSION_SECRET` | literal descartável, ≥ 32 caracteres |
| `INTEGRATION_ENC_KEY` | literal descartável, 64 hex |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` |

Isso é decisão de segurança, não economia de configuração. O repositório é público, então PRs vêm de forks. Um CI que não carrega segredo não tem o que vazar, em nenhum cenário de workflow comprometido.

**Efeito colateral relevante:** o `migrate deploy` contra um banco vazio faz o CI ser a primeira coisa que já verificou que as 71 migrations aplicam do zero. Em produção elas foram aplicadas manualmente e de forma incremental; o caminho completo nunca foi exercitado.

### 4.3 Branch protection

Apenas na `main`. A `dev` fica livre para push direto, com CI reportando.

| Regra | Valor | Justificativa |
|---|---|---|
| Pull request obrigatório | sim | `main` é produção; o portão fica onde está o risco |
| Status check obrigatório | o job do CI | é o que dá sentido ao portão |
| Aprovações exigidas | **0** | com 2 pessoas, exigir revisão trava quem estiver sozinho |
| Exigir branch atualizada | não | gera rebase em cadeia sem ganho proporcional num time pequeno |
| Vale para administradores | **sim** | ambos são admin; sem isso a regra é decorativa |
| Force push | bloqueado | |
| Deleção da branch | bloqueada | |

Aprovações em zero é escolha consciente: o portão que importa aqui é o automático. Exigir revisão humana num time de dois produziria aprovações carimbadas, que é pior do que nenhuma — dá a sensação de revisão sem a substância.

`enforce_admins: true` tem um custo real: hotfix direto na `main` deixa de existir. A saída de emergência passa a ser desligar a proteção conscientemente, o que é preferível a uma regra que todo mundo contorna por hábito.

### 4.4 Secret scanning

Ligar **push protection** no repositório. O secret scanning já está ativo por ser repo público; o push protection é o que bloqueia o push contendo um segredo detectado, em vez de avisar depois.

Justificativa concreta: o histórico deste repositório contém um GitHub PAT introduzido em `bf80d1f` e removido em `4b66cb9` no mesmo dia — mas remover num commit posterior não tira do histórico, e o repo é público. O token ficou legível por três meses. Uma varredura de 346 commits contra 14 famílias de padrão encontrou esse único vazamento; o resto está limpo.

## 5. Verificação

A implementação está completa quando:

1. Um PR para a `main` com erro de tipo proposital é **bloqueado** para merge.
2. O mesmo PR, com o erro corrigido, fica **liberado**.
3. Um push na `dev` dispara o workflow e ele passa.
4. O job reprova quando o `check:isolation` falha — verificável quebrando temporariamente um filtro de `organizationId`.
5. Uma tentativa de push com um segredo de teste é bloqueada pelo push protection.

Os itens 1, 2 e 4 são o que prova que o portão é real. Um CI que nunca reprovou não é evidência de nada.

## 6. Riscos e contrapartidas

| Risco | Avaliação |
|---|---|
| CI lento vira atrito | ~4-6 min por execução. Com o volume atual de PRs, aceitável. Se incomodar, dividir em dois jobs (rápido sem banco / lento com banco) é mudança contida. |
| `enforce_admins` bloqueia hotfix urgente | Real. Mitigação: desligar a proteção é um clique e fica registrado no audit log — melhor do que uma regra contornável por padrão. |
| Migrations de 71 arquivos deixam o CI lento com o tempo | ~20-40s hoje. Quando incomodar, o caminho é um dump de schema consolidado. Não é problema agora. |
| Push protection gera falso positivo | O bloqueio é contornável com justificativa registrada. O custo do falso positivo é muito menor que o do vazamento. |

## 7. Fora de escopo

Frentes do plano de DevOps maior, cada uma com seu próprio spec:

- **A — Higiene de dependências:** processo recorrente de auditoria. O patch de segurança do Next (16.2.7 → 16.3.6, duas RCEs não-autenticadas) já foi aplicado.
- **C — Deploy:** transformar o runbook manual do §8 do README em processo determinístico.
- **D — Produção em ordem:** `CRON_SECRET` em produção, agendamento dos crons no hPanel, backup antes de migração.
- **E — Observabilidade:** hoje é `console.error` e caçar log no hPanel.

Também fora: suíte de testes unitários (o projeto não tem nenhuma) e a revogação do token vazado, que é ação de conta e cabe ao dono.

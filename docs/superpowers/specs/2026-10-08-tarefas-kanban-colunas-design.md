# Kanban de Tarefas com colunas livres — design

**Data:** 2026-10-08 · **Status:** design aprovado em conversa; spec aguardando revisão.
**Tela:** `/app/tasks?view=kanban` ([src/components/tasks/tasks-board.tsx](../../../src/components/tasks/tasks-board.tsx)).

---

## 1. Objetivo

Transformar o kanban de Tarefas, hoje com 5 colunas automáticas por prazo, num quadro estilo Trello:
- colunas da empresa que podem ser renomeadas, criadas, reordenadas e excluídas;
- cards que se movem livremente entre colunas e dentro delas;
- rolagem horizontal visível.

**Hoje:**
- as colunas Atrasadas, Hoje, Em breve, Sem data e Concluídas são calculadas pela data e pelo status de cada tarefa;
- os títulos são fixos;
- arrastar só funciona para entrar e sair de "Concluídas" (conclui e reabre a tarefa);
- excluir card já existe (lixeira no card).

**Critério de sucesso:**
- renomear "Hoje" para "Esta semana" vale para todos os membros da empresa;
- arrastar um card de "Atrasadas" para "Em breve" deixa o card lá, para todos, até alguém movê-lo de novo;
- com 6 colunas numa tela de notebook, a barra horizontal está visível sem rolar a página, e dá para levar um card até a última coluna arrastando.

## 2. Decisões tomadas com o usuário

| Decisão | Escolha |
|---|---|
| O que o kanban representa | **Colunas livres (estilo Trello)**. A data continua no card, mas não define a coluna. |
| Escopo das colunas | **Da empresa**: um quadro só para todos os membros. |
| Coluna × "tarefa concluída" | **Independentes**. Concluir é só pelo check; o card fica onde está, riscado. Arrastar para "Concluídas" **deixa de concluir**. |
| Quadro inicial | **As 5 colunas atuais, congeladas**. Cada tarefa existente entra onde aparece hoje; depois nada se move sozinho. |
| Onde entra tarefa nova | **Coluna de entrada (★)**, escolhida pela empresa. Começa marcada em "Sem data". |
| Quem mexe nas colunas | Qualquer membro com acesso à tela Tarefas, como já acontece com as próprias tarefas. |
| Rolagem horizontal | Barra visível, quadro na altura da tela e rolagem automática ao arrastar perto da borda. |

## 3. Fora do escopo

- A visão em lista: as abas Em aberto, Hoje, Atrasadas e Próximas continuam por data.
- Quadros por pessoa e mais de um quadro por empresa.
- Mudar quem pode criar, editar ou excluir tarefas.
- Arrastar colunas: a reordenação é pelo menu, com "mover para a esquerda/direita".
- Tela de configurações do quadro: tudo é feito no próprio quadro.

## 4. Comportamento

**Primeira abertura do kanban na empresa.** O sistema cria as colunas, nesta ordem, com os nomes no idioma de quem abriu (chaves já existentes `tasks.board.*`):
1. Atrasadas
2. Hoje
3. Em breve
4. Sem data (★ entrada)
5. Concluídas

Cada tarefa existente vai para uma coluna por esta regra, no horário de Brasília (`America/Sao_Paulo`), naquele momento:

| Tarefa | Coluna |
|---|---|
| concluída (`doneAt` preenchido) | Concluídas |
| sem vencimento | Sem data (fica sem coluna gravada, ou seja, na entrada) |
| vencimento antes de hoje | Atrasadas |
| vencimento hoje | Hoje |
| vencimento depois de hoje | Em breve |

Depois disso, nenhuma tarefa muda de coluna sozinha.

**Tarefa nova.** Não importa por onde foi criada (lista, CRM, automação, assistente, agente de WhatsApp, recorrência), ela aparece na coluna de entrada. Nenhum desses caminhos muda: tarefa sem coluna gravada é exibida na entrada.

**Cards:**
- **Arrastar** (computador): solta em qualquer coluna e em qualquer posição dentro dela. O card fica onde foi solto.
- **"Mover para…"** (menu do card): lista as colunas. Leva o card para o fim da coluna escolhida e funciona também no celular.
- **Check:** conclui ou reabre, como hoje. O card **não** muda de coluna.
- **Lixeira:** exclui com confirmação, como hoje.
- **Clique:** abre a tarefa, como hoje.

**Colunas:**
- **Renomear:** clicar no título vira um campo; Enter ou sair do campo salva, Esc cancela. O nome tem de 1 a 40 caracteres.
- **Menu "⋯":** Renomear, Definir como entrada ★, Mover para a esquerda, Mover para a direita e Excluir.
- **"+ Nova coluna"** fica no fim do quadro, com limite de 20 colunas por empresa.
- **Excluir** pede confirmação: "Excluir a coluna X? Os N cards dela vão para <entrada>." A coluna de entrada não pode ser excluída: a opção fica desabilitada, com a dica "Defina outra coluna como entrada antes".
- **Trocar a entrada:** os cards que estavam na entrada antiga sem coluna gravada continuam nela. A marca só passa a valer para as tarefas criadas a partir dali.

**Rolagem horizontal:**
- a barra do quadro fica visível e com contraste;
- o quadro ocupa a altura disponível da tela, então a barra fica sempre à vista sem rolar a página;
- ao arrastar um card a menos de ~80 px da borda esquerda ou direita do quadro, ele rola sozinho;
- Shift + roda do mouse continua rolando na horizontal.

## 5. Modelo de dados (migration aditiva)

```prisma
/// A column of the org's task kanban (one board per org). Created on the
/// board's first open (src/lib/tasks/board.ts); renamed/added/removed by members.
model TaskBoardColumn {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  order          Int      @default(0)
  /// New tasks (no boardColumnId) show here. Exactly one per org.
  isEntrance     Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tasks Task[]

  @@index([organizationId, order])
  @@map("task_board_columns")
}
```

Em `Task`:

```prisma
  /// Kanban column; null = the org's entrance column.
  boardColumnId String?
  /// Position inside the column (ascending); null = after the ordered ones.
  boardOrder    Float?
  boardColumn   TaskBoardColumn? @relation(fields: [boardColumnId], references: [id], onDelete: SetNull)

  @@index([organizationId, boardColumnId])
```

- **Migration:** cria `task_board_columns`, os índices, as duas colunas nulas em `tasks` e a FK com `ON DELETE SET NULL`. Nada é apagado.
- **Aplicação em produção:** no Supabase, **antes do merge**, com `db execute` + `migrate resolve` (nunca `migrate deploy`).
- `TaskBoardColumn` entra em `TENANT_MODELS`.

## 6. Ordem dos cards numa coluna

1. `boardOrder` crescente;
2. os sem `boardOrder` depois, por vencimento crescente (sem data por último);
3. por fim, por criação crescente.

Ao soltar um card, o servidor calcula a posição dele entre os vizinhos (média dos dois; topo = primeiro − 1; fim = último + 1; coluna vazia = 0). Se a coluna de destino ainda tiver cards sem `boardOrder`, ou se a distância entre vizinhos ficar menor que 1e-6, antes ele renumera a coluna inteira na ordem exibida (1024, 2048, …), na mesma transação.

## 7. Servidor

**Regras puras** (`src/lib/tasks/board-core.ts`, sem banco, testáveis):
- a distribuição inicial por data no horário de Brasília (a tabela do §4);
- a posição entre vizinhos;
- a ordem de exibição;
- a validação do nome da coluna.

**Montagem do quadro** (`ensureTaskBoard(organizationId, names)` em `src/lib/tasks/board.ts`):
- se a empresa não tem colunas, abre uma transação com trava por empresa (`pg_advisory_xact_lock`), confere de novo, cria as 5 colunas e distribui as tarefas existentes (§4);
- duas aberturas simultâneas não duplicam colunas;
- a página do kanban chama a função antes de listar.

**Leitura:** `listTaskBoardColumns(orgId)` na DAL. `TaskRow` ganha `boardColumnId` e `boardOrder`.

**Actions** (`src/app/actions/task-board.ts`):
- todas conferem sessão, a tela `tasks` (`canAccessScreen`) e o módulo `tasks` (`hasModule`);
- todas usam `tenantDb(orgId)`, com `findFirst` + `updateMany`/`deleteMany` e checagem de `count`;
- a coluna e a tarefa precisam ser da empresa.

| Action | Efeito |
|---|---|
| `moveTaskOnBoard(taskId, columnId, beforeTaskId \| null)` | grava `boardColumnId` (sempre explícito, mesmo na entrada) e `boardOrder` (§6) |
| `createTaskBoardColumn(name)` | cria no fim; recusa acima de 20 |
| `renameTaskBoardColumn(id, name)` | nome validado (1 a 40, sem espaços nas pontas) |
| `moveTaskBoardColumn(id, "left" \| "right")` | troca a ordem com a vizinha |
| `setTaskBoardEntrance(id)` | numa transação: grava a entrada antiga nas tarefas sem coluna e passa a marca para a nova |
| `deleteTaskBoardColumn(id)` | recusa a entrada; numa transação, os cards dela voltam para sem coluna (entrada) e a coluna é apagada |

- Cada action chama `revalidatePath("/app/tasks")`.
- Excluir coluna e trocar a entrada geram auditoria.
- O limite de 20 colunas vai para `src/config/limits.ts` (`taskBoardColumnsMax`).

**Tempo real:** a assinatura `tasks` em `src/lib/queries/realtime.ts` passa a incluir a maior `updatedAt` e a contagem de `task_board_columns`. Assim, renomear ou criar uma coluna atualiza o quadro aberto dos outros membros.

## 8. Tela

- A página do kanban carrega as colunas (garantindo o quadro) e as tarefas, e passa as duas listas para o `TasksBoard`.
- O `TasksBoard` agrupa por coluna efetiva: `boardColumnId`, ou a entrada se for nulo, ou se apontar para uma coluna que não existe mais.
- Atualização otimista ao mover, com o servidor confirmando. Se der erro, um toast avisa e o quadro recarrega.
- O comportamento antigo "arrastar para Concluídas conclui" é removido.
- O título "Atrasadas" deixa de ser vermelho, porque a coluna é livre. A data do card continua vermelha quando vencida e a tarefa não está concluída.
- **i18n:** novas chaves em `tasks.board` para menu, confirmações, erros, "Mover para…", "Nova coluna" e a dica da entrada. Paridade pt/en, com a contagem atualizada no CLAUDE.md e no guia 04.

## 9. Arquivos

**Novos:**
- a migration;
- `src/lib/tasks/board-core.ts`;
- `src/lib/tasks/board.ts`;
- `src/lib/queries/task-board.ts`;
- `src/app/actions/task-board.ts`;
- `scripts/check-task-board.ts` (`npm run check:tasks`).

**Alterados:**
- `prisma/schema.prisma`;
- `src/lib/tenant-db.ts`;
- `src/lib/queries/tasks.ts` (`TaskRow`);
- `src/lib/queries/realtime.ts`;
- `src/config/limits.ts`;
- `src/app/[locale]/app/tasks/page.tsx`;
- `src/components/tasks/tasks-board.tsx` (pode ser dividido em coluna e card, se crescer demais);
- `src/messages/pt.json`, `src/messages/en.json`;
- `scripts/check-isolation.ts`;
- `package.json`;
- `CLAUDE.md`;
- `README.md` (§7 e o passo antes do merge no §8);
- guias 03, 04 e 06.

## 10. Verificação

- **As cinco checagens** e mais `check:tasks`, que cobre:
  - a distribuição inicial nas viradas de dia em Brasília (23:59 e 00:00, inclusive com o servidor em UTC);
  - a posição entre vizinhos (topo, meio, fim, vazia, renumeração);
  - a ordem de exibição;
  - a validação de nome.
- **`check:isolation`:** a coluna da empresa A não aparece para a B.
- **No navegador local, com o banco do Docker:**
  - primeira abertura cria as 5 colunas e distribui as tarefas;
  - arrastar entre colunas e dentro delas;
  - "Mover para…";
  - renomear, criar, reordenar, trocar a entrada e excluir coluna (os cards vão para a entrada);
  - tarefa nova cai na entrada;
  - check não move o card;
  - barra horizontal visível com 6 colunas;
  - rolagem automática ao arrastar perto da borda;
  - duas abas abertas se atualizam.

## 11. Deploy

1. Aplicar a migration no Supabase antes do merge (`db execute` + `migrate resolve`).
2. Merge. Na primeira abertura do kanban, cada empresa ganha as 5 colunas com as tarefas onde estavam.

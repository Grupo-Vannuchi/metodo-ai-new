# Menu de opções e início sem palavra-chave na automação de WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A automação "Mensagem recebida no WhatsApp" ganha o passo "Menu de opções" (texto numerado, um caminho de perguntas e mensagem final por opção) e a opção de começar com qualquer mensagem.

**Architecture:** Tudo cabe no JSON que a regra já guarda (`actions`, `config`) e em `automation_sessions.answers`, sem migration. As regras puras (texto do menu, leitura da escolha, caminho ativo, quando "qualquer mensagem" começa, notas e título) ficam em dois arquivos novos sem import de servidor, testados por `npm run check:automation`. O motor [whatsapp-flow.ts](../../../src/lib/automation/whatsapp-flow.ts) passa a usar essas regras, e um e2e contra o `next dev` com uma Evolution falsa prova a conversa inteira. O editor ganha o nó do menu, um nó por opção e os painéis.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 com driver adapter, next-intl, tsx para os scripts de checagem.

**Spec:** [docs/superpowers/specs/2026-10-27-automacao-whatsapp-menu-design.md](../specs/2026-10-27-automacao-whatsapp-menu-design.md)

## Global Constraints

- Sem migration e sem dependência nova. Regras salvas antes desta mudança (sem `start`, com `ask_questions`) se comportam exatamente como hoje, inclusive o texto das notas e o título da oportunidade.
- O motor roda como sistema: toda consulta Prisma em `whatsapp-flow.ts` leva `organizationId` explícito. Nas server actions, use `tenantDb` ([guia 03](../../guia/03-multi-tenancy.md)).
- Limites: de 2 a 9 opções; nome da opção até 60 caracteres; pergunta do menu até 300; boas-vindas e mensagem final até 1000; até 15 perguntas por caminho (`MAX_FLOW_QUESTIONS`).
- Janela de "qualquer mensagem": 7 dias. Expiração da sessão: 24 h, como hoje.
- Textos fixos do bot em português, como constantes (como `PLEASE_TYPE` e `DEFAULT_FINAL`):
  - menu: `<pergunta>\n\n1 - <opção 1>\n2 - <opção 2>…`;
  - resposta inválida: `Não entendi. Responda com o número de uma das opções:\n\n1 - …`;
  - notas: primeira linha `Opção escolhida: <opção>`;
  - título: `<regra> · <opção> · <contato>`.
- i18n: toda chave nova em `pt.json` e `en.json`, com paridade. No fim, atualize a contagem do CLAUDE.md (hoje 3173).
- Testes nunca mandam mensagem de WhatsApp de verdade: o e2e usa uma Evolution falsa local.
- Commits: `[Automacoes] - Verbo + Tarefa`, corpo curto, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nada de push sem o usuário pedir.
- Antes de cada commit, rode os cinco do CLAUDE.md (`typecheck`, `lint`, `build`, `check:isolation`, `check:node`). O lint deste worktree roda com `npx eslint . --ignore-pattern ".claude/**"`.

## Review Focus

1. **Rajada no começo.** Numa conversa parada, o lead manda "Oi" e "tudo bem?" com 1 s de intervalo. Ele recebe uma boas-vindas e um menu, o agente de IA não responde, e não sobra uma segunda sessão que responda depois (Task 3, caso J do e2e).
2. **Resposta ao menu em duas mensagens.** O lead manda "2" e logo depois "obrigado". Vale a opção 2 (Task 2, `pickMenuChoice`).
3. **Regra editada com o lead no meio do caminho.** Se as opções forem reordenadas ou renomeadas, a sessão é cancelada e o lead recomeça no menu, em vez de receber perguntas do evento errado (Task 2, `sessionFitsRule`; Task 3, caso K).
4. **Regra antiga.** Config sem `start` vira palavra-chave. "Fazer perguntas" gera as mesmas notas e o mesmo título de hoje (Task 1 e Task 2).
5. **Passo do menu numa regra que não é de WhatsApp.** Trocar o gatilho para um evento do CRM com o menu na regra bloqueia o salvamento com `whatsappOnly` (Task 1).

---

### Task 1: Tipos, validação e texto do menu

**Files:**
- Modify: `src/lib/automation/types.ts`
- Modify: `src/lib/automation/match.ts` (exportar `normalizeText`)
- Create: `src/lib/automation/menu.ts`
- Create: `scripts/check-automation.ts`
- Modify: `package.json` (script `check:automation`: `tsx scripts/check-automation.ts`)
- Modify: `docs/guia/06-antes-de-commitar.md` (um parágrafo de `check:automation` junto aos de `check:tasks`/`check:search`)

**Interfaces:**
- Produces, em `types.ts`:
  ```ts
  export type WhatsappStart = "keyword" | "any";
  export type WhatsappTriggerConfig = { connectionId: string; start: WhatsappStart; keyword: string; match: KeywordMatch };
  export const MIN_MENU_OPTIONS = 2;
  export const MAX_MENU_OPTIONS = 9;
  export type MenuOption = { label: string; questions: FlowQuestion[]; finalMessage?: string };
  // RuleAction ganha: { type: "ask_menu"; firstMessage?: string; question: string; options: MenuOption[] }
  export type FlowStep = Extract<RuleAction, { type: "ask_questions" | "ask_menu" }>;
  export function isFlowStep(a: RuleAction | undefined): a is FlowStep;
  // ACTION_TYPES: "ask_menu" logo depois de "ask_questions"
  // WHATSAPP_ONLY_ACTIONS = ["ask_questions", "ask_menu", "create_opportunity"]
  // RuleConfig.layout: { trigger?: NodePos; actions?: NodePos[]; branches?: NodePos[] }  (branches[i] = nó da opção i)
  // RuleProblem ganha "menuQuestion" | "menuOptions"
  ```
- Produces, em `menu.ts` (sem import de servidor; o editor usa na prévia):
  ```ts
  export const INVALID_MENU_PREFIX = "Não entendi. Responda com o número de uma das opções:";
  export function menuList(labels: string[]): string;          // "1 - A\n2 - B"
  export function formatMenu(question: string, labels: string[]): string;   // `${question.trim()}\n\n${menuList}`
  export function invalidMenuReply(labels: string[]): string;  // `${INVALID_MENU_PREFIX}\n\n${menuList}`
  export function parseMenuChoice(text: string, labels: string[]): number | null; // índice a partir de 0
  ```
- Produces, em `match.ts`: `export function normalizeText(s: string): string` (mesmo corpo de hoje).

- [ ] **Step 1: Prepare o worktree.** `cp ../../../.env .env` e depois `npm ci --prefer-offline` (o `postinstall` roda `prisma generate`). Esperado: `npm run typecheck` verde antes de qualquer mudança.

- [ ] **Step 2: Escreva os testes que falham em `scripts/check-automation.ts`**, no formato de [scripts/check-task-board.ts](../../../scripts/check-task-board.ts): `check(name, fn)` com `node:assert/strict`, sem banco nem rede.
  - `parseConfig` de regra antiga: `parseConfig({ whatsapp: { connectionId: "c", keyword: "evento", match: "contains" } }).whatsapp` → `{ connectionId: "c", start: "keyword", keyword: "evento", match: "contains" }`. `start: "any"` volta `"any"`, e `start: "lixo"` volta `"keyword"`.
  - `parseConfig` lê `layout.branches`, com as posições válidas e na mesma ordem.
  - `parseActions` de `ask_menu`:
    - nome da opção cortado em 60 e com `trim`; pergunta do menu cortada em 300;
    - 10 opções viram 9; 16 perguntas numa opção viram 15;
    - `field` desconhecido vira `"notes"`; `finalMessage` vazia vira `undefined`.
  - `parseActions` de `ask_questions` e de `ai_collect` continua igual a hoje.
  - `ruleProblem` com gatilho WhatsApp e `start: "any"` sem palavra → `null`, se o resto estiver certo. Com `start: "keyword"` sem palavra → `"keyword"`.
  - `ruleProblem` de menu:
    - pergunta do menu vazia → `"menuQuestion"`;
    - 1 opção → `"menuOptions"`; 2 opções com uma sem nome → `"menuOptions"`;
    - pergunta vazia dentro de uma opção → `"questions"`;
    - opção sem perguntas → `null`.
  - `ruleProblem` com `ask_menu` fora da primeira posição, ou com `ask_menu` e `ask_questions` juntos → `"questionsFirst"`. Gatilho `stage_entered` com `ask_menu` → `"whatsappOnly"`.
  - `formatMenu("Sobre qual evento você deseja falar?", ["Evento X","Evento Y"])` → `"Sobre qual evento você deseja falar?\n\n1 - Evento X\n2 - Evento Y"`. O texto de `invalidMenuReply(["A","B"])` → `"Não entendi. Responda com o número de uma das opções:\n\n1 - A\n2 - B"`.
  - `parseMenuChoice` com `["Evento X","Evento Y","Evento Z"]`:
    - `"2"`, `"2."`, `"2)"`, `"2 -"`, `" opção 2 "`, `"Opcao 2"`, `"op 2"`, `"numero 2"`, `"2️⃣"`, `"evento y"`, `"EVENTO Y"`, `"2 evento y"` → `1`;
    - `"4"`, `"0"`, `"10"`, `"1 e 2"`, `"oi"`, `"o de sábado"`, `""` → `null`.

- [ ] **Step 3: Rode e veja falhar.** `npm run check:automation`. Esperado: FAIL (imports inexistentes).

- [ ] **Step 4: Implemente.**
  - `types.ts`:
    - extraia o parse das perguntas de `ask_questions` para um helper interno, reaproveitado pelas opções do menu;
    - em `ruleProblem`, com o gatilho de WhatsApp, a ordem fica `connection` → `keyword` (só com `start === "keyword"`) → `questionsFirst` (primeiro passo `isFlowStep`, nenhum outro `isFlowStep` depois) → os problemas do passo.
  - `parseMenuChoice`:
    - troque os emojis de número (`/([0-9])️?⃣/g` → `$1`) e aplique `normalizeText`;
    - aceite `^(?:opcao |op |numero )?([1-9])$` dentro do total de opções;
    - aceite também o nome normalizado da opção, ou `N <nome>`.

- [ ] **Step 5: Rode e veja passar.** `npm run check:automation` lista todos os ✓, e `npm run typecheck` fica verde. O editor ainda não compila sem `start` em `emptyWa`: acrescente `start: "keyword"` em `emptyWa` de [automations-client.tsx](../../../src/components/crm/automations-client.tsx), só isso, para o typecheck passar.

- [ ] **Step 6: Commit** (inclui o spec e este plano).
  ```bash
  git add src/lib/automation scripts/check-automation.ts package.json docs/guia/06-antes-de-commitar.md src/components/crm/automations-client.tsx docs/superpowers
  git commit -m "[Automacoes] - Adiciona o tipo do menu de opções e o início com qualquer mensagem"
  ```

### Task 2: Regras puras do fluxo

**Files:**
- Create: `src/lib/automation/flow-core.ts` (sem import de servidor)
- Modify: `scripts/check-automation.ts`

**Interfaces:**
- Consumes: `FlowStep`, `FlowQuestion`, `MenuOption` (Task 1); `parseMenuChoice` (Task 1).
- Produces:
  ```ts
  export type Answers = Record<string, string>;
  export const MENU_KEY = "menu";             // índice da opção, a partir de 0, como texto
  export const MENU_LABEL_KEY = "menuLabel";  // nome da opção no momento da escolha
  export const ANY_MESSAGE_QUIET_MS = 7 * 24 * 60 * 60 * 1000;
  export const BURST_GRACE_MS = 10 * 60 * 1000;
  export type ActivePath = { questions: FlowQuestion[]; finalMessage?: string; choice?: { index: number; label: string } };
  export function activePath(step: FlowStep, answers: Answers): ActivePath | null;
  export function sessionFitsRule(step: FlowStep, answers: Answers): boolean;
  export function pickMenuChoice(lines: string[], labels: string[]): number | null;
  export type SessionStatus = "ACTIVE" | "COMPLETED" | "EXPIRED" | "HANDOFF" | "CANCELED";
  export type AnyStartFacts = {
    arrivedAt: Date;
    assigned: boolean;
    /** Mensagem anterior mais nova que conta como atividade: qualquer saída, ou
     *  entrada com mais de BURST_GRACE_MS antes de arrivedAt. Null = conversa nova. */
    lastActivityAt: Date | null;
    /** Sessão mais recente DESTA regra nesta conversa. */
    lastSession: { status: SessionStatus; createdAt: Date } | null;
    /** Existe saída escrita por pessoa (OUTBOUND, agentReply=false) depois de lastSession.createdAt. */
    humanReplyAfterLastSession: boolean;
  };
  export function canStartOnAnyMessage(f: AnyStartFacts): boolean;
  export function opportunityNotes(ruleName: string, path: ActivePath, answers: Answers): string;
  export function opportunityTitle(ruleName: string, path: ActivePath, contactName: string | null): string;
  ```

- [ ] **Step 1: Escreva os testes que falham** em `scripts/check-automation.ts`:
  - `activePath`:
    - `ask_questions` → as perguntas e a mensagem final do passo, sem `choice`;
    - `ask_menu` sem `menu` → `null`;
    - com `{ menu: "1", menuLabel: "Evento Y" }` → perguntas e mensagem final da opção 2, com `choice: { index: 1, label: "Evento Y" }`;
    - `menu: "7"` com 3 opções, ou `menu: "x"` → `null`.
  - `sessionFitsRule`, casos verdadeiros:
    - `ask_questions` com `{}` ou `{ "0": "a" }` e 2 perguntas;
    - `ask_menu` com `{}`;
    - `ask_menu` com `{ menu: "1", menuLabel: "Evento Y" }` e uma pergunta pendente.
  - `sessionFitsRule`, casos falsos:
    - `ask_questions` com `menu` nas respostas;
    - `ask_questions` com todas as perguntas respondidas;
    - `ask_menu` sem `menu`, mas com `"0"` respondido (a regra trocou de passo);
    - `menuLabel` diferente do nome atual da opção (reordenada ou renomeada);
    - índice fora da faixa;
    - todas as perguntas da opção respondidas.
  - `pickMenuChoice(["2","obrigado"], L)` → `1`; `(["oi","3"], L)` → `2`; `(["oi","tudo bem"], L)` → `null`. A última linha que vale ganha.
  - `canStartOnAnyMessage`, com `arrivedAt = 2026-10-27T12:00Z`:
    - conversa nova (`lastActivityAt: null`) → `true`;
    - atividade há 6 dias e 23 h → `false`; há exatamente 7 dias → `true`;
    - `assigned: true` → sempre `false`, mesmo com conversa nova;
    - atividade há 1 h, `lastSession` `EXPIRED` ou `CANCELED`, sem resposta humana → `true`; com resposta humana → `false`;
    - atividade há 1 h e `lastSession` `COMPLETED` ou `HANDOFF` → `false`.
  - `opportunityNotes` com `ask_questions` (sem `choice`) é idêntica ao texto de hoje em `finishFlow`:
    ```
    <pergunta>: <resposta ou —>
    …
    Origem: WhatsApp (automação "<regra>")
    ```
    Com `choice`, ganha antes a linha `Opção escolhida: Evento Y`.
  - `opportunityTitle`:
    - sem `choice` → `"<regra> · <contato>"`, e `"<regra> · "` com contato nulo, como hoje;
    - com `choice` → `"<regra> · Evento Y · <contato>"`.

- [ ] **Step 2: Rode e veja falhar.** `npm run check:automation` → FAIL.
- [ ] **Step 3: Implemente `flow-core.ts`.** `sessionFitsRule` vale quando:
  - `activePath` é `null` e não há chave numérica (o menu ainda espera a escolha); ou
  - `activePath` não é nula, o `menuLabel` confere (no menu), não há `menu` num `ask_questions` e pelo menos uma pergunta do caminho está sem resposta.
- [ ] **Step 4: Rode e veja passar.** `npm run check:automation`.
- [ ] **Step 5: Commit** `[Automacoes] - Adiciona as regras puras do menu e do início com qualquer mensagem`.

### Task 3: Motor da conversa + e2e

**Files:**
- Modify: `src/lib/automation/whatsapp-flow.ts`
- Create: `scripts/check-automation-e2e.ts`
- Modify: `package.json` (`check:automation:e2e`: `tsx --env-file=.env scripts/check-automation-e2e.ts`)
- Modify: `docs/guia/06-antes-de-commitar.md` (parágrafo do e2e, no formato do de `check:mcp:e2e`)

**Interfaces:**
- Consumes: tudo da Task 2; `formatMenu`, `invalidMenuReply` (Task 1); `isFlowStep` (Task 1).
- Produces: nada novo para as outras tasks. `FlowRule` passa a ser `{ id, name, wa, step: FlowStep, actions }` (era `ask`).

- [ ] **Step 1: Escreva o e2e que falha** em `scripts/check-automation-e2e.ts`, no estilo de [check-mcp-e2e.ts](../../../scripts/check-mcp-e2e.ts): `PrismaClient` com `PrismaPg`, `node:assert/strict`, e limpeza total no `finally`.
  - **Fixtures**, numa organização nova:
    - `OrganizationModule` `inbox` `ACTIVE`, e o funil padrão com etapas que `insertBotOpportunity` exige;
    - uma `IntegrationConnection` `EVOLUTION` `ACTIVE`, com `meta.webhookToken` e `credentialsEnc` criptografado no formato de [crypto.ts](../../../src/lib/integrations/crypto.ts). Esse arquivo é `server-only`, então copie o formato no script: AES-256-GCM, `iv:tag:ciphertext` em base64, chave hex `INTEGRATION_ENC_KEY`. As credenciais são `{ baseUrl: "http://localhost:4999", apiKey: "e2e", instance: "e2e" }`.
  - **Evolution falsa**: `http.createServer` na porta 4999 (ou `AUTOMATION_E2E_EVO_PORT`). Responde `POST /message/sendText/e2e` com `{ key: { id } }` e guarda `{ number, text }` por número.
  - **Webhook**: `POST http://localhost:3000/api/webhooks/evolution/<connId>/<token>` (ou `AUTOMATION_E2E_URL`). O payload é `messages.upsert`: `data.key.remoteJid = "<numero>@s.whatsapp.net"`, `fromMe: false`, `id` único, `message.conversation` com o texto e `pushName`. Confira o formato com `parseInboundMessages`.
  - **Esperas**: um helper que aguarda as próximas N mensagens de um número, com prazo de 25 s (o debounce é 8 s). Outro que confirma que nada chegou em 14 s.
  - **Regras**, criadas direto no banco, na ordem:
    - **R_kw**: palavra "evento", `contains`, `ask_menu` com `firstMessage: "BV-KW"`, `question: "Qual evento (kw)?"`. Opções: "Evento X" (perguntas "Qual o seu nome?" → `name`, "Quantos ingressos?" → `notes`; final "FX"), "Evento Y" ("Qual a empresa?" → `notes`; final "FY") e "Falar com um atendente" (sem perguntas; final "FA"). Depois, `create_opportunity`.
    - **R_any**: `start: "any"`, mesmas opções, `firstMessage: "BV-ANY"`, `question: "Qual evento?"`. Depois, `create_opportunity`.
    - **R_old**: JSON cru sem `start`, palavra "orcamento", `ask_questions` com "Para quando?" → `notes`.
  - **Casos**, rodando em paralelo, um número por caso:
    - **A**: "quero falar do evento" → BV-KW, menu kw. "2." → "Qual a empresa?". "ACME" → "FY". A oportunidade tem título `R_kw · Evento Y · <contato>` e notas começando com `Opção escolhida: Evento Y`.
    - **B**: "Oi" → BV-ANY, menu. "o de sábado" → `invalidMenuReply`. "1️⃣" → "Qual o seu nome?". "Ana" → "Quantos ingressos?". "3" → "FX". O contato passa a se chamar "Ana".
    - **C**: "Oi" → menu. "falar com um atendente" → "FA", e a sessão fica `COMPLETED`. Depois, "obrigado" → nada.
    - **D**: conversa semeada com uma saída de 2 dias atrás. "Oi" → nada, e nenhuma sessão.
    - **E**: conversa semeada com `assignedToId`. "Oi" → nada.
    - **F**: conversa semeada com uma saída de 8 dias atrás. "Oi" → BV-ANY, menu.
    - **G**: "Oi" → menu. Mude `lastInboundAt` da sessão para 25 h atrás. "2" → BV-ANY e menu de novo; a sessão antiga fica `EXPIRED` e há uma nova `ACTIVE`.
    - **H**: igual ao G, mas antes do "2" insira uma saída com `agentReply: false` agora. "2" → nada.
    - **J**: "Oi" e, 1 s depois, "tudo bem?" → exatamente BV-ANY e um menu, nada além. Fica uma única sessão `ACTIVE` na conversa. "2" → só "Qual a empresa?".
    - **K**: "Oi" → menu. "2" → "Qual a empresa?". Troque no banco a ordem de "Evento X" e "Evento Y" em R_any. "ACME" → BV-ANY e menu; a sessão anterior fica `CANCELED`.
    - **L**: "orcamento" → "Para quando?". "sexta" → mensagem final padrão. As notas não têm a linha "Opção escolhida".
  - **Limpeza**: apague tudo pelo `organizationId` no `finally`, inclusive sessões, mensagens, conversas e contatos.

- [ ] **Step 2: Rode e veja falhar.** Suba `npx next dev --webpack` em :3000 (com Turbopack as rotas `/api` dão 404 nesta máquina) e rode `npm run check:automation:e2e`. Esperado: FAIL nos casos de menu.

- [ ] **Step 3: Implemente em `whatsapp-flow.ts`.**
  - **`flowRules`** aceita estas regras:
    - primeiro passo `ask_questions` com pelo menos 1 pergunta, ou `ask_menu` com 2 opções ou mais;
    - palavra preenchida, ou `start === "any"`.
  - **`claimFlow`**:
    - **Sessão aberta.** Leia `answers` na consulta da sessão aberta. A sessão continua se a regra existe, não expirou e `sessionFitsRule(rule.step, answers)` vale. Senão, marque `EXPIRED` ou `CANCELED` e siga, com a mesma mensagem, para o começo do fluxo.
    - **Regras com palavra.** Só as com `start === "keyword"` passam por `keywordMatches`.
    - **Regra de qualquer mensagem.** Sem palavra que case, pegue a regra `start === "any"` mais antiga e monte `AnyStartFacts`:
      - `arrivedAt`: `createdAt` da mensagem que chegou;
      - `assigned`: `conversation.assignedToId` (inclua no `select`);
      - `lastActivityAt`: `findFirst` da mensagem mais nova da conversa com id diferente da que chegou e `createdAt <= arrivedAt`, que seja `OUTBOUND` ou tenha `createdAt < arrivedAt - BURST_GRACE_MS`;
      - `lastSession`: sessão mais recente da regra na conversa;
      - `humanReplyAfterLastSession`: existe `OUTBOUND` com `agentReply: false` depois de `lastSession.createdAt`.
    - **Começo.** Se `canStartOnAnyMessage`, crie a sessão como hoje.
    - **Uma sessão por conversa.** Depois de criar uma sessão (palavra ou qualquer mensagem), deixe só uma `ACTIVE` na conversa: a de `createdAt` mais novo continua (empate pelo `id`) e as outras viram `CANCELED`. Numa rajada, dois `claimFlow` podem criar sessões ao mesmo tempo. Sem essa limpeza, a sobra responde depois que a outra termina.
  - **`runFlowTurn`**:
    - **Menu sem escolha.** Com `ask_menu` sem `MENU_KEY`, o menu conta como enviado se algum texto do bot desta sessão for `formatMenu(...)` ou `invalidMenuReply(...)` (com `trim`).
      - Se não foi enviado: mande a boas-vindas (se for o primeiro turno do bot) e o menu, e pare.
      - Se foi: as linhas de entrada desde a última mensagem do bot vão para `pickMenuChoice`. Sem linha, mande `PLEASE_TYPE`. Sem escolha, mande `invalidMenuReply`.
      - Com escolha: grave `MENU_KEY` e `MENU_LABEL_KEY`. Se o caminho não tem perguntas, feche a sessão, mande a mensagem final e finalize. Senão, mande a primeira pergunta do caminho.
    - **Resto do turno.** Vale a lógica de hoje sobre `activePath(step, answers)`, no lugar de `rule.ask.questions` e `rule.ask.finalMessage`.
  - **`finishFlow`** recebe o `ActivePath`:
    - nome e e-mail do contato vêm das perguntas do caminho;
    - notas e título vêm de `opportunityNotes` e `opportunityTitle`;
    - `rest` continua `rule.actions.slice(1)`.

- [ ] **Step 4: Rode e veja passar.** `npm run check:automation:e2e` com todos os casos ✓. `npm run check:automation` também verde.
- [ ] **Step 5: Commit** `[Automacoes] - Faz o fluxo de WhatsApp seguir o menu e começar com qualquer mensagem`.

### Task 4: Uma regra de qualquer mensagem por número

**Files:**
- Modify: `src/app/actions/automations.ts`

**Interfaces:**
- Produces:
  - `RuleResult` com `error: "unauthorized" | "forbidden" | "invalid" | "unknown" | "anyTaken"`;
  - `toggleRule(id, enabled): Promise<{ ok: boolean; error?: "anyTaken" }>`.
  - A Task 5 mostra `t("err.anyTaken")` nos dois casos.

- [ ] **Step 1: Implemente `anyMessageTaken(ctx, connectionId: string, exceptId: string | null): Promise<boolean>`** no próprio arquivo, como `checkWhatsapp`. Use `tenantDb(...).automationRule.findMany` com `trigger: "whatsapp_message"`, `enabled: true` e `id: { not: exceptId }` quando houver; a resposta é `true` se alguma `parseConfig(config).whatsapp` tiver `start === "any"` no mesmo `connectionId`. Chame-o:
  - em `createRule`, quando a regra é de WhatsApp com `start: "any"`;
  - em `updateRule`, idem, mas só se a regra guardada está `enabled` (busque com `findFirst`);
  - em `toggleRule`, ao ligar uma regra de WhatsApp com `start: "any"`.
- [ ] **Step 2: Verifique.** `npm run typecheck` e o lint verdes. O teste de verdade vem no navegador, na Task 6.
- [ ] **Step 3: Commit** `[Automacoes] - Recusa a segunda regra de qualquer mensagem no mesmo número`.

### Task 5: Editor — gatilho, nó do menu, nós das opções e painéis

**Files:**
- Modify: `src/components/crm/automations-client.tsx`
- Create: `src/components/crm/automation-flow-inspectors.tsx`. Recebe `Field` e `Select` (movidos de `automations-client.tsx` e exportados), e os novos `QuestionsEditor`, `MenuInspector` e `OptionInspector`.
- Modify: `src/messages/pt.json`, `src/messages/en.json`, `CLAUDE.md` (contagem)

**Interfaces:**
- Consumes:
  - `formatMenu` (Task 1), `MIN_MENU_OPTIONS`, `MAX_MENU_OPTIONS`, `MAX_FLOW_QUESTIONS`;
  - de `toggleRule`, `{ ok, error? }`, e `RuleResult.error === "anyTaken"` (Task 4).
- Produces, em `automation-flow-inspectors.tsx`:
  ```ts
  export function Field(props: { label: string; children: React.ReactNode }): JSX.Element;
  export function Select(props: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }): JSX.Element;
  export function QuestionsEditor(props: { questions: FlowQuestion[]; onChange: (q: FlowQuestion[]) => void; t: Translator }): JSX.Element;
  export function MenuInspector(props: { step: Extract<RuleAction, { type: "ask_menu" }>; onChange: (s: Extract<RuleAction, { type: "ask_menu" }>) => void; t: Translator }): JSX.Element;
  export function OptionInspector(props: { index: number; option: MenuOption; onChange: (o: MenuOption) => void; t: Translator }): JSX.Element;
  ```
  `Translator` é `ReturnType<typeof useTranslations>`. `QuestionsEditor` é exatamente o editor de perguntas de hoje (texto, "Salvar em", ×, "Adicionar pergunta", dica), e o painel de `ask_questions` passa a usá-lo.

- [ ] **Step 1: Chaves de i18n** em `crm.automations`, em pt e en:
  - **Gatilho:**
    - `action.ask_menu`: "Menu de opções" / "Options menu";
    - `waStart`: "O fluxo começa" / "The flow starts";
    - `waStartMode.keyword`: "Com uma palavra-chave" / "With a keyword";
    - `waStartMode.any`: "Com qualquer mensagem" / "With any message";
    - `waStartAnyHint`: "Quem escrever para este número recebe o fluxo se a conversa for nova ou estiver parada há 7 dias. Conversas atribuídas a alguém ficam de fora, e regras com palavra-chave neste número têm prioridade." (en equivalente);
    - `waStartAnyShort`: "qualquer mensagem" / "any message".
  - **Painel do menu:**
    - `menuQuestion`: "Pergunta do menu";
    - `menuQuestionPlaceholder`: "Ex.: Sobre qual evento você deseja falar?";
    - `menuOptions`: "Opções, nesta ordem";
    - `menuOptionPlaceholder`: "Ex.: Evento X";
    - `addOption`: "Adicionar opção"; `removeOption`: "Remover opção";
    - `moveOptionUp`: "Subir"; `moveOptionDown`: "Descer";
    - `menuOptionsHint`: "De 2 a 9 opções. As perguntas de cada uma ficam no bloco dela.";
    - `menuPreview`: "Como o lead vê";
    - `menuInvalidHint`: "Se a resposta não for uma das opções, o menu é enviado de novo.";
    - `optionsCount`: plural "# opção" / "# opções".
  - **Painel da opção:**
    - `optionLabel`: "Nome da opção";
    - `optionTitle`: "Opção {n}";
    - `optionNoQuestions`: "Nenhuma pergunta. O lead recebe a mensagem final logo depois de escolher.";
    - `optionFinalOnly`: "só a mensagem final".
  - **Problemas e erros:**
    - `problem.menuQuestion`: "Escreva a pergunta do menu.";
    - `problem.menuOptions`: "O menu precisa de pelo menos 2 opções, todas com nome.";
    - `err.anyTaken`: "Este número já tem uma regra ativa que começa com qualquer mensagem. Desative a outra primeiro.".
  - **Textos que mudam:**
    - `problem.questionsFirst` → "Com o gatilho de WhatsApp, o primeiro passo precisa ser \"Fazer perguntas\" ou \"Menu de opções\", e só um deles.";
    - `problem.whatsappOnly` → "\"Fazer perguntas\", \"Menu de opções\" e \"Criar oportunidade\" só funcionam com o gatilho de WhatsApp.".
  - Depois, atualize a contagem do CLAUDE.md.

- [ ] **Step 2: Gatilho.**
  - Campo `waStart` (Select) logo depois de "Número que recebe". Com `any`, esconda palavra e "A palavra precisa estar" e mostre `waStartAnyHint`.
  - O resumo do nó do gatilho e o chip do cartão da lista mostram `waStartAnyShort` no lugar de `"palavra"`.
  - Uma linha de erro acima da lista mostra `err.anyTaken` quando `toggleRule` recusar. No editor, o `error` de hoje já mostra `err.anyTaken`.

- [ ] **Step 3: Passo do menu.**
  - `ACTION_ICON.ask_menu = ListOrdered`, e `newAction("ask_menu")` cria `{ type, question: "", options: [{ label: "", questions: [] }, { label: "", questions: [] }] }`.
  - O botão de adicionar `ask_questions`/`ask_menu` só aparece com o gatilho de WhatsApp e sem nenhum `isFlowStep` na regra. `addAction` desses dois insere na posição 0 e desloca `layout.actions`.
  - `actionSummary(ask_menu)` → `${t("action.ask_menu")}: ${t("optionsCount", { count })}`.

- [ ] **Step 4: Nós das opções no canvas.**
  - Com `actions[0]` sendo `ask_menu`, desenhe um nó por opção:
    - rótulo `${i + 1} · ${label || t("optionTitle", { n: i + 1 })}`;
    - resumo `questionsCount` ou `optionFinalOnly`;
    - × que remove a opção e a posição `layout.branches[i]`.
  - `Selection` vira `"trigger" | number | { branch: number } | null`. `startDrag` aceita `{ branch: i }` e grava em `layout.branches`.
  - Linhas:
    - do centro do menu para cada opção, e de cada opção para `actions[1]`, se existir;
    - nesse caso não há linha direta de `actions[0]` para `actions[1]`;
    - as demais ligações ficam como hoje.
  - Posição padrão das opções: fileira centrada 130 px abaixo do menu, com passo `NODE_W + 24`. `actions[1]` e seguintes, sem posição salva, vão para baixo dessa fileira. `normalizeLayout` inclui `branches`, e o `save` corta `branches` ao total de opções.
  - Painéis:
    - clicar no menu abre `MenuInspector` (boas-vindas, pergunta, lista de opções com ↑ ↓ ×, "Adicionar opção" até `MAX_MENU_OPTIONS`, prévia com `formatMenu` num balão, `menuInvalidHint`);
    - clicar numa opção abre `OptionInspector` (nome, `QuestionsEditor`, mensagem final);
    - reordenar no menu também reordena `layout.branches`.

- [ ] **Step 5: Verifique.** `npm run typecheck`, o lint, `npm run build` e `npm run check:automation` verdes. Chaves de pt e en com a mesma contagem (o comando `node -e` que conta folhas nos dois arquivos).
- [ ] **Step 6: Commit** `[Automacoes] - Adiciona o menu de opções e o início com qualquer mensagem ao editor`.

### Task 6: Verificação final no navegador

**Files:** nenhum novo. Só correções, se aparecerem.

- [ ] **Step 1: Teste no navegador.** Logado no `next dev --webpack` (seed owner), em `/app/automations`:
  - **Menu do zero.** Crie uma regra de WhatsApp com "Com qualquer mensagem" e o "Menu de opções" com 3 opções (uma sem perguntas). Arraste o menu e uma opção, salve, reabra: tudo volta no lugar, com as linhas certas.
  - **Validação.** Salvar com uma opção sem nome mostra `problem.menuOptions`. Uma segunda regra ativa de qualquer mensagem no mesmo número mostra `err.anyTaken`, e ligar uma desligada pelo interruptor da lista mostra a mesma mensagem.
  - **Regra antiga.** Abrir uma regra antiga de "Fazer perguntas" mostra o painel de sempre, e salvar não muda o comportamento.
  - **Prévia e ordem.** A prévia do menu bate com `formatMenu`, e reordenar opções reordena os nós.
- [ ] **Step 2: Rode as checagens.** Os cinco do CLAUDE.md, `npm run check:automation` e `npm run check:automation:e2e`, todos verdes. Cole a saída no relatório.
- [ ] **Step 3: Confira o spec.** Releia o §8 do spec e marque cada caso como coberto pelo e2e (Task 3) ou pelo teste no navegador (Step 1).
- [ ] **Step 4: Commit.** Se houve correção, `[Automacoes] - Corrige <o quê> do menu de opções`.

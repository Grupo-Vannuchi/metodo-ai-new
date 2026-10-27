# Automação de WhatsApp com menu de opções e início sem palavra-chave — desenho

Data: 2026-10-27. Parte do que já está na `main`: gatilho "Mensagem recebida no WhatsApp" (PR #217), perguntas fixas sem IA (PR #218) e qualquer número aceito (PR #248). Onde este documento diz "como hoje", vale o código atual de [src/lib/automation/whatsapp-flow.ts](../../../src/lib/automation/whatsapp-flow.ts), [types.ts](../../../src/lib/automation/types.ts) e [automations-client.tsx](../../../src/components/crm/automations-client.tsx).

## 1. Intenção

Um cliente do MétodoAI vai usar o bot do WhatsApp para atender os leads dele, que chegam perguntando sobre eventos diferentes. Hoje o fluxo faz a mesma lista de perguntas para todo mundo. O cliente precisa que o bot pergunte primeiro qual é o evento e, a partir da resposta, siga um caminho próprio, com perguntas próprias e uma mensagem final própria.

Conversa que o usuário descreveu:

```
Lead: (chega mensagem)
Bot:  Sobre qual evento você deseja falar?
      1 - Evento X
      2 - Evento Y
      3 - Evento Z
Lead: 2
Bot:  (perguntas do caminho do Evento Y, uma por vez)
Bot:  (mensagem final do caminho do Evento Y)
```

O usuário também pediu que a regra possa começar **sem palavra-chave**: qualquer mensagem que chega no número inicia o fluxo.

**Sucesso:**
- o cliente monta o menu e os caminhos sozinho, na tela de Automações que já existe;
- o lead vê o menu numerado, responde o número e recebe só as perguntas daquele evento;
- cada caminho termina com a sua mensagem final;
- a oportunidade é criada como hoje, com o evento escolhido registrado nas notas;
- uma regra pode começar com qualquer mensagem, sem atropelar conversas que a equipe já está tendo.

## 2. Decisões

| Assunto | Decisão | De quem |
|---|---|---|
| Profundidade | Um menu só, no começo do fluxo. Não existe menu dentro de um caminho | palpite aceito pelo usuário |
| Resposta que não é opção | O bot manda o menu de novo, com um aviso curto antes | palpite aceito pelo usuário |
| Variações aceitas | Número puro e variações ("1.", "1)", "opção 1", "1️⃣"), e também o nome da opção escrito igual ("evento y") | número e variações: palpite aceito; nome da opção e emoji: minha decisão |
| Fim de cada caminho | Mensagem final própria, configurada no editor como a mensagem final é hoje | usuário |
| CRM | Todo caminho cria a oportunidade como hoje; as outras ações da regra (tarefa, notificação etc.) são as mesmas para todos os caminhos | palpite aceito pelo usuário |
| Evento nas notas | A primeira linha das notas é "Opção escolhida: Evento Y" | palpite aceito pelo usuário |
| Título da oportunidade | `<nome da regra> · <opção> · <nome do contato>` | minha decisão |
| Início sem palavra-chave | O gatilho ganha a escolha "Com uma palavra-chave" ou "Com qualquer mensagem" | usuário |
| Quando "qualquer mensagem" começa | Só se a conversa for nova ou estiver parada há **7 dias** (nenhuma mensagem, de nenhum lado, nos 7 dias antes desta) | usuário (aceitou a recomendação) |
| Conversa atribuída a alguém da equipe | "Qualquer mensagem" não começa, igual ao agente de IA, que fica quieto nesses casos | minha decisão |
| Lead que abandonou o menu | Se a última sessão desta regra na conversa expirou ou foi cancelada, e ninguém da equipe escreveu desde que ela começou, a próxima mensagem do lead abre o fluxo de novo, sem esperar os 7 dias | minha decisão (sem isso o lead fica 7 dias sem conseguir voltar, porque não existe palavra para reenviar) |
| Contato com oportunidade aberta | "Qualquer mensagem" começa mesmo assim; terminar o fluxo cria outra oportunidade | usuário (aceitou a recomendação: o lead pode estar perguntando de outro evento) |
| Formato do menu | Texto numerado. O usuário pediu botões clicáveis e voltou para texto: o cliente usa o número conectado por QR code (Evolution), onde botões não chegam na versão estável (issues evolution-api #2404 e #2390; correção só na 2.4.0, pré-lançamento) | usuário |
| Prioridade no mesmo número | Sessão aberta > regras com palavra-chave (a mais antiga primeiro, como hoje) > a regra de qualquer mensagem | minha decisão |
| Regras de qualquer mensagem | No máximo uma ativa por número; o salvamento recusa a segunda | minha decisão |
| Onde o menu mora | Ação nova "Menu de opções" (`ask_menu`), alternativa a "Fazer perguntas" como primeiro passo | minha decisão |
| Perguntas antes do menu | Não existem. O menu é a primeira coisa depois da boas-vindas | minha decisão (o exemplo do usuário começa pelo menu) |
| Limites | 2 a 9 opções (um dígito); 0 a 15 perguntas por caminho | minha decisão |
| Caminho sem perguntas | Permitido: escolheu, recebe a mensagem final e o fluxo termina (ex.: "4 - Falar com um atendente") | minha decisão |
| Textos fixos do bot | O aviso de resposta inválida não é configurável, como os textos fixos de hoje | minha decisão |
| Banco | Nenhuma migration: tudo cabe nos JSON `actions`/`config` da regra e em `automation_sessions.answers` | consequência do desenho |

## 3. Comportamento

### 3.1 Começo do fluxo

Modo **palavra-chave**: igual a hoje.

Modo **qualquer mensagem**: a mensagem inicia o fluxo quando, ao mesmo tempo:
- a conversa não tem sessão aberta;
- nenhuma regra com palavra-chave deste número casou com a mensagem;
- a conversa não está atribuída a ninguém (`conversation.assignedToId` vazio);
- e uma destas vale:
  - **conversa parada:** não existe mensagem na conversa (de entrada ou de saída, de pessoa ou de bot) nos 7 dias anteriores à mensagem que chegou. Conversa nova conta como parada;
  - **lead que abandonou:** a sessão mais recente desta regra na conversa terminou `EXPIRED` ou `CANCELED`, e nenhuma mensagem de saída escrita por pessoa (saída sem `agentReply`) apareceu na conversa desde que essa sessão começou. A mensagem que chegou não vale como resposta: o fluxo recomeça da boas-vindas e do menu.

A regra dos 7 dias impede que o bot mande o menu quando o lead responde alguém da equipe, ou escreve logo depois de terminar o fluxo (sessão `COMPLETED`). Mensagens que não iniciam o fluxo seguem para o agente de IA, como hoje.

Ter oportunidade aberta não impede o começo: terminar o fluxo cria outra oportunidade.

### 3.2 O que o lead recebe

1. A mensagem de boas-vindas, se houver, numa mensagem separada (como hoje).
2. O menu, numa mensagem só:

```
Sobre qual evento você deseja falar?

1 - Evento X
2 - Evento Y
3 - Evento Z
```

A numeração vem da ordem das opções no editor; o formato é `N - nome`.

### 3.3 A escolha

O texto do lead é normalizado como em [match.ts](../../../src/lib/automation/match.ts) (sem acento, minúsculo, pontuação vira espaço), e os emojis de número (`1️⃣`) viram o dígito. Vale como escolha da opção N:
- `N`, com ou sem pontuação ("1", "1.", "1)", "1 -");
- `opcao N`, `op N`, `numero N`;
- o nome da opção, normalizado ("evento y"), ou `N` seguido do nome ("2 evento y").

Qualquer outra coisa é inválida, inclusive números fora da lista e duas opções juntas. O bot responde:

```
Não entendi. Responda com o número de uma das opções:

1 - Evento X
2 - Evento Y
3 - Evento Z
```

e continua esperando. Não há limite de tentativas; a sessão expira em 24 h sem resposta, como hoje.

### 3.4 O caminho

Depois da escolha, as perguntas daquele caminho seguem uma por vez, exatamente como "Fazer perguntas" faz hoje: cada resposta vai para o campo escolhido (nome do contato, e-mail do contato ou notas). Ao responder a última, o lead recebe a mensagem final do caminho (ou o texto padrão de hoje, se estiver vazia) e a sessão fecha. Caminho sem perguntas manda a mensagem final logo depois da escolha.

### 3.5 Fim

Igual a `finishFlow` de hoje, com estas diferenças:
- nome e e-mail do contato vêm das respostas do caminho escolhido;
- notas da oportunidade:

```
Opção escolhida: Evento Y
<pergunta 1 do caminho>: <resposta>
<pergunta 2 do caminho>: <resposta>
Origem: WhatsApp (automação "<nome da regra>")
```

- título: `<nome da regra> · Evento Y · <nome do contato>`;
- as demais ações da regra rodam depois, iguais para qualquer caminho.

### 3.6 Regra editada no meio de uma conversa

Se a sessão aberta aponta para uma opção que não existe mais, ou se o primeiro passo da regra deixou de ser o menu, a sessão é cancelada (`CANCELED`), como hoje acontece quando a regra some. A mesma mensagem é então tratada do zero, pelas regras do §3.1 (em "qualquer mensagem", cai no caso "lead que abandonou" e recomeça o fluxo). Como a opção é guardada pelo índice, reordenar ou remover opções no meio de uma conversa pode trocar o caminho; quem implementar pode guardar uma identidade estável da opção para cancelar nesses casos também.

## 4. Dados (JSON, sem migration)

Em [types.ts](../../../src/lib/automation/types.ts):

```ts
export type WhatsappTriggerConfig = {
  connectionId: string;
  start: "keyword" | "any";   // novo; regras antigas sem o campo = "keyword"
  keyword: string;            // obrigatória só quando start = "keyword"
  match: KeywordMatch;
};

export type MenuOption = { label: string; questions: FlowQuestion[]; finalMessage?: string };

// nova variante de RuleAction
| { type: "ask_menu"; firstMessage?: string; question: string; options: MenuOption[] }

// RuleConfig.layout ganha as posições dos nós de cada opção
layout?: { trigger?: NodePos; actions?: NodePos[]; branches?: NodePos[] };
```

- `ask_menu` entra em `ACTION_TYPES` e em `WHATSAPP_ONLY_ACTIONS`.
- `parseActions` normaliza `ask_menu`: `question` até 300 caracteres, `label` até 60, `finalMessage`/`firstMessage` até 1000, no máximo 9 opções e 15 perguntas por opção (`MAX_FLOW_QUESTIONS`).
- `parseConfig` lê `start` (qualquer valor diferente de `"any"` vira `"keyword"`) e `layout.branches`.
- `ruleProblem`, com gatilho de WhatsApp: o primeiro passo precisa ser `ask_questions` **ou** `ask_menu`, e só um dos dois na regra (`questionsFirst`, texto ajustado). A palavra só é obrigatória com `start = "keyword"`. Problemas novos: `menuQuestion` (pergunta do menu vazia) e `menuOptions` (menos de 2 opções ou alguma sem nome). Pergunta vazia dentro de um caminho reusa `questions`.
- A checagem "no máximo uma regra ativa de qualquer mensagem por número" precisa do banco, então fica na server action de salvar e na de ligar/desligar a regra, não em `ruleProblem`.
- `automation_sessions.answers` guarda a escolha e as respostas do caminho, por exemplo `{ "menu": "1", "0": "...", "1": "..." }` (opção pelo índice a partir de 0; as chaves numéricas são as perguntas do caminho escolhido). O formato exato fica com quem implementar.

## 5. Motor ([whatsapp-flow.ts](../../../src/lib/automation/whatsapp-flow.ts))

- `flowRules` aceita regras cujo primeiro passo é `ask_questions` ou `ask_menu`, e regras com `start = "any"` mesmo sem palavra.
- `claimFlow` aplica a ordem do §3.1: sessão aberta, depois regras com palavra-chave, depois a regra de qualquer mensagem com as checagens de atribuição, dos 7 dias e do lead que abandonou. A checagem dos 7 dias olha a mensagem anterior à que chegou (ela já foi gravada antes do `claimFlow` rodar, como hoje).
- `runFlowTurn` hoje descobre se a pergunta pendente já foi enviada comparando com os textos do bot. Com o menu, o texto montado do menu e o texto do aviso de resposta inválida entram nessa comparação.
- Os textos fixos novos (aviso de resposta inválida) ficam como constantes em português, como `PLEASE_TYPE` e `DEFAULT_FINAL`.
- Tudo continua rodando como sistema, com `organizationId` explícito em toda consulta (guia 03).

## 6. Tela ([automations-client.tsx](../../../src/components/crm/automations-client.tsx))

### 6.1 Gatilho
- Campo novo **"O fluxo começa"** com as opções "Com uma palavra-chave" e "Com qualquer mensagem", logo depois de "Número que recebe".
- Com "qualquer mensagem", os campos de palavra e de "A palavra precisa estar" somem e aparece a explicação: qualquer pessoa que escrever para o número inicia o fluxo se a conversa for nova ou estiver parada há 7 dias; regras com palavra-chave no mesmo número têm prioridade.
- O resumo do nó do gatilho e o cartão da lista de regras mostram "qualquer mensagem" no lugar da palavra.

### 6.2 Canvas
- Nó **"Menu de opções"** com resumo "3 opções".
- Abaixo dele, um nó por opção, lado a lado, ligado ao menu: "Opção 2 · Evento Y" com resumo "2 perguntas". Os nós das opções são arrastáveis e a posição é salva em `layout.branches`.
- As linhas de todas as opções convergem para o passo seguinte (ex.: "Criar oportunidade"), que por padrão fica abaixo da fileira de opções.
- O botão de adicionar "Menu de opções" só aparece com o gatilho de WhatsApp e quando a regra ainda não tem "Fazer perguntas" nem "Menu de opções". Adicionar o menu coloca ele como **primeiro** passo. Para trocar um pelo outro, remove-se um e adiciona-se o outro.
- Um × no nó da opção remove a opção.

### 6.3 Painel do menu (ao clicar no nó do menu)
- Mensagem de boas-vindas (opcional).
- Pergunta do menu.
- Opções: lista de campos de nome, com ↑ ↓ para reordenar, × para remover e "Adicionar opção" (até 9).
- Prévia "Como o lead vê", com o menu montado.
- Dica: se a resposta não for uma opção, o menu é enviado de novo.

### 6.4 Painel da opção (ao clicar no nó de uma opção)
- Nome da opção (o mesmo campo da lista do menu).
- "Perguntas, nesta ordem", com o mesmo editor de hoje (pergunta + "Salvar em"). Vale extrair o editor de perguntas atual para um componente usado pelos dois painéis.
- Mensagem final.

### 6.5 i18n
Todas as chaves novas em `pt.json` e `en.json`, com paridade, e a contagem de chaves no CLAUDE.md atualizada.

## 7. Fora deste trabalho

- Menu dentro de um caminho.
- Ações diferentes por caminho (funil, responsável ou tag por evento).
- Perguntas antes do menu.
- Botões ou listas clicáveis do WhatsApp: decisão do usuário (§2, "Formato do menu").
- IA.
- Texto do aviso de resposta inválida configurável.

## 8. Como validar

- Os cinco checks do CLAUDE.md.
- Ponta a ponta local com Evolution falsa e webhook simulado, como no PR #218 (nunca mandar mensagem em produção para testar). Casos:
  1. palavra-chave inicia o menu; escolha "2" segue o caminho 2 até a mensagem final;
  2. "qualquer mensagem" em conversa nova inicia o menu;
  3. "qualquer mensagem" com mensagem na conversa há 2 dias não inicia (vai para o agente);
  4. mensagem com a palavra de outra regra no mesmo número inicia a regra da palavra, não a de qualquer mensagem;
  5. respostas "1.", "opção 1", "1️⃣" e "evento x" escolhem a opção 1; "5", "oi" e "1 e 2" repetem o menu;
  6. caminho sem perguntas manda a mensagem final logo depois da escolha;
  7. oportunidade criada com "Opção escolhida" nas notas e o título com a opção;
  8. remover a opção escolhida no meio da conversa cancela a sessão e a mesma mensagem recomeça o fluxo;
  9. regra antiga de "Fazer perguntas" com palavra-chave continua funcionando igual;
  10. salvar uma segunda regra ativa de qualquer mensagem no mesmo número é recusado;
  11. "qualquer mensagem": lead recebe o menu, some por 25 h e manda "2" → recebe boas-vindas e menu de novo;
  12. o mesmo, mas um vendedor escreveu na conversa depois do menu → não recomeça (vai para o agente);
  13. "qualquer mensagem" em conversa atribuída a alguém não começa;
  14. lead manda "obrigado" logo depois da mensagem final → não recomeça.
- Teste no navegador do editor: criar menu com 3 opções, arrastar os nós, salvar, reabrir e conferir que tudo voltou.

## 9. Publicação

Sem migration. Merge na `main` publica na Hostinger; as regras de hoje continuam como estão.

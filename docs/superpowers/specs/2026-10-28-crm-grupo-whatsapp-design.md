# Contatos do CRM num grupo do WhatsApp — desenho

- **Data:** 2026-10-28.
- **Branch:** a criar. Nome sugerido: `feature/crm-grupo-whatsapp`, a partir de `origin/main` 1a41df4.
- **Proposta em página, aprovada pelo usuário:** artifact "Do CRM ao Grupo", https://claude.ai/artifact/1KDPuYW4vqeTALfyxR1FMf.

## Intenção

Uma empresa que usa o MétodoAI quer colocar os próprios clientes, que estão numa pasta de contatos do
CRM, num grupo do WhatsApp. No grupo, a empresa só manda informações. Hoje isso não existe. O app só faz
o caminho inverso: Conversas → Exportar leva os membros de um grupo para o CRM. É uma necessidade nova;
nunca foi feito antes.

O que o usuário disse:
- "os clientes vão receber informações": o grupo é de avisos e só a empresa escreve;
- "tem que adicionar direto": não há convite antes nem pedido de aceite pelo MétodoAI;
- quem o WhatsApp não deixa adicionar recebe o link do grupo no privado, automaticamente, pelo mesmo
  número ("Pode ser");
- uma pasta tem "uns 50" clientes;
- o teto é de 100 pessoas por dia por número ("vamos aumentar para 100"; a proposta era 50);
- "qualquer pessoa com acesso" aos contatos do CRM pode usar, cada uma com o próprio número conectado
  em Conversas;
- numa rodada nova para o mesmo grupo, ficam de fora duas pessoas: quem uma rodada anterior adicionou e
  depois saiu do grupo, e quem já recebeu o link e não entrou ("pular os dois");
- só roda das 8h às 20h, no horário de São Paulo, todos os dias ("pode ser").

O usuário confirmou este resumo ("correto"):
- **Onde fica o botão:** na pasta e na seleção de contatos da lista.
- **Grupos na escolha:** só aparecem aqueles em que o número da pessoa é admin.
- **Quem fica de fora:** contatos sem telefone e contatos com opt-out.
- **Convite:** um texto padrão que a pessoa pode editar antes de começar.
- **Uma rodada por número:** se alguém começar outra, ela espera a anterior terminar.
- **Teto do dia:** se acabar no meio da pasta, a rodada continua sozinha no dia seguinte.
- **Número desconectado:** a rodada pausa e retoma quando ele voltar.
- **Resultado:** a tela mostra a situação de cada contato, e fica um registro no contato.

## Objetivos

1. **Botão "Adicionar a grupo do WhatsApp"** em CRM → Contatos (`/app/contacts`), em dois lugares:
   - com uma pasta aberta, ele leva todos os contatos da pasta;
   - com contatos marcados na lista, ele aparece na barra de seleção (`src/components/crm/bulk-bar.tsx`),
     ao lado de "Mover para" e "Adicionar tag".
2. **Escolha do grupo.**
   - Aparecem os grupos do número da pessoa: a conexão Evolution dela, a de Conversas
     (`IntegrationConnection` com `ownerId` = a pessoa).
   - Os grupos em que o número não é admin aparecem bloqueados, com o motivo.
   - Há busca pelo nome.
   - Sem número conectado e ativo, a tela diz isso e aponta para Conversas.
3. **Conferência antes de começar.** A tela mostra:
   - as contagens: total escolhido, já no grupo, sem telefone ou com número que não é de celular, opt-out,
     saiu do grupo depois de uma rodada anterior, já recebeu o convite numa rodada anterior, e quantos
     serão adicionados;
   - o texto do convite: padrão e editável, com `{{nome}}`. O link do grupo o sistema põe sempre no fim, e
     ele não pode ser apagado;
   - o ritmo e a previsão de tempo;
   - o aviso de privacidade: num grupo, todos veem o telefone de todos;
   - um aviso quando o grupo deixa qualquer participante mandar mensagem;
   - um aviso quando a soma passa de 1.024 participantes. Nesse caso, a conferência só segue com o que
     cabe, e o resto fica como "Não deu agora".
4. **Rodada em segundo plano.**
   - Uma pessoa por vez, com pausa aleatória de 30 a 90 s entre uma e a próxima.
   - Só das 8h às 20h, no horário de São Paulo, todos os dias. Fora disso, a rodada espera.
   - Teto de 100 pessoas por dia por número.
   - Quem o WhatsApp recusa por privacidade recebe o link no privado, pelo mesmo número e no mesmo ritmo.
   - Quando o teto acaba, a rodada continua sozinha no dia seguinte, a partir das 8h.
   - Quando o número desconecta, ela pausa e retoma quando ele volta.
   - Dá para pausar e retomar à mão.
   - Fechar a página não para a rodada.
5. **Acompanhamento.** Uma tela com o progresso, a previsão e a situação de cada contato:
   - Adicionado;
   - Convite enviado;
   - Já estava no grupo;
   - Sem WhatsApp;
   - Pulado (sem telefone ou opt-out);
   - Saiu do grupo: uma rodada anterior adicionou, e a pessoa não está mais lá;
   - Já recebeu o convite: uma rodada anterior mandou o link, e a pessoa não entrou;
   - Não deu agora (outro motivo);
   - Na fila.
6. **No contato** (`/app/contacts/[id]`): uma seção "Grupos do WhatsApp" com o resultado de cada rodada
   em que ele entrou, por exemplo "Adicionado ao grupo Ofertas da Semana em 28/10 por Fulano".

## Não-objetivos

- Criar grupos, mudar configuração de grupo (inclusive "só admins enviam"), remover participantes ou
  promover admins.
- Manter a pasta e o grupo iguais: quem entra na pasta depois não vai para o grupo sozinho.
- Comunidades e Canais do WhatsApp.
- WhatsApp Oficial (Cloud API). É só pela Evolution.
- Empresas do CRM (`companies`). É só contatos.
- Mandar mensagens no grupo. Isso continua sendo do WhatsApp e de Conversas.
- Tentar de novo sozinho um "Não deu agora". Uma nova rodada com a mesma pasta faz isso: quem já entrou
  aparece como "Já estava no grupo", e quem saiu ou já recebeu o convite fica de fora.
- Incluir à mão quem saiu do grupo ou já recebeu o convite. Não há opção para isso.

## Anti-objetivos (falha mesmo se "funcionar")

- O número da empresa ser bloqueado pelo WhatsApp por causa da rodada. Para evitar:
  - nunca acelerar com chamadas em paralelo;
  - nunca rodar duas rodadas no mesmo número ao mesmo tempo;
  - nunca passar do teto do dia.
- Adicionar ou mandar convite a quem pediu opt-out.
- Adicionar ou mandar convite fora das 8h às 20h (São Paulo).
- Readicionar quem saiu de um grupo depois de uma rodada.
- Mandar o convite de um grupo duas vezes para a mesma pessoa, na mesma rodada ou em rodadas diferentes,
  inclusive quando a fila entrega o job duas vezes ou o servidor reinicia no meio.
- Dois aparelhos do mesmo celular passarem do teto ou rodarem ao mesmo tempo. Isso acontece quando o
  mesmo número está conectado em duas empresas ou por duas pessoas.
- Um contato de outra empresa entrar numa rodada, ou alguém usar o número conectado de outra pessoa da
  equipe.
- Mexer no grupo além de adicionar.
- Perder o andamento num reinício do Passenger ou num redeploy (todo merge na `main`).
- Um convite sem o link, ou com o link de outro grupo.

## Decisões do usuário

- Adicionar direto, sem convite antes.
- Convite automático no privado para quem o WhatsApp recusa por privacidade.
- Teto de 100 pessoas por dia por número.
- Qualquer pessoa com acesso aos contatos do CRM pode usar, com o próprio número.
- Uma rodada é um clique: não há sincronização com a pasta.
- Numa rodada nova para o mesmo grupo, ficam de fora quem uma rodada anterior adicionou e depois saiu, e
  quem já recebeu o link e não entrou.
- Horário: das 8h às 20h, no horário de São Paulo, todos os dias.

## Decisões minhas

O usuário confirmou o resumo; os detalhes abaixo são meus.

- **Ritmo:** pausa aleatória de 30 a 90 s entre uma pessoa e a próxima. É mais lenta que a das campanhas
  de WhatsApp (30 a 60 s, `THROTTLE` em `src/lib/dispatch.ts`), porque adicionar a grupo pesa mais para o
  antispam do que mandar mensagem. A previsão da tela usa 60 s por pessoa.
- **"Número" é o celular do WhatsApp, não a conexão.** Um mesmo celular pode estar ligado a vários
  aparelhos e, por isso, a várias instâncias da Evolution: duas pessoas da mesma empresa, ou o mesmo dono
  em duas empresas.
  - Ao começar, a rodada lê na Evolution o JID da própria instância (o `ownerJid` do
    `fetchInstances`, ou o campo que o estado da conexão devolver) e o guarda.
  - O teto e a regra de uma rodada por vez contam todas as rodadas com o mesmo JID, em qualquer empresa.
    Essa conta roda em contexto de sistema e não mostra dado de outra empresa.
  - A mensagem de "Na fila" só diz "este número já está adicionando pessoas a outro grupo". Ela não diz
    qual empresa nem qual grupo.
- **Conta do teto:**
  - é por número (o JID acima), por dia corrido no fuso `America/Sao_Paulo`;
  - cada pessoa em que houve tentativa conta 1: Adicionado, Convite enviado ou Não deu agora;
  - quem é tirado antes, sem chamada ao WhatsApp, não conta: Já estava, Sem WhatsApp, Pulado, Saiu do
    grupo e Já recebeu o convite;
  - o convite não conta a mais. A pessoa já contou ao ser recusada.
- **Uma rodada por número.** Se alguém começar outra no mesmo número, ela fica "Na fila" e começa sozinha
  quando a anterior terminar ou for cancelada.
- **Horário:**
  - nenhuma chamada de adicionar ou de convite sai fora das 8h às 20h de São Paulo;
  - uma pausa que terminaria depois das 20h vira espera até as 8h do dia seguinte;
  - a previsão de tempo da conferência e do acompanhamento leva o horário em conta. Por exemplo, "termina
    amanhã por volta das 8h40".
- **Rodadas anteriores.** Ao começar, a rodada compara os itens de rodadas anteriores (mesma empresa,
  mesmo grupo, mesmo número normalizado) com os participantes atuais:
  - quem ficou como Adicionado e não está mais no grupo vira "Saiu do grupo";
  - quem ficou como Convite enviado e não está no grupo vira "Já recebeu o convite";
  - os dois ficam de fora, sem opção de incluir.

  O app não recebe aviso de quem entra ou sai do grupo (nenhum evento de grupo é assinado em
  `EVO_EVENTS`), então a conta é sempre essa comparação no início da rodada.
- **Lista de grupos:**
  - vem de `GET /group/fetchAllGroups/{instância}` do número da pessoa, não do `listExportGroups`, que só
    conhece grupos que já tiveram conversa;
  - o admin é conferido de novo em `GET /group/findGroupInfos` ao começar, e em cada retomada;
  - se o número deixou de ser admin, a rodada pausa com esse motivo.
- **Quem já está no grupo:** é conferido uma vez, ao começar, pelos participantes do `findGroupInfos`
  (`parseGroupParticipants` já resolve participantes `@lid` pelo `phoneNumber`). Depois disso vale a
  resposta de cada adição.
- **Números:** passam por `normalizeWhatsappNumber` e `looksLikeWhatsappMobile` (`src/lib/phone.ts`), como nas
  campanhas. Quem não passa vira "Sem WhatsApp" sem chamada nenhuma. Os demais são conferidos na Evolution
  (`POST /chat/whatsappNumbers/{instância}`) na vez de cada um; quem não tem conta vira "Sem WhatsApp" e
  não conta no teto.
- **Adição:** `POST /group/updateParticipant/{instância}?groupJid=…` com
  `{ "action": "add", "participants": [número] }`, uma pessoa por chamada. A Evolution devolve
  `{ updateParticipants: [...] }` com um código por número, vindo do Baileys. Mapeamento:
  - `200` vira Adicionado;
  - o código de privacidade vira Convite enviado. Provavelmente é `403`, com um `add_request`;
  - o código de "já participa" vira Já estava. Provavelmente é `409`;
  - qualquer outro código ou falha vira Não deu agora, com o código guardado.

  Os códigos exatos só se confirmam no teste real (ver "Como testar").
- **Convite:**
  - o link vem de `GET /group/inviteCode/{instância}?groupJid=…` (`inviteUrl`), uma vez por rodada, e é
    guardado na rodada;
  - a mensagem sai por `POST /message/sendText/{instância}`, como as mensagens de Conversas;
  - **não** usamos `POST /group/sendInvite`: ele manda para a lista inteira seguida, sem pausa;
  - o texto padrão em pt é "Oi {{nome}}! Este é o link para entrar no grupo {{grupo}}:", e o link vem
    numa linha própria no fim. Em en, um texto equivalente.
- **Duplicidade e retomada.** O padrão é o do e-mail em massa (`src/lib/email-broadcast/dispatch.ts`):
  - uma trava (lease) por rodada garante um executor só;
  - cada item é marcado "em andamento" antes da chamada à Evolution;
  - um item que ficou "em andamento" depois de uma queda nunca é refeito sozinho. Ele vira "Não deu agora"
    com o motivo "interrompido", porque a adição ou o convite pode ter acontecido.
- **Execução:** dentro do processo, com `after()` e a trava, como o e-mail em massa, porque a produção não
  tem fila. Com QStash configurado, usa a fila (`enqueue` + handler em `JOB_HANDLERS`, que reagenda com
  `delaySeconds` = pausa).
- **Retomar sozinho** (dia seguinte, reinício, número que voltou): uma rota de cron nova
  `/api/cron/whatsapp-groups`, a cada 5 min, protegida por `isCronAuthorized` (guia 05). Ela retoma as
  rodadas devidas: chegou o horário permitido, o teto liberou, a trava venceu ou o número voltou a ficar
  ativo.
  - Sem o cron agendado no hPanel, a rodada também retoma quando alguém abre a tela de acompanhamento, e
    há o botão "Retomar".
  - Só depende do cron o "continua sozinha" quando ninguém abre a tela.
- **Registro no contato.** O app não tem histórico de contato (não há modelo de atividade). O registro é a
  seção do objetivo 6, lida da tabela de itens da rodada.
- **Permissões e módulos:**
  - a tela `contacts` vale para qualquer membro com acesso a ela;
  - precisa dos módulos `crm` e `inbox`, resolvidos no servidor com `hasModule` e passados como prop;
  - a pessoa precisa ter o próprio número conectado e com status `ACTIVE`;
  - quem pausa, retoma ou cancela uma rodada é quem a começou, ou o dono e os admins.
- **Aviso de "todos podem mandar":** sai do campo `announce` do `findGroupInfos`, a confirmar no teste real.
  É só um aviso: o MétodoAI não muda a configuração do grupo.
- **Dados guardados:** duas tabelas novas.
  - **Rodada:** `organizationId`, conexão, JID do número, quem começou, `groupJid`, nome do grupo, link do
    convite, texto do convite, status (Na fila / Rodando / Pausada com motivo / Concluída / Cancelada),
    contagens, trava e datas.
  - **Item:** `organizationId`, rodada, contato, número normalizado, situação, código do WhatsApp, motivo e
    data em que foi processado.
  - Um contato aparece uma vez por rodada (`@@unique`).
  - Nomes e índices ficam com o construtor.
- **Logs e auditoria:**
  - os logs levam o id do item, nunca o telefone inteiro;
  - a auditoria registra começar, pausar, retomar e cancelar (`audit(ctx, …)`), com o id da rodada e do
    grupo.

## Restrições do repo

- **Multi-tenant** (guia 03): `tenantDb(orgId)` nas actions e consultas; `findFirst` + `updateMany` por id.
  O executor roda como sistema e usa o Prisma cru, sempre com `organizationId` explícito vindo da rodada.
  As tabelas novas entram no `check:isolation`.
- **Rotas `/api/*` são públicas por padrão** (guia 05): o cron usa `isCronAuthorized`, e uma rota de job
  verifica a assinatura do QStash.
- **Evolution:** credenciais sempre por `resolveEvoCreds()`; funções novas em
  `src/lib/integrations/evolution-client.ts`, no molde de `findGroupInfo` (helper `req()` com timeout).
- **Gating** pelas fontes de verdade (`src/config/modules.ts`, `src/config/screens.ts`), sem `if`
  espalhado (guia 04).
- **i18n:** pt e en com as mesmas chaves. Recontar e atualizar o número em `CLAUDE.md` e nos guias 02 e 04.
- **Env:** nenhuma variável nova. `CRON_SECRET` e QStash já são opcionais e conhecidos.
- **Migration:** as tabelas novas têm migration, aplicada no Supabase **antes** do merge. A Hostinger não
  roda `migrate deploy`.
- **Node 20.x** em produção.
- **Guias:** o guia 05 ganha a rota de cron nova (e entra na tabela de crons do README §8); o guia 03, as
  consultas novas; o guia 04, o gating.

## Como testar

- **Checagens puras** num script `check:` novo:
  - o mapeamento de código para situação;
  - a conta do teto por dia no fuso de São Paulo, somando rodadas de conexões diferentes com o mesmo JID;
  - o horário: a próxima hora permitida, e a pausa que cruza as 20h;
  - quem entra (sem telefone, opt-out, já no grupo, número inválido, saiu do grupo, já recebeu o convite);
  - o texto do convite (`{{nome}}`, `{{grupo}}`, link sempre no fim);
  - a previsão de tempo.
- **Evolution falsa** (servidor local no estilo dos servidores falsos do `check:imap`) cobrindo:
  - adicionado, privacidade → convite, já no grupo, outro erro;
  - número sem WhatsApp;
  - deixou de ser admin;
  - número desconectado;
  - teto do dia e retomada no dia seguinte, às 8h;
  - duas conexões do mesmo celular: a segunda rodada espera, e o teto é um só;
  - job entregue duas vezes;
  - queda com item "em andamento", que nunca é refeito.
- **Teste real, só com números nossos:** um grupo criado para o teste, pelo número de teste, com 2 ou 3
  números da equipe. Um deles fica com a privacidade de grupos em "Meus contatos", para provocar o convite.
  - Nunca clientes.
  - É aqui que se confirmam os códigos do Baileys e o campo `announce`.

## Produção

1. Aplicar a migration no Supabase antes do merge.
2. Opcional: agendar `/api/cron/whatsapp-groups` (`*/5 * * * *`) no hPanel, com `CRON_SECRET`. Sem ele, a
   rodada só continua sozinha enquanto o processo não reinicia; depois disso, retoma quando alguém abre a
   tela ou clica em "Retomar".
3. Primeiro uso real: uma pasta pequena (5 a 10 contatos), acompanhando o número.

## Deixado ao construtor

- Nomes de tabelas, colunas, índices, rotas, componentes e chaves de i18n.
- O desenho exato das telas, seguindo o artifact e os componentes do CRM.
- Como mostrar "Na fila" para uma rodada que espera outra no mesmo número.
- A duração da trava e o intervalo de renovação, desde que nenhuma pausa passe da trava.
- Se a conferência de números (`whatsappNumbers`) é feita por pessoa ou em lotes pequenos, desde que nada
  vá ao WhatsApp antes da vez de cada um.

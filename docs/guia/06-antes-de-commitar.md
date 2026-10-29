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
| `build` | o app compila e empacota de verdade, com tudo que `typecheck` sozinho não pega — com **webpack**, como na Hostinger, e não com o Turbopack do `next dev` ([README §8, gotcha 4](../../README.md)) | quase sempre import que não resolve ou API de servidor usada dentro de um client component; algo que funciona no `next dev` e quebra só aqui pode ser diferença entre os dois empacotadores |
| `check:isolation` | que o Postgres respeita um filtro `organizationId` escrito à mão — **não** que `tenantDb`, a DAL ou as actions estão de fato passando esse filtro | **a mais séria das cinco** — ver "check:isolation" abaixo |
| `check:node` | toda a árvore de dependências roda no Node de produção | ver "check:node" abaixo |

**Checagem de módulo (fora das cinco):** `npm run check:email` roda as asserções das funções puras do
submenu E-mail (normalização, deduplicação, renderização, assinatura Svix, transições de status, domínio do remetente,
espera da nova tentativa do e-mail transacional, as regras do envio pela conta Microsoft (tipo de conta, limite diário,
caminho direto ou rascunho, faixas do upload, decisão sobre falhas do Graph), as regras do envio pela conta Google (tipo de conta pelo `hd`, conta sem Gmail, permissão parcial, limite diário, upload simples ou retomável, decisão sobre falhas do Gmail, recusas que pedem reconexão e piloto por empresa), as regras do envio por SMTP (ritmo a partir do limite por hora, decisão sobre as respostas do servidor, preparação separada da entrega, regra de endereços internos e portas, validação do formulário da conta, inclusive o servidor e a porta da caixa de entrada (a segurança vem da porta), e reaproveitamento da senha guardada, que também olha o servidor, a porta e a segurança do IMAP: ligar a caixa ou trocar um deles exige digitar a senha, e salvar de novo leva a caixa que o formulário mandou, mantendo-a ou tirando-a), as regras puras da caixa de entrada por IMAP (servidor sugerido a partir do SMTP, id do e-mail e do anexo na URL, nome do erro de conexão, pasta de Enviados, assunto e cabeçalhos da resposta e se ela saiu, linha da lista a partir do envelope, anexos de uma mensagem pela estrutura, e o e-mail aberto a partir da leitura do `postal-mime`: imagens `cid:` dentro do corpo, anexos pelo índice original e destinatários; mais uma guarda que falha se algum arquivo de `src/lib/email-broadcast/imap/` apagar, mover, copiar ou expurgar e-mails, fechar a caixa (o `CLOSE` apaga de vez o que está marcado `\Deleted`), trocar ou tirar marcas, citar a marca `\Deleted` ou mexer em pastas, ou se não achar `core.ts` e `parse.ts` para varrer; e a prova de que as regex do `Re:` do assunto, a da resposta pelo IMAP e a do `normalizeSubject`, respondem em milissegundos a um assunto de 200 mil espaços, onde uma regex quadrática levaria um minuto), a montagem do MIME e os motivos de
falha em português, conferindo que o texto de cada motivo de pausa e de falha, e de cada erro da caixa de entrada no formulário da conta, existe em `pt.json` e `en.json`). Não usa
banco nem rede. Rode sempre que mexer em `src/lib/email-broadcast/`.

`npm run check:tasks` faz o mesmo para as regras puras do kanban de Tarefas
([src/lib/tasks/board-core.ts](../../src/lib/tasks/board-core.ts): distribuição inicial por data no
horário de Brasília, posição entre cards, nome de coluna, coluna da tarefa nova pela data, para onde vai
o card ao concluir, reabrir ou arrastar para a coluna de concluídas). Rode sempre que mexer nesse arquivo.

`npm run check:automation` cobre as regras puras da automação de WhatsApp. Em
[src/lib/automation/types.ts](../../src/lib/automation/types.ts), confere a leitura e a validação da regra:
início por palavra ou por qualquer mensagem, menu de opções, regras salvas antes do menu e a troca entre
"Fazer perguntas" e "Menu de opções" no editor. Em
[src/lib/automation/menu.ts](../../src/lib/automation/menu.ts), confere o texto do menu e qual opção cada
resposta escolhe. Em [src/lib/automation/flow-core.ts](../../src/lib/automation/flow-core.ts), confere o
caminho ativo, quando "qualquer mensagem" começa, e as notas e o título da oportunidade. Não usa banco nem
rede. Rode sempre que mexer em `src/lib/automation/`.

`npm run check:automation:e2e` testa a conversa inteira da automação de WhatsApp contra o `next dev` em
:3000 ([scripts/check-automation-e2e.ts](../../scripts/check-automation-e2e.ts)). O lead escreve pelo
webhook da Evolution e o bot responde para uma Evolution falsa em :4999, então nenhuma mensagem sai de
verdade. Os casos cobrem:
- menu por palavra-chave e por qualquer mensagem, resposta inválida, opção sem perguntas, regra antiga;
- conversa recente, atribuída ou parada há 8 dias;
- lead que some 25 h, com e sem resposta da equipe depois;
- equipe que assume no meio do menu (mensagem, atribuição ou resposta durante a espera de 8 s), e o fluxo de palavra-chave que continua;
- fluxo de palavra-chave terminado que não reabre um menu antigo abandonado;
- "Oi" + "tudo bem?" seguidos e quase ao mesmo tempo, e regra editada no meio da conversa.

Cria uma organização de teste e apaga tudo o que criou, inclusive sobras de uma rodada interrompida.
Precisa do Postgres do Docker e do `next dev` no ar; se o Turbopack responder 404 nas rotas de API, suba
com `npx next dev --webpack`. Cada turno espera o debounce de 8 s, então leva uns dois minutos.

`npm run check:search` cobre o filtro da busca ao digitar
([src/lib/search-options.ts](../../src/lib/search-options.ts): sem acento e sem maiúscula, quem começa
com o texto vem primeiro, limite da lista). Ele é usado pelo `SearchSelect`
([src/components/ui/search-select.tsx](../../src/components/ui/search-select.tsx)), que hoje atende
Empresa, Contato, Responsável e Produto/Serviço da oportunidade e Empresa, Contato e o produto de cada
item da proposta. Rode sempre que mexer nesse arquivo.

`npm run check:groups` cobre o "Adicionar aos contatos" com grupos do WhatsApp
([src/lib/integrations/evolution-groups.ts](../../src/lib/integrations/evolution-groups.ts): o número do
membro vem de `phoneNumber` quando o id é um LID; [src/lib/whatsapp/group-import.ts](../../src/lib/whatsapp/group-import.ts):
o 9 nos celulares antigos de 12 dígitos, o nome "Contato #N" continuando a numeração da pasta do grupo e os
números que já estão no CRM sendo pulados). Rode sempre que mexer nesses dois arquivos.

`npm run check:group-add` cobre as regras puras do "Adicionar a grupo do WhatsApp"
([src/lib/whatsapp/group-add/core.ts](../../src/lib/whatsapp/group-add/core.ts): o mesmo telefone em formatos
diferentes (com ou sem 55, com ou sem o 9, com máscara) dando a mesma chave e o mesmo número para discar (o
celular antigo de 8 dígitos ganha o 9 e conta como celular); quem entra na rodada e quem fica de fora, na ordem
das regras (opt-out, que vale para o número e não só para o registro: bloqueia todo contato da seleção com o mesmo
telefone, em qualquer ordem; sem telefone, número que não é de celular, já no grupo, saiu do grupo depois de uma
rodada anterior, já recebeu o convite, ficou em dúvida numa rodada anterior e número repetido na pasta; quem ficou em
dúvida, porque a adição ou o texto do convite pode ter saído (`interrupted`, `uncertain` e `invite_uncertain`), fica de
fora com `previous_uncertain`, ou é `ALREADY_IN` se já está no grupo, e nunca é refeito sozinho) e as contagens da
conferência; o código
da resposta de cada adição virando adicionado, convite ou já estava; o horário das 8h às 20h de São Paulo, a
próxima tentativa depois da pausa de 30 a 90 s e a retomada às 8h do dia seguinte quando o teto de 100 por dia
acaba; o texto do convite com `{{nome}}` e `{{grupo}}` e o link sempre no fim; e a previsão de término).
Cobre também como as respostas da Evolution são lidas em
[src/lib/integrations/evolution-groups.ts](../../src/lib/integrations/evolution-groups.ts): a lista de grupos, com os
participantes `@lid` resolvidos pelo `phoneNumber` e a contagem dos que ficaram sem número; se o número da pessoa é admin
do grupo (`null`, e não `false`, quando um membro sem número poderia ser ele); os dígitos de um JID sem o `:device`; o JID
do próprio número, nas respostas v2 e v1 do `fetchInstances` e só o da instância pedida; o código de cada adição, que vem
como texto ou como número; se o número tem WhatsApp; e o link do grupo, que só vale se for `https://chat.whatsapp.com/…`.
Cobre também o que as actions aceitam
([src/lib/validations/whatsapp-group-add.ts](../../src/lib/validations/whatsapp-group-add.ts)), porque elas são
endpoints públicos: o JID do grupo (dígitos, ou dígitos-dígitos, e `@g.us`: `x@g.us` e o JID de uma pessoa,
`…@s.whatsapp.net`, não passam), o texto do convite (aparado, de 1 a 1.000 caracteres: vazio e 1.001 não passam) e a
origem da rodada (uma pasta, com `folderId` `null` para "sem pasta" e nunca omitido, ou de 1 a 1.000 contatos
marcados: lista vazia e 1.001 não passam).
E tem uma guarda estática, porque as únicas escritas no WhatsApp são adicionar um participante e mandar o texto do
convite: ela falha se algum arquivo de `src/lib/whatsapp/group-add/` citar `sendInvite` ou `updateSetting` ou escrever
`"remove"`, `"promote"` ou `"demote"` (comentários também contam), se o `evolution-client.ts` citar `sendInvite` ou
`updateSetting` ou mandar `action` `remove`, `promote` ou `demote`, ou se ela não achar o `core.ts` para varrer.
Tem uma segunda guarda estática, para a auditoria: lê [src/app/actions/whatsapp-group-add.ts](../../src/app/actions/whatsapp-group-add.ts)
(sem os comentários) e falha se o `meta` de algum `audit(...)` citar JID, telefone ou convite (`jid`, `phone`, `invite`,
em qualquer grafia), espalhar um objeto dentro dele (`...x`) ou não for um objeto literal, ou se faltar uma das quatro
entradas (`started`, `paused`, `resumed`, `canceled`) no arquivo lido. O motivo: o JID antigo de grupo é
`<telefone>-<carimbo>@g.us`, o número de quem criou o grupo (muitas vezes um terceiro), e a tabela de auditoria dura
tanto quanto a empresa; as entradas levam o id da rodada e o NOME do grupo. Ela confere a regra em exemplos que têm de
falhar e em exemplos que têm de passar antes de varrer o arquivo, para que um erro nela não vire um passe silencioso.
Não usa banco nem rede. Rode sempre que mexer em `src/lib/whatsapp/group-add/`, em `src/lib/validations/whatsapp-group-add.ts`, em `src/app/actions/whatsapp-group-add.ts`, em `src/lib/integrations/evolution-groups.ts` ou em `src/lib/integrations/evolution-client.ts`.

`npm run check:group-add:e2e` testa o código de servidor do "Adicionar a grupo do WhatsApp"
([scripts/check-whatsapp-group-add-e2e.ts](../../scripts/check-whatsapp-group-add-e2e.ts)): o que fala com a
Evolution e o que grava no banco. A Evolution é uma falsa em loopback
([scripts/shims/fake-evolution.ts](../../scripts/shims/fake-evolution.ts)), então nada chega ao WhatsApp; o banco é o
Postgres local. Primeiro cobre as chamadas novas de
[src/lib/integrations/evolution-client.ts](../../src/lib/integrations/evolution-client.ts): a lista de grupos do número
(`fetchAllGroups`), um grupo pelo JID (`fetchGroupSummary`, em todos os formatos de resposta que o `findGroupInfo` já
aceita), o JID do próprio número (`fetchOwnerJid`, respostas v2 e v1), a adição (`addGroupParticipant`), a conferência de
que o número tem WhatsApp (`checkOnWhatsapp`), o link do grupo (`fetchGroupInviteUrl`) e o envio do texto
(`sendPlainText`). De cada uma confere o método, o caminho, a query e o corpo exatos que saem (o nome da instância vai
codificado, mesmo com espaço ou barra, e o `apikey` vai no cabeçalho), o tempo limite próprio (30, 20, 15, 30, 15, 15 e
30 s) e a resposta lida: a lista de grupos com os participantes, o código de cada adição (200, 403 pela privacidade da
pessoa, 409, qualquer outro, ou nenhum) e o texto do convite, que sai sem mudar um espaço. Confere também o que acontece
quando a Evolution falha: uma conexão fechada sem resposta, ou um servidor fora do ar, dá `httpStatus` 0 e nenhum código
na adição, `ok` falso no envio e `null` nas leituras; um status de erro vale como erro mesmo com um corpo que parece
certo, e uma resposta que não é uma lista de grupos não vira lista vazia; um 200 cujo corpo é só `null` não derruba
nenhuma das sete chamadas; e um erro 500 que repete o número e o texto, como a Evolution faz, não deixa nenhum dos dois
em nenhuma linha do console. Só duas escritas chegam à Evolution falsa: a adição (sempre `action: "add"`) e o texto, e
nenhuma chamada cai fora das rotas que ela serve.
Depois cobre o serviço, o executor e as consultas
([src/lib/whatsapp/group-add/service.ts](../../src/lib/whatsapp/group-add/service.ts),
[runner.ts](../../src/lib/whatsapp/group-add/runner.ts) e
[src/lib/queries/whatsapp-group-add.ts](../../src/lib/queries/whatsapp-group-add.ts)), com um relógio e um
agendador do próprio teste no lugar dos reais (`groupAddRuntime`: dormir só move o relógio, e o `after()` nunca é
usado, nem a fila, a não ser no teste do job, que aponta o cliente para um QStash falso em loopback). Confere, entre
outras coisas: os grupos do próprio número com `admin` verdadeiro, falso ou `null`, e
`no_connection` para quem não tem número seu, mesmo com um colega da empresa conectado; a conferência com as contagens
exatas (rodada anterior incluída) e sem escrever nada; uma rodada inteira (adicionado, convite por texto, já estava,
falha, sem WhatsApp) em que o contato com opt-out, e o de mesmo número de um opt-out fora da pasta, não aparecem em
nenhuma requisição; um opt-out feito depois de começar (do próprio contato, ou de outro da empresa com o mesmo número)
valendo na vez da pessoa, sem chamada nenhuma; o horário das 8h às 20h e o relógio lido de novo antes da adição e do
convite; o teto de 100 por dia contado por número em todas as empresas, no dia de São Paulo e só com adicionado,
convite e falha, e a rodada que continua no dia seguinte; uma rodada por número com a fila subindo na ordem e a
pausada segurando a fila; a pausa de
30 a 90 s entre as pessoas, que vale pelo número e não pela rodada (a que sobe depois do fim de outra, de um
cancelamento ou de uma retomada espera a pausa da última tentativa do número, de qualquer empresa); número
desconectado, Evolution fora do ar e não ser admin (pausam sem adicionar ninguém); a trava (dois executores ao mesmo
tempo, trava vencida, trava perdida no meio de uma espera) com uma chamada por número e quem ficou em andamento
virando `interrupted` sem ser refeito; resposta sem código, erro de HTTP e sem resposta da adição; o link do grupo
pedido uma vez, o texto do convite e o link que falta; o texto do convite sem resposta virando `invite_uncertain` (a
recusa continua `invite_failed`) e a rodada seguinte do grupo pulando, sem chamada, quem ficou `interrupted`,
`uncertain` ou `invite_uncertain`, só do mesmo grupo e da mesma empresa; dois cliques em "Começar" dando uma rodada só; o
nome do grupo que o começo devolve ao lado do id da rodada, o mesmo que a rodada guarda (`Grupo` se o grupo não tem nome,
e nunca o JID, nem o antigo com o número de quem criou o grupo), que é o que a auditoria grava; o excedente de
1.024 participantes como `group_full`; pausar, retomar e cancelar, inclusive no meio de uma chamada; a lista de
rodadas devidas do cron e o `pokeGroupAdd`; a rota do cron (`/api/cron/whatsapp-groups`): sem o segredo, com um errado,
de outro esquema ou com o segredo não configurado ela responde 401 e não toca em nada; com ele, chama só as rodadas
devidas e deixa em paz a de trava ainda viva (até 90 s, o limite incluído) e a que um executor está trabalhando, e
responde `{ ok: true, resumed }` (as chamadas autorizadas só rodam quando não há rodada aberta de outra empresa no
banco, porque a rota lê todas, e o teste avisa quando as pula); o job da fila `whatsapp-group-add` (trabalha por 50 s,
volta depois da espera que a rodada pede e é o nome que o `kickGroupAddRun` publica); a rodada pausada porque o grupo
não deu para ler (`not_admin` com a nota
`group_unreadable`), que volta sozinha na lista do cron e no `pokeGroupAdd` quando o grupo lê de novo e o número é admin,
e que fica como estava, sem escrita nenhuma, enquanto o grupo não lê, o número não é admin ou não dá para saber (um
`not_admin` de verdade, sem a nota, e qualquer outro motivo de pausa nunca voltam sozinhos, nem perguntam nada à
Evolution, e uma rodada cuja conexão é de outra empresa não é aberta); e que outra empresa não vê, não pausa, não
cancela nem retoma uma rodada, e que nenhum erro deixa número ou texto do convite no console nem no `lastError`.
Precisa de um `.env` (o comando o carrega; o segredo do cron é do próprio teste, então o `.env` não precisa ter um) e do
Postgres do Docker, e leva uns 30 s; não usa a internet. O banco é só o
local, e o script recusa rodar contra outro. Cria duas empresas de teste (`wga-e2e-<carimbo>` e `wga-e2e-<carimbo>-b`),
com usuários, vínculos e uma conexão Evolution cada, e apaga tudo no fim, mesmo se falhar (rodadas e itens, contatos,
pastas, conexões, vínculos, usuários e empresas). Se o processo for morto no meio (Ctrl+C, queda do Docker), sobram as
empresas `wga-e2e-%` e os usuários `wga-*@test.local`: apague só esses, à mão. Toda conexão aponta para a Evolution
falsa em loopback: o script lê cada uma de volta e confere que tem `baseUrl`, chave e instância próprias em loopback antes
de qualquer chamada (uma conexão sem `baseUrl` cairia na Evolution real do `.env`), e recusa qualquer requisição a outro
host. Os números dos testes só vão para a falsa. Roda com `tsx --tsconfig scripts/tsconfig.server.json`, como o
`check:imap`: o shim `scripts/shims/server-only.ts` deixa os módulos `server-only` carregarem fora do Next, e o tsconfig
traz o alias `@/`. A falsa serve também `connectionState` (padrão `open`) e `fetchInstances`, que o executor da rodada
usa; cada rota tem uma resposta padrão, o teste troca a que quiser (`set`) e a falsa guarda método, caminho, query e
corpo de toda chamada. Rode sempre que mexer em `src/lib/integrations/evolution-client.ts`, em
`scripts/shims/fake-evolution.ts`, em `src/lib/whatsapp/group-add/` ou em `src/lib/queries/whatsapp-group-add.ts`.

`npm run check:mcp` cobre as regras puras do servidor MCP de leitura
([src/lib/mcp/core.ts](../../src/lib/mcp/core.ts): comparação da chave com espaço ou quebra de linha
colados, datas `AAAA-MM-DD` como dias UTC com o fim inclusivo, período invertido ou longo demais,
limite de 50 a 200 itens por página, a linha única "Folha de pagamento" do resumo financeiro e a
varredura que acha campo sensível na resposta). Ele também falha se algum arquivo de `src/lib/mcp/` ou
`src/lib/queries/mcp/` chamar escrita do Prisma ou SQL cru: o MCP é só leitura. Não usa banco nem rede.
Rode sempre que mexer nessas duas pastas.

`npm run check:mcp:e2e` testa o servidor MCP de ponta a ponta contra o `next dev` em :3000
([scripts/check-mcp-e2e.ts](../../scripts/check-mcp-e2e.ts)): 404 sem chave ou com chave errada, 405
no GET, o cliente oficial do MCP conectando pela chave no caminho e no header, a lista exata de
ferramentas (todas marcadas como só leitura), as asserções de cada módulo e, por último, a varredura:
toda ferramenta com `organizationId` é chamada para a organização de teste A, que tem um texto-sentinela
plantado em cada campo sensível, e para a B, vazia — nada sensível, nada da outra organização e nenhum
erro na organização vazia. Precisa do Postgres
do Docker, do `next dev` no ar e de `MCP_API_KEY` no `.env` (a mesma que o servidor lê). Cria duas
organizações de teste e apaga tudo o que criou, mesmo quando falha; erros nunca mostram a chave. Se o
`next dev` com Turbopack responder 404 em todas as rotas de API, suba com `npx next dev --webpack`.
Com o Redis configurado, duas rodadas seguidas podem bater no limite de 120 chamadas por minuto —
espere um minuto.

`npm run check:imap` testa o código de servidor da caixa de entrada por IMAP da conta SMTP
([scripts/check-email-imap.ts](../../scripts/check-email-imap.ts)) contra uma caixa descartável da
Ethereal (um servidor SMTP e IMAP de verdade, que não entrega nada para fora) e o Postgres local. Hoje
cobre as credenciais da conta (`sealSmtpSettings` → `openSmtpSettings` devolve o IMAP igual; conta
antiga, sem as chaves do IMAP, ou com chaves que não servem, abre com `imap: null` e o SMTP intacto) e a
conexão de [src/lib/email-broadcast/imap/connect.ts](../../src/lib/email-broadcast/imap/connect.ts): login
real em TLS, senha errada, certificado sempre conferido, nome que não resolve, endereço interno recusado
antes de qualquer conexão, e a porta 143 só com STARTTLS (um servidor de mentira em loopback prova que
nenhum login sai em texto puro; outros, que um servidor hostil não alcança: linha, literal e resposta têm
teto (por resposta; o teto do pedido inteiro é do `inbox.ts`, mais abaixo), não há `COMPRESS=DEFLATE`, e o
texto de falha é cortado em 400 caracteres depois de redigido).
Nenhum texto de falha leva a senha. Cobre também a leitura da caixa de
[src/lib/email-broadcast/imap/inbox.ts](../../src/lib/email-broadcast/imap/inbox.ts): dois e-mails reais
entram pelo SMTP da própria Ethereal (um texto em ISO-8859-1 e um HTML com imagem `cid:` e `tabela.pdf`) e o
script confere a lista (mais recente primeiro, não lidas, anexo, no máximo 50 e a contagem de todas), o
filtro e a busca (acento, aspas, barra invertida, quebra de linha), abrir (corpo com a imagem embutida,
marcado como lido na mesma resposta e no servidor, sem marcar os outros), o anexo (os mesmos bytes; fora da
lista do e-mail é "não encontrado"), a UIDVALIDITY trocada, o limite de tamanho (a mensagem acima dele só
mostra cabeçalhos e um aviso), uma mensagem que o parser recusa, outra empresa, conta sem IMAP, desconectada
ou com credencial que não abre, senha recusada (`reconnect`, e a conta fica `NEEDS_RECONNECT`: o pedido
seguinte responde `reconnect` sem abrir conexão nenhuma; um login recusado com `[UNAVAILABLE]`, `[LIMIT]` ou
`[INUSE]` é `temporary` e deixa a conta como está) e servidor fora do ar (`temporary`, sem a senha no log e com a
conta intacta). Servidores de mentira em loopback provam o que o imapflow esconde, porque ele responde
`false`, `undefined` ou `[]` quando a conexão cai, sem erro. O `inbox.ts` roda de verdade contra eles
(`openImap` recusa loopback de propósito, então o check troca o `imapRequest` que o `inbox.ts` exporta, o mesmo
que baixa o teto de tempo e de bytes para caberem em frações de segundo): busca recusada é `not_found`; lista,
contagem ou STATUS recusados, conexão perdida ou cortada no meio do pedido (no STATUS, na busca, na lista, ao
abrir, entre o tamanho e o arquivo de um download, antes da marca de lido) e estouro do tempo são `temporary`,
nunca uma caixa vazia, um 404 ou um zero; um servidor que despeja linhas que ninguém pediu é cortado depois de
poucas, e o pedido que passa do teto de bytes também; linhas de e-mails que ninguém pediu, partidas em duas ou
repetidas não viram e-mail em branco nem em dobro; a linha guarda só o que a lista pediu (um literal pendurado
nela, de 16 MB na vida real, não fica na memória); e o e-mail com a estrutura mais funda do que o imapflow lê
(ele larga o e-mail sem avisar) não some da lista, e a segunda consulta recusada só tira esse e-mail da
página. Cobre também a resposta (`replyToImapMessage`, `smtp/send.ts`): `sendSmtpMail` continua entregando e
`sendSmtpMime` recusa servidor interno e senha errada sem repetir a senha; responder ao M1 sai pelo SMTP da
Ethereal na mesma conversa (`In-Reply-To`, `References`, `Re:`), grava a cópia na pasta `\Sent` e deixa só o M1
`\Answered`; Reply-To, assunto numa linha só e cadeia de `References` cortada; remetente sem endereço simples
(inclusive um que fecharia o `RCPT TO`) não recebe nada; e, contra o servidor de mentira
(`scripts/shims/fake-imap.ts`, que agora também aceita `APPEND` e `LIST` com pastas), que o envio recusado é
`temporary`, o que pode ter saído é `uncertain` (sem cópia, sem marca, sem segundo pedido) e que, depois de
enviada, nada do IMAP (pasta sem marca, cópia recusada, conexão caída, UIDVALIDITY trocada, outra conta) a
transforma em falha nem a envia duas vezes. O vigia do pedido que falha corta o pedido como `temporary` em vez de
virar exceção solta no processo; `openImap` aceita o tempo máximo de abertura como argumento, e o pedido que guarda a
cópia depois do envio tem limites só dele (10 s para abrir e 10 s de trabalho, `imapRequest.postSendOpenMs` e
`postSendBudgetMs`, em vez dos 30 s e 60 s dos outros pedidos): uma caixa muda nele custa só a cópia (`savedToSent`
falso), sem esperar esses outros limites, e a resposta sai uma vez só.
Precisa de **internet** (a API da Ethereal e o IMAP dela, porta 993), do
Postgres do Docker e de um `.env` válido, e **recusa rodar** se o `DATABASE_URL` não for local. Cada pedido à
caixa é uma conexão nova (uma dúzia de idas e vindas): com a rede daqui o script leva uns 3 minutos (a
Ethereal fica longe), e a linha de cada check lento mostra o tempo dele. Cria uma organização `IMAP-E2E-<carimbo>` (e outra, para
provar o isolamento) e apaga o que criou, mesmo quando falha; **se você matar o script no meio** (Ctrl+C,
tempo esgotado), o que ele criou fica no banco e é preciso apagar a mão (`organizations` com nome
`IMAP-E2E-%` e as linhas de `email_sender_accounts` delas). A caixa da Ethereal não tem como ser apagada
(expira sozinha) e a senha dela nunca vai para a saída. Roda com
`tsx --tsconfig scripts/tsconfig.server.json`: o shim `scripts/shims/server-only.ts` deixa os módulos
`server-only` carregarem fora do Next, e o tsconfig traz o alias `@/` e o `env.ts`. A rede instável derruba a
criação da conta na Ethereal de vez em quando: o script tenta 3 vezes antes de desistir; se o erro for de
rede, rode de novo (os pedidos à caixa que devem ter resposta de verdade repetem até 2 vezes se vier
`temporary`). Rode sempre que mexer em `src/lib/email-broadcast/imap/` ou em
`src/lib/email-broadcast/smtp/credentials.ts` ou `smtp/send.ts`.

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

Exemplo: `nodemailer` (monta o MIME do envio pelas contas Microsoft e Google e, no canal SMTP, também envia por
SMTP, pelo `nodemailer/lib/smtp-connection`) exige Node >= 20; por isso cabe na árvore de produção.

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

Trabalha-se na `dev`. **Mergear na `main` publica em produção automaticamente** — a Hostinger
observa a branch e implanta a cada push, rodando `npm install` (com `prisma generate` no
`postinstall`) e depois `npm run build`. Não existe passo manual depois do merge, nem revisão
humana entre ele e o ar: **o CI verde é o único portão**. Por isso vale a pena rodar as cinco
checagens localmente antes, em vez de descobrir no PR.

> **O deploy automático não roda `prisma migrate deploy`.** Se a sua mudança toca
> `prisma/schema.prisma`, aplique a migration no Supabase **antes** de mergear. Código novo com
> schema antigo quebra; schema novo com código antigo costuma sobreviver. Procedimento no §8 do README.

`main` é uma branch protegida no
GitHub — push direto é rejeitado, e a única forma de levar código até lá é por Pull Request.
Conferido na configuração real do repositório: a proteção exige que o check `validate` do CI
([.github/workflows/ci.yml](../../.github/workflows/ci.yml) — as mesmas cinco checagens deste
guia, mais `prisma migrate deploy` contra um Postgres efêmero do próprio job) esteja verde antes do
merge, bloqueia force-push e deleção da branch, e vale até para admin (`enforce_admins`). Ela
**não** exige aprovação humana configurada — o gate é o CI, não um revisor. Isso não dispensa pedir
revisão quando fizer sentido; só significa que o GitHub não vai impedir o merge por falta dela.

O runbook completo — o que o pipeline faz, o procedimento de migração e o histórico de incidentes — está no
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

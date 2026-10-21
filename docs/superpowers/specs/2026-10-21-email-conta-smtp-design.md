# Envio de e-mail em massa por SMTP (qualquer provedor) — desenho

Data: 2026-10-21 · Fase 3 do "envio pela caixa da própria empresa". Microsoft ([2026-10-15](2026-10-15-email-conta-microsoft-design.md)) e Google ([2026-10-19](2026-10-19-email-conta-google-design.md)) já estão na `main`. Onde este documento diz "igual à Microsoft/Google", vale o que está lá e no código atual.

## 1. Intenção

O gestor pediu "conexão por POP e SMTP do e-mail" para cadastrar **hoje** o e-mail de um cliente novo. O e-mail desse cliente é de domínio próprio hospedado na **KingHost**, fora da Microsoft e do Google. Hoje o MétodoAI não tem como enviar por ele.

A ideia completa: disparar os e-mails pelo servidor do próprio cliente (SMTP) e ver as respostas dentro do MétodoAI (POP/IMAP), como já acontece com a conta Microsoft. **Esta fase é só o envio**: foi o que o usuário escolheu para ficar pronto hoje. A leitura das respostas é a fase seguinte (seção 12).

**Sucesso:**
- a empresa preenche servidor, porta, usuário e senha; o sistema confere a conexão e salva;
- envia pelo mesmo formulário de hoje, e os destinatários recebem do endereço dela;
- os envios nunca passam do limite por hora que a empresa informou (vão mais devagar, sem pausar);
- ao chegar no limite do dia, o envio pausa e diz por quê;
- ninguém recebe duas vezes.

## 2. Decisões

| Assunto | Decisão | De quem |
|---|---|---|
| Provedor | Qualquer servidor SMTP com login (o primeiro cliente é KingHost) | usuário |
| Escopo desta fase | Só envio. Ler respostas (POP/IMAP) fica para a próxima | usuário |
| Contas por empresa | No máximo uma conta SMTP, ao lado da Microsoft e da Google (até 3 contas, uma por provedor) | minha decisão, segue a regra da Google |
| Quem usa | Todos que têm acesso ao E-mail da empresa | minha decisão, igual à Microsoft |
| Quem vê a opção | Todas as empresas com o E-mail; sem variável de piloto | minha decisão, dita ao usuário |
| Campos | E-mail remetente, nome do remetente, servidor, porta, segurança (SSL ou STARTTLS), usuário (vem preenchido com o e-mail), senha, limite por hora, limite por dia | usuário (aceitou o resumo) |
| Teste ao salvar | Conecta, negocia o TLS e faz o login. Se falhar, mostra o motivo e não salva. Não manda e-mail de teste | resumo aceito; "sem e-mail de teste" é minha decisão |
| Limite por hora | Espaça os envios para nunca passar dele. Nunca pausa por causa dele | usuário (aceitou o resumo) |
| Limite por dia | Ao chegar, pausa e espera "Retomar envio", como hoje | usuário |
| Padrões | 100 por hora e 500 por dia, que a pessoa ajusta | minha decisão (o usuário ouviu "500 por dia") |
| Máximos | 1.700 por hora (o ritmo mínimo de 2,1 s por e-mail) e 10.000 por dia; o limite por hora não pode passar do diário | minha decisão |
| Senha recusada no envio | A conta vira "precisa reconectar", o envio pausa, e o formulário pede a senha nova | usuário (aceitou o resumo) |
| Pasta Enviados | **Não** fica cópia na caixa do cliente nesta fase | dito ao usuário |
| Atalhos por provedor | Nenhum. A pessoa preenche os dados que o provedor dela informa | minha decisão (os valores da KingHost encontrados não são oficiais) |
| Cota da plataforma | Envios por SMTP não contam | minha decisão, igual à Microsoft/Google |
| Certificado TLS | Sempre conferido; não há opção de desligar | minha decisão (segurança) |
| Portas aceitas | 465, 587 e 2525. A 25 é recusada | minha decisão (segurança, seção 4.2) |
| Servidor | Recusa nome ou IP que aponte para rede interna | minha decisão (segurança, seção 4.2) |
| Onde fica o formulário | Página própria `/app/email/smtp`, como as de assinatura | minha decisão |
| Senha na edição | Deixar em branco mantém a senha guardada **só** se servidor, porta, segurança e usuário continuarem iguais. Mudou qualquer um, a senha é pedida de novo | minha decisão (segurança: senão, alguém com acesso ao E-mail apontaria o servidor para um seu e receberia a senha guardada no teste) |
| Recusa de um destinatário | Nunca pausa o envio. Falha só aquele destinatário, mesmo depois de esgotar as repetições | minha decisão (ao pausar, o destinatário volta para a fila e seria o primeiro na retomada, travando o envio para sempre) |

## 3. Dados

Migration aditiva `20261021120000_email_sender_smtp` (aplicar no Supabase antes do merge, com `prisma db execute` + `migrate resolve`, como as anteriores; **nunca** `migrate deploy`):

- `EmailSenderProvider` ganha `SMTP`.
- `EmailChannel` ganha `SMTP`.
- `email_sender_accounts` ganha duas colunas **opcionais**, usadas só pelo SMTP:
  - `hourlyLimit INTEGER NULL`;
  - `dailyLimit INTEGER NULL`.

  Microsoft e Google continuam com os limites estimados de `LIMITS`, e as colunas ficam nulas para eles.
- `accountKind` da conta SMTP é `"smtp"`.
- `credentials` guarda, criptografado com `encryptCredentials` (`INTEGRATION_ENC_KEY`), o objeto `{ host, port, security, username, password }`. Nada disso vai para o navegador, com uma exceção: na edição, o servidor monta o formulário com host, porta, segurança e usuário, mas **nunca** a senha.
- Nada muda em `email_broadcasts`/`email_broadcast_recipients`: `channel = SMTP` e `senderAccountId` usam as colunas que já existem.

**Tudo o que hoje aceita só `"MICROSOFT" | "GOOGLE"` passa a aceitar `"SMTP"`**, sempre filtrando pelo provedor. Pontos conhecidos:
- `getSenderAccountView`;
- `disconnectSenderAccount`;
- `startEmailBroadcast` e `resumeEmailBroadcast`;
- `emailComposerData`;
- `listEmailBroadcasts`;
- `listChannelFromParam`/`emailListHref` (`?canal=smtp`);
- `validations/email-broadcast.ts` (`channel`);
- `ComposerDraft.channel`;
- `MailboxChannel` em `failure-reason.ts`;
- o `mailbox` do despachante (`dispatch.ts`).

`SenderAccountView.accountKind` ganha `"smtp"`, e a view passa a trazer os limites e o servidor da conta SMTP.

`check:isolation` ganha:
- empresa A com conta SMTP (ao lado das outras duas), e empresa B sem enxergar nenhuma;
- uma segunda conta SMTP na mesma empresa é recusada (P2002);
- a busca por provedor `SMTP` devolve a conta certa.

## 4. Conexão

### 4.1 Formulário e gravação

- **Página:** `/app/email/smtp`, com o mesmo gate do E-mail (sessão, tela `email` e módulo `marketing`) e a trilha "E-mail / Conta SMTP". Ela tem três modos:
  - nova conta;
  - editar a conta conectada;
  - reconectar, quando a conta está `NEEDS_RECONNECT`.
- **Server action** `saveSmtpAccount`, com o mesmo gate, conferido antes de tudo. Valida com zod:
  - `email`: e-mail válido, guardado em minúsculas;
  - `displayName`: opcional, até 100 caracteres;
  - `host`: só o nome do servidor (sem `://`, caminho, espaço ou porta), até 253 caracteres;
  - `port`: 465, 587 ou 2525;
  - `security`: `ssl` (TLS desde o início) ou `starttls`. O formulário sugere `ssl` para 465 e `starttls` para 587/2525, mas a pessoa pode trocar;
  - `username`: até 254 caracteres, padrão igual ao e-mail;
  - `password`: até 512 caracteres. É obrigatória na conta nova e na reconexão. Na edição, vazia mantém a senha atual **só se servidor, porta, segurança e usuário forem os mesmos da conta guardada**. Se qualquer um mudar, a senha é obrigatória: a senha guardada nunca vai para um destino diferente daquele em que foi digitada;
  - `hourlyLimit`: de 1 a 1.700;
  - `dailyLimit`: de 1 a 10.000, e `hourlyLimit` ≤ `dailyLimit`.
- **Teste antes de gravar, toda vez que salva** (inclusive na edição, com a senha mantida): conecta, faz o TLS ou o STARTTLS, manda EHLO e faz o login. Os tempos-limite são 15 s para conectar, 10 s para a saudação e 30 s no total.
  - Servidor sem autenticação é recusado: o MétodoAI só envia com login.
  - Falha = nada é gravado, e a tela mostra o motivo:

  | Código | Quando | Mensagem (tom) |
  |---|---|---|
  | `auth_failed` | o servidor recusou usuário/senha (EAUTH, 535) | "O servidor recusou o usuário ou a senha." |
  | `tls_failed` | certificado que não confere, autoassinado, ou STARTTLS indisponível | "O certificado do servidor não confere com o endereço informado. Use o servidor que o provedor indica para programas de e-mail." |
  | `connection_failed` | recusa, tempo esgotado ou conexão caída | "Não foi possível conectar em `servidor:porta`. Confira o servidor e a porta; se estiver usando a 465, tente a 587 com STARTTLS." |
  | `host_not_found` | o nome do servidor não existe | "Servidor não encontrado." |
  | `host_not_allowed` | endereço de rede interna, ou porta fora da lista | "Este servidor não pode ser usado." |
  | `no_auth` | o servidor não oferece login | "Este servidor não pede login; o MétodoAI só envia com usuário e senha." |
  | `failed` | qualquer outro | genérica |

  O texto técnico do erro aparece ao passar o mouse, como nos motivos de falha de hoje.
- **Gravar e trocar a conta:** igual à Google, por provedor e sob a trava `email_sender:<org>:SMTP`:
  - mesmo endereço = atualiza a linha, mantendo o id (os envios e a contagem das últimas 24 h continuam);
  - endereço diferente = apaga a conta SMTP antiga e cria outra. Os envios ligados à antiga pausam até alguém retomar.

  Grava `status ACTIVE` e `lastError null`.
- **Auditoria:** `email_sender.connected` e `email_sender.disconnected`, com `provider`, `email` e `host`. Nunca a senha.
- **Desconectar:** igual às outras contas (`disconnectSenderAccount("SMTP")`). Apaga a linha, e os envios dela pausam com `no_sender_account`.

### 4.2 Proteção do servidor (o usuário escolhe para onde o MétodoAI conecta)

Quem preenche o formulário decide em qual endereço e porta o servidor do MétodoAI vai abrir conexão. Sem trava, daria para usar isso para sondar a rede interna da hospedagem. Por isso:

- **Portas:** só 465, 587 e 2525.
- **Resolução do nome:** antes de cada conexão (no teste e em cada envio), o nome é resolvido (A e AAAA). A conexão é recusada se **qualquer** endereço cair em:
  - loopback;
  - redes privadas: 10/8, 172.16/12 e 192.168/16;
  - link-local (169.254/16, fe80::/10) ou CGNAT (100.64/10);
  - fc00::/7, 0.0.0.0/8, multicast ou reservados.

  IP digitado direto passa pela mesma regra.
- **Conecta no IP conferido,** com o nome original para o SNI e para conferir o certificado. Assim, uma troca de DNS entre a checagem e a conexão não desvia para outro lugar.
- A regra de endereços é uma função pura (`check:email` cobre os intervalos).

## 5. Envio

### 5.1 O mesmo laço de envio

O SMTP é o terceiro adaptador de `runMailboxBroadcast` (`mailbox/deliver.ts`). **Não copie o laço**: as garantias de "ninguém recebe duas vezes" moram nele:
- reserva `QUEUED → SENDING`;
- `SENDING` que sobra vira `UNCERTAIN`;
- a liquidação é guardada por `SENDING`;
- o limite de 24 h.

O contrato do adaptador ganha três pontos. Microsoft e Google **não mudam de comportamento**, e os testes atuais do `check:email` continuam passando:

1. **Acesso.** Hoje o laço pega um token OAuth (`getSenderAccessToken`).
   - Microsoft e Google continuam assim.
   - O SMTP abre as credenciais guardadas. Se não abrirem, a conta vira `NEEDS_RECONNECT` e o envio pausa com `reconnect`.
   - O que o `send` recebe passa a ser do adaptador: token ou configuração SMTP.
2. **Limites.**
   - O limite diário passa a ser calculado a partir da conta (Microsoft/Google pelo `accountKind`, SMTP pela coluna `dailyLimit`).
   - Ponto opcional de limite por hora: só o SMTP tem.
3. **Ritmo.** O intervalo entre e-mails da caixa é:
   - Microsoft e Google: `MAILBOX_PACE_MS` (2,1 s);
   - SMTP: `max(2,1 s, 3.600.000 ms ÷ limite por hora)`, arredondado para cima;
   - nos dois casos, vezes o número de envios da mesma conta rodando ao mesmo tempo, como hoje.

**Limite por hora:** antes de cada e-mail, o laço conta as saídas da conta nos últimos 60 min. A contagem é igual à de 24 h (`SENT`, `SENDING`, `UNCERTAIN` pelo `sentAt`), só que com janela de 1 h. Se a conta chegou no limite, o laço **espera** em blocos de até 10 s, renovando o lease (`run.wait`), e confere de novo. Nunca pausa por isso.

**Lease:** hoje a pausa entre e-mails dorme até 2,1 s × 20 sem renovar o lease de 90 s. Com o SMTP, o intervalo pode chegar a vários minutos (por exemplo, 36 s × 3 envios ao mesmo tempo). Toda espera longa precisa ser feita em blocos de no máximo 10 s com heartbeat. O intervalo entre dois heartbeats nunca chega perto dos 90 s.

**Fila (`budgetMs`):** o prazo continua valendo. O laço devolve `done: false` quando ele acaba, mesmo no meio de uma espera.

### 5.2 Como o e-mail sai

- **MIME:** montado pelo `buildMime` de hoje (mesmos cabeçalhos, `List-Unsubscribe` incluído). É entregue cru: envelope `MAIL FROM` = e-mail da conta e `RCPT TO` = destinatário.
- **Remetente:** `fromEmail` é o e-mail da conta, e `fromName` é o nome do remetente da conta, congelado ao iniciar o envio, como na Microsoft. Reply-To como hoje.
- **Conexão:** uma por e-mail (sem pool). Com o ritmo do SMTP, reaproveitar não compensa a complexidade. Quem construir pode reaproveitar dentro de uma rodada, se mantiver a classificação de falhas abaixo.
- **Tempos-limite do envio:** 15 s para conectar, 10 s para a saudação e 60 s de socket. Os 60 s servem para anexo de até 10 MB em servidor lento.
- **Separar "preparação" de "entrega"** é o que decide entre repetir e `UNCERTAIN`. Usar `nodemailer/lib/smtp-connection` diretamente (`connect` → `login` → `send`), ou outro jeito que dê a mesma garantia:
  - falha em `connect`/TLS/`login`: estágio **prepare**. O e-mail não saiu e pode repetir;
  - falha de rede ou tempo esgotado **durante o `send`** (`ECONNECTION`, `ETIMEDOUT`, `ESOCKET`, `ESTREAM`): estágio **send**. Pode ter sido depois do ponto final, então vira `UNCERTAIN` e nunca é reenviado;
  - **resposta do servidor** recusando (`EENVELOPE` no `MAIL FROM`/`RCPT TO`/`DATA`, ou `EMESSAGE` na resposta final) **nunca** é incerta: o servidor disse não, então o e-mail não foi aceito.

### 5.3 Falhas do SMTP

A ordem importa: a primeira linha que bate decide. Tudo fica numa função pura do SMTP, irmã de `gmailFailureAction`, coberta pelo `check:email`.

| Situação | O que acontece |
|---|---|
| Falha de rede ou tempo esgotado durante o `send` | `UNCERTAIN`, sem reenvio |
| Falha de rede, DNS ou tempo esgotado antes do login (prepare) | repete até 3 vezes com espera; esgotado, pausa com `provider_error` |
| Certificado/TLS (`ETLS`, erros de certificado) | pausa com `provider_error` (repetir não resolve), com o texto técnico |
| Login recusado com 4xx (por exemplo, `454 4.7.0` temporário) | repete até 3 vezes; esgotado, pausa com `provider_error` |
| `EAUTH` (login recusado: 535, 534, 530) | a conta vira `NEEDS_RECONNECT` e o envio pausa com `reconnect` |
| `ENOAUTH` | pausa com `provider_error` |
| Resposta com tamanho excedido (código `message-552`, `5.3.4`, "message size"/"too large"/"tamanho") | falha só esse destinatário (`message_too_large`) e segue |
| No `RCPT TO`, no `DATA` ou na resposta final, código estendido `x.1.x` ou `x.2.x` (endereço ou caixa do destinatário: inexistente, cheia, desativada) | 5xx: falha só esse destinatário. 4xx: repete até 5 vezes e, esgotado, falha só esse destinatário. **Nunca pausa** |
| Resposta que fala de limite (`/\b(rate\|limit\|quota\|too many\|limite\|excedid)/i`), fora do caso acima | pausa com `daily_limit`: o provedor recusou por limite de envio |
| `RCPT TO` recusado com 5xx | falha só esse destinatário e segue (`invalid_address` para 550, 551, 553, 501, 510 e 511; `generic` para o resto) |
| `RCPT TO` recusado com 4xx | repete até 5 vezes; esgotado, falha só esse destinatário. **Nunca pausa** |
| `MAIL FROM` recusado com 5xx (por exemplo, remetente diferente do login) | pausa com `account_blocked`, com o texto do servidor |
| Resposta final (depois do conteúdo) com 5xx | falha só esse destinatário (`generic`). A regra atual de 3 falhas seguidas pausa o envio |
| `DATA` recusado com 5xx | pausa com `provider_error` |
| Qualquer outra resposta 4xx (421, 451...), fora do `RCPT TO` | repete com espera (até 5 vezes); esgotado, pausa com `provider_error` |
| Qualquer outra | pausa com `provider_error` |

**O que é de um destinatário nunca pausa o envio.** Quando o laço pausa, ele devolve o destinatário atual para a fila, e a retomada pega esse mesmo endereço primeiro. Uma recusa que só vale para aquele endereço pausaria o envio a cada "Retomar envio", para sempre.

**Teto por e-mail:** uma tentativa (conectar + login + entrega) tem no máximo 75 s, para caber no lease de 90 s. Estourado o teto, a conexão é fechada:
- antes do `send`, vale como falha de conexão (repete);
- durante o `send`, vale como `transfer` (`UNCERTAIN`).

- **Como o erro fica no destinatário:** `smtp:<estágio>-<código>|<resposta>`, até 500 caracteres. Exemplos: `smtp:rcpt-550|...` e `smtp:data-552|...`.
- **Tradução do erro:** `recipientFailure` traduz `rcpt-5xx` como `invalid_address`, tamanho como `message_too_large`, e o resto como `generic`.
- **Detecção de limite:** a regra de tamanho vem **antes** da de limite, porque "message size exceeds fixed limit" contém "limit".

## 6. Telas

- **Escolha do canal (E-mail e Novo e-mail):**
  - quarto cartão, **"Por outro provedor (SMTP)"**;
  - texto: "Use o e-mail do seu domínio em qualquer provedor (KingHost, Locaweb, Hostinger...), com servidor, porta e senha";
  - ícone genérico de servidor de e-mail no `ChannelIcon` (canal `smtp`);
  - com quatro cartões, a grade fica em 2 × 2 nas telas largas.
- **Estados do cartão:**
  - sem conta: botão "Configurar SMTP", que leva a `/app/email/smtp`;
  - conectada: mostra e-mail, servidor, limites (por hora e por dia) e enviados nas últimas 24 h / restantes hoje, com os botões Usar, Editar e Desconectar;
  - precisa reconectar: "O servidor recusou a senha. Informe a senha nova", com o botão Reconectar.
- **Formulário (`/app/email/smtp`):** os campos da seção 4.1, com ajudas curtas:
  - "use os dados de SMTP que seu provedor informa para programas de e-mail";
  - "o limite por hora deixa o envio mais lento, mas nunca acima do que o provedor permite";
  - "os e-mails mandados à mão pela mesma caixa também contam para o provedor".

  O botão "Testar e salvar" mostra o motivo de falha da tabela 4.1. Em caso de sucesso, volta para a escolha do canal com um aviso de "Conta SMTP conectada".
- **Lista por canal:** `?canal=smtp`, com o cartão da conta em cima, só os envios SMTP, e sem a coluna "Entregues".
- **Formulário do e-mail:** `?via=smtp`. Remetente fixo com o chip "conta SMTP". A confirmação diz:
  - quantos recebem agora e o limite do dia;
  - o tempo estimado pelo limite por hora (por exemplo, "cerca de 5 h");
  - que **não** fica cópia em Enviados;
  - que não há rastreio de entrega nem de abertura.
- **Relatório:** "Enviado pela conta SMTP x" e o aviso de que não há rastreio.
- **Textos por provedor:** os textos de pausa e da lista que hoje têm versão Google ganham versão SMTP, escolhida pelo canal, do mesmo jeito (`pausedMessageKey`/`listPausedMessageKey`):
  - `daily_limit`: "o provedor recusou por limite" ou "o limite do dia informado foi atingido";
  - `reconnect`: "o servidor recusou a senha";
  - `no_sender_account`;
  - `account_blocked`: "o servidor recusou o remetente";
  - `provider_error`.

  pt e en com as mesmas chaves.
- **Caixa de entrada:** continua só Microsoft. Nada muda.

## 7. Segurança

- Senha criptografada com `INTEGRATION_ENC_KEY`. Nunca vai para o navegador, para o log nem para a auditoria.
- Isolamento por empresa: toda consulta pela DAL/`tenantDb`; no despachante, `organizationId` explícito.
- Proteção de endereço e porta (seção 4.2).
- TLS sempre: 465 com SSL ou STARTTLS obrigatório. Não há opção de envio sem criptografia, e o certificado é sempre conferido.
- Server actions conferem o gate e validam a entrada no servidor: o tipo do TypeScript não vale em tempo de execução.

## 8. Testes

- **`check:email`:**
  - classificação das falhas SMTP (tabela 5.3, incluindo a ordem tamanho → limite);
  - intervalo a partir do limite por hora (100/h → 36 s; 1.700/h → 2,1 s);
  - espera do limite por hora;
  - regra de endereços internos (IPv4 e IPv6) e portas;
  - validação do formulário (limites, hora ≤ dia, senha obrigatória na conta nova);
  - `recipientFailure` com o prefixo `smtp:`;
  - textos de pausa por canal;
  - lista por canal com `smtp`.
- **`check:isolation`:** seção 3.
- **As cinco validações de sempre.**
- **Teste real local** (máquina do usuário), com uma caixa SMTP que o usuário autorizar. Pode ser a do cliente, com permissão dele, ou outra caixa do usuário:
  - salvar com senha errada (`auth_failed`) e certa;
  - envio pequeno para destinatários autorizados;
  - anexo;
  - limite por hora baixo (por exemplo, 2/h, conferindo o espaçamento);
  - limite do dia baixo, que pausa;
  - desconectar e reconectar.
- **Em produção, depois do deploy:** o primeiro "Testar e salvar" prova que a Hostinger deixa a conexão sair. A própria Hostinger confirmou ao usuário que dá para usar um SMTP de outro provedor.

## 9. Publicação

1. Migration no Supabase antes do merge (`db execute` + `migrate resolve`), com a autorização do usuário.
2. Nenhuma variável nova no hPanel.
3. Merge → deploy → cadastrar a conta do cliente em produção → envio pequeno de teste para endereços autorizados.
4. Guias atualizados no mesmo commit de cada fonte de verdade que mudar:
   - `lib/queries/` → guia 03;
   - `config/limits.ts` → guia 04, se os padrões/máximos ficarem lá;
   - README §8: nota curta de suporte (limite por hora, `tls_failed`, porta 465 → 587).

## 10. Riscos

- **A Hostinger bloquear conexões de saída para SMTP externo.** A própria Hostinger diz que funciona. Se bloquear, o teste ao salvar mostra `connection_failed` em produção, e a saída seria um relay por HTTPS (fora desta fase).
- **Envios longos.** Com limite por hora baixo, um envio pode levar horas rodando no processo do site (`after()`, sem fila em produção). Se o processo reiniciar, o envio fica parado até alguém clicar em "Retomar envio", o mesmo comportamento de hoje, só que mais provável. Um cron que retome envios parados fica para depois.
- **Limites desconhecidos do provedor.** A pessoa informa os dela, e a recusa real do provedor pausa o envio (5.3).
- **Certificado que não confere.** Por exemplo, `smtp.dominiodocliente.com.br` com certificado do provedor. A mensagem `tls_failed` orienta a usar o servidor do provedor.
- **Spam.** Como o e-mail sai pelo servidor do provedor, o SPF/DKIM do domínio do cliente valem como em qualquer programa de e-mail. Mesmo assim, um volume alto num domínio sem histórico pode cair no spam.

## 11. Fora de escopo

- Ler respostas (POP/IMAP), a cópia em Enviados e as devoluções.
- Mais de uma conta SMTP por empresa.
- Atalhos com os dados de cada provedor.
- O cadastro genérico "SMTP" da tela de Conexões (`integrations/registry.ts`): continua como está, sem uso.
- Texto da política de privacidade sobre a senha SMTP guardada (revisar depois).

## 12. Próxima fase (registrado, não construir agora)

Ler as respostas pela caixa do cliente. O gestor pediu POP. Sugestão: **IMAP quando o provedor tiver** (KingHost e Hostinger têm), porque ele também permite:
- salvar a cópia em Enviados (APPEND);
- marcar como lida.

POP fica só como alternativa. A decisão é do usuário quando a fase começar.

## 13. Deixado para quem construir

- Nomes de arquivos e a forma exata dos três pontos novos do adaptador, desde que o laço continue um só (5.1) e Microsoft/Google não mudem.
- Usar `smtp-connection` direto ou o transporte, desde que a separação prepare/send da 5.2 valha.
- Como a página do formulário reaproveita os componentes de formulário existentes.
- O texto exato das mensagens novas, seguindo o tom das atuais.

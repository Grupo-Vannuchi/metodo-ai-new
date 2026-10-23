# Caixa de entrada por IMAP (conta SMTP) — desenho

Data: 2026-10-23 · Branch: `feature/email-caixa-imap` (a partir de `origin/main` 540c3b4)

## Intenção

O Supermercado Varandas envia o e-mail em massa pela própria caixa da KingHost, conectada como conta
SMTP (spec `2026-10-21-email-conta-smtp-design.md`). O usuário pediu para ver os e-mails que chegam nessa
caixa dentro do MétodoAI, "semelhante" à Caixa de entrada que já existe para a conta Microsoft. É a
"Próxima fase" (§12) do spec do SMTP: ler a caixa por IMAP.

O que o usuário disse: qualquer pessoa da empresa pode abrir a caixa no MétodoAI; quando chega um e-mail,
não precisa acontecer nada — ele só fica na caixa de entrada; fazer igual à caixa Microsoft (ler,
responder, baixar anexos, marcar como lido ao abrir); executar com vários agentes.

Teste feito em 2026-10-23 (só leitura): `imap.kinghost.net:993` (SSL, TLS 1.3, Dovecot, `AUTH=PLAIN`,
`IDLE`) aceita o mesmo login da conta SMTP (`mkt@supermercadovarandas.com.br`). Pastas: `INBOX`,
`INBOX.Sent`, `INBOX.Drafts`, `INBOX.Trash`, `INBOX.Spam`, `INBOX.Junk` — sem marcação special-use.
`imap.uni5.net` é o servidor das contas de revenda da KingHost. O SMTP do Varandas é `smtpi.kinghost.net`.

## Objetivos

1. **Aba "Caixa de entrada" no canal SMTP** do E-mail (`/app/email?canal=smtp&aba=caixa`), com o mesmo
   comportamento da caixa Microsoft:
   - os 50 e-mails mais recentes da `INBOX`; mais antigos só pela busca (de 3 a 100 caracteres);
   - filtros Todas / Não lidas / Respostas aos envios (a última pelo mesmo critério da Microsoft —
     remetente + assunto —, agora sobre os envios do canal SMTP);
   - abrir um e-mail mostra o corpo isolado (iframe sandbox + CSP, imagens `cid:` como data URI),
     remetente, destinatários, anexos, o cartão do CRM e o cartão "Resposta ao envio";
   - abrir um e-mail não lido o marca como lido na caixa real (`\Seen`), como a Microsoft;
   - responder em texto: a resposta sai pela própria conta SMTP, na mesma conversa (`In-Reply-To`,
     `References`, assunto "Re: …"), e uma cópia é gravada na pasta de Enviados da caixa (APPEND), para
     aparecer no webmail;
   - baixar anexos (sempre como download);
   - número de não lidas no cartão do canal SMTP e na aba, como na Microsoft.
2. **IMAP no formulário da conta SMTP** (`/app/email/smtp`): seção opcional "Caixa de entrada (IMAP)"
   com servidor e porta (993 com SSL ou 143 com STARTTLS). Usuário e senha são os mesmos do SMTP. O
   servidor vem sugerido a partir do SMTP (ver "Sugestão do servidor"). Com o IMAP preenchido, "Testar e
   salvar" testa também o login no IMAP. Sem IMAP, a conta funciona como hoje (só envio, sem aba de caixa).
3. **Ativar para o Varandas sem refazer a conta:** editar a conta SMTP existente, preencher o IMAP,
   digitar a senha e salvar.

## Não-objetivos

- POP3. Navegar por outras pastas além da `INBOX`.
- Atualização em tempo real (IDLE): a lista atualiza ao abrir ou recarregar, como na Microsoft.
- Paginação além dos 50 (a busca alcança os antigos).
- Mover, apagar, arquivar ou marcar como não lido.
- Guardar e-mails no banco (tudo é lido ao vivo, como na Microsoft).
- Caixa do Google (escopo restrito, assunto separado). Cópia dos envios em massa em Enviados. Leitura de
  devoluções (bounces).

## Anti-objetivos (falha mesmo se "funcionar")

- O app apagar, mover ou expurgar qualquer e-mail. As únicas escritas na caixa são: marcar como lido ao
  abrir e gravar a cópia da resposta em Enviados.
- A senha ir para o navegador, log, auditoria ou mensagem de erro, ou ser enviada a um servidor novo sem
  ser digitada de novo. A regra que o SMTP já tem (só reaproveita a senha salva se servidor, porta,
  segurança e usuário não mudaram) passa a valer também para o servidor, a porta e a segurança do IMAP:
  ligar o IMAP ou trocar o servidor dele exige digitar a senha.
- Conectar em rede interna: a guarda do SMTP (`resolveSmtpHost` / `isBlockedSmtpAddress` /
  `pickSmtpAddress`) vale para o IMAP. Certificado TLS sempre verificado; na porta 143 o STARTTLS é
  obrigatório (nunca texto puro).
- Uma empresa ver a caixa de outra (a conta é sempre lida pelo `organizationId` da sessão).
- Um servidor IMAP lento ou que derruba a conexão travar a página ou derrubar o processo do Passenger.

## Decisões técnicas (minhas, com o usuário tendo dispensado as perguntas)

- **Bibliotecas:** `imapflow@2.3.0` (publicada em 2026-10-08; `node >=20`; sem build nativo; tipos
  inclusos) e `postal-mime@4.0.5` (2026-10-07; zero dependências; CJS + ESM; tipos inclusos). Versões
  exatas, com pelo menos duas semanas de publicação. `postal-mime` no lugar de `mailparser`, que puxa o
  `html-to-text` (`node >=20.19.0`, sem garantia de que a Hostinger esteja nessa versão) e mais dez
  dependências. Atualizar o `imapflow` para 2.5.x ou acima a partir de ~2026-10-30 (correções de
  STARTTLS e de limite de buffer) fica como acompanhamento.
- **Sem migração:** as configurações do IMAP (`imapHost`, `imapPort`, `imapSecurity`) vão dentro das
  credenciais criptografadas que a conta SMTP já guarda (`EmailSenderAccount.credentials`). Conta antiga,
  sem esses campos, abre normalmente e só não tem caixa.
- **Tela e acesso:** a mesma tela `emailInbox` (opt-in) e o módulo `marketing`. Dono e admins veem;
  membros comuns veem se a tela estiver liberada no perfil de acesso — é como o usuário libera "qualquer
  pessoa" sem abrir a caixa (que traz redefinições de senha e códigos) para quem não deve. Sem variável de
  piloto (o SMTP não tem).
- **Uma conexão IMAP por pedido** (o Passenger não mantém processo de fundo): conectar no IP checado pela
  guarda, autenticar, abrir a `INBOX`, executar, `LOGOUT` no `finally`. Tempos: conexão 15 s, saudação
  10 s, socket 30 s; `logger: false`; `disableAutoIdle: true`; ouvinte de `error` sempre presente.
- **Ids na URL:** e-mail `msg=<uidvalidity>.<uid>` (só dígitos); anexo `a=<parte MIME>`
  (`^\d+(\.\d+)*$`). UIDVALIDITY diferente da atual = "não encontrado".
- **Leitura:** listar com envelope/flags/estrutura (BODY.PEEK, não marca lido); abrir baixa o e-mail
  inteiro só até 15 MB — acima disso mostra cabeçalhos e o aviso "abra no webmail". Marcar lido é um
  `STORE +FLAGS (\Seen)` explícito.
- **Pasta de Enviados:** pela marcação special-use `\Sent`; senão por nome, nesta ordem: `INBOX.Sent`,
  `Sent`, `INBOX.Enviados`, `Enviados`, `Sent Items`, `Itens Enviados`. Sem pasta: a resposta sai mesmo
  assim, sem cópia.
- **Reaproveitar a caixa Microsoft:** os tipos (`InboxView`, `InboxMessageSummary`,
  `InboxMessageDetail`, `MailboxResult`), o componente `EmailInbox`, `inboxBodyDocument`,
  `replaceCidImages` e `matchReplyToSend`. Generalizar o que hoje é preso à Microsoft: `inboxHref` (canal
  fixo), `microsoftSendsTo` (canal fixo), `isGraphId` (validador por canal), textos que citam o Outlook,
  o `SenderAccountPanel` dos estados de erro e a rota de anexo.

### Sugestão do servidor IMAP

A partir do servidor SMTP salvo: `smtp.kinghost.net` e `smtpi.kinghost.net` → `imap.kinghost.net`;
`smtp.uni5.net` e `smtpi.uni5.net` → `imap.uni5.net`; `smtp.hostinger.com` → `imap.hostinger.com`;
`smtp.mail.yahoo.com` → `imap.mail.yahoo.com`. Regra geral: trocar o primeiro rótulo `smtp`, `smtpi` ou
`smtps` por `imap`; se o primeiro rótulo for outro (ex.: `mail.empresa.com.br`), sugerir o mesmo host.
Porta sugerida 993 (SSL). É só sugestão: o campo fica editável.

## Restrições do repo

- Node 20 na Hostinger, `next build --webpack`, só arquivos rastreados vão para produção (se o webpack
  reclamar do `imapflow`, `serverExternalPackages: ["imapflow"]` no `next.config.ts`, com comentário).
- Multi-tenancy: a conta é lida pela DAL com `organizationId` explícito (guia 03).
- Rota nova de anexo (`/api/…`): a própria rota checa sessão, telas `email` e `emailInbox`, módulo
  `marketing` e o formato dos ids, como a rota da Microsoft (guia 05).
- i18n pt/en em paridade (contagem de chaves no CLAUDE.md atualizada).
- Guias no mesmo commit: 05 (rota nova), 06 (asserções novas em `check:email`), 04 se mudar texto sobre a
  tela. README §8 com o passo de produção.
- As cinco checagens antes de cada commit.

## Como testar

- `check:email` (puro): sugestão do servidor IMAP; formulário com IMAP (validação e erros); regra da senha
  com IMAP; ids `msg` e parte; mapeamento dos erros do IMAP; cabeçalhos da resposta (`Re:`,
  `In-Reply-To`, `References`); escolha da pasta Enviados; resumo do e-mail a partir do envelope.
- Ponta a ponta local com uma caixa descartável da Ethereal (SMTP e IMAP reais): conectar a conta SMTP +
  IMAP pelo formulário; mandar um e-mail para a caixa; ver na lista; abrir (vira lido); responder (chega
  e aparece em Enviados); baixar anexo. Navegador headless, como no teste do SMTP.
- Teste no Varandas só com o OK do usuário: abrir a caixa e ler. Responder só para endereço autorizado.

## Produção

Sem migração. Depois do merge: editar a conta SMTP do Varandas, preencher `imap.kinghost.net` / 993 / SSL,
digitar a senha e salvar. A saída na porta 993 a partir da Hostinger ainda não está provada: o primeiro
"Testar e salvar" em produção prova.

## Deixado ao construtor

Estrutura de arquivos (sugestão: `src/lib/email-broadcast/imap/`), nomes, como generalizar os
componentes (ex.: prop `channel`), rota de anexo nova (`/api/email/smtp/attachment`) ou genérica, e o
texto exato das mensagens, seguindo o tom das da Microsoft.

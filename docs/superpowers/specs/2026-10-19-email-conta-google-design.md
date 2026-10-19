# Envio de e-mail em massa pela conta Google da empresa — desenho

Data: 2026-10-19 · Fase 2 do "envio pela caixa da própria empresa". A fase 1 (Microsoft) está em produção desde 19/10 e o desenho dela é a base deste: [2026-10-15-email-conta-microsoft-design.md](2026-10-15-email-conta-microsoft-design.md). Onde este documento diz "igual à Microsoft", vale o que está lá e no código atual.

## 1. Intenção

As empresas clientes querem que os e-mails em massa saiam da caixa delas, e muitas usam Google:
- **Gmail pessoal:** `@gmail.com`.
- **Google Workspace:** e-mail próprio hospedado no Google, como `@nillow.com`.

Hoje elas só podem enviar pela plataforma (com domínio liberado) ou por uma conta Microsoft.

Esta fase deixa a empresa conectar a conta Google e enviar por ela, do mesmo jeito que já envia pela Microsoft: mesma escolha de canal, mesmo formulário, mesmas garantias.

**Sucesso:**
- uma empresa conecta o Gmail ou o Workspace, envia, e os destinatários recebem do endereço dela;
- o e-mail aparece em Enviados no Gmail da empresa;
- quando passa do limite diário, o envio pausa e diz por quê;
- ninguém recebe duas vezes.

## 2. Decisões

| Assunto | Decisão | De quem |
|---|---|---|
| Tipos de conta | Gmail pessoal e Google Workspace (domínio próprio), pelo mesmo login do Google | usuário |
| Contas por empresa | Uma conta Google **e** uma Microsoft podem ficar conectadas ao mesmo tempo, **no máximo uma de cada provedor** por empresa | usuário |
| Quem usa | Todos que têm acesso ao E-mail da empresa (igual à Microsoft) | usuário (confirmou que as regras da Microsoft valem) |
| Formulário | O mesmo: editor, assinatura, anexos até 10 MB | usuário |
| Limite diário | Avisa na confirmação quantos recebem hoje; ao chegar no limite, pausa e espera "Retomar envio" | usuário |
| Pasta Enviados | Todo e-mail fica em Enviados do Gmail | usuário |
| Motivo de falha | Em vermelho na lista e no relatório, em português, técnico ao passar o mouse | usuário |
| Cota da plataforma | Envios pelo Google não contam | usuário |
| Permissão pedida | Só "enviar e-mails em seu nome" (`gmail.send`) + identidade (`openid`, `email`). Nunca ler a caixa | usuário (aceitou "sem ler a caixa") |
| Lançamento | Construir já. Testar com as contas do usuário no **modo de teste** do Google. Pedir a aprovação em paralelo. Só liberar para os clientes depois da aprovação | usuário |
| Limites estimados | Gmail pessoal **500**/24 h; Workspace **2.000**/24 h (um destinatário por mensagem, então o limite de mensagens é o que pesa) | minha decisão, pelos números oficiais (seção 6.3) |
| Ritmo | O mesmo da Microsoft: 1 e-mail a cada 2,1 s por caixa (~28/min); a cota da API permite até ~60/min | minha decisão |
| Liberação gradual | Variável opcional `GOOGLE_MAIL_PILOT_ORG_IDS`: se tiver valor, só essas empresas veem a opção Google; vazia, todas veem | minha decisão (seção 8) |

## 3. Google Cloud: projeto, tela de consentimento e variáveis

**Projeto separado do login.** O "Entrar com Google" atual (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) já está publicado e usa só escopos de identidade. Colocar `gmail.send` nele faria o app de login entrar em verificação e no teto de 100 usuários não verificados. Por isso o envio usa um **projeto novo no Google Cloud** ("MetodoIA E-mail") com um cliente OAuth próprio.

- **Tipo de usuário:** External.
- **Status de publicação:** **Testing** até a aprovação.
  - Até 100 usuários de teste cadastrados no projeto; para o piloto, as contas do usuário.
  - A autorização expira em **7 dias**.
  - **Não publicar em produção antes de aprovar.** Sem aprovação aparece a tela de "app não verificado" e há um teto **vitalício** de 100 contas novas no projeto, que não pode ser zerado.
- **Escopos:** `openid`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/gmail.send`.
  - `gmail.send` é escopo **sensível**, não restrito: exige a verificação padrão, sem auditoria de segurança paga.
  - Os outros dois não são sensíveis.
- **URIs de redirecionamento:** `https://metodotia.com/api/email/google/callback` e `http://localhost:3000/api/email/google/callback`. Montadas com `joinSiteUrl`, sem barra dupla.
- **Variáveis novas, opcionais, declaradas em `src/lib/env.ts`:**
  - `GOOGLE_MAIL_CLIENT_ID` e `GOOGLE_MAIL_CLIENT_SECRET`. Sem as duas, a opção Google não aparece em lugar nenhum.
  - `GOOGLE_MAIL_PILOT_ORG_IDS`: lista de ids de empresa separados por vírgula (seção 8).
- **O que a aprovação da Google pede (tarefa do usuário, fora do código):**
  - página inicial pública com link para a política de privacidade;
  - política de privacidade no mesmo domínio, descrevendo o uso dos dados do Google (seção 9);
  - domínio `metodotia.com` confirmado no Google Search Console por uma conta dona ou editora do projeto;
  - vídeo no YouTube (não listado), em inglês, mostrando a conexão (com o client ID visível na barra de endereço) e o envio;
  - justificativa de cada escopo.

  A Google fala em 3 a 10 dias úteis, mas há relatos de semanas ou meses.

## 4. Dados

Migration aditiva `20261019120000_email_sender_google` (aplicar no Supabase antes do merge, com `prisma db execute` + `migrate resolve`):

- `EmailSenderProvider` ganha `GOOGLE`.
- `EmailChannel` ganha `GOOGLE`.
- `email_sender_accounts`: o índice único passa de `organizationId` para **`(organizationId, provider)`**. As linhas atuais (uma Microsoft por empresa) já cumprem a regra nova. O código antigo continua funcionando com a migration aplicada, desde que ainda não exista linha `GOOGLE`.
- Nada muda em `email_broadcasts`/`email_broadcast_recipients`: `channel = GOOGLE` e `senderAccountId` apontando para a conta Google usam as colunas que já existem.

**Lugares do código que hoje supõem uma conta por empresa e passam a filtrar por provedor (obrigatório).** Sem isso, uma empresa com as duas contas pegaria a errada:
- `saveMicrosoftAccount` (`microsoft/accounts.ts`): procura a conta atual da empresa; passa a procurar `provider: MICROSOFT`.
- `getSenderAccountView` (`queries/email-sender-accounts.ts`): passa a receber o provedor.
- `disconnectMicrosoftAccount` (`actions/email-sender-accounts.ts`): desconecta só a do provedor pedido.
- `startEmailBroadcast` e `resumeEmailBroadcast` (`actions/email-broadcasts.ts`): buscam a conta do provedor do canal do envio.
- `emailComposerData`: passa a trazer as duas contas (`microsoft` e `google`).
- A trava de renovação (`pg_advisory_xact_lock` com a chave `email_sender:<org>`) passa a ter o provedor na chave, para uma renovação Google não esperar uma Microsoft.

Teste de isolamento novo: empresa A com conta Google e Microsoft; empresa B não enxerga nenhuma das duas. Na mesma empresa, a busca por provedor devolve a conta certa.

## 5. Conexão

- **Rotas:** `GET /api/email/google/connect` e `GET /api/email/google/callback`, com o mesmo padrão das rotas Microsoft:
  - mesmo gate (sessão + tela E-mail + módulo marketing), conferido antes de tudo;
  - `state` + PKCE + empresa em cookies curtos `gg_mail_state`, `gg_mail_verifier` e `gg_mail_org` (10 min);
  - volta para `/app/email/new?google=connected` ou `?google_error=<código>`.
- **Cliente OAuth:** `arctic` `Google(clientId, clientSecret, redirectURI)`. Na URL de autorização vão também:
  - `access_type=offline`, para receber o refresh token;
  - `prompt=consent select_account`: o Google só devolve o refresh token na primeira autorização, e o `consent` garante um novo a cada conexão; o `select_account` deixa escolher a conta.
- **Permissão parcial.** O Google deixa a pessoa desmarcar permissões. Se o token voltar sem `gmail.send` no campo `scope`, a conexão é recusada com a mensagem "Marque a permissão de enviar e-mails para conectar" (código `missing_send`), e nada é gravado.
- **Endereço e tipo de conta.** Vêm do ID token:
  - `email`, que precisa ter `email_verified = true`;
  - `hd` (domínio hospedado): presente = Workspace (`work`); ausente = Gmail pessoal (`personal`).

  Nenhuma chamada extra à API do Gmail; o `users.getProfile` exigiria escopos maiores.
- **Gravar e trocar a conta.** Igual à Microsoft, só que por provedor:
  - mesmo endereço = atualiza a linha;
  - endereço diferente = apaga a conta Google antiga da empresa e cria outra. Os envios ligados à antiga ficam sem conta e pausam até alguém retomar.
- **Renovação do acesso.** Igual à Microsoft:
  - renova com 5 min de folga, sob a trava por empresa + provedor;
  - `refreshAccessToken(refreshToken)` do `arctic`; o Google normalmente não devolve refresh token novo, então mantém o antigo.
- **Quando marcar "precisa reconectar".** A conta vira `NEEDS_RECONNECT` em:
  - `invalid_grant`: acesso revogado, senha da conta Google trocada, 6 meses sem uso, ou os 7 dias do modo de teste vencidos;
  - `admin_policy_enforced`: o administrador do Workspace bloqueou.

  `invalid_client`, que é segredo do app errado ou vencido, conta como falha temporária, como na Microsoft.
- **Desconectar:** apaga só a conta Google; os envios dela pausam com `no_sender_account`.
- **Erros da conexão:**

  | Código | Quando |
  |---|---|
  | `cancelled` | `access_denied` |
  | `admin_required` | `admin_policy_enforced`, ou o administrador do Workspace precisa liberar o app como confiável |
  | `missing_send` | permissão de envio desmarcada |
  | `not_configured` | variáveis faltando |
  | `failed` | qualquer outro |

  Enquanto o projeto estiver em Testing, uma conta fora da lista de teste recebe `access_denied` do Google e cai em `cancelled`. Por isso o texto de `cancelled` cita também a lista de teste nesse período.

## 6. Envio

### 6.1 Um laço só para as duas caixas

A garantia de "ninguém recebe duas vezes" está em `microsoft/deliver.ts`:
- reserva `QUEUED → SENDING` antes da chamada;
- `SENDING` que sobra vira `UNCERTAIN`;
- liquidação guardada por `SENDING`;
- limite de 24 h;
- renovação no 401.

Ela **não pode ser copiada**. O laço vira um despachante de caixa genérico, que recebe um "adaptador" por provedor:
- renovar o token;
- enviar um e-mail;
- classificar uma falha.

O ramo `MICROSOFT` do despachante passa a usar o adaptador Microsoft; o ramo `GOOGLE`, o adaptador Google. O comportamento Microsoft não muda; os testes atuais do `check:email` continuam passando.

### 6.2 Como o e-mail sai pelo Gmail

- **Montagem:** o MIME é montado como hoje (`buildMime`, nodemailer só como montador).
- **Até 5 MB de MIME:** uma chamada `POST https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media` com `Content-Type: message/rfc822` e o MIME cru no corpo, sem base64. É a chamada de **entrega**.
- **Acima de 5 MB** (anexos grandes, até ~13,5 MB com 10 MB de anexo):
  - upload retomável: `POST …/messages/send?uploadType=resumable` com `X-Upload-Content-Type: message/rfc822` e `X-Upload-Content-Length`;
  - a resposta traz a `Location`;
  - um `PUT` com o MIME inteiro. O `PUT` final é a chamada de **entrega**; o `POST` inicial é preparação.
  - O endpoint aceita até 35 MiB, e o Gmail até 25 MB por mensagem.
- **Enviados:** o Gmail coloca a mensagem em Enviados sozinho. A resposta traz `labelIds`, e o teste real confere que inclui `SENT`. Se não incluir, o desenho volta para revisão antes do lançamento.

### 6.3 Limites (números oficiais de 2026)

- **Gmail pessoal:** 500 e-mails por dia. **Workspace:** 2.000 mensagens por dia por usuário, 3.000 destinatários externos e 3.000 únicos por dia, em janela de 24 h móvel. A Google avisa que os limites podem mudar sem aviso.
- **Como contar:** `LIMITS.googleDailyPersonal = 500`, `LIMITS.googleDailyWork = 2_000` em `src/config/limits.ts` (guia 04 atualizado), contados pelas saídas da conta nas últimas 24 h, como na Microsoft.
- **Envios fora do MétodoAI:** os e-mails que a pessoa manda pelo próprio Gmail também contam para a Google e não são vistos aqui. A recusa real da Google também pausa o envio (6.4).

### 6.4 Falhas do Gmail

| Resposta | O que acontece |
|---|---|
| 401 | renova o token e repete uma vez; falhando, pausa com `reconnect` |
| 429 com "Mail sending" / "User-rate limit exceeded (Mail sending)" | limite diário: pausa com `daily_limit` (a Google avisa que pode durar horas) |
| 429 "Too many concurrent requests" ou 403 `userRateLimitExceeded` / `rateLimitExceeded` | repete com espera (respeita `Retry-After` até 60 s) |
| 403 `domainPolicy` | o administrador desligou apps do Gmail: pausa com `account_blocked` (texto Google) |
| 403 `dailyLimitExceeded` | cota do **projeto** MétodoAI, não da caixa: pausa com `provider_error` |
| 400 `badRequest` / `invalidArgument` | falha só esse destinatário (endereço recusado) e segue |
| 0 / timeout / 500 / 502 / 504 na chamada de entrega | `UNCERTAIN`, sem reenvio (mesma regra da Microsoft) |
| 503 | repete como o 429 |
| erros na preparação (POST do upload retomável) | repete até 3 vezes; esgotado, pausa |

Os códigos acima ficam numa função pura do Google, irmã de `graphFailureAction`, coberta pelo `check:email`.

## 7. Telas

- **Escolha do canal (E-mail e Novo e-mail):**
  - terceiro cartão **"Pela conta Google"**, com o "G" oficial do login (`ProviderMark`);
  - texto: "Sai do Gmail ou do Google Workspace da empresa. As respostas chegam nessa caixa e cada e-mail fica salvo em Enviados";
  - mesmos estados do cartão da Microsoft (conectar, conectada com tipo / limite / enviados em 24 h, trocar, desconectar, reconectar);
  - o painel de conta (`MicrosoftAccountPanel`) vira um painel genérico por provedor.
- **Lista por canal:** `?canal=google`, com o cartão da conta Google em cima e só os envios Google, sem a coluna "Entregues".
- **Formulário:** `?via=google`. Remetente fixo com o chip "conta Google". A confirmação diz:
  - quantos recebem agora (e o limite do Gmail ou do Workspace);
  - o ritmo;
  - que os e-mails ficam em Enviados do Gmail;
  - que o Google não informa entrega nem abertura.
- **Relatório:** "Enviado pela conta Google x" e o aviso de que não há rastreio de entrega.
- **Textos por provedor.** Hoje alguns textos citam a Microsoft:
  - pausa: `daily_limit`, `reconnect`, `no_sender_account`, `account_blocked`, `provider_error_microsoft`;
  - lista: `listReason.paused.*`;
  - motivo de falha: `failure.message_too_large`.

  Cada um ganha a versão Google, escolhida pelo canal do envio, do mesmo jeito que `provider_error_microsoft` já é escolhido hoje. pt e en com as mesmas chaves.
- **Ícones:** depende do PR `feature/email-icones-provedores` (`ChannelIcon`). Se ele já estiver na `main`, o Google entra no mesmo componente.

## 8. Liberação gradual

Enquanto o projeto Google estiver em Testing, só contas cadastradas como usuário de teste conseguem conectar. Qualquer outra empresa que clicasse veria um erro do Google.

Para evitar isso em produção:
- se `GOOGLE_MAIL_PILOT_ORG_IDS` tiver valor, a opção Google só aparece para essas empresas;
- nas outras, nada de Google aparece (cartões, `?canal=google`, `?via=google`; as rotas recusam com `not_configured`);
- depois da aprovação, apaga-se a variável e todas veem.

## 9. Política de privacidade

A aprovação exige que a política (`/privacy`, pt e en) diga, para o Google:
- quais dados são acessados: endereço do e-mail e permissão de envio;
- para quê: enviar os e-mails que a própria empresa monta no MétodoAI;
- que o MétodoAI não lê, não guarda e não compartilha o conteúdo da caixa;
- como revogar o acesso;
- a frase de conformidade com a "Google API Services User Data Policy", incluindo os requisitos de "Limited Use".

O texto entra nesta fase.

## 10. Segurança

Igual à Microsoft:
- tokens criptografados com `INTEGRATION_ENC_KEY`, nunca no navegador nem no log;
- isolamento por empresa;
- rotas com gate próprio.

O escopo é o menor possível: só envio, sem leitura.

## 11. Testes

- **`check:email`:**
  - tipo de conta pelo `hd`;
  - limites 500/2.000;
  - classificação das falhas do Gmail;
  - escolha do caminho do envio (≤ 5 MB direto, acima retomável);
  - permissão parcial (`missing_send`);
  - lista por canal com `google`.
- **`check:isolation`:** duas contas por empresa (seção 4).
- **As cinco validações de sempre.**
- **Teste real** (contas do usuário, em Testing, destinatários autorizados por ele):
  - conectar Gmail pessoal e Workspace;
  - envio pequeno;
  - anexo de ~8 MB (retomável);
  - Enviados com `SENT`;
  - limite diário (com o limite local reduzido);
  - desconectar e reconectar;
  - empresa com Google e Microsoft enviando cada uma pela sua conta;
  - a reconexão depois de 7 dias aparece como "precisa reconectar".

## 12. Publicação

1. Migration no Supabase antes do merge.
2. Variáveis no hPanel: `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET` e `GOOGLE_MAIL_PILOT_ORG_IDS` com as empresas do piloto.
3. Merge → deploy → teste real em produção com as contas de teste.
4. Usuário pede a aprovação da Google (seção 3).
5. Aprovado: muda o projeto para "In production", apaga `GOOGLE_MAIL_PILOT_ORG_IDS`, e todas as empresas veem a opção.
6. README §8 ganha o runbook: projeto Google, publicação, vencimento do segredo, teto de 100 contas.

## 13. Riscos

- **A aprovação demora ou volta com pedidos.** O piloto segue em Testing, com reconexão semanal.
- **O administrador do Workspace bloqueia o app.** Mensagem com a instrução de liberar o app como confiável.
- **A Google muda os limites.** A recusa real pausa o envio, e os números ficam em `LIMITS`.
- **Gmail pessoal com reputação baixa cai no spam,** como aconteceu na Microsoft. Fora do nosso controle; a confirmação pode lembrar disso.

## 14. Fora de escopo

- Yahoo / SMTP genérico.
- Ler a caixa: detectar devoluções ou respostas exigiria escopo restrito e auditoria paga.
- Mais de uma conta do mesmo provedor por empresa.
- Mudar o "Entrar com Google" do login.

## 15. Deixado para quem construir

- **Nomes de arquivos e a forma exata do adaptador por provedor,** desde que o laço de envio seja um só (6.1).
- **Como dividir o painel de conta genérico,** mantendo o visual atual.
- **O texto exato das mensagens novas,** seguindo o tom das atuais.

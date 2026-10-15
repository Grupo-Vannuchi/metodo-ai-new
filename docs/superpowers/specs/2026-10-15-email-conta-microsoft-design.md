# Envio de e-mail pela conta Microsoft — design

**Data:** 2026-10-15 · **Status:** design aprovado em conversa; spec aguardando revisão.
**Complementa:** as specs do E-mail em massa (2026-10-06, 2026-10-08, 2026-10-09 e 2026-10-13). Nada
do que elas definem muda para um envio pela plataforma.
**Protótipo das telas:** https://claude.ai/artifact/NgWfGXj81uUMR2v1hXXaC6 (privado).

---

## 1. Objetivo

Cada empresa pode conectar **uma caixa de e-mail Microsoft** e enviar por ela os mesmos e-mails em massa de
**Comunicação → E-mail**. Isso vale para:
- contas pessoais: @outlook.com, @hotmail.com, @live.com;
- caixas empresariais no Microsoft 365 (ex.: contato@nillow.com).

O envio pela plataforma (Resend) continua igual. Esta é a primeira fase; Google (Gmail e Workspace) e
Yahoo/SMTP ficam para depois (seção 12).

**Critério de sucesso:**
- uma empresa conecta a caixa Microsoft dela sem ninguém entrar no Azure;
- um e-mail montado no editor de hoje (texto rico, imagens, assinatura, anexos até 10 MB, descadastro)
  sai **da caixa conectada**, aparece em "Itens enviados" dela, e as respostas chegam nela;
- o envio respeita o ritmo e o limite diário da Microsoft, pausa sozinho no limite e só continua quando
  alguém clicar em "Retomar envio";
- ninguém recebe o mesmo envio duas vezes;
- quando algo falha, a lista de envios e o relatório dizem **por quê**, em português e em vermelho.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Provedores nesta fase | **Só Microsoft** (Outlook pessoal e Microsoft 365). |
| Plataforma (Resend) | **Continua**, com a tela de hoje sem mudança. |
| Escolha do canal | Uma **tela antes do formulário** pergunta: "Pela plataforma" ou "Pela conta Microsoft". |
| Dono da conta | **A empresa.** No máximo **uma conta de envio por empresa**; quem tem acesso ao E-mail da empresa usa, conecta, troca e desconecta. Quem tem várias empresas conecta uma caixa em cada. |
| App no Azure | **Um app só, da plataforma**, novo e separado do "Entrar com Microsoft" (que segue com o app antigo). O cliente nunca entra no Azure. |
| Limite diário | **Não bloqueia** antes de enviar; a confirmação **avisa quantos recebem agora**. |
| Quem passou do limite | O envio **pausa e espera** alguém clicar em "Retomar envio". |
| Anexos | **Até 10 MB**, igual à plataforma. |
| Itens enviados | **Salvar todos** na caixa conectada. |
| Motivo de falha | **Em vermelho**, em português, na lista de envios e no relatório, **nos dois canais**. |
| Corpo do e-mail | O **mesmo editor de texto rico** de hoje. |
| Cota mensal da plataforma | Envios pela Microsoft **não contam** (não passam pelo Resend). |

## 3. Configuração no Azure (feita uma vez, pela plataforma)

App registrado no diretório "Moraes Vannuchi" (2026-10-15):
- **Tipos de conta:** "Qualquer locatário do Entra ID + contas pessoais da Microsoft" (tenant `common`).
- **Plataforma Web**, URIs de redirecionamento:
  - `https://metodotia.com/api/email/microsoft/callback`;
  - `http://localhost:3000/api/email/microsoft/callback`.
- **Permissões delegadas do Microsoft Graph:** `Mail.Send`, `offline_access`, `User.Read`. Nenhuma exige
  consentimento de administrador; algumas empresas com Microsoft 365 podem exigir mesmo assim (política
  delas). A verificação do editor (Publisher verification) é recomendada e fica como passo opcional.
- **Segredo do cliente** com validade de 24 meses. A data de vencimento vai para o runbook do README.

Variáveis novas em [src/lib/env.ts](../../../src/lib/env.ts), opcionais:
- `MICROSOFT_MAIL_CLIENT_ID`;
- `MICROSOFT_MAIL_CLIENT_SECRET`.

Sem as duas, o cartão "Pela conta Microsoft" não aparece e as rotas respondem "não configurado". As
variáveis do login (`MICROSOFT_CLIENT_ID`/`SECRET`) não são usadas aqui.

O endereço de retorno é montado juntando `NEXT_PUBLIC_SITE_URL` e o caminho **sem barra dupla**. Em
produção essa variável termina em `/`: o app antigo do login só funciona porque tem o endereço com barra
dupla cadastrado. Por isso **não** se mexe nela.

## 4. Dados

### 4.1 Tabela nova `email_sender_accounts` (`EmailSenderAccount`)

| Campo | Tipo | Observação |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `organizationId` | `String @unique` | uma conta por empresa, garantido pelo banco |
| `provider` | enum `EmailSenderProvider { MICROSOFT }` | preparado para Google/SMTP depois |
| `email` | `String` | endereço da caixa, normalizado |
| `displayName` | `String?` | nome de exibição da Microsoft |
| `accountKind` | `String` | `"personal"` ou `"work"`; define o limite diário estimado |
| `credentials` | `String` | `encryptCredentials({ accessToken, refreshToken, expiresAt })` de [src/lib/integrations/crypto.ts](../../../src/lib/integrations/crypto.ts) |
| `status` | enum `EmailSenderAccountStatus { ACTIVE NEEDS_RECONNECT }` | |
| `lastError` | `String?` | último erro técnico da renovação |
| `connectedById` | `String` | usuário que conectou |
| `createdAt` / `updatedAt` | `DateTime` | |

- Entra em `TENANT_MODELS` ([src/lib/tenant-db.ts](../../../src/lib/tenant-db.ts)), ganha um caso no
  `check:isolation` e é citada no guia 03.
- Sem `upsert`: conectar faz `findFirst` + `updateMany`/`create` por `organizationId`.
- O tipo da conta vem do `tid` do id token: `9188040d-6c67-4c5b-b112-36a304b66dad` é o tenant das
  contas pessoais da Microsoft; qualquer outro é Microsoft 365 (`work`).

### 4.2 Mudanças em `email_broadcasts`

- `channel` — enum `EmailChannel { PLATFORM MICROSOFT }`, padrão `PLATFORM`.
- `senderAccountId` — `String?`, FK para `email_sender_accounts` com `onDelete: SetNull`.
- Ao **iniciar** um envio pela Microsoft, `fromEmail` e `fromName` recebem o endereço e o nome da conta,
  congelados, como já acontece com a assinatura.
- `pausedReason` ganha os valores:
  - `daily_limit`: limite diário estimado atingido ou recusa por limite;
  - `reconnect`: a conta precisa ser reconectada;
  - `no_sender_account`: conta desconectada ou trocada por outra;
  - `account_blocked`: a Microsoft bloqueou a caixa para envio.

### 4.3 Status de destinatário

`EmailRecipientStatus` ganha dois valores:
- `SENDING` — reservado pelo despachante antes de chamar a Microsoft;
- `UNCERTAIN` — o envio foi interrompido depois da reserva e antes da confirmação. Não é reenviado.

### 4.4 Migration (aditiva)

`prisma/migrations/20261015120000_email_sender_accounts/migration.sql`:
- cria os enums novos e a tabela;
- acrescenta as colunas em `email_broadcasts`;
- acrescenta `SENDING` e `UNCERTAIN` em `EmailRecipientStatus` (`ALTER TYPE … ADD VALUE`).

Não apaga nada, e o código anterior continua funcionando com ela aplicada. Vai para o Supabase **antes**
do merge, com `prisma db execute` + `prisma migrate resolve` (nunca `migrate deploy`).

## 5. Conectar, manter e desconectar

### 5.1 Rotas

As duas rotas se protegem sozinhas (guia 05): exigem sessão, `canAccessScreen(ctx, "email")` e o módulo
`marketing`, como as actions do E-mail.

- **`GET /api/email/microsoft/connect`**:
  - gera `state` e o verificador PKCE (`arctic`);
  - guarda os dois em cookies `httpOnly` de 10 minutos, como em
    [src/app/api/auth/[provider]/route.ts](../../../src/app/api/auth/[provider]/route.ts);
  - redireciona para a Microsoft (`MicrosoftEntraId("common", …)`) com os escopos
    `openid profile email offline_access User.Read Mail.Send` e `prompt=select_account`;
  - aceita `?intent=reconnect` só para voltar com a mensagem certa.
- **`GET /api/email/microsoft/callback`**:
  1. confere o `state` e troca o código por tokens;
  2. lê `GET /me` (endereço: `mail`, senão `userPrincipalName`; nome: `displayName`) e o `tid`;
  3. grava ou substitui a conta da empresa, com credenciais criptografadas e `status = ACTIVE`;
  4. se a conta anterior era **outra caixa**, os envios dela em andamento (`SENDING`) pausam com
     `no_sender_account`;
  5. registra auditoria (`email_sender.connected` / `email_sender.replaced`);
  6. volta para `/app/email/new?microsoft=connected`, ou `?microsoft_error=<código>` quando o usuário
     cancela, a Microsoft recusa ou a empresa exige aprovação do administrador.

### 5.2 Token de acesso

`getMicrosoftAccessToken(account)`, em `src/lib/email-broadcast/microsoft/token.ts`:
- devolve o token guardado se faltam mais de 5 minutos para vencer;
- senão, renova com o `refreshToken` (`arctic` `refreshAccessToken`) e grava o par novo;
- se a renovação devolver `invalid_grant` (senha trocada, acesso revogado, segredo vencido), marca a conta
  `NEEDS_RECONNECT`, guarda `lastError` e devolve "reconectar".

A renovação é serializada por conta (trava por empresa na transação), para dois envios simultâneos não
gastarem o mesmo `refreshToken`.

### 5.3 Desconectar

É uma action da tela de escolha, com confirmação:
- apaga a linha da conta (`deleteMany` por empresa);
- pausa com `no_sender_account` os envios da empresa em andamento pelo canal Microsoft;
- registra auditoria (`email_sender.disconnected`).

A tela informa que, para tirar o acesso também do lado da Microsoft, a pessoa pode remover o app nas
configurações de privacidade da conta Microsoft dela.

## 6. Envio

### 6.1 Despachante

Continua sendo o de [src/lib/email-broadcast/dispatch.ts](../../../src/lib/email-broadcast/dispatch.ts):
mesma fila de destinatários, mesmo lease, mesmo "Retomar envio", mesmo `after()`, um e-mail por
destinatário (o link de descadastro é individual). Pelo canal `MICROSOFT`, o "carteiro" muda:

1. **Montagem:** o mesmo `composeEmail` de hoje (HTML sanitizado, versão texto, assinatura congelada,
   rodapé e cabeçalhos de descadastro `List-Unsubscribe` + `List-Unsubscribe-Post`). Vira uma mensagem
   **MIME** com o `MailComposer` do pacote `nodemailer`, usado só para montar a mensagem (não envia por
   SMTP). Dependência nova, conferida pelo `check:node`.
2. **Até ~3 MB de MIME:** `POST /me/sendMail` com o MIME em base64 (limite de 4 MB por chamada do
   Graph). A Microsoft guarda em "Itens enviados".
3. **Acima disso e até 10 MB de anexos:**
   - `POST /me/messages` com o MIME **sem os anexos**, o que cria um rascunho;
   - cada anexo vai em seguida: abaixo de 3 MB por `POST /messages/{id}/attachments`; a partir de 3 MB
     por sessão de upload (`createUploadSession`, partes múltiplas de 320 KiB);
   - por fim, `POST /me/messages/{id}/send`, que guarda em "Itens enviados".
   
   Se algo falhar no meio, o rascunho é apagado (`DELETE /me/messages/{id}`).
4. Os arquivos são lidos uma vez por execução (`readMedia`), como hoje.

### 6.2 Ritmo e limite diário

- **Ritmo:** um e-mail a cada **2,1 s** por conta, ~28 por minuto, abaixo dos 30 por minuto da Microsoft.
  Dois envios simultâneos pela mesma conta dividem o ritmo, como `activeSends` já faz na plataforma.
- **Limite estimado** por tipo de conta, em [src/config/limits.ts](../../../src/config/limits.ts) (guia 04):
  - `microsoftDailyPersonal = 300`;
  - `microsoftDailyWork = 10_000`.
- **Restante do dia:** `limite − destinatários com status SENT, SENDING ou UNCERTAIN de envios dessa conta
  com sentAt nas últimas 24 h`. Função pura, coberta pelo `check:email`.
- **Antes de cada e-mail:** se o restante é 0, o envio pausa com `daily_limit` antes de chamar a
  Microsoft. Uma recusa de limite vinda da Microsoft também pausa com `daily_limit`.
- **"Retomar envio"** volta a enviar até o novo restante e pausa de novo, se for o caso.
- **Cota mensal:** a contagem de [src/lib/queries/email-broadcasts.ts](../../../src/lib/queries/email-broadcasts.ts)
  passa a considerar só envios com `channel = PLATFORM`.

### 6.3 Nunca enviar duas vezes

O Resend descarta repetições pela chave de idempotência; o Graph não. Por isso:
1. antes de chamar a Microsoft, o destinatário passa de `QUEUED` para `SENDING` (`updateMany` conferindo
   o lease);
2. com a Microsoft aceitando, vira `SENT` com `sentAt`;
3. numa falha definitiva, vira `FAILED` com o código do erro;
4. quando um despachante pega o lease de um envio pela Microsoft, todo destinatário dele ainda em
   `SENDING` vira **`UNCERTAIN`** ("o envio foi interrompido antes da confirmação"). Ele não é reenviado.

### 6.4 Erros

| Resposta da Microsoft | O que acontece |
|---|---|
| 401 / `InvalidAuthenticationToken` | renova o token e repete uma vez; falhando, pausa com `reconnect` |
| 429 ou 503 com `Retry-After` | espera o tempo indicado (até 60 s) e repete |
| 5xx, timeout, rede | repete com espera crescente (`retry-policy.ts`); esgotado, pausa com `provider_error` |
| 400 `ErrorInvalidRecipients` e afins, por destinatário | só esse destinatário vira `FAILED`; o envio segue |
| recusa por limite de envio (`ErrorExceededMessageLimit`, `ErrorQuotaExceeded`) | pausa com `daily_limit` |
| caixa bloqueada para envio (`ErrorMessageSubmissionBlocked`, `ErrorAccountSuspend`) | pausa com `account_blocked` |
| qualquer outro 4xx | o destinatário vira `FAILED` com o código; três seguidos pausam com `provider_error` |

Os códigos exatos de cada caso são confirmados na documentação do Graph durante a implementação. A tabela
de tradução (6.5) cobre o que vier, com frase genérica para o resto.

### 6.5 Motivos em português

Uma função pura, `failureReason(...)`, traduz o motivo em uma chave de i18n e guarda o texto técnico ao lado:
- pelo `pausedReason` do envio: `daily_limit`, `reconnect`, `no_sender_account`, `account_blocked`,
  `quota`, `no_connection`, `provider_error`;
- pelo código de erro do destinatário: Microsoft e Resend.

Erro sem tradução mostra uma frase genérica ("Falha ao enviar para este endereço"), com o texto técnico no
`title` (aparece ao passar o mouse). Vale para os **dois canais**.

## 7. Telas

O protótipo tem as quatro.

1. **Escolha do canal** (`/app/email/new`):
   - **"Pela plataforma"** abre o formulário de hoje (`?via=platform`);
   - **"Pela conta Microsoft"**, conforme o estado:
     - sem conta: **"Conectar conta Microsoft"**;
     - conectada: endereço, tipo, limite estimado e enviados nas últimas 24 h, com **"Usar esta conta"**
       (`?via=microsoft`), **"Trocar conta"** e **"Desconectar"**, ambos com confirmação;
     - precisa reconectar: aviso em vermelho e **"Reconectar"**;
   - o cartão da Microsoft some se o app não estiver configurado no servidor.
2. **Formulário** — o de hoje, nos dois canais. Pela Microsoft:
   - o bloco "Nome do remetente / Endereço de envio" vira **"De: Nome <endereço> (conta Microsoft)"**, sem
     edição, com o link "Trocar canal";
   - o resto é igual: **editor de texto rico**, lista, planilha, assinatura, anexos até 10 MB;
   - "Enviar teste" também sai pela caixa conectada;
   - o rascunho guarda o canal e abre nele em `/app/email/[id]/edit`.
3. **Confirmação**, pela Microsoft, acrescenta:
   - *"X dos Y destinatários recebem agora. Esta conta envia cerca de N por dia, e M já saíram nas últimas
     24 h. Ao chegar no limite, o envio pausa e espera você retomar."* (ou "Todos recebem agora");
   - o ritmo e o tempo estimado dessa parte;
   - o aviso de que os e-mails ficam em "Itens enviados";
   - o aviso de que a Microsoft não informa entrega nem abertura.
4. **Lista de envios** (`/app/email`):
   - mostra o remetente e o canal;
   - mostra, nos dois canais, a **linha vermelha com o motivo** embaixo do status.
5. **Relatório** (`/app/email/[id]`), pela Microsoft:
   - cabeçalho "Enviado pela conta Microsoft <endereço>";
   - faixa vermelha quando pausado, com o motivo e "Retomar envio";
   - contadores **Enviados, Falhas, Situação incerta, Na fila**, sem Entregues e Abertos;
   - motivo de cada falha em vermelho, em português.

Os textos novos entram em `pt.json` e `en.json` com paridade, e a contagem de chaves sobe no CLAUDE.md e
no guia 04.

## 8. Segurança

- Tokens só criptografados no banco, abertos só no servidor, na hora de enviar. Nunca vão para o cliente
  nem para logs.
- Escopos mínimos: só enviar (`Mail.Send`). Não lê a caixa.
- `state` e PKCE no fluxo de conexão; as rotas exigem sessão, tela e módulo.
- A tabela nova é isolada por empresa (`TENANT_MODELS` + `check:isolation`).
- O despachante continua como contexto de sistema, com `organizationId` explícito em toda consulta.

## 9. Testes

- **`check:email`** ganha casos puros para:
  - montagem do MIME (cabeçalhos com acento, anexos com nome acentuado, partes HTML e texto,
    cabeçalhos de descadastro);
  - escolha entre envio direto e rascunho pelo tamanho;
  - restante do dia;
  - tradução dos motivos;
  - tipo da conta pelo `tid`;
  - montagem do endereço de retorno sem barra dupla;
  - passagem de `SENDING` para `UNCERTAIN`.
- **`check:isolation`** ganha o caso de `email_sender_accounts`.
- As cinco validações de sempre.
- **Teste real, local:** conectar uma caixa Outlook de teste e enviar para endereços de teste
  autorizados por você. O teste cobre envio pequeno, envio com anexo de ~8 MB, limite simulado (constante
  baixa no teste), reconexão e desconexão. Nenhum envio real sem a sua autorização.

## 10. Publicação

1. Aplicar a migration no Supabase **antes** do merge.
2. Pôr `MICROSOFT_MAIL_CLIENT_ID` e `MICROSOFT_MAIL_CLIENT_SECRET` no hPanel.
3. Mergear. O endereço de retorno de produção já está cadastrado no app.
4. Registrar no runbook do README (§8) a data de vencimento do segredo e como trocá-lo.

## 11. Riscos

- **Bloqueio pela Microsoft:** contas Outlook pessoais que mandam muitos e-mails parecidos podem ser
  bloqueadas como spam. O envio pausa com `account_blocked` e a tela explica. Para volume alto, o caminho
  continua sendo a plataforma.
- **Limite estimado:** a Microsoft não informa quanto resta. O aviso é uma estimativa e o envio pausa na
  recusa real.
- **Empresas com Microsoft 365 restrito:** podem exigir aprovação do administrador delas para o app.
  A verificação do editor reduz isso.
- **Segredo do app vence em 24 meses:** sem troca, todas as contas passam a "precisa reconectar".

## 12. Fora de escopo

- Google (Gmail e Workspace) e Yahoo/SMTP: próximas fases, reaproveitando a tabela de contas de envio e a
  tela de escolha.
- Ler respostas ou devoluções da caixa conectada.
- Uma caixa por pessoa, em vez de por empresa.
- Campanhas, que não são tocadas.

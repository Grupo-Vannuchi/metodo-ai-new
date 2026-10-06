# Envio de e-mail em massa (submenu E-mail) — design

**Data:** 2026-10-06 · **Status:** design aprovado em conversa; spec aguardando revisão.
**Mockup das telas:** https://claude.ai/artifact/MMJhqcuDZbwboK1vDEmQtH (privado)

---

## 1. Objetivo

Um item **E-mail** no menu, dentro do grupo Comunicação, onde o usuário escreve um e-mail num editor
rico e envia para muitas pessoas de uma vez, pelo Resend da própria empresa. Os destinatários são a
**soma** de:

- contatos do CRM (todos, por tag ou por pasta);
- empresas (todas ou por pasta), usando o e-mail cadastrado na empresa;
- endereços avulsos (busca por nome ou lista colada).

**Critério de sucesso:** se o mesmo endereço aparece mais de uma vez no mesmo envio (num contato,
numa empresa e digitado à mão, por exemplo), ele recebe **um** e-mail, e quem já recebeu nunca
recebe de novo, nem quando o envio é retomado depois de uma interrupção.

## 2. Decisões tomadas com o usuário

| Decisão | Escolha |
|---|---|
| Grupos disponíveis | Contatos do CRM e Empresas. Funcionários e membros da equipe ficam fora. |
| Conta do Resend | **A de cada cliente**, cadastrada em Conexões (provider `RESEND`, já existe). Nunca a da plataforma. |
| Abordagem | Tela própria com tabelas próprias (alternativa A). Não estende Campanhas nem usa Broadcasts do Resend. |
| Editor | TipTap, o mesmo `RichTextEditor` das Propostas. |
| Campanhas | **Nada de Campanhas é alterado.** Ver §11. |
| Duplicado | O mesmo endereço duas vezes **no mesmo envio**. Envios diferentes não se bloqueiam entre si. |

## 3. Fora do escopo (v1)

Agendamento, anexos, rastreio de abertura e clique, modelos salvos (o "Duplicar" cobre esse uso),
tela de gestão da lista de bloqueio, funcionários e membros como grupos, e retomada automática sem
fila (ver §8.4).

## 4. Telas

As quatro telas estão no mockup. As rotas ficam em `src/app/[locale]/app/email/`.

| Rota | Conteúdo |
|---|---|
| `/app/email` | Card da conexão Resend (remetente; se o status de entrega está ativo), card da cota do mês, tabela de envios (assunto, status, destinatários, entregues, problemas, data). Sem conexão: aviso com link para Conexões, e o envio fica bloqueado (rascunho continua permitido). |
| `/app/email/new` e `/app/email/[id]/edit` | Composer. À esquerda: nome do remetente, endereço (só leitura, vem da conexão), responder-para opcional, assunto, editor TipTap com variáveis, aviso do rodapé automático, "Enviar teste para mim". À direita: destinatários e resumo ao vivo (selecionados, repetidos, bloqueados, inválidos, total único), cota, "Salvar rascunho" e "Revisar e enviar". |
| (diálogo) | Confirmação: "Enviar para N endereços?", com remetente, assunto e a conta detalhada. |
| `/app/email/[id]` | Relatório. Rascunho redireciona para `/edit`. Barra de progresso; contadores Na fila, Enviados, Entregues, Bounce e Spam; filtro por status; tabela com destinatário, origem ("Contato + Empresa" quando foi deduplicado), status e erro. Recarrega a cada 5 s enquanto está enviando. Botões "Ver e-mail enviado", "Duplicar" e, quando cabe, "Retomar envio". |

Só rascunho pode ser apagado. Um envio iniciado é histórico e conta na cota.

## 5. Modelo de dados

São três tabelas novas, todas com `organizationId` e todas adicionadas a `TENANT_MODELS`. A
migration é **só aditiva**: nenhuma tabela existente muda.

```prisma
enum EmailBroadcastStatus { DRAFT SENDING PAUSED DONE }
enum EmailRecipientStatus { QUEUED SENT DELIVERED BOUNCED COMPLAINED FAILED }
enum EmailSuppressionReason { UNSUBSCRIBED BOUNCED COMPLAINED }

model EmailBroadcast {
  id             String               @id @default(cuid())
  organizationId String
  subject        String
  html           String               @db.Text  // HTML do editor; sanitizado de novo ao renderizar
  fromName       String?
  replyTo        String?
  audience       Json                 @default("{}") // seleção (§6.1), para o rascunho reabrir igual
  stats          Json                 @default("{}") // { selected, invalid, duplicates, suppressed } congelado no envio
  status         EmailBroadcastStatus @default(DRAFT)
  pausedReason   String?              // "no_connection" | "quota" | "provider_error"
  lastError      String?              // mensagem do Resend quando pausou por erro
  createdById    String
  startedAt      DateTime?
  finishedAt     DateTime?
  lastDispatchAt DateTime?            // heartbeat do disparador (§8.4)
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt
  recipients     EmailBroadcastRecipient[]
  @@index([organizationId, createdAt])
  @@index([organizationId, status])
  @@map("email_broadcasts")
}

model EmailBroadcastRecipient {
  id                String               @id @default(cuid())
  organizationId    String
  broadcastId       String
  email             String               // normalizado: trim + minúsculas
  name              String?              // para {{nome}}
  companyName       String?              // para {{empresa}}
  sources           String[]             @default([]) // "contact" | "company" | "manual"
  contactId         String?              // referência solta, sem FK: apagar o contato não apaga o histórico
  companyId         String?
  batchNo           Int                  // lote fixo de 100, definido na criação (§8.2)
  status            EmailRecipientStatus @default(QUEUED)
  providerMessageId String?
  error             String?
  sentAt            DateTime?
  updatedAt         DateTime             @updatedAt
  broadcast         EmailBroadcast       @relation(fields: [broadcastId], references: [id], onDelete: Cascade)
  @@unique([broadcastId, email])         // a garantia de "sem duplicado" é do banco
  @@index([broadcastId, status])
  @@index([broadcastId, batchNo])
  @@index([organizationId, sentAt])
  @@index([providerMessageId])
  @@map("email_broadcast_recipients")
}

model EmailSuppression {
  id             String                 @id @default(cuid())
  organizationId String
  email          String                 // normalizado
  reason         EmailSuppressionReason
  recipientId    String?                // destinatário que originou (link ou webhook)
  createdAt      DateTime               @default(now())
  @@unique([organizationId, email])
  @@map("email_suppressions")
}
```

A gravação na lista de bloqueio usa `createMany` com `skipDuplicates`, nunca `upsert`
(`upsert` não passa pelo filtro do `tenantDb`; ver guia 03).

## 6. Destinatários e deduplicação

### 6.1 Seleção (validada com zod e salva em `audience`)

```ts
{
  allContacts: boolean, contactTags: string[], contactFolderIds: string[], contactIds: string[],
  allCompanies: boolean, companyFolderIds: string[], companyIds: string[],
  emails: string[], // digitados ou colados
}
```

`contactIds` e `companyIds` vêm da busca por nome no campo de avulsos. Limites: até 5.000 `emails`
e até 1.000 ids.

### 6.2 Resolução (`src/lib/email-broadcast/audience.ts`)

1. **Contatos** com e-mail que batem em **qualquer** critério marcado: todos, tag (`hasSome`),
   pasta (`in`) ou id (`in`). Os critérios se somam (OU), diferente do filtro E de Campanhas.
2. **Empresas** com e-mail, pela mesma regra: todas, pasta ou id.
3. **Avulsos**: a lista digitada.
4. Cada candidato é normalizado (`trim().toLowerCase()`) e validado. Inválido conta em `invalid` e sai.
5. Os válidos são agrupados por endereço. `duplicates` = válidos − únicos. Nome e empresa vêm da
   primeira fonte, na ordem contato > empresa > avulso. `sources` guarda todas as origens, e é isso
   que o relatório mostra como "Contato + Empresa".
6. Saem os **bloqueados**: os endereços da `EmailSuppression` da organização **mais** os e-mails de
   contatos com `optedOut = true`, que é só leitura (§11). Esses entram em `suppressed`.

O que sobra é `total`. A conta exibida é sempre
`selected − invalid − duplicates − suppressed = total`.

Normalização, validação e o parse da lista colada (separadores: vírgula, ponto e vírgula, espaço e
quebra de linha) ficam em `src/lib/email-broadcast/normalize.ts`. O arquivo não usa `server-only`
para que o client marque em vermelho os chips inválidos com a mesma regra do servidor.

### 6.3 Resumo ao vivo

A action `previewEmailAudience(selection)` devolve os contadores e uma amostra de 100 endereços.
É chamada com debounce de 350 ms, como o `countAudience` de Campanhas. A action
`searchEmailTargets(q)` devolve até 10 contatos ou empresas com e-mail que casam nome ou endereço.

## 7. Conteúdo

- **Editor:** `RichTextEditor` de `src/components/proposals/rich-text-editor.tsx`, importado sem
  alteração, com as variáveis `nome` e `empresa`.
- **Renderização** (`src/lib/email-broadcast/render.ts`, função pura): `sanitizeHtml` (o allowlist
  das Propostas, também importado sem alteração), depois substituição de `{{nome}}` e `{{empresa}}`
  com o valor **escapado** no corpo e texto puro no assunto. Variável sem valor vira vazio; a UI
  avisa que avulsos sem cadastro ficam sem nome.
- **Layout:** HTML de e-mail com tabela de 600 px, estilos inline e um `<style>` básico para
  `p`, `h2`, `h3`, `ul` e `a`.
- **Versão texto:** o corpo sem tags, para entregabilidade.
- **Rodapé automático**, fora do editor: "Você recebeu este e-mail de {nome da organização}." e o
  link "Não quero mais receber" (§9). Sempre em pt-BR na v1.
- **Remetente:** `"{fromName} <{fromEmail da conexão}>"`, com `reply_to` opcional.
- **Enviar teste para mim:** renderiza com o nome do usuário logado e o nome da organização, põe
  `[Teste]` no assunto e envia uma vez para o e-mail do usuário pela conexão do cliente. Não grava
  destinatário e não conta na cota. É aqui que aparece cedo o erro "domínio não verificado" do Resend.

## 8. Envio

### 8.1 Iniciar (`sendEmailBroadcast(id)`)

1. Checa a sessão, a tela `email` e o módulo `marketing` (§10). O envio precisa estar em `DRAFT`,
   com assunto e corpo preenchidos.
2. Sem conexão RESEND, devolve `no_connection`.
3. `ensureResendWebhook` (§10.2), em modo best-effort: falhar não bloqueia o envio.
4. Resolve a audiência. Se o total for zero, devolve `empty`. Se passar da cota restante do mês
   (§8.5), devolve `quota` com os números, e **não** começa um envio parcial.
5. `updateMany` de `DRAFT` para `SENDING`, com `count === 1` como trava contra duplo clique. Grava
   `stats` e `startedAt`.
6. Cria os destinatários em blocos de 1.000 com `createMany` + `skipDuplicates`.
   `batchNo = floor(índice / 100)`, na ordem alfabética do endereço. Se falhar, apaga os
   destinatários e volta para `DRAFT`.
7. Registra a auditoria `email_broadcast.started`. Com QStash: `enqueue("email-broadcast")`. Sem
   QStash (produção hoje): `void runEmailBroadcast(id)` em segundo plano, o mesmo padrão de Campanhas.

### 8.2 Disparador (`src/lib/email-broadcast/dispatch.ts`)

Roda em contexto de sistema (Prisma cru, `organizationId` explícito em toda query), em loop:

1. **Lease:** `updateMany` em `lastDispatchAt = now` onde `status = SENDING` e o heartbeat está
   nulo ou tem mais de 90 s. Se `count === 0`, outro executor está vivo e este sai. A cada lote o
   heartbeat é renovado.
2. Sem conexão: `PAUSED` com `no_connection`. Cota esgotada: `PAUSED` com `quota`.
3. Pega o **menor `batchNo` que ainda tem `QUEUED`** e os `QUEUED` desse lote. Sem nenhum:
   `DONE` + `finishedAt`.
4. Renderiza cada um com as próprias variáveis e o próprio link de descadastro.
5. `POST /emails/batch` com **`Idempotency-Key: eb-{broadcastId}-{batchNo}`**. O lote é
   determinístico, então reenviar depois de uma queda é deduplicado pelo Resend, que guarda a
   chave por 24 h.
   - **200:** numa transação, cada destinatário vira `SENT` com `providerMessageId`, casando pelo
     índice, que o Resend devolve na mesma ordem.
   - **429:** espera o `retry-after` e repete, no máximo 5 vezes.
   - **5xx ou erro de rede:** repete com a mesma chave, no máximo 3 vezes, com backoff. Depois
     disso: `PAUSED`, `provider_error` e `lastError`.
   - **422 (um endereço ruim derruba o lote) ou 409 (o lote mudou depois de envios individuais):**
     cai para `POST /emails`, um por destinatário, com chave `eb-{id}-{batchNo}-{recipientId}`.
     Cada resposta atualiza só a sua linha (`SENT`, ou `FAILED` com a mensagem).
   - **401 ou 403** (chave inválida, domínio não verificado): `PAUSED`, `provider_error` e
     `lastError` com a mensagem do Resend.
6. Pausa de cerca de 150 ms entre lotes. O limite do Resend é de 10 requisições por segundo por
   conta, dividido com o que o cliente mais envia.

### 8.3 Fila

O job `email-broadcast`, registrado em `src/lib/jobs/index.ts`, roda o loop por no máximo 50 s e
se reenfileira se não terminou. No caminho sem fila, o loop roda até o fim.

### 8.4 Retomar

Produção não tem QStash, então se o Passenger reciclar o processo no meio de um envio, ele para.
O relatório mostra **"Retomar envio"** em dois casos: `SENDING` com heartbeat de mais de 2 minutos,
ou `PAUSED` depois que a causa foi resolvida. A action só chama o disparador, e o lease (§8.2)
garante um único executor. A retomada continua só os `QUEUED`; os lotes já aceitos são
protegidos pela chave de idempotência. Retomada automática sem clique fica fora da v1 (exigiria o
cron de Campanhas ou QStash).

### 8.5 Cota

`LIMITS.emailBroadcastQuotaPerMonth = 50_000` em `src/config/limits.ts`, **separada** da cota de
Campanhas. Conta os destinatários da organização com `sentAt` no mês corrente.

## 9. Descadastro (LGPD)

- **Assinatura:** `src/lib/email-broadcast/unsubscribe.ts`, um arquivo novo; o `src/lib/unsubscribe.ts`
  de Campanhas não muda. É um HMAC-SHA256 com `SESSION_SECRET` sobre
  `email-broadcast-unsub:{recipientId}`. O prefixo separa o domínio, para não existir colisão com
  as assinaturas de Campanhas.
- **Link no rodapé:** `/email-unsubscribe/{recipientId}/{sig}`, em
  `src/app/[locale]/email-unsubscribe/[recipientId]/[sig]/page.tsx`. A página mostra o botão
  "Confirmar descadastro", e um GET sozinho não descadastra, porque scanners de link abrem URLs. A
  confirmação é uma server action pública que verifica a assinatura e grava a `EmailSuppression`
  com `UNSUBSCRIBED`, usando o `organizationId` lido do destinatário.
- **Um clique (RFC 8058, exigido por Gmail e Yahoo para envio em massa):** cada e-mail leva
  `List-Unsubscribe: <{site}/api/email/unsubscribe/{recipientId}/{sig}>` e
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. A rota aceita só `POST`, verifica o HMAC e
  tem o mesmo efeito. É pública de propósito, e isso vai registrado no guia 05.
- **Efeito:** só a lista de bloqueio do E-mail. O `Contact.optedOut` **não** é alterado (§11).

## 10. Acesso, conexão e status de entrega

### 10.1 Menu e permissões

- `src/config/screens.ts`: nova tela `email` em `GATEABLE_SCREENS`.
- `src/config/modules.ts`: `marketing.screens` passa a incluir `email`.
- `src/components/app/app-nav.tsx`: item `{ href: "/app/email", key: "email", icon: Mail }` no grupo
  `comms`, depois de Campanhas.
- `layout.tsx` de `/app/email`: `requireScreen(ctx, "email")` e `requireModule(ctx, "marketing")`.
- Actions: `getOrgContext()`, `canAccessScreen(ctx, "email")` e `hasModule(ctx.modules, "marketing")`.
  Se falhar, devolve `forbidden`.
- Membros com modelo de acesso só veem a tela depois que um admin marcar "E-mail" no modelo.
  Owner e admin veem direto.

### 10.2 Conexão e webhook (`src/lib/email-broadcast/connection.ts`)

- **Credenciais:** a conexão `RESEND` mais recente da organização, decifrada com
  `decryptCredentials`. O resolver é próprio e não importa `src/lib/dispatch.ts`.
- **`ensureResendWebhook`:** se `meta.emailWebhook` não existe, ou se a chave mudou (hash da apiKey
  diferente) ou o endpoint mudou, chama `POST https://api.resend.com/webhooks` com o endpoint
  `{site}/api/webhooks/resend/{connectionId}` e os eventos `email.delivered`, `email.bounced`,
  `email.complained` e `email.failed`. Guarda em `meta.emailWebhook` o `{ id, secretEnc, keyHash,
  endpoint }`, com o segredo cifrado. O webhook antigo é removido em best-effort. A gravação é um
  `updateMany` que **mescla** o `meta`.
  - O passo é pulado quando o site não é `https` ou é `localhost`; em dev o webhook exige ngrok.
  - Se a chave do cliente não puder criar webhooks (por exemplo, uma chave só de envio), o envio
    funciona do mesmo jeito: os status ficam em "Enviado" e a tela avisa "status de entrega
    indisponível".

### 10.3 Rota do webhook (`src/app/api/webhooks/resend/[connectionId]/route.ts`)

1. Lê o corpo cru e carrega a conexão `RESEND` pelo id (Prisma cru, contexto de sistema). Se não
   existir: 404.
2. Verifica a assinatura **Svix**: headers `svix-id`, `svix-timestamp` e `svix-signature`.
   - Conteúdo assinado: `{id}.{timestamp}.{body}`.
   - Segredo: o base64 que vem depois de `whsec_`. Algoritmo HMAC-SHA256, comparado em tempo constante.
   - Tolerância de 5 minutos no timestamp.
   - Falha: 401. A verificação é escrita à mão, sem dependência nova.
3. Idempotência: `WebhookEvent` com `dedupeKey = RESEND:{svix-id}`. Duplicado devolve 200.
4. Aplica a transição só para frente (função pura), com `updateMany` filtrado por
   `providerMessageId`, `organizationId` e os status de origem permitidos:
   - `delivered`: de SENT para DELIVERED.
   - `bounced`: de SENT ou DELIVERED para BOUNCED, gravando `bounce.message` em `error`. Se
     `bounce.type === "Permanent"`, o endereço entra na lista de bloqueio como `BOUNCED`.
   - `complained`: de qualquer status, exceto FAILED, para COMPLAINED, e o endereço entra na lista
     de bloqueio como `COMPLAINED`.
   - `failed`: de QUEUED ou SENT para FAILED.
5. Evento desconhecido, ou `email_id` que não é deste módulo (o cliente pode usar a mesma conta
   Resend para outras coisas), é ignorado com 200.

A rota fica em `/api/webhooks/resend/...`. Como o segmento estático tem precedência, ela não
conflita com `/api/webhooks/[provider]`, que segue intocada; já existe o precedente
`/api/webhooks/evolution/...`.

## 11. Campanhas: o que não é tocado

Nenhum destes muda:

- `src/lib/dispatch.ts`, `src/lib/integrations/channels/email.ts` e `src/lib/integrations/webhooks/**`;
- `src/app/api/webhooks/[provider]/route.ts`;
- `src/app/actions/campaigns.ts`, `src/lib/queries/campaigns.ts`, `src/lib/validations/campaign.ts`;
- `src/components/campaigns/**`, `src/app/[locale]/app/campaigns/**`;
- `src/lib/unsubscribe.ts`, `src/app/[locale]/unsubscribe/**`;
- os models `Campaign`, `CampaignRecipient` e `MessageTemplate`;
- `LIMITS.dispatchQuotaPerMonth`.

O E-mail **lê** o `Contact.optedOut`, porque quem pediu para sair das campanhas também não recebe
e-mail em massa, mas **nunca escreve** nele.

`sanitizeHtml` e `RichTextEditor`, das Propostas, são reaproveitados por import, sem alteração.

## 12. Arquivos

**Novos:**
- a migration `prisma/migrations/<timestamp>_email_broadcasts/`;
- `src/lib/email-broadcast/` com `normalize.ts`, `audience.ts`, `render.ts`, `resend.ts`
  (cliente HTTP: batch, single, webhooks), `connection.ts`, `dispatch.ts`, `unsubscribe.ts`,
  `webhook.ts` (Svix e transições);
- `src/lib/queries/email-broadcasts.ts`, `src/lib/validations/email-broadcast.ts`,
  `src/app/actions/email-broadcasts.ts`;
- as páginas em `src/app/[locale]/app/email/**`, os componentes em `src/components/email/**`, a
  página `email-unsubscribe` e as duas rotas de API;
- `scripts/check-email-broadcast.ts`, com asserções das funções puras.

**Alterados:**
- `prisma/schema.prisma`, `src/lib/tenant-db.ts` (+3 em `TENANT_MODELS`);
- `src/config/screens.ts`, `modules.ts`, `limits.ts`, `audit.ts`, e
  `src/components/app/app-nav.tsx`, `src/lib/jobs/index.ts`;
- `src/messages/pt.json` e `en.json` (namespaces `emailBroadcast` e `emailUnsubscribe`, mais
  `app.nav.email`);
- `scripts/check-isolation.ts`, com asserções para as três tabelas novas;
- os guias 03, 04 e 05 (mais o 06, se a contagem do `check:isolation` aparecer nele) e o README
  (linha do E-mail e nota sobre o webhook).

## 13. Verificação

Não há suíte de testes unitários.

1. As cinco checagens do `CLAUDE.md`, com `check:isolation` cobrindo as tabelas novas.
2. `npx tsx scripts/check-email-broadcast.ts`:
   - parse e normalização: maiúsculas, espaços e separadores misturados;
   - contadores `selected − invalid − duplicates − suppressed = total`;
   - variável com `<script>` sai escapada;
   - assinatura Svix válida passa e corpo alterado falha;
   - transições de status só para frente.
3. **E2E local** (org de dev com Marketing instalado e uma conexão RESEND de teste):
   - um endereço próprio cadastrado como contato, como empresa **e** digitado à mão → chega 1 e-mail;
   - "Enviar teste";
   - descadastro pela página → o próximo envio exclui o endereço;
   - POST de um evento assinado com o segredo guardado na rota do webhook → o status muda;
   - um evento repetido não muda nada.
4. Antes do merge, o `git diff main --stat` não pode listar nenhum arquivo da §11.

## 14. Deploy

- A migration é só aditiva. **Aplicar o SQL no Supabase antes do merge na `main`**, seguindo o
  runbook do README §8, já que a Hostinger não roda `migrate deploy`.
- Não há env nova. O webhook depende de `NEXT_PUBLIC_SITE_URL` em `https`, que produção já tem.
- Para cada cliente usar: conta no Resend, domínio verificado e a chave cadastrada em Conexões. A
  tela de E-mail explica isso quando não há conexão.

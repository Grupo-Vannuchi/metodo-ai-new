# Conversas (Oficial): WhatsApp pela API oficial da Meta — design

**Data:** 2026-09-28 · **Status:** aprovado em conversa, aguardando revisão desta spec.
**Origem:** passos 2 (teste técnico) e 4 (desenvolvimento) do *Plano de execução: API oficial do
WhatsApp Business* (28/09/2026) e do *Relatório executivo* (25/09/2026).
**Branch:** `feature/change-provider-to-whatsapp-official`.

---

## 1. Problema

O WhatsApp do MétodoAI funciona hoje por conexão não oficial (QR code, via Evolution). Ela pode
cair e expõe os números dos clientes a banimento. A decisão de negócio é migrar para a **API
oficial (WhatsApp Cloud API), conectando o MétodoAI direto na Meta**, sem a Evolution no meio.

O inbox atual depende da Evolution de ponta a ponta — envio (`sendMessage` exige
`provider: "EVOLUTION"`), webhook (`/api/webhooks/evolution/...`), mídia (`getBase64FromMediaMessage`)
e agente de IA. O único código de Meta que existe é o adaptador `META_CLOUD` de campanhas, que só
envia **texto livre** (a Meta recusa fora da janela de 24h) e está preso na Graph **v20.0**, expirada
em 24/09/2026. O webhook genérico `/api/webhooks/[provider]` não tem o `GET` de verificação que a
Meta exige e não verifica assinatura (`TODO(P9)`).

## 2. Objetivo e critério de sucesso

Uma tela nova, **"Conversas (Oficial)"**, em que o vendedor conecta o próprio número oficial,
recebe e responde clientes, envia anexos e modelos aprovados, respeitando a janela de 24h — e
campanhas que disparam modelos aprovados por esse número. **Nada muda para quem não está liberado.**

**Pronto quando** (critério do passo 2 do Plano): com o número de teste da Meta, o fluxo completo
funciona — receber texto e mídia, responder, anexo, citar, reagir, janela de 24h, enviar modelo,
nova conversa e uma campanha pequena — e as cinco validações do repositório passam.

## 3. Decisões tomadas (com o usuário, 28/09/2026)

| Tema | Decisão |
|---|---|
| Convivência com a tela atual | **Tela separada**, item de menu próprio. A tela Conversas (Evolution) fica intacta. Quando a migração terminar (passo 9 do Plano), a nova assume o lugar da antiga. |
| Arquitetura | **Código novo e tabelas novas.** Não reaproveita `Conversation`/`Message`. |
| Dono do número | **Por vendedor**, como hoje: cada usuário conecta o próprio número oficial e só ele vê as conversas. Pode ter 1 Evolution + 1 oficial. |
| Conexão do número | **Credenciais manuais** (Phone Number ID, WABA ID, token, PIN opcional). Embedded Signup fica para depois do credenciamento como Tech Provider. |
| Liberação | **Só empresas listadas** em `WHATSAPP_CLOUD_ORG_IDS`. Lista vazia = ninguém vê nada. |
| Escopo v1 | Núcleo + **anexos** + **responder/reagir** + **campanhas oficiais**. |
| Agente de IA | **Próxima etapa** (o Financeiro revisa o preço do módulo IA antes — passo 3 do Plano). |

Abordagens descartadas: refatorar o inbox atual para uma camada de provedor antes (mexe em todos os
caminhos atuais antes de entregar algo) e usar a Cloud API através da Evolution (lacunas levantadas
em 25/09: sem verificação de assinatura, sem BSUID, erros da Meta engolidos com 2xx, entre outras).

## 4. Fatos da Meta que moldam o desenho (verificados em 28/09/2026)

Documentação em `developers.facebook.com/documentation/business-messaging/whatsapp` (o antigo
`/docs/whatsapp` redireciona para lá).

- **Graph API:** mais nova é **v26.0** (29/07/2026); v21–v25 seguem suportadas. Versão fica em
  `META_GRAPH_VERSION`, padrão `v26.0`.
- **BSUID:** todo webhook traz `contacts[].user_id` e `messages[].from_user_id` (formato `CC.<id>`).
  O telefone (`wa_id`/`from`) **pode faltar** para quem adotou nome de usuário. Enviar para um BSUID
  usa `"recipient": "<BSUID>"` no lugar de `"to"`. O BSUID muda se o usuário troca de telefone
  (webhook `user_id_update`).
- **Número incluído pela API** precisa de `POST /{phone-number-id}/register` (PIN de 6 dígitos da
  verificação em duas etapas; limite de 10 tentativas por 72h) e de
  `POST /{waba-id}/subscribed_apps`, sem o qual nenhum webhook chega.
- **Webhook:** `GET` com `hub.mode`/`hub.verify_token`/`hub.challenge`; `POST` assinado com
  `X-Hub-Signature-256: sha256=<hex>` (HMAC-SHA256 com o App Secret). Sem 200, a Meta reenvia por
  até **7 dias** — deduplicar é obrigatório. Pede resposta rápida (p50 < 250 ms).
- **Mídia recebida:** o `id` vale **7 dias**; a URL de download vale **5 minutos** e exige o token.
  Formatos aceitos: imagem JPEG/PNG até 5 MB; vídeo MP4/3GP até 16 MB; áudio AAC/AMR/MP3/M4A/OGG-Opus
  até 16 MB; documento PDF/DOC(X)/XLS(X)/PPT(X)/TXT até 100 MB; figurinha WebP. **GIF não.**
- **Status:** `sent`/`delivered`/`read`/`failed`/`played`, com `errors[]` em falhas e `pricing`
  (`type`, `category`) em `sent` e em um de `delivered`/`read`. Reações só recebem `sent`.
- **Cobrança:** a partir de **1º/10/2026** mensagens de atendimento dentro da janela são cobradas
  (Brasil ≈ US$ 0,0068). Marketing é mais caro.
- **Limites:** por portfólio, em faixas (250 → 2K → 10K → 100K → ilimitado) de **contatos únicos
  fora da janela por 24h**; 80 mensagens/s por número; 1 mensagem a cada 6 s para o mesmo contato.
- **Embedded Signup** v2 e v3 são desligados em **15/10/2026** (não afeta esta entrega).

## 5. Arquitetura

### 5.1 Onde fica cada coisa (tudo novo)

| Peça | Local |
|---|---|
| Tela | `src/app/[locale]/app/inbox-oficial/page.tsx` — configuração do número em `?config=1` (engrenagem), como na tela atual |
| Componentes | `src/components/inbox-oficial/` — lista, conversa, campo de envio, seletor de modelo, faixa da janela, formulário do número. Arquivos pequenos e focados; reaproveita só peças visuais soltas (ex.: `audio-player.tsx`) |
| Rotas de API | `src/app/api/inbox-oficial/` — `conversations`, `messages`, `media/fetch` (sob demanda), `media/upload` (anexo) |
| Escrita | `src/app/actions/inbox-oficial.ts` |
| Leitura | `src/lib/queries/inbox-oficial.ts` (sempre `tenantDb`) |
| Integração Meta | `src/lib/whatsapp-cloud/` — ver 5.2 |
| Webhook | `src/app/api/webhooks/whatsapp-cloud/route.ts` (`GET` verificação + `POST` assinado) |
| Testes | `src/lib/whatsapp-cloud/__tests__/*.test.ts` + fixtures dos exemplos da documentação |

### 5.2 `src/lib/whatsapp-cloud/`

Unidades pequenas, cada uma com um propósito. As marcadas **puras** não importam banco nem
`server-only` — são as cobertas pela suíte de testes.

| Arquivo | Responsabilidade |
|---|---|
| `graph.ts` | Cliente da Graph API: monta URL com `META_GRAPH_VERSION`, faz a chamada com o token, devolve `{ ok, data }` ou `{ ok: false, code, message }` a partir do corpo de erro da Meta. Nunca loga o token. |
| `signature.ts` (**pura**) | `verifySignature(rawBody, header, appSecret)` — HMAC-SHA256, `timingSafeEqual`, fail-closed. |
| `webhook-parser.ts` (**puro**) | Payload da Meta → lista de eventos normalizados: `message`, `reaction`, `status`, `template_status`, `user_id_update`. Um evento por item; ignora o que não reconhece. |
| `window.ts` (**pura**) | Janela de 24h: `isWindowOpen(lastInboundAt, now)` e `windowClosesAt(...)`. |
| `errors.ts` (**pura**) | Código da Meta → categoria (`window_closed`, `undeliverable`, `rate_limited`, `pair_rate_limited`, `marketing_opt_out`, `marketing_limited`, `template_paused`, `template_disabled`, `token_invalid`, `not_registered`, `account_restricted`, `invalid_params`, `unknown`) + se vale tentar de novo. |
| `template-params.ts` (**pura**) | Modelo + mapeamento de variáveis + contato → `components` do envio e texto final para exibir. Suporta `POSITIONAL` e `NAMED`; recusa modelos com cabeçalho de mídia ou botão com variável (fora do v1). |
| `media-rules.ts` (**pura**) | Tipo/tamanho aceitos pela Meta por categoria de mídia. |
| `numbers.ts` | Conectar (ler número, inscrever app, registrar), trocar token, desconectar, remover. Carrega/decifra o token para uso no servidor. |
| `ingest.ts` | Grava eventos do webhook (sistema, Prisma cru, `organizationId` vindo do número). |
| `send.ts` | Envio de texto, mídia, reação, modelo e confirmação de leitura; grava a mensagem e trata erros. |
| `media.ts` | Download da mídia recebida (Meta → `putMedia`) e upload de anexo (→ `POST /{phone-number-id}/media`). |
| `templates.ts` | Sincronização dos modelos (`GET /{waba-id}/message_templates`, paginado). |
| `campaign.ts` | Lote de disparo das campanhas oficiais (§8). |
| `rollout.ts` | `isWhatsappCloudEnabled(organizationId)` — **único** ponto que lê `WHATSAPP_CLOUD_ORG_IDS`. |

### 5.3 Acesso e liberação

- Tela nova com chave **`inboxOficial`** (camelCase, mesma chave do menu e de `app.nav.*`): entra em `GATEABLE_SCREENS` (`src/config/screens.ts`)
  e em `screens` do módulo `inbox` (`src/config/modules.ts`). Modelos de acesso existentes não a
  incluem — MEMBER com modelo de acesso só a vê se um admin conceder; OWNER/ADMIN e MEMBER sem
  modelo a veem (comportamento padrão de `resolveAllowedScreens`).
- **Liberação** por cima do gating de módulo/tela: `isWhatsappCloudEnabled(orgId)`. Consultado por
  menu (`app-shell.tsx` filtra a chave quando a empresa não está liberada), página (`notFound()`),
  rotas de API (404) e actions (erro `not_enabled`). Nenhum outro lugar lê a variável.
- **Por vendedor:** toda leitura e escrita da tela filtra pelos números com `ownerId = ctx.userId`.
  Enviar, reagir, marcar lida e baixar mídia checam que a conversa pertence a um número do usuário.

### 5.4 Variáveis de ambiente (em `src/lib/env.ts`, todas opcionais)

| Variável | Uso | Ausente |
|---|---|---|
| `META_APP_SECRET` | verificar `X-Hub-Signature-256` | webhook recusa todo `POST` (401) |
| `META_WEBHOOK_VERIFY_TOKEN` | responder à verificação do webhook | webhook recusa todo `GET` (403) |
| `META_GRAPH_VERSION` | versão da Graph API | usa `v26.0` |
| `WHATSAPP_CLOUD_ORG_IDS` | lista de `organizationId` liberados, separada por vírgula | ninguém é liberado |

## 6. Dados

Uma migration **só aditiva** (cria enum e tabelas). **Nenhuma tabela existente muda.** Os cinco
modelos novos têm `organizationId` e entram em `TENANT_MODELS` (`src/lib/tenant-db.ts`).
`scripts/check-isolation.ts` ganha uma asserção para `WhatsappCloudConversation`.

Enums reaproveitados (só tipos): `MessageDirection`, `MessageStatus`, `MediaStatus`,
`ConnectionStatus`. Enum novo: `WhatsappCloudMessageType` (o atual não tem "modelo").

```prisma
enum WhatsappCloudMessageType {
  TEXT
  IMAGE
  AUDIO
  VIDEO
  DOCUMENT
  STICKER
  LOCATION
  TEMPLATE
  UNSUPPORTED
}

/// Número oficial conectado por um vendedor. O token fica cifrado (crypto.ts).
model WhatsappCloudNumber {
  id                 String           @id @default(cuid())
  organizationId     String
  ownerId            String
  phoneNumberId      String           @unique
  wabaId             String
  displayPhoneNumber String?
  verifiedName       String?
  qualityRating      String?
  accessTokenEnc     String
  status             ConnectionStatus @default(INACTIVE)
  lastError          String?
  checkedAt          DateTime?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  conversations WhatsappCloudConversation[]

  @@unique([organizationId, ownerId])
  @@index([organizationId])
  @@map("whatsapp_cloud_numbers")
}

/// Conversa com um cliente. Identidade: bsuid (sempre vem da Meta) e/ou waId (telefone, opcional).
model WhatsappCloudConversation {
  id                 String    @id @default(cuid())
  organizationId     String
  numberId           String
  bsuid              String?
  waId               String?
  username           String?
  profileName        String?
  contactId          String?
  lastInboundAt      DateTime?
  lastMessageAt      DateTime?
  lastMessagePreview String?
  unreadCount        Int       @default(0)
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  number   WhatsappCloudNumber    @relation(fields: [numberId], references: [id], onDelete: Cascade)
  messages WhatsappCloudMessage[]

  @@unique([numberId, bsuid])
  @@unique([numberId, waId])
  @@index([organizationId, lastMessageAt])
  @@map("whatsapp_cloud_conversations")
}

model WhatsappCloudMessage {
  id               String                   @id @default(cuid())
  organizationId   String
  conversationId   String
  wamid            String?
  direction        MessageDirection
  type             WhatsappCloudMessageType @default(TEXT)
  body             String?
  templateName     String?
  templateLanguage String?
  /// Extras por tipo: coordenadas, anúncio de origem (referral), etc.
  payload          Json                     @default("{}")
  mediaId          String?
  mediaUrl         String?
  mediaMime        String?
  mediaName        String?
  mediaSize        Int?
  mediaStatus      MediaStatus?
  status           MessageStatus?
  errorCode        Int?
  errorMessage     String?
  pricingCategory  String?
  pricingType      String?
  reactions        Json                     @default("[]")
  quotedWamid      String?
  quotedBody       String?
  sentById         String?
  campaignId       String?
  timestamp        DateTime
  createdAt        DateTime                 @default(now())

  conversation WhatsappCloudConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, wamid])
  @@index([conversationId, timestamp])
  @@map("whatsapp_cloud_messages")
}

/// Modelo aprovado/pendente/rejeitado, sincronizado da Meta por WABA.
model WhatsappCloudTemplate {
  id              String   @id @default(cuid())
  organizationId  String
  wabaId          String
  metaId          String
  name            String
  language        String
  category        String
  status          String
  parameterFormat String
  components      Json
  rejectedReason  String?
  syncedAt        DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, wabaId, name, language])
  @@map("whatsapp_cloud_templates")
}

/// Vínculo 1-para-1 com uma Campaign existente: o que é da API oficial.
model WhatsappCloudCampaign {
  id             String   @id @default(cuid())
  organizationId String
  campaignId     String   @unique
  numberId       String
  templateId     String
  /// Por variável do modelo: { source: "nome" | "empresa" | "fixo", value?: string }
  params         Json     @default("{}")
  /// Por que a campanha foi pausada automaticamente (mostrado na página dela).
  pausedReason   String?
  createdAt      DateTime @default(now())

  @@index([organizationId])
  @@index([templateId])
  @@map("whatsapp_cloud_campaigns")
}
```

Notas:
- `@@unique([numberId, bsuid])` e `@@unique([numberId, waId])` convivem com `NULL` (o Postgres
  aceita vários `NULL` num índice único), então uma conversa pode existir só com telefone (iniciada
  por nós) ou só com BSUID (cliente com nome de usuário).
- `whatsapp_cloud_campaigns` referencia `campaigns.id`, `whatsapp_cloud_numbers.id` e
  `whatsapp_cloud_templates.id` **sem** relação Prisma no model `Campaign` — assim o model existente
  não ganha nem um campo de relação. A limpeza ao apagar uma campanha é feita pela action
  (`deleteMany` do vínculo junto).

## 7. Fluxos

### 7.1 Conectar o número (engrenagem)

1. Formulário: **Phone Number ID**, **WABA ID**, **token** e **PIN** (opcional; não é guardado).
2. `numbers.connect`, na ordem — se qualquer passo falhar, mostra a mensagem da Meta e não grava
   o número como ativo:
   1. `GET /{phone-number-id}?fields=display_phone_number,verified_name,quality_rating` — valida
      token e ID e traz os dados de exibição;
   2. `POST /{waba-id}/subscribed_apps` — idempotente;
   3. `POST /{phone-number-id}/register` com o PIN, se informado.
3. Limite: 1 número oficial por usuário por empresa; o total de números de WhatsApp da empresa
   (Evolution + oficiais) respeita `LIMITS.whatsappNumbersLimit` (10). `countWhatsappConnections`
   em `src/lib/queries/connections.ts` passa a somar os números oficiais, para o fluxo antigo
   também enxergar o total.
4. Grava com token cifrado e `status: ACTIVE`; sincroniza os modelos da WABA.
5. Depois de conectado: **trocar token** (campo em branco mantém o atual; revalida com o passo 2.1),
   **atualizar dados** (repete 2.1), **desconectar** (`INACTIVE`, mantém conversas) e **remover**
   (confirmação; apaga conversas, mensagens e as mídias do armazenamento — LGPD).

### 7.2 Receber (`/api/webhooks/whatsapp-cloud`)

- **`GET`:** `hub.mode === "subscribe"` e `hub.verify_token === META_WEBHOOK_VERIFY_TOKEN` → 200
  com `hub.challenge` cru; senão 403.
- **`POST`:**
  1. Lê o corpo cru; `verifySignature` falhou → 401, nada é processado.
  2. `webhook-parser` gera os eventos. Para cada `changes[].value`, o
     `metadata.phone_number_id` resolve o `WhatsappCloudNumber` (e com ele o `organizationId`).
     Número desconhecido → ignora.
  3. Por evento (`ingest.ts`):
     - **message:** acha a conversa por `bsuid`, depois por `waId`; cria se não existir e preenche o
       identificador que faltava. Grava a mensagem (conflito no `wamid` = reenvio → ignora). Atualiza
       `lastInboundAt`, `lastMessageAt`, prévia, `unreadCount + 1` e `profileName`/`username`.
       Mídia entra com `mediaId` e `mediaStatus: PENDING`. Resposta citando outra → `quotedWamid` +
       `quotedBody` (snapshot da mensagem citada, se estiver no banco).
     - **Contato do CRM:** com telefone, liga ao contato com o mesmo telefone ou cria um (mesma
       regra da tela atual — `resolveContactId` passa a ser exportada de `src/lib/whatsapp/ingest.ts`,
       sem mudar o comportamento). Só com BSUID, **não** cria contato.
     - **reaction:** aplica em `reactions` da mensagem-alvo; emoji ausente = remove a reação do cliente.
     - **status:** avança só para frente (reutiliza `resolveTransition` de
       `src/lib/integrations/webhooks/delivery.ts`); grava `errorCode`/`errorMessage` e
       `pricingCategory`/`pricingType`; preenche `bsuid`/`waId` da conversa se faltavam; chama
       `applyCampaignDeliveryUpdates` (existente) para destinatários de campanha.
     - **template_status:** atualiza `WhatsappCloudTemplate.status`/`rejectedReason`; `PAUSED` ou
       `DISABLED` pausa as campanhas oficiais `RUNNING` que usam o modelo.
     - **user_id_update:** troca `bsuid` anterior pelo atual nas conversas.
  4. Responde 200. Falha de processamento → `console.error("[wa-cloud] ...")`, nunca 500.
- Não grava em `WebhookEvent`: a deduplicação é pela unicidade do `wamid`, e uma campanha de 10 mil
  contatos gera ~30 mil webhooks de status.

### 7.3 Mídia recebida

- Com QStash configurado: job novo `whatsapp-cloud-media` (registrado em `src/lib/jobs/index.ts`)
  logo após gravar a mensagem. Sem QStash: download disparado sem `await` depois da gravação (o
  processo Node é persistente no Passenger — mesmo padrão do agente de IA).
- Download: `GET /{media-id}` → URL (5 min) → bytes com o token → `putMedia` → `mediaUrl`,
  `READY`. Falhou → `FAILED`, com nova tentativa sob demanda.
- Sob demanda: a tela chama `POST /api/inbox-oficial/media/fetch` ao exibir uma mídia `PENDING` ou
  `FAILED` (enquanto o `mediaId` tiver menos de 7 dias).
- Exibição e exclusão reaproveitam o armazenamento atual (`src/lib/storage/blob.ts`).

### 7.4 Enviar

Toda action: sessão → liberação → conversa pertence a número do usuário → número `ACTIVE`.
Destino: `to: waId` quando há telefone; senão `recipient: bsuid`.

| Ação | Regras |
|---|---|
| **Texto** | Só com janela aberta (checado no servidor por `lastInboundAt`). Até 4.096 caracteres. Resposta citando outra → `context.message_id`. |
| **Anexo** | Upload para `POST /api/inbox-oficial/media/upload` (sessão + liberação + dono), que valida tipo e tamanho pelo conteúdo do arquivo e por `media-rules.ts`, guarda com `putMedia` (para exibir) e sobe para a Meta (`POST /{phone-number-id}/media`) → envia por `id`. Legenda em imagem, vídeo e documento; nome do arquivo em documento. Só com janela aberta. GIF e formatos fora da tabela são recusados com mensagem clara. |
| **Reação** | Em mensagens com até 30 dias; tocar no mesmo emoji remove. Espelha localmente mesmo se a Meta falhar, como a tela atual. |
| **Modelo** | Qualquer momento. Lista só modelos `APPROVED` da WABA do número; variáveis pré-preenchidas (nome do contato); prévia; grava a mensagem como `TEMPLATE` com o texto final. |
| **Nova conversa** | Contato do CRM (com telefone) ou número digitado. Janela começa fechada → o primeiro envio é um modelo. |
| **Marcar lida** | Ao abrir a conversa: `unreadCount = 0` e `status: read` para o `wamid` da última mensagem do cliente (se tiver até 30 dias). Falha aqui não é erro para o usuário. |

A mensagem só é gravada depois que a Meta aceita (`SENT` + `wamid`); se a Meta recusa, nada é
gravado e o erro volta para a tela como aviso (sem bolha órfã). Mensagem
`held_for_quality_assessment` na resposta conta como enviada.

### 7.5 Modelos

- Sincronizados ao conectar, pelo botão "Sincronizar modelos" na engrenagem e, para status, pelo
  webhook. Criar modelo continua sendo no **WhatsApp Manager** da Meta (fora do v1).
- Na engrenagem, lista de modelos com status e motivo de rejeição.

### 7.6 A tela

- Lista de conversas à esquerda (nome do contato do CRM → `profileName` → `username` → telefone),
  atualizada por polling a cada ~10 s; conversa aberta a cada ~4 s.
- Faixa da janela: "Janela aberta · fecha em 5h12" / "Janela fechada — envie um modelo aprovado
  para retomar". Janela fechada trava o campo de texto e destaca "Enviar modelo".
- Sem foto de perfil (a Meta não fornece): iniciais.
- Número com status de erro → faixa no topo com o motivo e atalho para a engrenagem.
- Sem número conectado → cartão de conexão no lugar da lista.

## 8. Campanhas oficiais

**Princípio:** quem não está liberado não percebe diferença nenhuma. A separação no código é por
existência do vínculo `WhatsappCloudCampaign`.

### 8.1 Criar

- Em `/app/campaigns/new`, o servidor resolve e passa para o formulário `cloud: { enabled, templates }`
  — `enabled` só quando a empresa está liberada **e** o usuário tem número oficial `ACTIVE`.
- Com `enabled`, a opção de canal `WHATSAPP_CLOUD` aparece como **"WhatsApp Oficial"** e troca o
  seletor de modelo interno pelo seletor de **modelo aprovado da Meta** + mapeamento de cada variável
  (nome do contato, empresa ou texto fixo) + prévia com um contato real do público + aviso com o
  limite atual do número na Meta (`whatsapp_business_manager_messaging_limit`) ao lado do tamanho do
  público. Sem `enabled`, o formulário é exatamente o de hoje.
- Modelos com cabeçalho de mídia ou botão com variável aparecem desabilitados com o motivo.
- Action nova `createCloudCampaign`: mesmo público e mesmos filtros de `createCampaign`
  (`audienceWhere`, já exportada de `src/lib/queries/campaigns.ts`), grava `Campaign`
  (`channel: WHATSAPP_CLOUD`, `templateId: null`), os `CampaignRecipient` e o
  `WhatsappCloudCampaign` com o número do criador.

### 8.2 Disparar

- `startCampaign` e `dispatchCampaignBatch` ganham um desvio no início: campanha com vínculo
  `WhatsappCloudCampaign` → `whatsapp-cloud/campaign.ts`; sem vínculo → caminho atual, inalterado.
- Número: o do vínculo (o do criador). Número inativo ou com erro → campanha pausa.
- Ritmo: lotes de 25, próximo lote em 2–5 s. A cota mensal (`LIMITS.dispatchQuotaPerMonth`) vale
  igual. Sem QStash, roda em processo (`dispatchCampaignToCompletion`), como hoje.
- Cada envio grava também a mensagem `TEMPLATE` (com `campaignId`) na conversa oficial do número,
  criando a conversa pelo telefone se preciso — a resposta do cliente chega com contexto.
- Erros da Meta (via `errors.ts`):

| Categoria | Efeito |
|---|---|
| `rate_limited` (130429) | para o lote, tenta de novo em 60 s |
| `pair_rate_limited` (131056) | destinatário volta para a fila, tenta no próximo lote |
| `template_paused` / `template_disabled` (132015/132016) | **pausa a campanha** |
| `token_invalid` (190) | **pausa a campanha** e marca o número com erro |
| `undeliverable` (131026) | destinatário `FAILED`: "Número não recebe WhatsApp." |
| `marketing_opt_out` (131050) | destinatário `FAILED`: "Contato optou por não receber marketing." |
| `marketing_limited` (131049) | destinatário `FAILED`: "A Meta limitou mensagens de marketing para este contato." |
| `invalid_params` (132000/131009) | destinatário `FAILED` com o detalhe da Meta |

- Status de entrega pelos webhooks (§7.2) atualizam `CampaignRecipient` pela função existente.

### 8.3 Editar e apagar

- `updateCampaign` com vínculo: só o nome muda (o formulário de edição mostra o modelo como leitura).
- `deleteCampaign` com vínculo: apaga o vínculo junto.

## 9. Segurança

- Assinatura do webhook sobre os bytes crus, com `timingSafeEqual`; `GET` e `POST` fail-closed.
- Token cifrado (AES-256-GCM, `src/lib/integrations/crypto.ts`), decifrado só na chamada à Meta,
  nunca enviado ao navegador nem logado.
- Toda rota e action nova: `getOrgContext()` → `isWhatsappCloudEnabled` → dono do número. Leitura
  e escrita de usuário via `tenantDb`; trabalho por id com `findFirst` + `updateMany`/`deleteMany`
  checando `count === 0` (guia 03). Webhook e jobs: Prisma cru com `organizationId` explícito.
- Upload: exige sessão, confere tipo pelo conteúdo (não pela extensão) e tamanho no servidor.

## 10. Mudanças em código existente

Todas sem efeito para quem não está liberado:

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` + migration | só modelos e enum novos (§6) |
| `src/lib/tenant-db.ts` | 5 modelos novos em `TENANT_MODELS` |
| `src/lib/env.ts` | 4 variáveis opcionais (§5.4) |
| `src/config/screens.ts`, `src/config/modules.ts`, `settings/access/page.tsx` | tela `inboxOficial` (a página de modelos de acesso também filtra pela liberação) |
| `src/components/app/app-shell.tsx`, `app-nav.tsx`, `back-bar.tsx` | item de menu, filtrado pela liberação |
| `src/messages/pt.json`, `en.json` | chaves novas, com paridade |
| `src/lib/queries/connections.ts` | `countWhatsappConnections` soma os números oficiais |
| `src/lib/whatsapp/ingest.ts` | `export` em `resolveContactId` |
| `src/lib/jobs/index.ts` | job `whatsapp-cloud-media` |
| `src/lib/dispatch.ts`, `src/app/actions/campaigns.ts` | desvio para campanhas com vínculo (`startCampaign`, `dispatchCampaignBatch`, `deleteCampaign`) |
| `src/app/[locale]/app/campaigns/new` e edição, `campaign-form.tsx`, `campaign-edit-form.tsx` | props `cloud` resolvidas no servidor |
| `scripts/check-isolation.ts` | asserção da tabela de conversas oficiais |
| `package.json` | script `test:wa-cloud` |
| README (§6, §7) e guias 03, 04, 05, 06 | documentação no mesmo commit da mudança correspondente |

**Não muda:** tela Conversas atual, inbox/actions/webhook da Evolution, agente de IA, adaptador
`meta-cloud.ts` antigo (Graph v20 — correção separada), webhook genérico `[provider]`.

## 11. Testes e verificação

- **Suíte nova** — a primeira do repositório: `node:test` + `tsx` (já é dependência), sem pacote
  novo. `npm run test:wa-cloud` roda `src/lib/whatsapp-cloud/__tests__/`. Cobre as unidades puras:
  assinatura (válida, inválida, sem segredo, tamanho diferente), parser (fixtures da documentação:
  texto, imagem, áudio, documento, localização, reação e remoção, resposta citando, status `failed`
  com `errors[]`, status com `pricing`, cliente só com BSUID, `message_template_status_update`,
  `user_id_update`), janela de 24h, tradução de erros, montagem de parâmetros (`POSITIONAL` e `NAMED`,
  modelo não suportado) e regras de mídia. Documentada no guia 06; **fora** da lista obrigatória de
  cinco validações.
- **As cinco validações** de sempre passam (`typecheck`, `lint`, `build`, `check:isolation`,
  `check:node`).
- **Ponta a ponta (passo 2 do Plano)**, com número de teste da Meta + ngrok, roteiro:
  verificação do webhook; receber texto, imagem, áudio, documento; responder; citar; reagir;
  anexo; janela fechada bloqueia texto; modelo reabre; nova conversa por número; campanha com
  2–3 contatos (status entregue/lido); assinatura inválida recusada; empresa fora da lista não vê a
  tela e recebe 404 nas rotas; tela Conversas atual segue funcionando.

## 12. Implantação

1. Migration aplicada no Supabase **antes** do merge na `main` (cria tabelas vazias; inofensiva).
2. Variáveis na Hostinger: `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` e
   `WHATSAPP_CLOUD_ORG_IDS` (começa vazia ou só com a empresa MétodoAI).
3. Merge: `feature/...` → `dev` → PR para a `main` com CI verde.
4. Ligar uma empresa = editar `WHATSAPP_CLOUD_ORG_IDS`.

### Configurar a Meta (vira seção do README para quem assumir)

1. **App** no Meta for Developers com o produto WhatsApp → *Configurações do app → Básico*: App
   Secret → `META_APP_SECRET`.
2. **Webhook** em *WhatsApp → Configuração*: URL de retorno
   `https://metodotia.com/api/webhooks/whatsapp-cloud` (em dev, a URL do ngrok), token de
   verificação = `META_WEBHOOK_VERIFY_TOKEN`; assinar os campos `messages`,
   `message_template_status_update` e `user_id_update`.
3. **Token permanente:** Gerenciador de Negócios → *Usuários do sistema* → criar (admin) → atribuir o
   app e a WABA → gerar token com `whatsapp_business_messaging` e `whatsapp_business_management`.
   (O token da tela *Configuração da API* expira em 24h — serve só para um teste rápido.)
4. **Número de teste:** cadastrar até 5 números de destino em *Configuração da API*.
5. **Número real:** definir o PIN de verificação em duas etapas; informar no formulário de conexão.

## 13. Riscos

- **Volume de webhook:** ~3 status por mensagem enviada. A rota só grava e responde; o índice por
  `(organizationId, wamid)` mantém a busca barata.
- **Deploy derruba o site 30–60 s:** a Meta reenvia por até 7 dias; a unicidade do `wamid` absorve.
- **Limite de números da Meta:** 2 por portfólio antes da verificação da empresa, 20 depois — o
  piloto por vendedor esbarra nisso antes da verificação (passo 1 do Plano).
- **Faixa de mensagens:** portfólio novo alcança 250 contatos novos por 24h; campanha maior é
  segurada/recusada pela Meta. O formulário avisa; não bloqueia.
- **Custo:** mensagens de atendimento cobradas a partir de 1º/10. `pricingCategory` permite medir
  no piloto (passo 6 do Plano).

## 14. Fora de escopo (próximas etapas, cada uma com design próprio)

- Agente de IA no número oficial.
- Embedded Signup (depende do credenciamento como Tech Provider).
- Criar e submeter modelos pela plataforma (biblioteca do Marketing).
- Opt-out automático ("Parar de receber" → etiqueta e exclusão de campanhas futuras).
- Estimativa de custo em reais no formulário de campanha.
- Gravação de áudio pelo navegador (WebM → OGG/Opus).
- Modelos com cabeçalho de mídia ou botões com variável.
- Grupos, coexistência com o app WhatsApp Business (`smb_message_echoes`, histórico).
- Pastas, fixar, renomear, exportar; contador no menu; atualização instantânea (SSE); busca global
  e página do contato mostrando conversas oficiais.
- Migração de histórico e fotos das conversas da Evolution (passo 8 do Plano).
- Atualizar a versão do adaptador `meta-cloud.ts` antigo.

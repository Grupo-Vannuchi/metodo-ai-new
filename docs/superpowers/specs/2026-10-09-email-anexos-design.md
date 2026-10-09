# Anexos no E-mail em massa — design

**Data:** 2026-10-09 · **Status:** design aprovado em conversa; spec aguardando revisão.
**Complementa:** `2026-10-06-email-em-massa-design.md` e `2026-10-08-email-dominios-plataforma-design.md`.
Nada do que elas definem muda quando o envio **não** tem anexo.

---

## 1. Objetivo

Em **Comunicação → E-mail**, quem monta um envio pode anexar vários arquivos dos tipos que os
provedores de e-mail aceitam. Os mesmos anexos vão para todos os destinatários daquele envio.

**Critério de sucesso:**
- um envio com um PDF, uma imagem e um `.docx` chega com os três anexos abertos no Gmail e no
  Outlook;
- `.zip`, `.exe` e conjuntos acima de 10 MB são recusados na tela, com o motivo;
- um envio interrompido e retomado não manda o e-mail duas vezes para ninguém;
- um envio sem anexo continua saindo em lotes de 100, sem nenhuma mudança.

## 2. Decisões tomadas com o usuário

| Decisão | Escolha |
|---|---|
| Uso esperado | **Listas pequenas** (até algumas centenas): proposta, catálogo, documento para a carteira de clientes. |
| Anexo de verdade ou link | **Anexo de verdade** em qualquer envio. Não há troca automática por link. |
| Muitos destinatários com anexo | **Deixa enviar, com aviso** do tempo estimado na confirmação. Sem bloqueio. |
| Tamanho máximo | **10 MB somando todos os anexos** de um envio. |
| Quantidade máxima | **10 arquivos.** |
| Tipos | **Lista fechada** (§5). Tudo fora dela é recusado. |
| Como o arquivo chega ao Resend | **Abordagem A:** o servidor baixa o arquivo do armazenamento uma vez por execução e manda o conteúdo (base64) dentro de cada e-mail. Descartada a B, `path` com URL, em que o Resend baixa o arquivo sozinho: ela gasta a cota de transferência do Supabase a cada destinatário e não funciona no ambiente local. |

## 3. Fora do escopo

- Anexo diferente por destinatário (ex.: o boleto de cada cliente).
- Troca automática de anexo por link de download.
- Rotina de limpeza de arquivos sem uso no armazenamento.
- "Enviar teste" (não existe hoje no E-mail e não entra aqui).
- Qualquer mudança em Campanhas ou nos e-mails transacionais (`src/lib/email/`).

## 4. Por que o envio com anexo é diferente

O endpoint de lote do Resend (`/emails/batch`), usado hoje para mandar 100 e-mails por chamada,
**não aceita anexos** ("The `attachments` field is not supported yet"). Com anexo, cada destinatário
vira uma chamada a `/emails`. O ritmo continua em ~2 requisições/s somando todos os envios em
andamento (`PACE_MS = 500` em `dispatch.ts`), então um envio com anexo sai a ~2 e-mails/s:

| Destinatários | Sem anexo | Com anexo |
|---|---|---|
| 300 | ~2 s | ~2,5 min |
| 1.000 | ~5 s | ~8 min |
| 10.000 | ~50 s | ~1h25 |

Enquanto roda, ele divide esse ritmo com os envios das outras empresas, que ficam mais lentos na
mesma proporção. O e-mail transacional (login, reset) não é afetado, porque o total de
requisições/s não muda.

## 5. Regras dos arquivos

**Tipos aceitos** (pela extensão, sem diferenciar maiúsculas; o `content_type` mandado ao Resend
sai desta tabela, nunca do navegador):

| Grupo | Extensões |
|---|---|
| Documentos | `.pdf`, `.doc`, `.docx`, `.odt`, `.rtf`, `.txt` |
| Planilhas | `.xls`, `.xlsx`, `.ods`, `.csv` |
| Apresentações | `.ppt`, `.pptx`, `.odp` |
| Imagens | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp` |

Ficam de fora de propósito:
- executáveis e scripts, que Gmail e Outlook bloqueiam;
- compactados (`.zip`, `.rar`, `.7z`), tratados com desconfiança pelos filtros de spam em envio em
  massa e recusados pelo Gmail quando trazem executáveis dentro;
- Office com macro (`.docm`, `.xlsm`, `.pptm`).

**Limites:**
- até **10 arquivos**;
- até **10 MB no total** (10 × 1024 × 1024 bytes);
- cada arquivo, sozinho, também até 10 MB.

O limite de 10 MB vem da entrega: servidores de e-mail de empresas costumam recusar mensagens
acima disso, e o anexo cresce ~33% em base64. O teto do Resend é 40 MB por e-mail depois do base64.

**Nome do arquivo:**
- o nome original (com acentos) é o que aparece na tela e no e-mail do destinatário;
- antes de guardar, tiram-se barras, caracteres de controle e espaços nas pontas, e o nome é
  cortado em 150 caracteres sem perder a extensão;
- a chave no armazenamento usa uma versão só com `[A-Za-z0-9._-]`.

## 6. Tela

**Composer** (`/app/email/new` e `/app/email/[id]/edit`):
- Abaixo do corpo do e-mail, uma seção **Anexos** com o botão "Adicionar arquivos", que aceita
  vários de uma vez (`<input type="file" multiple accept="...">` com as extensões da §5).
- Antes de subir, a tela confere tipo, tamanho, quantidade e total com as mesmas regras puras do
  servidor (§9). O que não passa não sobe e mostra o motivo: "Arquivo .zip não é aceito",
  "Passa do limite de 10 MB", "No máximo 10 arquivos".
- Os arquivos sobem **um por requisição**, em sequência. Enquanto sobe, a linha mostra "Enviando…".
  Uma falha mostra aviso e o arquivo não entra na lista.
- Enquanto houver arquivo subindo, "Salvar rascunho" e "Revisar e enviar" ficam desabilitados, para
  o rascunho não ser salvo sem o anexo.
- Cada anexo aparece numa linha com nome, tamanho e botão de remover. Embaixo, o contador
  "3 arquivos · 4,2 MB de 10 MB".
- Com pelo menos um anexo, aparece um aviso fixo na seção: "E-mails com anexo saem um por um,
  cerca de 2 por segundo."
- Os anexos são salvos com o rascunho ("Salvar rascunho" e "Revisar e enviar"), como o resto do
  formulário.
- A seção fica num componente próprio, `src/components/email/email-attachments.tsx`, para não
  inchar o `email-composer.tsx`.

**Confirmação do envio:** com anexos, a descrição ganha uma frase:
"Com anexos, o envio leva cerca de {minutos} minutos." O cálculo é `ceil(total × 0,5 s / 60)`, e
abaixo de 1 minuto o texto vira "menos de 1 minuto". Não há bloqueio.

**Página do envio** (`/app/email/[id]`): uma seção "Anexos" lista nome e tamanho de cada arquivo,
quando houver.

**Duplicar:** o novo rascunho recebe a mesma lista de anexos, apontando para os mesmos arquivos.

## 7. Armazenamento e dados

**Rota de upload: `POST /api/email/attachment`** (`src/app/api/email/attachment/route.ts`):
- Nas primeiras linhas, as mesmas checagens de `/api/email/image`:
  - `getOrgContext()`, que responde 401 sem sessão;
  - `canAccessScreen(ctx, "email")` e `hasModule(ctx.modules, "marketing")`, que respondem 403.
- Recebe `multipart/form-data` com um campo `file`. Recusa com 400 e um código:
  - `invalid`: sem arquivo;
  - `type`: extensão fora da §5;
  - `size`: arquivo acima de 10 MB.
- Responde 503 (`storage`) quando o armazenamento ativo não permite leitura pelo servidor (§7, "Leitura").
- Grava com `putMedia` na chave `email-attachments/<organizationId>/<uuid>-<nome-seguro>` e
  responde `{ ok: true, attachment: { key, filename, size } }`, com o `size` medido no servidor.

**Coluna nova** em `EmailBroadcast`:

```prisma
/// EmailAttachment[] (src/lib/email-broadcast/attachments.ts): { key, filename, size }.
attachments Json @default("[]")
```

A migration é aditiva, uma única linha:
`ALTER TABLE "email_broadcasts" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';`

O tipo não é guardado: ele sai sempre da extensão do `filename` (§5).

**Validação no servidor**, em `saveEmailDraft` e de novo em `startEmailBroadcast`:
- o zod do rascunho ganha `attachments: z.array(emailAttachmentSchema).max(10).default([])`, com
  `key` ≤ 300, `filename` 1–150 e `size` inteiro positivo;
- depois do zod, `checkAttachments(orgId, list)` (§9) exige que toda chave:
  - comece com `email-attachments/<orgId deste usuário>/`;
  - tenha o formato gerado pela rota;
  - tenha extensão permitida, com soma dos `size` ≤ 10 MB;
- falha devolve `{ ok: false, error: "attachments_invalid" }`, um código novo de `EmailActionError`;
- a checagem de chave é a trava de isolamento: um rascunho nunca aponta para um arquivo de outra
  empresa nem para um endereço qualquer, porque o servidor só lê **chaves** do armazenamento e
  nunca URLs vindas do cliente.

O `size` declarado pelo cliente pode ser falso. Por isso, o despachante confere o tamanho real dos
bytes (§8).

**Leitura** (nova função em `src/lib/storage/blob.ts`): `readMedia(pathname): Promise<Buffer>`.

| Armazenamento | Como lê |
|---|---|
| Supabase Storage (produção) | `GET {SUPABASE_URL}/storage/v1/object/authenticated/media/<pathname>` com os headers da service role (`sbHeaders()`): leitura autenticada, sem depender da URL pública. Conferir o caminho exato na documentação da API do Storage ao implementar. |
| Disco local (dev) | `fs.readFile` dentro de `.media/`, recusando caminho que saia da pasta |
| Vercel Blob (legado) | não suportado: lança erro |

`mediaReadable()` devolve `true` com Supabase ou disco local e é o que a rota de upload consulta
para o 503. O Vercel Blob gera nome com sufixo aleatório, então a chave não basta para ler.

## 8. Envio (`src/lib/email-broadcast/dispatch.ts`)

**Sem anexo:** nada muda.

**Com anexo:**
1. **No início de cada execução de `runEmailBroadcast`** (depois do lease e das checagens de chave e
   remetente), o despachante lê o `attachments` do envio:
   - roda `checkAttachments` de novo;
   - baixa cada arquivo com `readMedia`;
   - confere que a soma **real** dos bytes ≤ 10 MB;
   - monta `{ filename, content: base64, content_type }` uma vez, guardado em memória só durante
     essa execução.
2. Se algum arquivo não pôde ser lido, pausa com `pausedReason = "attachment_unavailable"` e
   `lastError = "<nome do arquivo>"`. Se as regras falharem sobre os bytes reais, pausa com
   `"attachment_invalid"`. **Nenhum e-mail sai sem os anexos.** "Retomar envio" tenta de novo e
   baixa os arquivos outra vez.
3. Cada lote (`batchNo`, 100 destinatários) vai pelo caminho um por um que já existe (`oneByOne`),
   em vez de `sendBatch`. Ficam iguais:
   - a chave de idempotência por destinatário `eb-<broadcastId>-<batchNo>-<recipientId>`;
   - a política `singleFailureAction`;
   - a pausa depois de 5 falhas seguidas com o mesmo status;
   - o `beat()` e a espera de `paceMs` entre destinatários;
   - a checagem de cota e de remetente antes de cada lote.
4. `toEmail` inclui `attachments` quando o envio tem anexos. `ResendEmail` ganha
   `attachments?: { filename: string; content: string; content_type: string }[]`.
5. `sendOne` aceita um tempo limite opcional. Envios com anexo usam **60 s** em vez dos 30 s
   padrão, porque cada requisição carrega até ~13,3 MB.
6. **Orçamento de tempo dentro do lote:** `oneByOne` passa a conferir o `deadline` entre um
   destinatário e outro e devolve um novo resultado `{ kind: "budget" }` quando ele acaba. O laço
   principal então libera o lease como já faz no fim do orçamento. Os destinatários restantes do
   lote continuam `QUEUED` e são pegos na próxima execução. Sem isso, um lote de 100 com anexo
   (≥ 50 s) estouraria o `QUEUE_BUDGET_MS` no modo fila. No modo `after()` o `deadline` é
   infinito, e isso não muda nada.

**Cota:** inalterada. Cada e-mail conta 1, com ou sem anexo.

**Auditoria:** o `meta` de `email_broadcast.started` ganha `attachments: <quantidade>`.

## 9. Regras puras (`src/lib/email-broadcast/attachments.ts`, sem `server-only`)

Usadas pela tela, pelas actions, pela rota, pelo despachante e pelo `check:email`:

- `MAX_ATTACHMENTS = 10`, `MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024`
- `ATTACHMENT_TYPES`: extensão → `content_type` (tabela da §5)
- `type EmailAttachment = { key: string; filename: string; size: number }`
- `attachmentExtension(filename)` → extensão permitida em minúsculas, ou `null`
- `attachmentContentType(filename)` → `content_type`, ou `null`
- `cleanAttachmentName(raw)` → nome limpo (§5), ou `null` se ficar vazio ou sem extensão permitida
- `attachmentStorageKey(orgId, uuid, filename)` → a chave da §7
- `isAttachmentKeyOf(orgId, key)` → prefixo e formato da chave
- `checkAttachments(orgId, list)` → `null` ou o primeiro problema: `"count" | "type" | "total" | "key"`
- `readAttachments(value: unknown)` → `EmailAttachment[]`; JSON quebrado vira `[]`, como `readAudience`
- `estimateAttachmentSendMinutes(total)` → minutos arredondados para cima (0 = "menos de 1 minuto")

## 10. Falhas e mensagens

| Situação | O que acontece |
|---|---|
| Tipo, tamanho, quantidade ou total na tela | O arquivo não sobe e a tela mostra o motivo |
| Falha de rede ou 5xx no upload | Aviso "Não foi possível anexar {arquivo}"; a lista fica como estava |
| Rascunho salvo com anexo adulterado | `attachments_invalid`: "Os anexos deste envio são inválidos. Remova e anexe de novo." |
| Arquivo sumiu ou não pôde ser lido no envio | Pausa `attachment_unavailable` com o nome do arquivo; "Retomar envio" tenta de novo |
| Bytes reais fora das regras | Pausa `attachment_invalid` |
| Resend recusa e-mails com anexo | Regras atuais: `fail_recipient`; 5 falhas seguidas pausam com a mensagem do Resend |

Os textos novos entram em `pt.json` e `en.json` com as mesmas chaves:
- `attachments.*` (título, botão, contador, aviso, enviando e cada erro);
- `confirmAttachments`;
- `paused.attachment_unavailable`, `paused.attachment_invalid`;
- `error.attachments_invalid`;
- `report.attachments`.

## 11. Limpeza e privacidade

- Remover um anexo do rascunho, apagar o rascunho ou desistir antes de salvar **não apaga** o
  arquivo do armazenamento. As imagens do corpo do e-mail funcionam assim hoje, pelo mesmo
  motivo: rascunhos duplicados e envios já feitos apontam para o mesmo arquivo. Uma rotina de
  limpeza fica para depois, se o armazenamento crescer (§3).
- O bucket `media` é público, com endereços impossíveis de adivinhar (uuid na chave), como as
  imagens do e-mail e a mídia do chat. O destinatário recebe o conteúdo dentro do e-mail e nunca
  vê esse endereço. O servidor lê pela API autenticada (§7).

## 12. Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` + `prisma/migrations/<ts>_email_broadcast_attachments/` | coluna `attachments` |
| `src/lib/email-broadcast/attachments.ts` | **novo**: regras puras (§9) |
| `src/lib/storage/blob.ts` | `readMedia`, `mediaReadable` |
| `src/app/api/email/attachment/route.ts` | **nova** rota de upload |
| `src/lib/validations/email-broadcast.ts` | `emailAttachmentSchema` e campo no rascunho |
| `src/app/actions/email-broadcasts.ts` | salvar, validar, duplicar e iniciar com anexos; erro `attachments_invalid`; auditoria |
| `src/lib/email-broadcast/resend.ts` | `attachments` em `ResendEmail`; tempo limite opcional |
| `src/lib/email-broadcast/dispatch.ts` | carregar anexos, caminho um por um, `budget`, pausas novas |
| `src/lib/email-broadcast/types.ts` | `attachments` em `ComposerDraft` |
| `src/components/email/email-attachments.tsx` | **novo**: seção Anexos |
| `src/components/email/email-composer.tsx` | usa a seção; frase na confirmação |
| `src/app/[locale]/app/email/new/page.tsx`, `[id]/edit/page.tsx` | passam `attachments` ao composer |
| `src/app/[locale]/app/email/[id]/page.tsx` | seção "Anexos" |
| `src/messages/pt.json`, `src/messages/en.json` | textos (§10) |
| `scripts/check-email-broadcast.ts` | verificações das regras puras |
| `README.md` | parágrafo do E-mail em massa: anexos, rota nova, envio um por um |

O guia 05 não lista as rotas protegidas por sessão uma a uma, e a rota nova usa o padrão de sessão
que ele já descreve. Por isso, não precisa de mudança.

## 13. Testes

**Automáticos:**
- `npm run check:email` ganha verificações de `attachments.ts`:
  - tipos aceitos e recusados, inclusive `.ZIP` e `.Pdf`;
  - nome com barras, acentos e mais de 150 caracteres;
  - chave de outra empresa e chave fora do formato;
  - 11 arquivos e total de 10 MB + 1 byte;
  - JSON quebrado em `readAttachments`;
  - estimativa (0, 1, 120 e 1.000 destinatários).
- As cinco validações antes do commit: `typecheck`, `lint`, `build`, `check:isolation` e `check:node`.

**Manuais, no ambiente local** (disco local como armazenamento):
1. Anexar PDF, PNG e `.docx` e enviar para `delivered@resend.dev` e para um e-mail próprio.
   Conferir se os três chegam e abrem.
2. Tentar `.zip`, `.exe`, 11 arquivos e um conjunto acima de 10 MB. Os quatro devem ser recusados
   com o motivo certo.
3. Salvar o rascunho, recarregar a página e ver os anexos de volta. Duplicar e ver os anexos na
   cópia.
4. Interromper o servidor no meio de um envio com anexo e usar "Retomar envio". Ninguém deve
   receber duas vezes (conferir no painel do Resend).
5. Apagar o arquivo de `.media/` antes de enviar. O envio deve pausar com
   `attachment_unavailable` e o nome do arquivo.
6. Um envio sem anexo continua saindo em lotes (uma chamada `/emails/batch` por lote no log).

**Em produção, depois do merge:**
- Subir um arquivo perto de 10 MB. Não se sabe se a Hostinger aceita esse tamanho numa
  requisição; a rota de imagens só recebe até 5 MB. Se recusar, o limite do servidor web precisa
  subir, ou o limite por arquivo precisa descer.
- Um envio pequeno com anexo para um e-mail próprio.

## 14. Implantação

1. Aplicar a migration no Supabase **antes do merge** (`db execute` + `migrate resolve`, como nas
   anteriores; README §8). Ela só adiciona uma coluna com default.
2. Merge na `main`. A Hostinger implanta sozinha.
3. Fazer os dois testes de produção da §13.

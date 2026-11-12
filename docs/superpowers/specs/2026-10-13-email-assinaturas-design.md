# Assinaturas no E-mail em massa — design

**Data:** 2026-10-13 · **Status:** design aprovado em conversa; spec aguardando revisão.
**Complementa:** as specs do E-mail em massa (2026-10-06, 2026-10-08 e 2026-10-09). Nada do que
elas definem muda para um envio sem assinatura.
**Protótipo das telas:** https://claude.ai/artifact/A9rEUB6c9PQctSoFRhvgwK (privado).
**Atualização (2026-10-13, `feature/email-assinatura-sem-texto`):** o "Texto acima da imagem" do tipo
"Imagem pronta" foi removido — do formulário, da renderização, da validação e do banco (coluna
`introText` apagada na migration `20261013180000_email_signatures_drop_intro_text`). As menções a
`introText`/"texto acima" abaixo descrevem a primeira versão.

---

## 1. Objetivo

Cada empresa cadastra assinaturas de e-mail e escolhe uma em cada envio de **Comunicação → E-mail**.
Uma assinatura pode ser:
- **"Texto e imagens":** montada no editor, com logo;
- **"Imagem pronta":** uma imagem completa, como um banner com foto, contatos e logos.

**Critério de sucesso:**
- um e-mail novo já vem com a assinatura padrão da empresa escolhida, e dá para trocar ou tirar;
- o destinatário recebe corpo → assinatura → aviso de descadastro;
- editar ou excluir uma assinatura depois não muda envios já feitos nem envios em andamento;
- a empresa B não vê nem usa assinaturas da empresa A.

## 2. Decisões tomadas com o usuário

| Decisão | Escolha |
|---|---|
| Dono da assinatura | **A empresa.** Todos que usam o E-mail naquela empresa veem e escolhem as mesmas. |
| Quem cria, edita e exclui | **Qualquer pessoa com acesso à tela E-mail** (mesma permissão; sem regra nova). |
| Onde fica | **E-mail → aba "Assinaturas"**, ao lado de "Envios". |
| Tipos | **"Texto e imagens"** (editor do corpo) e **"Imagem pronta"** (imagem + texto acima opcional + link opcional + texto alternativo obrigatório). |
| Padrão | **Uma por empresa**, pré-escolhida em e-mail novo; dá para trocar ou escolher "Sem assinatura". |
| Como entra no envio | **Abordagem A:** o rascunho guarda qual assinatura foi escolhida; ao iniciar o envio, o servidor grava uma **cópia congelada** no envio. Descartadas: B (colar no corpo), em que a assinatura vira texto editável e trocar exige apagar à mão; e C (ler a assinatura a cada e-mail), em que uma edição no meio do envio mistura versões e uma exclusão quebra o envio. |

## 3. Fora do escopo

- Assinatura por usuário.
- Variáveis (`{{nome}}`, `{{empresa}}`) dentro da assinatura: ela fala de quem envia, não de quem recebe.
- Assinatura em Campanhas, nos e-mails transacionais ou no WhatsApp.
- Restringir a edição a administradores.
- Rotina que apaga do armazenamento as imagens de assinaturas excluídas.

## 4. Telas

### 4.1 Abas do E-mail

`/app/email` (lista de envios) e `/app/email/signatures` (assinaturas) ganham, abaixo do título, a
mesma navegação de abas: **Envios** | **Assinaturas**. O componente é `src/components/email/email-tabs.tsx`.

### 4.2 Aba Assinaturas — `/app/email/signatures`

- Cartões, um por assinatura, ordenados com a padrão primeiro e depois por nome. Cada cartão mostra:
  - nome e o selo do tipo ("Texto" ou "Imagem");
  - o selo **"Padrão"**, quando for;
  - prévia renderizada e data da última alteração;
  - **Editar**, **Excluir** e **Definir como padrão** (este só aparece se não for a padrão).
- **Nova assinatura:** um botão no topo e um cartão tracejado no fim da lista. Some quando a
  empresa chega a 20 assinaturas, e então aparece o aviso "Limite de 20 assinaturas".
- **Excluir** pede confirmação: "Rascunhos que usam esta assinatura ficam sem assinatura. Envios já
  feitos não mudam."
- Sem nenhuma assinatura, aparece um estado vazio com o botão "Criar a primeira assinatura".

### 4.3 Criar e editar — `/app/email/signatures/new` e `/app/email/signatures/[id]/edit`

Formulário no componente `src/components/email/signature-form.tsx`.

**Campos comuns aos dois tipos:**
- **Nome:** obrigatório, até 60 caracteres. É interno: o destinatário não vê.
- **Tipo:** escolha entre "Texto e imagens" e "Imagem pronta".
- **"Usar como padrão":** caixa de marcar.
- **Prévia ao lado,** montada pela mesma função do envio (§6).

**Tipo "Texto e imagens":**
- O `RichTextEditor` do corpo, com o suporte a imagem ligado: upload por `/api/email/image` ou link https.
- Até 50.000 caracteres de HTML.

**Tipo "Imagem pronta":**
- **Imagem:** obrigatória.
  - Pode ser enviada por `/api/email/image` (PNG, JPG, GIF ou WEBP até 5 MB) ou colada como link `https://`.
  - Tem "Trocar imagem" e "Remover".
  - Dica na tela: "Largura ideal: 600 px; no celular a imagem se ajusta à tela."
- **Texto acima da imagem:** opcional, até 200 caracteres. Exemplo: "Atenciosamente,".
- **Link ao clicar na imagem:** opcional, validado por `safeClickHref`.
- **Texto alternativo:** obrigatório, até 200 caracteres. Dica na tela: "Aparece quando o programa de
  e-mail bloqueia imagens (comum no Outlook). Coloque nome e telefone."

**Trocar de tipo no formulário** não apaga o que foi preenchido no outro tipo até salvar. Ao salvar,
só os campos do tipo escolhido são gravados; os do outro tipo são limpos.

### 4.4 No novo e-mail (composer)

- **Seção "Assinatura"** logo abaixo do corpo, antes dos Anexos.
- **Seleção:** um `<select>` com as assinaturas da empresa (a padrão aparece como "Nome (padrão)") e a
  opção **"Sem assinatura"**. Ao lado, o link **"Gerenciar assinaturas"**, que leva para `/app/email/signatures`.
- **Prévia:** abaixo do select, a prévia da assinatura escolhida, a partir do HTML que o servidor já
  sanitizou (§6). Com "Sem assinatura", o texto "Este e-mail vai sem assinatura. O aviso de descadastro
  continua no rodapé."
- **E-mail novo:** vem com a assinatura padrão. Sem padrão, vem "Sem assinatura".
- **Rascunho:** abre com a assinatura salva nele. Se ela foi excluída, abre com "Sem assinatura".
- **Empresa sem assinaturas:** a seção mostra só o texto "Nenhuma assinatura cadastrada." e o link
  "Criar assinatura".
- A escolha é salva com o rascunho. "Duplicar" copia a escolha.

### 4.5 Página do envio e e-mail recebido

- A prévia "Ver e-mail enviado" da página do envio mostra a assinatura congelada no envio.
- **No HTML do e-mail,** a assinatura entra dentro do cartão branco, depois do corpo, num bloco com
  margem superior de 24 px. O aviso de descadastro continua fora do cartão, como hoje.
- **Na versão só-texto,** a assinatura entra depois do corpo, separada por uma linha em branco:
  - tipo texto: o HTML convertido por `htmlToText`;
  - tipo imagem: o texto acima, o texto alternativo e o link, um por linha, só os que existirem.

## 5. Dados

```prisma
enum EmailSignatureKind {
  TEXT
  IMAGE
}

/// A reusable e-mail signature of ONE organization (spec 2026-10-13).
model EmailSignature {
  id             String             @id @default(cuid())
  organizationId String
  name           String
  kind           EmailSignatureKind @default(TEXT)
  /// TEXT: editor HTML as typed; sanitized again whenever it is rendered.
  html           String             @default("") @db.Text
  /// IMAGE fields (null for TEXT).
  imageUrl       String?
  imageAlt       String?
  imageHref      String?
  introText      String?
  isDefault      Boolean            @default(false)
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  broadcasts EmailBroadcast[]

  @@index([organizationId])
  @@map("email_signatures")
}
```

Em `EmailBroadcast`, três campos e a relação:

```prisma
  /// Signature chosen in the composer (null = none). Deleting it nulls this.
  signatureId    String?
  signature      EmailSignature?    @relation(fields: [signatureId], references: [id], onDelete: SetNull)
  /// Frozen copy taken when the send starts (sanitized HTML + text part); the
  /// dispatcher only ever reads these, never email_signatures.
  signatureHtml  String?            @db.Text
  signatureText  String?            @db.Text
```

- **Migration aditiva:** o enum, a tabela com o índice, as três colunas e a FK com `ON DELETE SET NULL`.
- **Isolamento:**
  - `EmailSignature` entra em `TENANT_MODELS`, que vai de 76 para 77;
  - o `check:isolation` ganha uma asserção (de 15 para 16): uma assinatura da empresa A não aparece numa busca filtrada pela empresa B;
  - o guia 03 é atualizado com as duas contagens e com "assinatura de e-mail" na lista do que o script popula.
- **Uma padrão por empresa:** garantido na action. Marcar `isDefault` faz, em sequência:
  1. `updateMany({ where: { isDefault: true }, data: { isDefault: false } })` no `tenantDb` da empresa;
  2. `updateMany({ where: { id }, data: { isDefault: true } })`.
- **Limite de 20 por empresa,** conferido na criação.

## 6. Montagem da assinatura

**Regras puras** em `src/lib/email-broadcast/signature.ts` (sem `server-only`), usadas pelo
formulário, pelas actions, pelo composer, pelo início do envio e pelo `check:email`:

- `MAX_SIGNATURES = 20`, `MAX_SIGNATURE_NAME = 60`, `MAX_SIGNATURE_HTML = 50_000`, `MAX_SIGNATURE_LINE = 200`
- `type SignatureContent =
  | { kind: "TEXT"; html: string }
  | { kind: "IMAGE"; imageUrl: string; imageAlt: string; imageHref: string | null; introText: string | null }`
- `signatureProblem(content): "html_empty" | "html_too_long" | "image_required" | "image_url" | "alt_required" | "line_too_long" | "href" | null`.
  O `imageUrl` passa por `safeImageSrc` e o `imageHref` por `safeClickHref`, ambos de `image-links.ts`.
- `renderSignature(content): { html: string; text: string }`:
  - **TEXT:** `html` sem mudanças; `text = htmlToText(html)`.
  - **IMAGE:** `html` = `<p>intro</p>` (quando houver) + `<a href="href"><img src="url" alt="alt"></a>`.
    Sem link, só o `<img>`. Os atributos e o texto são escapados com `escapeHtml`.
    `text` = intro, alt e href, um por linha, só os que existirem.
- `signatureContentOf(row)`: lê uma linha do banco e devolve o `SignatureContent`.
- `untilStable(fn, input, maxPasses = 10)`: aplica `fn` até a saída parar de mudar; devolve `""` se não
  estabilizar.

**Lado servidor** (em `compose.ts`, que é `server-only`):
- `sanitizeHtmlStable(html)` = `untilStable(sanitizeHtml, html)`. O `sanitizeHtml` faz uma passada só,
  e remover uma tag pode emendar outra (`<<x>img ...>` vira `<img ...>`). Por isso toda assinatura
  usa a versão estável.
- `composeSignature(content)` = `renderSignature` + `sanitizeHtmlStable` + `prepareEmailImages` no HTML.
- O resultado é o que vai para a prévia do composer, para a lista de assinaturas e para a cópia
  congelada no início do envio.
- **Ao salvar** uma assinatura de texto, `saveEmailSignature` roda `sanitizeHtmlStable` primeiro e
  passa ao `signatureProblem` o HTML já limpo, que é o que fica gravado. Uma assinatura só com
  `<script>` é recusada, em vez de ser gravada vazia.
- **Prévias** (lista de assinaturas, composer e formulário): sempre num `<iframe sandbox="">`
  (`SignaturePreview`), nunca no DOM da app. Sem scripts, e sem CSS vazando para dentro ou para fora.
  A prévia do formulário mostra o HTML do editor ainda sem sanitizar.
- `composeEmail` ganha `signature?: { html: string; text: string } | null`:
  - **HTML:** a cópia congelada já saiu do `composeSignature`; aqui ela passa de novo só pelo
    `sanitizeHtmlStable`, nunca pelo `prepareEmailImages` (que não é idempotente). O corpo enviado ao
    `buildEmailDocument` vira `corpo + <div style="margin-top:24px">assinatura</div>`;
  - **texto:** `corpo + "\n\n" + assinatura.text`, antes da linha do descadastro.

## 7. Actions e queries

**Queries** em `src/lib/queries/email-signatures.ts`, via `tenantDb`:
- `listEmailSignatures(orgId)`: padrão primeiro, depois por nome;
- `getEmailSignature(orgId, id)`;
- `defaultEmailSignatureId(orgId)`.

**Actions** em `src/app/actions/email-signatures.ts`, com o mesmo `gate()` das actions do E-mail
(sessão + tela "email" + módulo Marketing):
- `saveEmailSignature(id | null, input)`:
  - valida com zod (§8) e `signatureProblem`;
  - na criação, confere o limite de 20;
  - grava só os campos do tipo e aplica a regra de padrão;
  - revalida `/app/email/signatures`.
- `deleteEmailSignature(id)`: `deleteMany({ where: { id } })` com checagem de `count`. A FK zera o
  `signatureId` dos rascunhos.
- `setDefaultEmailSignature(id)`: a regra de padrão (§5), depois de conferir que a assinatura é da empresa.

**Mudanças em `src/app/actions/email-broadcasts.ts`:**
- `broadcastDraftSchema` ganha `signatureId: z.string().max(64).nullable().default(null)`.
- **`saveEmailDraft`:** com `signatureId`, confere com `getEmailSignature` que a assinatura existe na
  empresa. Se não existir, devolve `{ ok: false, error: "signature_missing" }`. Esse é o caso em que
  ela foi excluída com o composer aberto.
- **`startEmailBroadcast`:**
  - com `signatureId`, busca a assinatura (se não achar, `signature_missing`), roda `composeSignature`
    e grava `signatureHtml` e `signatureText` no mesmo `updateMany` que passa o envio para SENDING;
  - sem `signatureId`, grava os dois como `null`;
  - a auditoria ganha `signature: <nome> | null`.
- **`duplicateEmailBroadcast`:** copia o `signatureId`.
- `EmailActionError` ganha `"signature_missing"`.

**Despachante** (`dispatch.ts`):
- passa a ler `signatureHtml` e `signatureText` e a repassá-los ao `composeEmail`;
- nada mais muda: nem o lote, nem a idempotência, nem os anexos.

**Páginas:**
- `new` e `[id]/edit` do E-mail passam ao composer `signatures: { id, name, isDefault, previewHtml }[]`,
  com o `previewHtml` vindo de `composeSignature`;
- o `ComposerDraft` ganha `signatureId`;
- a página do envio passa `signatureHtml` e `signatureText` para o `composeEmail` da prévia.

## 8. Validação (zod)

`src/lib/validations/email-signature.ts`:

```ts
export const emailSignatureSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["TEXT", "IMAGE"]),
  html: z.string().max(50_000).default(""),
  imageUrl: z.string().trim().max(2000).default(""),
  imageAlt: z.string().trim().max(200).default(""),
  imageHref: z.string().trim().max(2000).default(""),
  introText: z.string().trim().max(200).default(""),
  isDefault: z.boolean().default(false),
});
```

A action converte a entrada em `SignatureContent` antes de chamar `signatureProblem`. Os campos vazios
viram `null`.

## 9. Falhas e mensagens

| Situação | O que acontece |
|---|---|
| Assinatura excluída com o composer aberto | Salvar ou enviar devolve `signature_missing`: "A assinatura escolhida foi excluída. Escolha outra." |
| Imagem da assinatura sumiu do armazenamento | O e-mail sai mesmo assim e o destinatário vê o texto alternativo (como nas imagens do corpo; nada é conferido no envio) |
| Nome vazio, 21ª assinatura, imagem ou alt faltando, link sem https | O formulário mostra o motivo e não salva |
| Assinatura padrão excluída | A empresa fica sem padrão; e-mails novos começam com "Sem assinatura" |
| Duas pessoas editando a mesma assinatura | Vale a última que salvar |

Os textos novos entram em `pt.json` e `en.json` com as mesmas chaves:
- `emailBroadcast.tabs.*`;
- `emailBroadcast.signatures.*` (lista, formulário, confirmações e erros);
- `emailBroadcast.signature.*` (seção do composer);
- `emailBroadcast.error.signature_missing`.

Ao terminar, a contagem de chaves é atualizada no CLAUDE.md e no guia 04.

## 10. Limpeza e privacidade

- Excluir uma assinatura não apaga as imagens dela do armazenamento. Envios antigos e a página do
  envio ainda apontam para elas, e as imagens do corpo já funcionam assim.
- As imagens ficam no mesmo armazenamento público, com endereço impossível de adivinhar, das imagens
  do corpo. O e-mail aponta para elas: não vão anexadas.

## 11. Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` + `prisma/migrations/<ts>_email_signatures/` | enum, tabela, colunas e FK |
| `src/lib/tenant-db.ts` | `EmailSignature` em `TENANT_MODELS` |
| `scripts/check-isolation.ts` | asserção da assinatura |
| `docs/guia/03-multi-tenancy.md` | contagens e lista |
| `src/lib/email-broadcast/signature.ts` | **novo**: regras puras (§6) |
| `src/lib/email-broadcast/compose.ts` | `composeSignature`; `composeEmail` com assinatura |
| `src/lib/email-broadcast/dispatch.ts` | lê e repassa a cópia congelada |
| `src/lib/validations/email-signature.ts` | **novo**: zod (§8) |
| `src/lib/validations/email-broadcast.ts` | `signatureId` no rascunho |
| `src/lib/queries/email-signatures.ts` | **novo** |
| `src/lib/queries/email-broadcasts.ts` | `getEmailBroadcast` devolve os campos de assinatura |
| `src/app/actions/email-signatures.ts` | **novo** |
| `src/app/actions/email-broadcasts.ts` | salvar, iniciar e duplicar com assinatura; erro novo |
| `src/lib/email-broadcast/types.ts` | `signatureId` no `ComposerDraft`; tipo da opção de assinatura |
| `src/components/email/email-tabs.tsx` | **novo** |
| `src/components/email/signature-form.tsx` | **novo** |
| `src/components/email/signature-card.tsx` | **novo**: cartão da lista com as ações |
| `src/components/email/email-composer.tsx` | seção Assinatura |
| `src/app/[locale]/app/email/page.tsx` | abas |
| `src/app/[locale]/app/email/signatures/page.tsx`, `new/page.tsx`, `[id]/edit/page.tsx` | **novas** |
| `src/app/[locale]/app/email/new/page.tsx`, `[id]/edit/page.tsx`, `[id]/page.tsx` | assinaturas no composer e na prévia |
| `src/messages/pt.json`, `src/messages/en.json` | textos (§9) |
| `scripts/check-email-broadcast.ts` | verificações de `signature.ts` |
| `README.md`, `CLAUDE.md`, `docs/guia/04-modulos-e-permissoes.md` | assinaturas; contagem de chaves |

As rotas novas são páginas em `/app/email/*`, protegidas pelo layout do E-mail, que já exige a tela
"email" e o módulo Marketing. Nenhuma rota de API entra (o upload reusa `/api/email/image`), então o
guia 05 não muda.

## 12. Testes

**Automáticos:**
- `npm run check:email` ganha verificações de `signature.ts`:
  - **TEXT:** o HTML passa sem mudanças e o texto sai de `htmlToText`;
  - **IMAGE:** com e sem link e com e sem intro; aspas, `<` e `&` no alt e na intro saem escapados;
  - **versão só-texto:** só as linhas que existirem;
  - **`signatureProblem`:** imagem faltando, `http://`, `javascript:`, alt vazio, linha com 201 caracteres e HTML vazio.
- `npm run check:isolation` com a asserção nova.
- As cinco validações antes do commit.

**Manuais, de ponta a ponta, no ambiente local:** envio real só para os endereços de teste do Resend,
com autorização do usuário.
1. Criar uma assinatura "Texto e imagens" (com logo) e uma "Imagem pronta", e marcar a de texto como padrão.
2. Num e-mail novo, a padrão já vem escolhida. Trocar para a de imagem e ver a prévia mudar.
3. Enviar para `delivered@resend.dev`. A prévia da página do envio mostra a assinatura.
4. Editar a assinatura depois do envio. A prévia do envio feito não muda.
5. Excluir a assinatura usada por um rascunho. O rascunho abre com "Sem assinatura".
6. Com o composer aberto, excluir a assinatura escolhida em outra aba e clicar em enviar. Deve aparecer o aviso `signature_missing`.
7. Um envio sem assinatura continua igual: lote, rodapé e anexos.
8. Marcar outra assinatura como padrão. A anterior perde o selo.

## 13. Implantação

1. Aplicar a migration no Supabase **antes do merge**, com `db execute` + `migrate resolve` (nunca
   `migrate deploy`; README §8). Ela só adiciona.
2. Merge na `main`. A Hostinger implanta sozinha.
3. Em produção: criar uma assinatura de imagem e fazer um envio pequeno para um e-mail próprio,
   conferindo no Gmail e no Outlook.

# E-mail em massa pela conta Resend da plataforma, com domínios liberados por empresa — design

**Data:** 2026-10-08 · **Status:** design aprovado em conversa; spec aguardando revisão.
**Muda:** a spec de 2026-10-06 (`2026-10-06-email-em-massa-design.md`) nas partes de conta Resend
(§2, §10.2), webhook (§10.3) e campo de remetente (§7). O resto continua valendo.

---

## 1. Objetivo

Todas as empresas enviam e-mail em massa pela **conta Resend da plataforma**: a chave
`RESEND_API_KEY` do `.env`, a mesma dos e-mails de login, convite e reset. Cada empresa só pode
enviar de **domínios próprios**, verificados à mão pelo time da plataforma no painel do Resend e
liberados para aquela empresa por um comando.

**Critério de sucesso:**
- uma empresa com `lojaxyz.com.br` liberado envia de qualquer endereço `@lojaxyz.com.br`;
- uma empresa sem o domínio liberado **não** consegue enviar dele, nem que outra empresa o tenha;
- o reset de senha continua chegando durante um envio grande.

## 2. Decisões tomadas com o usuário

| Decisão | Escolha |
|---|---|
| Conta Resend | **A da plataforma** (chave do `.env`), a mesma dos e-mails de login. Não há conta separada. |
| Remetente | O campo **"Endereço de envio"** começa vazio e é obrigatório para enviar; aceita um e-mail completo. |
| Domínios `@metodotia.com` | **Não** liberados para clientes. Cada empresa só envia de domínio próprio. |
| Verificação do domínio | **Manual**, no painel do Resend, feita pelo time da plataforma. |
| Vínculo domínio → empresa | **Tabela no banco + comando** (`npm run email:dominio`), rodado pelo time da plataforma. |
| Um domínio, quantas empresas | **Uma só.** É a trava contra uma empresa enviar como outra. |
| Chave "Full access" | **Não é necessária.** Basta "Sending access" com o domínio **"All domains"**. |
| Cota | Fica **50.000 por empresa por mês**. O volume total do plano Resend é dividido entre todas. |
| Proteção do reset de senha | O envio em massa limita-se a **2 requisições/s**; o e-mail transacional **tenta de novo uma vez** quando recebe 429. |

## 3. Fora do escopo

- Cadastro ou verificação automática de domínio pela API do Resend.
- Tela de administração da plataforma.
- Conta Resend separada.
- Qualquer mudança em Campanhas.
- Conexões → Resend continua existindo, só não é mais usado pelo E-mail.

## 4. Fluxo

**Time da plataforma (uma vez por domínio):**
1. Painel do Resend (conta do `.env`) → Domains → Add Domain → o domínio do cliente.
2. Passar ao cliente as linhas de DNS e esperar o status **Verified**.
3. Rodar o comando de liberação (§6).

**Uma vez só, para o status de entrega:** no painel do Resend → Webhooks → endpoint
`https://metodotia.com/api/email/webhook` com os eventos `email.delivered`, `email.bounced`,
`email.complained` e `email.failed`. O signing secret vai para a variável `RESEND_WEBHOOK_SECRET`
do hPanel.

**Cliente:**
- **Lista de envios:** no lugar do card "Resend conectado" aparecem os **domínios liberados da
  empresa**. Sem nenhum, aparece um aviso: "Nenhum domínio liberado. Fale com o suporte para liberar
  o domínio da sua empresa."
- **Composer:**
  - O campo **Endereço de envio** é editável, começa vazio e é obrigatório para enviar.
  - Abaixo dele, a lista "Domínios liberados: …".
  - Se o domínio digitado não está liberado, aparece um erro na hora e "Revisar e enviar" fica
    desabilitado.
  - O rascunho pode ser salvo com qualquer endereço de formato válido.
- **Envio:** o servidor confere de novo, no início, se o domínio do endereço é liberado para a
  empresa. Se não for, devolve o erro `domain_not_allowed`.

## 5. Modelo de dados (migration aditiva)

```prisma
/// A sender domain a platform admin verified in Resend and assigned to ONE org
/// (scripts/email-domain.ts). Globally unique: the lock that stops org B from
/// sending as org A's domain through the shared platform Resend account.
model EmailSenderDomain {
  id             String   @id @default(cuid())
  organizationId String
  domain         String   @unique // lowercase, no "@"
  createdAt      DateTime @default(now())

  @@index([organizationId])
  @@map("email_sender_domains")
}
```

Em `EmailBroadcast`, entra `fromEmail String?`: o endereço digitado, normalizado. A migration tem só
`CREATE TABLE`, `CREATE INDEX` e um `ALTER TABLE "email_broadcasts" ADD COLUMN "fromEmail" TEXT`,
uma coluna nula numa tabela do próprio módulo. Ela é aplicada no Supabase **antes** do merge, pelo
procedimento `db execute` + `migrate resolve` (nunca `migrate deploy`). `EmailSenderDomain` entra em
`TENANT_MODELS`.

## 6. Comando `npm run email:dominio`

Arquivo `scripts/email-domain.ts`. Usa `PrismaClient` com o adapter `PrismaPg`, como pede o
CLAUDE.md, e lê `DATABASE_URL` do arquivo de env passado:

```
npm run email:dominio -- list
npm run email:dominio -- add lojaxyz.com.br loja-xyz [--yes]
npm run email:dominio -- remove lojaxyz.com.br [--yes]
```

Para produção, o comando roda com o arquivo temporário de credencial, como na migration:
`npx tsx --env-file=.env.supabase scripts/email-domain.ts …`.

- **`add`:**
  - normaliza o domínio (minúsculas, sem `@` nem espaços) e valida o formato;
  - busca a empresa pelo `slug`;
  - recusa um domínio já vinculado a outra empresa, mostrando qual é;
  - é idempotente para a mesma empresa;
  - recusa `metodotia.com` e subdomínios.
- **`remove`:** apaga o vínculo. Envios em andamento daquele domínio pausam no lote seguinte (§7).
- **Segurança:**
  - antes de gravar, mostra o host do banco (sem senha);
  - fora de `localhost` exige `--yes`;
  - se a URL estiver malformada (ex.: esquema sem o "p" inicial), mostra um erro claro.

## 7. Envio e webhook

- **Credenciais:** o E-mail passa a usar `env.RESEND_API_KEY`. Se ela faltar, o envio pausa com
  `no_connection`, e o texto passa a dizer "a chave do Resend da plataforma não está configurada".
  `getResendConnection`, `ensureResendWebhook`, `deliveryTrackingActive` e a rota
  `/api/webhooks/resend/[connectionId]` **são removidos**.
- **Remetente:** `formatFrom(fromName, broadcast.fromEmail)`.
- **Revalidação no disparador:** no início de cada execução, o disparador confere se o domínio do
  `fromEmail` continua liberado para a empresa. Se não estiver, pausa com o motivo novo
  `domain_not_allowed`.
- **Ritmo:** `PACE_MS` passa de 150 para **500 ms** entre lotes, no máximo cerca de 2 req/s e 200
  e-mails/s. Sobra folga dos ~10 req/s da conta para os e-mails transacionais.
- **E-mail transacional** (`src/lib/email/send.ts`, que não é de Campanhas): em resposta 429, espera
  o `retry-after` (no máximo 2 s) e tenta **uma** vez mais. O resto não muda.
- **Webhook único:** rota nova `/api/email/webhook`.
  - Verifica a assinatura Svix com `env.RESEND_WEBHOOK_SECRET`; sem a variável, responde 401 a tudo.
  - Procura o destinatário pelo `providerMessageId` (contexto de sistema; a empresa vem da linha
    encontrada).
  - Mantém o comportamento atual:
    - ignora eventos de outros e-mails, como os de login, sem gravar;
    - deduplica por `RESEND:email:{svix-id}`, prefixo próprio que não se confunde com a rota
      genérica;
    - aplica as transições só para frente;
    - grava bounce permanente e spam na lista de bloqueio;
    - se aplicar falhar, apaga o evento e responde 500.
  - A rota genérica `/api/webhooks/[provider]` (Campanhas) não é tocada.
- **"Status de entrega ativo"** na tela passa a significar que `RESEND_WEBHOOK_SECRET` está
  configurado.

## 8. Tela e textos

- `emailComposerData` devolve `allowedDomains: string[]` no lugar de `fromEmail`.
- `ComposerDraft` ganha `fromEmail`.
- `broadcastDraftSchema` ganha `fromEmail`: vazio ou e-mail válido para rascunho.
- `startEmailBroadcast` exige `fromEmail` com domínio liberado.
- i18n pt/en:
  - saem as chaves `connection.*`, que deixam de fazer sentido;
  - entram `domains.*` e `error.domain_not_allowed`, `error.from_required` e
    `paused.domain_not_allowed`;
  - a contagem é atualizada no CLAUDE.md e no guia 04.
- A tela de Conexões não muda.

## 9. Arquivos

**Novos:**
- a migration;
- `scripts/email-domain.ts`;
- `src/app/api/email/webhook/route.ts`;
- `src/lib/email-broadcast/sender-domain.ts` (puro: `domainOfEmail`, `isSenderAllowed`);
- `src/lib/queries/email-sender-domains.ts` (DAL).

**Alterados:**
- `prisma/schema.prisma`, `src/lib/tenant-db.ts`, `src/lib/env.ts` (`RESEND_WEBHOOK_SECRET`
  opcional);
- `dispatch.ts`, `src/lib/email/send.ts`, as actions, `queries/email-broadcasts.ts`, as páginas e o
  composer;
- `pt.json` e `en.json`;
- `package.json` (script `email:dominio`);
- `scripts/check-isolation.ts`, `scripts/check-email-broadcast.ts`;
- README (§7 e o runbook §8, com o passo a passo do domínio e do webhook) e os guias 03, 04, 05 e 06.

**Removidos:**
- `src/app/api/webhooks/resend/[connectionId]/route.ts`;
- `src/lib/email-broadcast/connection.ts`, porque todas as funções dele saem (§7).

A chave vem direto de `env.RESEND_API_KEY` no disparador.

## 10. Verificação

- **As cinco checagens** e mais `check:email`, com os casos novos:
  - `domainOfEmail`: maiúsculas, espaços, sem `@`;
  - `isSenderAllowed`: domínio liberado, não liberado, subdomínio não conta, `metodotia.com` não
    conta.
- **`check:isolation`:** um domínio liberado na empresa A não aparece na B, e o mesmo domínio não
  pode ser criado nas duas (unique).
- **Comando, no banco local:**
  - `add` em duas empresas: a segunda é recusada;
  - `list`;
  - `remove`;
  - `add metodotia.com` é recusado.
- **Webhook novo, local, com dados falsos e curl:**
  - sem assinatura → 401;
  - entregue e bounce → aplicados;
  - repetição → `duplicate`;
  - e-mail de outro sistema → ignorado sem gravar.
- **Não verificável localmente:** envio real e o webhook real do Resend. Ficam para o teste em
  produção, depois de configurar `RESEND_WEBHOOK_SECRET` e liberar um domínio.

## 11. Deploy

1. Aplicar a migration no Supabase antes do merge.
2. Conferir no Resend se a chave do `.env` é "Sending access" com **All domains**.
3. Criar o webhook no painel e pôr o secret no hPanel (`RESEND_WEBHOOK_SECRET`).
4. Verificar o domínio do cliente no Resend e rodar `email:dominio add` contra produção.

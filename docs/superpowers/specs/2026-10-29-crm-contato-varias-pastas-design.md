# Um contato em várias pastas do CRM — desenho

- **Data:** 2026-10-29.
- **Branch:** `feature/crm-contato-varias-pastas`, a partir de `origin/main` 33823a7 (worktree em
  `.claude/worktrees/feature+crm-contato-varias-pastas`).
- **Só contatos.** As pastas de empresas continuam como estão: uma pasta por empresa.

## Intenção

Hoje, em CRM → Contatos (`/app/contacts`), cada contato fica em no máximo uma pasta (`Contact.folderId`).
O usuário quer poder deixar o mesmo contato em mais de uma pasta. Nas palavras dele, "só por em duas pastas
mesmo": é uma necessidade de organização, sem um fluxo maior por trás.

O usuário pediu para seguir sem mais perguntas ("continue onde estava"). As escolhas abaixo marcadas como
**(decisão do Claude)** não foram confirmadas por ele e estão listadas no fim para revisão.

## Objetivos

1. Um contato pode estar em nenhuma, uma ou várias pastas. "Sem pasta" passa a significar "não está em
   nenhuma pasta".
2. Dá para colocar um contato numa segunda pasta pela tela de Contatos, sem tirá-lo da primeira.
3. Dá para ver em que pastas um contato está: um selo no cartão e uma linha na página do contato.
4. Tudo que hoje filtra contatos por pasta continua funcionando com a regra nova: e-mail em massa,
   campanhas e a mesclagem de duplicados.

## Fora do escopo

- **Importações mudam só por dentro.** O contato novo entra na pasta da importação como hoje. O contato que
  já existe no CRM continua sendo pulado e **não** é colocado na pasta nova **(decisão do Claude**: palpite
  apresentado ao usuário e não contestado; ele pediu só "por em duas pastas").
- **Pastas de empresas** e o explorador delas: o comportamento fica igual.
- **A lixeira do cartão** continua excluindo o contato (de todas as pastas), com o "Desfazer" de hoje.
- **Servidor MCP:** não expõe pastas, então não muda.

## O que não pode acontecer

- Um contato some de uma pasta sem que a pessoa tenha pedido. Mover tira o contato só da pasta aberta.
- Um vínculo de uma empresa (organização) aponta para o contato de outra e o faz aparecer no CRM dela.
- O deploy derruba a tela de Contatos em produção, ou perde o que o código antigo gravou entre a migration e o
  merge.

## Modelo de dados

Tabela nova de vínculo, com `organizationId` como toda tabela de negócio:

```prisma
/// Um contato arquivado numa pasta. Um contato pode estar em várias; em nenhuma = "Sem pasta".
model ContactFolderLink {
  id             String   @id @default(cuid())
  organizationId String
  contactId      String
  folderId       String
  createdAt      DateTime @default(now())

  contact Contact       @relation(fields: [contactId], references: [id], onDelete: Cascade)
  folder  ContactFolder @relation(fields: [folderId], references: [id], onDelete: Cascade)

  @@unique([contactId, folderId])
  @@index([organizationId, folderId])
  @@map("contact_folder_links")
}
```

- `Contact.folderLinks` e `ContactFolder.links` são as relações novas.
- Apagar o contato apaga os vínculos dele. Apagar a pasta apaga só os vínculos: o contato continua e, sem
  outra pasta, aparece em "Sem pasta".
- `ContactFolderLink` entra em `TENANT_MODELS` ([src/lib/tenant-db.ts](../../../src/lib/tenant-db.ts)).
- **`Contact.folderId` fica no banco nesta fase, sem uso** (veja "Deploy em duas fases"). Recomendação: no
  schema, renomear o campo para `legacyFolderId` com `@map("folderId")` (e a relação para `legacyFolder`),
  para que qualquer uso esquecido quebre o `typecheck`. Isso não pode mudar nada no banco: o
  `migrate dev --create-only` desta fase deve gerar só a tabela nova. Se o Prisma quiser renomear índice ou
  FK, mantenha os nomes antigos com `map:`.

## Como funciona na tela de Contatos

O explorador ([folder-explorer.tsx](../../../src/components/crm/folder-explorer.tsx)) é o mesmo de Empresas.
As novidades entram por props opcionais, e Empresas não as passa.

**Contagem das pastas.** Cada pasta conta os contatos ligados a ela. "Sem pasta" conta quem não tem nenhum
vínculo. A soma das pastas pode passar do total de contatos, e isso é esperado.

**Arrastar** um contato (ou a seleção) da pasta aberta X para a pasta Y:
- **Sem tecla = mover.** Sai de X e entra em Y. As outras pastas do contato não mudam. Se ele já estava em Y,
  só sai de X.
- **Com Ctrl ao soltar = adicionar.** Entra em Y e continua em X. Enquanto o Ctrl está apertado, o cursor
  mostra "copiar" (`dropEffect = "copy"`). **(decisão do Claude**: segue a convenção do Windows Explorer, que
  é a referência declarada do componente.)
- **De "Sem pasta" para Y:** entra em Y, com ou sem Ctrl.
- **Para "Sem pasta" = tirar de todas as pastas**, com ou sem Ctrl. É o único jeito de o contato aparecer
  onde a pessoa o soltou. **(decisão do Claude)**
- O texto de dica no topo da pasta aberta (hoje "Arraste para selecionar") ganha, só em Contatos, uma menção
  ao Ctrl. A redação fica com quem implementar.

**Barra de seleção** ([bulk-bar.tsx](../../../src/components/crm/bulk-bar.tsx)), só em Contatos:
- "Mover para…" (já existe) segue a mesma regra de arrastar sem tecla. "Sem pasta" tira de todas.
- **"Adicionar à pasta…"** (novo, ao lado): uma lista das pastas; coloca na escolhida e mantém as atuais.
- **"Tirar desta pasta"** (novo): só aparece quando a pasta aberta é uma pasta de verdade. Tira os
  selecionados só dela, sem confirmação, porque basta adicionar de volta. Quem fica sem pasta vai para
  "Sem pasta".
- Para isso, o `BulkContext` passa a informar qual pasta está aberta.

**Cartão do contato** (grade e lista, em [contacts-grid.tsx](../../../src/components/crm/contacts-grid.tsx)):
quando o contato está em 2 ou mais pastas, aparece um selo pequeno "N pastas", com os nomes no `title`. O
selo serve para avisar, antes de mover ou excluir, que o contato também está em outro lugar.

**Página do contato** (`/app/contacts/[id]`): na lista de campos, uma linha nova "Pastas" com os nomes na
ordem das pastas, ou "—". Só leitura.

**Atualização otimista no explorador:**
- A pasta de destino ganha os itens que ainda não tem.
- Ao mover, a pasta aberta perde os itens.
- Soltando em "Sem pasta", todas as colunas perdem os itens, e "Sem pasta" os recebe.
- Depois, `router.refresh()`, como hoje.

## Ações no servidor

Ficam em [src/app/actions/bulk.ts](../../../src/app/actions/bulk.ts). Todas checam `getOrgContext()` e usam
`tenantDb`.

- `bulkMoveContacts(ids, toFolderId | null, fromFolderId | null)`: com `to = null`, apaga todos os vínculos
  dos ids. Senão, numa transação, apaga o vínculo com `from` (se houver) e cria com `to`
  (`skipDuplicates`).
- `bulkAddContactsToFolder(ids, folderId)` e `bulkRemoveContactsFromFolder(ids, folderId)`.
- **Antes de criar vínculo, filtre os ids por `db.contact.findMany({ where: { id: { in: ids } } })`.** O
  `createMany` de `tenantDb` põe o `organizationId` da empresa ativa no vínculo, mas não confere de quem é o
  `contactId`. Um id de contato de outra empresa viraria um vínculo desta empresa apontando para um contato
  alheio. A pasta também é conferida com `findFirst`, como hoje.
- `moveContact` em [contact-folders.ts](../../../src/app/actions/contact-folders.ts) não tem chamador. Remova.
- **Leitura do quadro** ([src/lib/queries/contact-folders.ts](../../../src/lib/queries/contact-folders.ts)):
  parta de `db.contact.findMany` (com filtro de empresa) incluindo os vínculos, nunca de vínculos incluindo
  contatos. É defesa em profundidade contra o caso acima. O mesmo cartão pode aparecer em várias colunas. Se
  o payload crescer demais, mande cada contato uma vez mais as listas de ids por pasta. Quem implementar
  decide, desde que a página não fique visivelmente mais lenta.

## Onde mais muda

| Lugar | Mudança |
|---|---|
| [extractions.ts](../../../src/app/actions/extractions.ts) (prospecção) e [import-csv.ts](../../../src/app/actions/import-csv.ts) | O contato novo ganha um vínculo com a pasta da importação em vez de `folderId`. Em `create` aninhado, o `organizationId` do vínculo vai explícito, porque o extends só injeta no nível de cima. |
| [inbox.ts](../../../src/app/actions/inbox.ts) (`createContacts`, `importGroup`) | `createContacts` usa `createMany`, que não devolve ids. Opção segura: `createManyAndReturn` com o `organizationId` já explícito no `data` (como o código faz hoje) e depois `createMany` dos vínculos. A numeração "Contato #N" lê os nomes pelos vínculos da pasta do grupo. |
| [merge.ts](../../../src/app/actions/merge.ts) (`mergeContacts`) | Hoje a pasta do contato descartado se perde. Passa a somar: dentro da transação, apague os vínculos dos descartados com pastas que o principal já tem e repasse o resto para o principal. |
| [audience.ts](../../../src/lib/email-broadcast/audience.ts) | `folderLinks: { some: { folderId: { in } } }`. Ninguém recebe duas vezes, porque os destinatários já são deduplicados por e-mail. |
| [email-broadcasts.ts](../../../src/lib/queries/email-broadcasts.ts) (`emailComposerOptions`) | Conta por pasta a partir dos vínculos, mantendo o filtro "tem e-mail e sem opt-out". |
| [campaigns.ts](../../../src/lib/queries/campaigns.ts) (`audienceWhere`) | `folderLinks: { some: { folderId } }`. |
| `src/messages/pt.json` e `en.json` | Chaves novas nos dois arquivos: adicionar à pasta, tirar desta pasta, selo "N pastas", "Pastas" na página do contato e a dica do Ctrl. Hoje são 3236. |

## Relação com `feature/crm-grupo-whatsapp`

Essa branch está em andamento em outra aba e ainda não foi mergeada. Ela lê contatos por pasta em
`sourceContacts` ([src/lib/whatsapp/group-add/service.ts](../../../src/lib/whatsapp/group-add/service.ts) na
própria branch):
- pasta → `folderLinks: { some: { folderId } }`;
- "Sem pasta" (`folderId: null`) → `folderLinks: { none: {} }`.

**Quem for mergeada por último faz essa adaptação.** As duas mexem em `schema.prisma`,
`scripts/check-isolation.ts`, no guia 03 e na contagem do i18n. Espere conflitos simples nesses pontos. A
migration desta branch usa data de 2026-10-29, depois das da outra.

## Deploy em duas fases

A Hostinger publica sem rodar migration, e o código que está no ar lê `contacts.folderId`. Por isso:

**Fase 1 (esta branch).** A migration é só aditiva:
1. cria `contact_folder_links`;
2. copia os vínculos atuais: um por contato com `folderId`;
3. cria um gatilho em `contacts` (`AFTER INSERT OR UPDATE OF "folderId"`) que espelha na tabela nova o que o
   código antigo gravar. Se o `folderId` mudou, apaga o vínculo antigo e cria o novo (`ON CONFLICT DO
   NOTHING`, id com `gen_random_uuid()::text`).

O gatilho fecha a janela entre aplicar a migration no Supabase e o build novo entrar no ar: importações e
movimentações feitas pelo código antigo nesse meio-tempo não se perdem. O código novo nunca grava
`folderId`, então depois do deploy o gatilho fica inerte. **(decisão do Claude**: o repositório não tem
gatilhos até hoje. A alternativa sem gatilho é rodar de novo a cópia logo antes do merge e aceitar uma janela
pequena.)

Runbook da fase 1. Entra no README §8, como nos precedentes:
1. Antes do merge, aplicar no Supabase com `npx prisma db execute --file
   prisma/migrations/<pasta>/migration.sql --schema prisma/schema.prisma` e depois
   `npx prisma migrate resolve --applied <pasta>`. **Não** use `migrate deploy`.
2. Conferir que o número de vínculos é igual ao número de contatos com `folderId`.
3. Fazer o merge. Com o build no ar, testar uma movimentação e uma adição em produção.

Se o merge precisar ser revertido, o código antigo volta a ler `folderId`. O que tiver sido feito na tela
nova não aparece nele: quem entrou numa segunda pasta continua só na primeira.

**Fase 2 (PR separado, depois de alguns dias estável).** Tira o campo legado do schema → merge e deploy → só
então aplica a migration que apaga o gatilho, a função, a FK, o índice e a coluna. A ordem é invertida de
propósito, como em `20261013180000_email_signatures_drop_intro_text`: o Prisma não lê colunas que o schema
não declara, então a coluna sobrando é inofensiva. Apagá-la antes do deploy quebraria o código no ar.

## Isolamento e validação

- `check:isolation` ganha o novo model: um vínculo em cada empresa; a leitura com filtro de organização só
  vê o seu; `updateMany`/`deleteMany` com organização trocada afetam zero linhas; o mesmo par
  contato+pasta duas vezes é recusado (P2002).
- Guia 03 no mesmo commit: a contagem de `TENANT_MODELS` (78 na `main`) e a lista e o número de asserções do
  `check:isolation` (24 na `main`).
- Os cinco antes de commitar: `typecheck`, `lint`, `build`, `check:isolation`, `check:node`.
- `grep` final: nenhum uso de `folderId` de contato fora da migration e do campo legado.

**Teste manual (local, `next dev --webpack`):**
1. Pôr um contato em duas pastas, por Ctrl+arrastar e por "Adicionar à pasta…". As duas pastas contam o
   contato, o cartão mostra "2 pastas" e a página do contato lista as duas.
2. Mover de X para Y: o contato sai de X e continua em Z.
3. "Tirar desta pasta" em X: quem não tem outra pasta aparece em "Sem pasta".
4. Soltar em "Sem pasta": o contato sai de todas.
5. Apagar a pasta X: o contato continua em Z.
6. Mesclar dois contatos de pastas diferentes: o principal fica nas duas.
7. E-mail em massa com duas pastas que têm um contato em comum: sai um e-mail só para ele.
8. Campanha filtrada por pasta.
9. Importar um grupo do WhatsApp: a numeração continua e quem já existe é pulado.
10. Empresas: arrastar e "Mover para" funcionam como antes, e o Ctrl não muda nada.
11. Gatilho: com a migration aplicada, um `UPDATE contacts SET "folderId" = …` à mão move o vínculo.

## Fica com quem implementar

- Nomes exatos de funções, chaves de i18n e redação dos textos.
- O formato do payload do quadro (cartão repetido ou listas de ids).
- Como obter os ids na importação do WhatsApp, respeitando o guia 03.
- Se "Adicionar à pasta…" e "Mover para…" viram um só menu com duas seções, desde que as duas ações fiquem
  visíveis.

## Decisões do Claude para revisar

1. Importações não colocam o contato que já existe na pasta nova.
2. Arrastar = mover; Ctrl ao soltar = adicionar.
3. Soltar ou "Mover para" em "Sem pasta" tira o contato de todas as pastas.
4. "Tirar desta pasta" sem confirmação.
5. Selo "N pastas" no cartão e linha "Pastas" (só leitura) na página do contato.
6. A mesclagem soma as pastas.
7. Gatilho temporário na fase 1, e o campo legado só sai na fase 2.

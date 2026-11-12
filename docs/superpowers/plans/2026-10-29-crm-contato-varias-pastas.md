# Um contato em várias pastas do CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um contato do CRM pode estar em nenhuma, uma ou várias pastas, com "mover", "adicionar" (Ctrl ao soltar ou barra de seleção) e "tirar desta pasta" na tela de Contatos.

**Architecture:**
- **Dados:** uma tabela de vínculo (`ContactFolderLink`) substitui `Contact.folderId`. A migration da fase 1 é só aditiva: copia os vínculos atuais e cria um gatilho que espelha na tabela nova o que o código antigo gravar em `folderId`. Por isso, a tela fica consistente em qualquer ponto do meio do caminho.
- **Leitura antes da gravação:** primeiro a leitura passa para os vínculos (quadro, selo e página do contato). Depois vêm as gravações (mover, adicionar, tirar), os filtros (e-mail em massa e campanhas), as importações e a mesclagem.
- **Testes:** as regras puras ficam num arquivo sem servidor, testado por `check:folders`. O código que fala com o banco é testado por `check:folders:db`, contra o Postgres local com o `tenantDb` de verdade.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 com driver adapter (`engineType = "client"`), next-intl, tsx para os scripts de checagem.

**Spec:** [docs/superpowers/specs/2026-10-29-crm-contato-varias-pastas-design.md](../specs/2026-10-29-crm-contato-varias-pastas-design.md)

## Global Constraints

- **Worktree:** `.claude/worktrees/feature+crm-contato-varias-pastas`, branch `feature/crm-contato-varias-pastas`, base `origin/main` 33823a7.
- **Outra aba ativa:** outra sessão trabalha em `feature/crm-grupo-whatsapp` no checkout principal. Nunca mexa nele nem no banco `metodoai`. Este worktree usa um banco só seu, `metodoai_pastas`, no mesmo container `metodoai-db` (Task 1).
- **Só contatos.** Pastas de empresas (`Company.folderId`, `CompanyFolder`, `bulkMoveCompanies`) não mudam. O explorador é compartilhado, então tudo que é novo nele entra por prop opcional.
- **Isolamento ([guia 03](../../guia/03-multi-tenancy.md)):** toda leitura e gravação passa por `tenantDb`. Antes de criar vínculo, os ids de contato passam por `db.contact.findMany` desta empresa. O quadro parte de contatos, nunca de vínculos.
- **Gravação:** o código novo nunca grava `contacts.folderId`. O campo continua no banco e no schema até a Task 8 (vira `legacyFolderId`), e só a fase 2 (outro PR) o apaga.
- **Migration:** `prisma/migrations/20261029120000_contact_folder_links/`. Em produção: `prisma db execute` + `migrate resolve --applied`. **Nunca** `migrate deploy` nem `migrate dev` contra o Supabase.
- **i18n:** toda chave nova em `pt.json` e `en.json`. Hoje são 3236; no fim, 3241. Atualize o número no CLAUDE.md.
- **Commits:** `[CRM] - Verbo + Tarefa`, corpo curto, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nada de push sem o usuário pedir.
- **Antes de cada commit:** `npm run typecheck && npx eslint . --ignore-pattern ".claude/**" && npm run build && npm run check:isolation && npm run check:node`, mais `check:folders` e `check:folders:db` a partir da task que os cria.
- **Adaptação da rodada de grupo:** a `sourceContacts` da `feature/crm-grupo-whatsapp` não existe na `main` e **não** entra neste plano. Quem for mergeado por último adapta (spec, seção "Relação com…").

## Review Focus

1. **Contato de outra empresa no pedido.** Um id de contato da empresa B, mandado pela empresa A para mover ou adicionar, não cria vínculo em nenhuma das duas (Task 4 e Task 5, casos `foreign contact`).
2. **Dois descartados na mesma pasta na mesclagem.** Com L1 e L2 na pasta F2 e o principal fora dela, o principal fica uma vez só em F2, sem P2002 (Task 2 `mergeLinkPlan`; Task 7 DB).
3. **Apagar uma pasta com o gatilho ligado.** O `SET NULL` de `contacts.folderId` dispara o gatilho na mesma hora em que os vínculos são apagados em cascata. O contato continua nas outras pastas, sem erro (Task 1 DB).
4. **Ctrl ao soltar em "Sem pasta" ou na pasta aberta.** Em "Sem pasta" é igual a sem Ctrl: tira de todas. Na pasta aberta não acontece nada (Task 2 `applyFolderDrop`).
5. **Contato em duas pastas escolhidas no e-mail em massa.** Recebe um e-mail só, e a contagem de cada pasta o inclui (Task 6 DB).

---

### Task 1: Tabela de vínculo, gatilho da fase 1 e isolamento

**Files:**
- Modify: `prisma/schema.prisma` (model novo depois de `ContactFolder`; `Contact.folderLinks`; `ContactFolder.links`)
- Create: `prisma/migrations/20261029120000_contact_folder_links/migration.sql`
- Modify: `src/lib/tenant-db.ts` (`"ContactFolderLink"` logo depois de `"ContactFolder"` em `TENANT_MODELS`)
- Modify: `scripts/check-isolation.ts` (bloco novo antes do `✅`; limpeza no `finally`)
- Create: `scripts/check-contact-folders-db.ts`
- Modify: `package.json` (`"check:folders:db": "tsx --tsconfig scripts/tsconfig.server.json --env-file=.env scripts/check-contact-folders-db.ts"`)
- Modify: `docs/guia/03-multi-tenancy.md` (`TENANT_MODELS` 78 → 79; asserções 24 → 27; "vínculo de contato com pasta" na lista do que o script popula)
- Modify: `docs/guia/06-antes-de-commitar.md` (parágrafo de `check:folders:db` depois do de `check:imap`)
- Modify: `README.md` (§3.5: `ContactFolderLink` depois de `ContactFolder`; §8 "Migrações": entrada "Antes do merge da branch `feature/crm-contato-varias-pastas`", com os três passos do runbook da spec)

**Interfaces:**
- Produces: o model `ContactFolderLink` exatamente como na spec (seção "Modelo de dados"), `Contact.folderLinks: ContactFolderLink[]`, `ContactFolder.links: ContactFolderLink[]`.
- Produces: `scripts/check-contact-folders-db.ts` com `check(name, fn)` assíncrono. Cria as empresas A e B (`slug` com `Date.now()`), registra tudo o que cria e apaga no `finally`, nesta ordem: vínculos, contatos, pastas, empresas. As tasks seguintes só acrescentam casos.

- [ ] **Step 1: Preparar o worktree com banco próprio**

```bash
cp ../../../.env .env
docker exec metodoai-db createdb -U metodoai metodoai_pastas
```
No `.env` do worktree, troque só o nome do banco em `DATABASE_URL` (`/metodoai?` → `/metodoai_pastas?`, ou `/metodoai` no fim). Depois:
```bash
npm ci
npx prisma migrate deploy
npm run db:seed
```
Run: `npx prisma migrate status`. Expected: "Database schema is up to date", e a linha do datasource mostra o banco `metodoai_pastas`.

- [ ] **Step 2: Escrever o caso que falha (gatilho)**

Em `scripts/check-contact-folders-db.ts`, com `PrismaClient` + `PrismaPg` (como `check-isolation.ts`), crie as pastas FA1, FA2 e FA3 na empresa A. Os contatos e o `folderId` só por SQL cru (`$executeRaw`), para o script sobreviver à renomeação da Task 8. `updatedAt` vai explícito no `INSERT`. Casos:
- `trigger: insert with folderId creates the link`: contato `t1` inserido com `folderId = FA1` → vínculos de `t1` = `[FA1]`.
- `trigger: changing folderId moves the link`: `UPDATE … SET "folderId" = FA2` → `[FA2]`.
- `trigger: an extra link survives a folderId change`: crie à mão o vínculo `t1`→FA3 e depois mude `folderId` para FA1 → `[FA1, FA3]` (ordenado).
- `trigger: folderId null removes only the legacy link`: `SET "folderId" = NULL` → `[FA3]`.
- `trigger: deleting a folder keeps the contact`: `t2` com `folderId = FA2` e vínculo extra em FA3; apague FA2 pelo Prisma → nenhum erro, `t2` existe e os vínculos dele são `[FA3]`.

Run: `npm run check:folders:db`. Expected: FAIL, porque a tabela `contact_folder_links` não existe.

- [ ] **Step 3: Schema e migration**

Altere o schema e rode `npx prisma migrate dev --create-only --name contact_folder_links`, contra `metodoai_pastas`. Renomeie a pasta gerada para `20261029120000_contact_folder_links`. O SQL gerado só pode ter a tabela, o índice único, o índice e as duas FKs. Acrescente ao fim, sem mudar o texto:

```sql
-- Fase 1: os vínculos atuais.
INSERT INTO "contact_folder_links" ("id", "organizationId", "contactId", "folderId", "createdAt")
SELECT gen_random_uuid()::text, c."organizationId", c."id", c."folderId", now()
FROM "contacts" c
WHERE c."folderId" IS NOT NULL
ON CONFLICT ("contactId", "folderId") DO NOTHING;

-- Fase 1: espelha o que o código antigo gravar em contacts.folderId até o deploy.
-- O código novo nunca grava folderId. A fase 2 apaga a função, o gatilho e a coluna.
CREATE FUNCTION "contact_folder_link_sync"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."folderId" IS NOT NULL AND OLD."folderId" IS DISTINCT FROM NEW."folderId" THEN
    DELETE FROM "contact_folder_links" WHERE "contactId" = NEW."id" AND "folderId" = OLD."folderId";
  END IF;
  IF NEW."folderId" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."folderId" IS DISTINCT FROM NEW."folderId") THEN
    INSERT INTO "contact_folder_links" ("id", "organizationId", "contactId", "folderId", "createdAt")
    VALUES (gen_random_uuid()::text, NEW."organizationId", NEW."id", NEW."folderId", now())
    ON CONFLICT ("contactId", "folderId") DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contacts_folder_link_sync"
AFTER INSERT OR UPDATE OF "folderId" ON "contacts"
FOR EACH ROW EXECUTE FUNCTION "contact_folder_link_sync"();
```
Aplique com `npx prisma migrate dev` (só no `metodoai_pastas`) e acrescente `ContactFolderLink` ao `TENANT_MODELS`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run check:folders:db`. Expected: os 5 casos com `✓`.

- [ ] **Step 5: Isolamento**

Em `check-isolation.ts`, crie uma pasta e um contato em cada empresa, com o vínculo de cada um. Mais três `assert`:
- `"a contact-folder link read scoped by org A returns only org A's link"`;
- `"a contact-folder link deleteMany with the wrong org affects 0 rows"`: `where: { id: linkA.id, organizationId: orgB.id }`;
- `"the same contact twice in one folder is refused (P2002)"`.

No `finally`, antes de `company.deleteMany`, apague vínculos, contatos e pastas de contato de `created.orgs`.

Run: `npm run check:isolation`. Expected: `✅ Tenant isolation: all checks passed.`, com 27 `✓`.

- [ ] **Step 6: Guias e README, os cinco checks, commit**

`[CRM] - Adiciona a tabela de vínculo entre contato e pasta`

---

### Task 2: Regras puras das pastas

**Files:**
- Create: `src/lib/crm/contact-folders-core.ts` (sem `server-only`, sem Prisma, sem React)
- Create: `scripts/check-contact-folders.ts`
- Modify: `package.json` (`"check:folders": "tsx scripts/check-contact-folders.ts"`)
- Modify: `docs/guia/06-antes-de-commitar.md` (parágrafo de `check:folders` junto aos de `check:tasks`/`check:automation`)

**Interfaces:**
- Produces:
  ```ts
  export type FolderColumn<T> = { id: string | null; name: string; items: T[] };
  export type FolderDropMode = "move" | "add";
  export function applyFolderDrop<T extends { id: string }>(
    cols: FolderColumn<T>[], ids: readonly string[], from: string | null, to: string | null, mode: FolderDropMode,
  ): FolderColumn<T>[];
  export type ContactCard = {
    id: string; name: string; email: string | null; phone: string | null; companyName: string | null; folderNames: string[];
  };
  export type ContactColumn = { id: string | null; name: string; contacts: ContactCard[] };
  export type BoardContact = Omit<ContactCard, "folderNames"> & { folderIds: string[] };
  export function buildContactColumns(folders: { id: string; name: string }[], contacts: BoardContact[]): ContactColumn[];
  export function mergeLinkPlan(
    primaryFolderIds: readonly string[], loserLinks: readonly { id: string; folderId: string }[],
  ): { deleteIds: string[]; repointIds: string[] };
  ```

**Regras de `applyFolderDrop`:**
- Os itens que andam são os de `ids` que estão na coluna `from`. Se nenhum estiver lá, ou se `to === from`, devolve o mesmo array `cols` (mesma referência), para o explorador saber que não há nada a gravar.
- `to === null`: tira os itens de todas as colunas de pasta e os põe no começo de "Sem pasta", sem repetir. O `mode` não importa.
- `to !== null`: põe no começo de `to` os que ainda não estão lá. Com `from === null`, tira de "Sem pasta" em qualquer `mode`. Com `from !== null` e `mode === "move"`, tira de `from`.

- [ ] **Step 1: Escrever os testes**

Use `node:assert/strict` e o `check()` de `check-task-board.ts`. Os itens são `{ id }`, e as colunas são U (`null`), A, B e C. A base é U=[], A=[c1,c2], B=[c3], C=[c1]. Compare as listas de ids:
- `move c1 A→B`: A=[c2], B=[c1,c3], C=[c1], U=[].
- `add c1 A→B`: A=[c1,c2], B=[c1,c3].
- `move c1 A→C keeps one copy in C`: A=[c2], C=[c1].
- `move c1 A→Sem pasta takes it out of every folder`: A=[c2], C=[], U=[c1]. Com `"add"`, o mesmo resultado.
- `from Sem pasta`: com U=[c4], `move c4 U→A` dá U=[], A=[c4,c1,c2]. Com `"add"`, o mesmo.
- `dropping on the open folder changes nothing`: `A→A` devolve as mesmas listas.
- `ids outside the source are ignored`: `move c3 A→B` não muda nada.
- `buildContactColumns`: pastas `[F1 "Clientes", F2 "Feira"]` e contatos `x` (`folderIds` `["F2","F1"]`), `y` (`[]`) e `z` (`["gone"]`). Resultado: `[{id:null,name:"",contacts:[y,z]}, {id:"F1",…,[x]}, {id:"F2",…,[x]}]`. `x.folderNames` é `["Clientes","Feira"]` (ordem das pastas) e `z.folderNames` é `[]`.
- `mergeLinkPlan`: com principal em `["F1"]` e descartados `l1:F1, l2:F2, l3:F2, l4:F3`, o resultado é `{ deleteIds: ["l1","l3"], repointIds: ["l2","l4"] }`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run check:folders`. Expected: FAIL, porque o módulo `contact-folders-core` não existe.

- [ ] **Step 3: Implementar as três funções em `contact-folders-core.ts`**

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run check:folders`. Expected: todos com `✓`.

- [ ] **Step 5: Os cinco checks, commit**

`[CRM] - Adiciona as regras puras das pastas de contato`

---

### Task 3: Ver em que pastas o contato está

**Files:**
- Modify: `src/lib/queries/contact-folders.ts` (`getContactsBoard` pelos vínculos; os tipos passam a vir do core)
- Modify: `src/lib/queries/contacts.ts` (`getContact` ganha os nomes das pastas)
- Modify: `src/components/crm/contacts-grid.tsx` (selo no cartão e na linha da lista)
- Modify: `src/app/[locale]/app/contacts/[id]/page.tsx` (linha "Pastas")
- Modify: `src/messages/pt.json`, `src/messages/en.json`, `CLAUDE.md` (3236 → 3238)
- Modify: `scripts/check-contact-folders-db.ts`

**Interfaces:**
- Consumes: `buildContactColumns`, `ContactCard`, `ContactColumn`, `BoardContact` (Task 2).
- Produces: `src/lib/queries/contact-folders.ts` reexporta `export type { ContactCard, ContactColumn } from "@/lib/crm/contact-folders-core"`. O import de `contacts-grid.tsx` não muda.
- Produces: `getContact` devolve também `folderLinks: { folder: { name: string; order: number; createdAt: Date } }[]`.
- i18n: `crm.contacts.folderBadge` = `"{count} pastas"` / `"{count} folders"`; `crm.contacts.folders` = `"Pastas"` / `"Folders"`.

- [ ] **Step 1: Escrever os casos de banco**

Os casos chamam `getContactsBoard` e `getContact` de verdade. O import é `@/lib/queries/…`, e o `server-only` vem do shim:
- `board: a contact in two folders shows in both`: `x` com vínculos em FA1 e FA2 → as colunas FA1 e FA2 contêm `x`, "Sem pasta" não, e `x.folderNames` = nomes de FA1 e FA2 na ordem das pastas.
- `board: a contact without links is in Sem pasta`.
- `board: a link pointing at another org's contact never shows it`: com o Prisma cru, crie na empresa A um vínculo de FA1 para um contato da empresa B → o quadro de A não tem esse contato em coluna nenhuma.
- `getContact lists the contact's folders`: `getContact(orgA, x.id)` → dois nomes.

Run: `npm run check:folders:db`. Expected: FAIL, porque `folderNames` é `undefined`.

- [ ] **Step 2: Implementar**

- `getContactsBoard`: lê os contatos com `folderLinks: { select: { folderId: true } }` e monta com `buildContactColumns`.
- `getContact`: acrescenta os nomes das pastas.
- Página do contato: a linha `{ label: t("folders"), value }` vai depois de "Tags", com os nomes ordenados por `order` e depois `createdAt`, separados por `", "`, ou `"—"`.
- Cartão (grade e lista): com `folderNames.length >= 2`, um selo `rounded-full bg-muted px-2 py-0.5 text-xs`, como o contador das pastas, ao lado do nome, com o texto `t("folderBadge", { count })` e `title={folderNames.join(", ")}`.

- [ ] **Step 3: Rodar e ver passar**

Run: `npm run check:folders:db`. Expected: todos com `✓`.

- [ ] **Step 4: Os cinco checks, commit**

`[CRM] - Mostra em que pastas o contato está`

---

### Task 4: Mover tira só da pasta aberta

**Files:**
- Create: `src/lib/crm/contact-folder-links.ts`
- Modify: `src/app/actions/bulk.ts` (`bulkMoveContacts`)
- Modify: `src/app/actions/contact-folders.ts` (apagar `moveContact`, que não tem chamador)
- Modify: `src/components/crm/folder-explorer.tsx`
- Modify: `src/components/crm/contacts-grid.tsx`
- Modify: `scripts/check-contact-folders-db.ts`

**Interfaces:**
- Consumes: `applyFolderDrop`, `FolderColumn` (Task 2).
- Produces, em `contact-folder-links.ts` (`import "server-only"`, `type Db = ReturnType<typeof tenantDb>`, como em `import-folders.ts`):
  ```ts
  export async function ownContactIds(db: Db, ids: readonly string[]): Promise<string[]>;
  /** null = `to` não é pasta desta empresa; senão, quantos contatos desta empresa foram movidos. */
  export async function moveContactsToFolder(
    db: Db, organizationId: string, ids: readonly string[], to: string | null, from: string | null,
  ): Promise<number | null>;
  ```
  O destino vem antes da origem em todas as camadas: no DAL, em `bulkMoveContacts` e em `onMoveItems`.
  A regra é a mesma do arraste sem tecla. Com `to === null`, apaga todos os vínculos dos ids. Senão, numa `db.$transaction`, faz `createMany` em `to` com `skipDuplicates` e, com `from !== null`, `deleteMany` de `from`. Com `to === from`, devolve 0 sem gravar.
- Produces: `bulkMoveContacts(ids: string[], folderId: string | null, fromFolderId: string | null): Promise<BulkResult>`. `null` do DAL vira `{ ok: false, error: "invalid" }`.
- Produces, no explorador:
  - `onMoveItems: (itemIds: string[], folderId: string | null, fromFolderId: string | null) => …`, com `fromFolderId` = a pasta aberta;
  - `BulkContext.openFolderId: string | null`;
  - `FolderColumn` importado do core e reexportado, para que `companies-grid.tsx` não mude;
  - o `onDrop` usa `applyFolderDrop(…, "move")` e não chama o servidor quando ele devolve o mesmo `cols`.
- Em `contacts-grid.tsx`: `onMoveItems={(ids, to, from) => bulkMoveContacts(ids, to, from)}`, e o `onMove` da barra chama `bulkMoveContacts(ids, folderId, openFolderId)`.

- [ ] **Step 1: Escrever os casos de banco**

Os casos chamam `moveContactsToFolder(tenantDb(orgA.id), orgA.id, ids, to, from)`:
- `move: A→B keeps the contact's other folders`: `x` em FA1 e FA3, mover FA1→FA2 → `[FA2, FA3]`.
- `move: to Sem pasta removes every link` → `[]`.
- `move: from Sem pasta adds the folder` (`from = null`, `to = FA1`) → `[FA1]`.
- `move: into a folder it is already in` (`x` em FA1 e FA2, mover FA1→FA2) → `[FA2]`, sem erro.
- `move: same folder is a no-op` → devolve 0 e os vínculos não mudam.
- `move: another org's folder is refused` (`to` = pasta da empresa B) → `null` e nada muda.
- `move: foreign contact` (ids = `[x, contatoDeB]`, FA1→FA2) → devolve 1, e não existe vínculo do contato de B em nenhuma empresa.

Run: `npm run check:folders:db`. Expected: FAIL, porque o módulo `contact-folder-links` não existe.

- [ ] **Step 2: Implementar o DAL, a action e o explorador**

- [ ] **Step 3: Rodar e ver passar**

Run: `npm run check:folders:db`. Expected: todos com `✓`.

- [ ] **Step 4: Os cinco checks, commit**

`[CRM] - Move o contato só da pasta aberta`

---

### Task 5: Adicionar à pasta e tirar desta pasta

**Files:**
- Modify: `src/lib/crm/contact-folder-links.ts`
- Modify: `src/app/actions/bulk.ts`
- Modify: `src/components/crm/folder-explorer.tsx`
- Modify: `src/components/crm/bulk-bar.tsx`
- Modify: `src/components/crm/contacts-grid.tsx`
- Modify: `src/messages/pt.json`, `src/messages/en.json`, `CLAUDE.md` (3238 → 3241)
- Modify: `scripts/check-contact-folders-db.ts`

**Interfaces:**
- Consumes: `ownContactIds`, `applyFolderDrop`, `BulkContext.openFolderId` (Tasks 2 e 4).
- Produces, no DAL:
  ```ts
  /** null = a pasta não é desta empresa; senão, quantos vínculos novos. */
  export async function addContactsToFolder(db: Db, organizationId: string, ids: readonly string[], folderId: string): Promise<number | null>;
  /** Quantos vínculos foram apagados. */
  export async function removeContactsFromFolder(db: Db, ids: readonly string[], folderId: string): Promise<number>;
  ```
- Produces, nas actions: `bulkAddContactsToFolder(ids: string[], folderId: string): Promise<BulkResult>` e `bulkRemoveContactsFromFolder(ids: string[], folderId: string): Promise<BulkResult>`.
- Produces, no explorador:
  - prop opcional `onAddItems?: (itemIds: string[], folderId: string) => Promise<unknown> | void`;
  - `ExplorerLabels.copyHint?: string`, mostrado depois do `dragHint` quando `onAddItems` existe;
  - soltar com `e.ctrlKey`, com `onAddItems` presente e `to !== null`, usa `mode = "add"`; em qualquer outro caso, `"move"`;
  - no `onDragOver` dos blocos, `e.dataTransfer.dropEffect = onAddItems && e.ctrlKey ? "copy" : "move"`.
- Produces, na barra de seleção: props opcionais `onAdd?: (folderId: string) => Promise<unknown>`, `onRemoveFromFolder?: () => Promise<unknown>` e `openFolderId?: string | null`.
  - "Adicionar à pasta…" (ícone `FolderPlus`) é um `<select>` igual ao "Mover para", sem "Sem pasta" e sem a pasta aberta.
  - "Tirar desta pasta" (`FolderMinus`) é um botão `outline`.
  - Em Contatos, `onRemoveFromFolder` só é passado quando `openFolderId !== null`.
- i18n:
  - `crm.bulk.addTo` = `"Adicionar à pasta…"` / `"Add to folder…"`;
  - `crm.bulk.removeFromFolder` = `"Tirar desta pasta"` / `"Remove from this folder"`;
  - `crm.contacts.copyHint` = `"Ctrl ao soltar mantém também na pasta atual"` / `"Hold Ctrl when dropping to keep it here too"`.

- [ ] **Step 1: Escrever os casos de banco**

- `add: keeps the current folders` (`x` em FA1, adicionar FA2) → `[FA1, FA2]`, e devolve 1.
- `add: twice is harmless` → a segunda vez devolve 0, sem erro.
- `add: another org's folder is refused` → `null`.
- `add: foreign contact` → nenhum vínculo para o contato da empresa B.
- `remove: only from that folder` (`x` em FA1 e FA2, tirar de FA1) → `[FA2]`.
- `remove: the last folder sends it to Sem pasta` → `[]`, e `getContactsBoard` põe `x` em "Sem pasta".

Run: `npm run check:folders:db`. Expected: FAIL, porque `addContactsToFolder` não é exportado.

- [ ] **Step 2: Implementar o DAL, as actions, o explorador, a barra e as chaves**

- [ ] **Step 3: Rodar e ver passar**

Run: `npm run check:folders:db`. Expected: todos com `✓`.

- [ ] **Step 4: Os cinco checks, commit**

`[CRM] - Adiciona contato a mais de uma pasta`

---

### Task 6: Filtros por pasta no e-mail em massa e nas campanhas

**Files:**
- Modify: `src/lib/email-broadcast/audience.ts:22`
- Modify: `src/lib/queries/contact-folders.ts` (função nova)
- Modify: `src/lib/queries/email-broadcasts.ts` (`emailComposerOptions`)
- Modify: `src/lib/queries/campaigns.ts:23` (`audienceWhere`)
- Modify: `scripts/check-contact-folders-db.ts`

**Interfaces:**
- Produces: `contactFolderEmailCounts(organizationId: string): Promise<Map<string, number>>`, em `queries/contact-folders.ts`. Conta, por pasta, os contatos com e-mail (`contains: "@"`) e sem opt-out (`contactFolderLink.groupBy` com filtro na relação `contact`). `emailComposerOptions` passa a usá-la, e a consulta de contatos dela fica só com `tags`.
- O filtro de pasta vira `folderLinks: { some: { folderId: { in: ids } } }` em `audience.ts` e `folderLinks: { some: { folderId } }` em `audienceWhere`.

- [ ] **Step 1: Escrever os casos de banco**

`x` tem e-mail e está em FA1 e FA2. `o` tem e-mail, está em FA1 e tem `optedOut: true`.
- `e-mail: a contact in two chosen folders gets one e-mail`: `resolveAudience(orgA.id, { ...EMPTY_AUDIENCE, contactFolderIds: [FA1, FA2] })` → em `.recipients`, o e-mail de `x` aparece uma vez e o de `o` não aparece.
- `e-mail: folder counts include a contact in both folders`: `contactFolderEmailCounts(orgA.id)` → FA1 = 1, FA2 = 1.
- `campaign: folder filter matches by link`: `tenantDb(orgA.id).contact.count({ where: audienceWhere("EMAIL", { folderId: FA2 }) })` = 1.

Run: `npm run check:folders:db`. Expected: FAIL, porque a seleção por pasta ainda lê `folderId` e não acha `x` em FA2.

- [ ] **Step 2: Implementar**

- [ ] **Step 3: Rodar e ver passar**

Run: `npm run check:folders:db`. Expected: todos com `✓`.

- [ ] **Step 4: Os cinco checks, commit**

`[CRM] - Filtra contatos por pasta pelos vínculos`

---

### Task 7: Importações e mesclagem

**Files:**
- Modify: `src/lib/crm/contact-folder-links.ts`
- Modify: `src/app/actions/merge.ts` (dentro da transação, antes de `tx.contact.deleteMany`)
- Modify: `src/app/actions/extractions.ts:242`
- Modify: `src/app/actions/import-csv.ts:123` (só o contato; a empresa, na linha 208, não muda)
- Modify: `src/app/actions/inbox.ts` (`createContacts`, `importConversationContacts`, `importGroup`)
- Modify: `scripts/check-contact-folders-db.ts`

**Interfaces:**
- Consumes: `mergeLinkPlan` (Task 2).
- Produces:
  ```ts
  export async function mergeContactFolderLinks(
    tx: Pick<Db, "contactFolderLink">, primaryId: string, loserIds: readonly string[],
  ): Promise<void>;
  ```
  Lê os vínculos do principal e dos descartados, aplica `mergeLinkPlan`, faz `deleteMany` dos `deleteIds` e `updateMany` dos `repointIds` para `contactId: primaryId`.
- Contato criado por prospecção ou planilha: `folderLinks: { create: { organizationId, folderId } }` no lugar de `folderId`. O `organizationId` vai explícito, porque o extends não alcança o `create` aninhado.
- `inbox.ts`: `createContacts(db: Db, organizationId: string, rows: { name: string; phone: string }[], folderId: string): Promise<void>`.
  - A cada 500, chama `createManyAndReturn` com `organizationId` já no `data` e `select: { id: true }`, e depois `contactFolderLink.createMany`.
  - Um comentário cita o guia 03: `createManyAndReturn` não está em `WHERE_OPS`, e por isso a organização vai à mão.
  - A numeração do `importGroup` lê `where: { folderLinks: { some: { folderId: existingFolder } }, name: { startsWith: CONTACT_NAME_PREFIX } }`.

- [ ] **Step 1: Escrever o caso de banco**

`merge: the primary ends up in every folder`. P está em FA1; L1 em FA1 e FA2; L2 em FA2 e FA3. Chame `tenantDb(orgA.id).$transaction((tx) => mergeContactFolderLinks(tx, P, [L1, L2]))`. Resultado: P em `[FA1, FA2, FA3]` e nenhum vínculo sobrando para L1 ou L2.

Run: `npm run check:folders:db`. Expected: FAIL, porque `mergeContactFolderLinks` não é exportado.

- [ ] **Step 2: Implementar a mesclagem e as três importações**

- [ ] **Step 3: Rodar e ver passar**

Run: `npm run check:folders:db`. Expected: todos com `✓`.

- [ ] **Step 4: Os cinco checks, commit**

`[CRM] - Grava pastas pelos vínculos nas importações e na mesclagem`

---

### Task 8: Campo legado, pendência da fase 2 e teste no navegador

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `README.md` (§10: pendência "Fase 2 de contato em várias pastas", com o passo a passo da spec)

**Interfaces:**
- `Contact.folderId` → `legacyFolderId String? @map("folderId")`; `folder` → `legacyFolder`; `ContactFolder.contacts` → `legacyContacts`.
- O comentário `///` diz que o campo é obsoleto, que só o gatilho `contact_folder_link_sync` o usa e que a fase 2 o apaga.
- O banco não muda.

- [ ] **Step 1: Renomear e provar que o banco não muda**

Run: `npx prisma migrate dev --create-only --name noop`. Expected: nenhuma migration nova ("Already in sync" ou equivalente). Se o Prisma quiser renomear índice ou FK, fixe o nome antigo com `map: "contacts_organizationId_folderId_idx"` (ou o nome que o SQL da Task 1 mostra) e rode de novo.

- [ ] **Step 2: Provar que ninguém usa o campo antigo**

Run: `npm run typecheck`. Expected: sem erros. Qualquer uso esquecido de `contact.folderId` quebraria aqui.
Run: `git grep -n "folderId" -- src`. Expected: só `ContactFolderLink`, empresas, conversas, campanhas (`AudienceFilter.folderId`), a seleção do e-mail (`contactFolderIds`/`companyFolderIds`) e a equipe.

- [ ] **Step 3: Teste no navegador**

Antes, veja quem está na porta 3000 (`Get-CimInstance Win32_Process`, linha de comando do `next dev`). Se for o servidor da outra aba, **pergunte ao usuário** antes de derrubar. Depois, `npx next dev --webpack` neste worktree.

Logue com o dono do seed (`emailVerified` e `organizations.ownerId` à mão, como em `metodoai-local-env-windows`). Percorra os 10 itens do "Teste manual" da spec. No item 9, importe uma planilha CSV, sem grupo do WhatsApp: nunca mande nem leia nada de WhatsApp de verdade. Os itens 7 e 8 só montam a audiência, sem enviar.

Expected: os 10 itens se comportam como a spec descreve.

- [ ] **Step 4: Todos os checks e commit**

Run: os cinco + `npm run check:folders` + `npm run check:folders:db`. Expected: tudo verde.

`[CRM] - Marca a pasta única do contato como legado`

-- CreateTable
CREATE TABLE "contact_folder_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_folder_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_folder_links_organizationId_folderId_idx" ON "contact_folder_links"("organizationId", "folderId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_folder_links_contactId_folderId_key" ON "contact_folder_links"("contactId", "folderId");

-- AddForeignKey
ALTER TABLE "contact_folder_links" ADD CONSTRAINT "contact_folder_links_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_folder_links" ADD CONSTRAINT "contact_folder_links_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "contact_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fase 1: espelha o que o código antigo gravar em contacts.folderId até o deploy.
-- Vem antes da cópia: uma escrita do código antigo durante a cópia também é espelhada.
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

-- Fase 1: os vínculos atuais (depois do gatilho; os dois usam ON CONFLICT DO NOTHING).
INSERT INTO "contact_folder_links" ("id", "organizationId", "contactId", "folderId", "createdAt")
SELECT gen_random_uuid()::text, c."organizationId", c."id", c."folderId", now()
FROM "contacts" c
WHERE c."folderId" IS NOT NULL
ON CONFLICT ("contactId", "folderId") DO NOTHING;

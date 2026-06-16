-- Link campaign recipients to their contact with ON DELETE CASCADE, so removing
-- a contact also removes its slots from every campaign (no orphan "—" rows).

-- 1) Remove pre-existing orphans (recipients whose contact was already deleted),
--    otherwise the foreign key would fail to validate.
DELETE FROM "campaign_recipients" cr
WHERE NOT EXISTS (
  SELECT 1 FROM "contacts" c WHERE c.id = cr."contactId"
);

-- 2) Add the foreign key.
ALTER TABLE "campaign_recipients"
  ADD CONSTRAINT "campaign_recipients_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

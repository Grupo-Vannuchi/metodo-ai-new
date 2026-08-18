-- "Monte seu Método" onboarding marker. Null = the owner hasn't picked their
-- first modules yet (fresh org). Existing orgs are already set up (they have
-- modules from the module backfill), so mark them onboarded.
ALTER TABLE "organizations" ADD COLUMN "onboardedAt" TIMESTAMP(3);
UPDATE "organizations" SET "onboardedAt" = now();

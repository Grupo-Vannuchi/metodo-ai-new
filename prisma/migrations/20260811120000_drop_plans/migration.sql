-- Plans are gone: with modularity, capability = installed modules and limits are
-- global (src/config/limits.ts). Drop the plan tier from Organization.
ALTER TABLE "organizations" DROP COLUMN "plan";
ALTER TABLE "organizations" DROP COLUMN "seatLimit";
DROP TYPE "Plan";

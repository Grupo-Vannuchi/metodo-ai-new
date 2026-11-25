-- Adds the user's session version (sessions signed with an older one stop working). Additive: a column with a default;
-- existing rows get 0, which is what a session signed before this change carries, so nobody is signed out by it.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

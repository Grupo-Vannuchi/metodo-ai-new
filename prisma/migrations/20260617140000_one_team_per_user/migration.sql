-- Enforce one team (organization) per user.

-- Defensive: if any user has more than one membership, keep a single one —
-- prefer an OWNER membership, then the earliest — and drop the rest.
DELETE FROM "memberships" m
USING (
  SELECT id, row_number() OVER (
    PARTITION BY "userId"
    ORDER BY (CASE WHEN role = 'OWNER' THEN 0 ELSE 1 END), "createdAt"
  ) AS rn
  FROM "memberships"
) ranked
WHERE m.id = ranked.id AND ranked.rn > 1;

-- Replace the non-unique userId index with a unique one.
DROP INDEX IF EXISTS "memberships_userId_idx";
CREATE UNIQUE INDEX "memberships_userId_key" ON "memberships"("userId");

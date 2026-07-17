-- CreateEnum
CREATE TYPE "FeedCategory" AS ENUM ('GENERAL', 'ANNOUNCEMENT', 'NEWS', 'EVENT', 'PRAISE');

-- AlterTable
ALTER TABLE "feed_posts" ADD COLUMN     "category" "FeedCategory" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "pinnedAt" TIMESTAMP(3);

-- Backfill: preserve the previous 24h-ephemeral behaviour for pre-existing posts.
-- Without this they'd become permanent (expiresAt IS NULL) and old, already-hidden
-- posts would resurface on the wall.
UPDATE "feed_posts" SET "expiresAt" = "createdAt" + INTERVAL '24 hours' WHERE "expiresAt" IS NULL;

-- CreateTable
CREATE TABLE "feed_comments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_poll_options" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "feed_poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_poll_votes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feed_comments_organizationId_idx" ON "feed_comments"("organizationId");

-- CreateIndex
CREATE INDEX "feed_comments_postId_createdAt_idx" ON "feed_comments"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "feed_poll_options_postId_idx" ON "feed_poll_options"("postId");

-- CreateIndex
CREATE INDEX "feed_poll_votes_organizationId_idx" ON "feed_poll_votes"("organizationId");

-- CreateIndex
CREATE INDEX "feed_poll_votes_optionId_idx" ON "feed_poll_votes"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "feed_poll_votes_postId_userId_key" ON "feed_poll_votes"("postId", "userId");

-- CreateIndex
CREATE INDEX "feed_posts_organizationId_pinnedAt_idx" ON "feed_posts"("organizationId", "pinnedAt");

-- AddForeignKey
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_poll_options" ADD CONSTRAINT "feed_poll_options_postId_fkey" FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_poll_options" ADD CONSTRAINT "feed_poll_options_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_poll_votes" ADD CONSTRAINT "feed_poll_votes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_poll_votes" ADD CONSTRAINT "feed_poll_votes_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "feed_poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_poll_votes" ADD CONSTRAINT "feed_poll_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_poll_votes" ADD CONSTRAINT "feed_poll_votes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


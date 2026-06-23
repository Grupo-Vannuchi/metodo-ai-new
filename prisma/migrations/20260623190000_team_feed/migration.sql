-- CreateTable
CREATE TABLE "feed_posts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feed_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_post_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "type" "TeamChatAttachmentType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,

    CONSTRAINT "feed_post_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_mentions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "feed_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_reactions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feed_posts_organizationId_createdAt_idx" ON "feed_posts"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "feed_post_attachments_organizationId_idx" ON "feed_post_attachments"("organizationId");

-- CreateIndex
CREATE INDEX "feed_post_attachments_postId_idx" ON "feed_post_attachments"("postId");

-- CreateIndex
CREATE INDEX "feed_mentions_organizationId_idx" ON "feed_mentions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "feed_mentions_postId_userId_key" ON "feed_mentions"("postId", "userId");

-- CreateIndex
CREATE INDEX "feed_reactions_organizationId_idx" ON "feed_reactions"("organizationId");

-- CreateIndex
CREATE INDEX "feed_reactions_postId_idx" ON "feed_reactions"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "feed_reactions_postId_userId_emoji_key" ON "feed_reactions"("postId", "userId", "emoji");

-- AddForeignKey
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_attachments" ADD CONSTRAINT "feed_post_attachments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_attachments" ADD CONSTRAINT "feed_post_attachments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_mentions" ADD CONSTRAINT "feed_mentions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_mentions" ADD CONSTRAINT "feed_mentions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_mentions" ADD CONSTRAINT "feed_mentions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


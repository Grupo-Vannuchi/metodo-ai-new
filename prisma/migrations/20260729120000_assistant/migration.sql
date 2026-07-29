-- AI copilot: conversation threads + messages (org-scoped tenant models).

CREATE TABLE "assistant_threads" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assistant_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_threads_organizationId_userId_updatedAt_idx" ON "assistant_threads"("organizationId", "userId", "updatedAt");

CREATE INDEX "assistant_messages_threadId_createdAt_idx" ON "assistant_messages"("threadId", "createdAt");

ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "assistant_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "WhatsappCloudMessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'STICKER', 'LOCATION', 'TEMPLATE', 'UNSUPPORTED');

-- CreateTable
CREATE TABLE "whatsapp_cloud_numbers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT,
    "verifiedName" TEXT,
    "qualityRating" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'INACTIVE',
    "lastError" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_cloud_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_cloud_conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "bsuid" TEXT,
    "waId" TEXT,
    "username" TEXT,
    "profileName" TEXT,
    "contactId" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_cloud_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_cloud_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "wamid" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "type" "WhatsappCloudMessageType" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "mediaId" TEXT,
    "mediaUrl" TEXT,
    "mediaMime" TEXT,
    "mediaName" TEXT,
    "mediaSize" INTEGER,
    "mediaStatus" "MediaStatus",
    "status" "MessageStatus",
    "errorCode" INTEGER,
    "errorMessage" TEXT,
    "pricingCategory" TEXT,
    "pricingType" TEXT,
    "reactions" JSONB NOT NULL DEFAULT '[]',
    "quotedWamid" TEXT,
    "quotedBody" TEXT,
    "sentById" TEXT,
    "campaignId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_cloud_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_cloud_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "metaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "parameterFormat" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "rejectedReason" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_cloud_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_cloud_campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "pausedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_cloud_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_cloud_numbers_phoneNumberId_key" ON "whatsapp_cloud_numbers"("phoneNumberId");

-- CreateIndex
CREATE INDEX "whatsapp_cloud_numbers_organizationId_idx" ON "whatsapp_cloud_numbers"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_cloud_numbers_organizationId_ownerId_key" ON "whatsapp_cloud_numbers"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "whatsapp_cloud_conversations_organizationId_lastMessageAt_idx" ON "whatsapp_cloud_conversations"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_cloud_conversations_numberId_bsuid_key" ON "whatsapp_cloud_conversations"("numberId", "bsuid");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_cloud_conversations_numberId_waId_key" ON "whatsapp_cloud_conversations"("numberId", "waId");

-- CreateIndex
CREATE INDEX "whatsapp_cloud_messages_conversationId_timestamp_idx" ON "whatsapp_cloud_messages"("conversationId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_cloud_messages_organizationId_wamid_key" ON "whatsapp_cloud_messages"("organizationId", "wamid");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_cloud_templates_organizationId_wabaId_name_languag_key" ON "whatsapp_cloud_templates"("organizationId", "wabaId", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_cloud_campaigns_campaignId_key" ON "whatsapp_cloud_campaigns"("campaignId");

-- CreateIndex
CREATE INDEX "whatsapp_cloud_campaigns_organizationId_idx" ON "whatsapp_cloud_campaigns"("organizationId");

-- CreateIndex
CREATE INDEX "whatsapp_cloud_campaigns_templateId_idx" ON "whatsapp_cloud_campaigns"("templateId");

-- AddForeignKey
ALTER TABLE "whatsapp_cloud_conversations" ADD CONSTRAINT "whatsapp_cloud_conversations_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "whatsapp_cloud_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_cloud_messages" ADD CONSTRAINT "whatsapp_cloud_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_cloud_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

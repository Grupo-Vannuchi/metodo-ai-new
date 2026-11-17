import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import type { ParamContext } from "@/lib/whatsapp-cloud/template-params";

/**
 * Leituras da tela oficial. WhatsApp é por vendedor: tudo passa pelo número do
 * próprio usuário (ownerId) — ninguém, nem admin, vê a conversa de outro.
 */

async function myNumberId(organizationId: string, userId: string): Promise<string | null> {
  const n = await tenantDb(organizationId).whatsappCloudNumber.findFirst({
    where: { ownerId: userId },
    select: { id: true },
  });
  return n?.id ?? null;
}

export async function getMyCloudNumber(organizationId: string, userId: string) {
  return tenantDb(organizationId).whatsappCloudNumber.findFirst({
    where: { ownerId: userId },
    select: {
      id: true,
      phoneNumberId: true,
      wabaId: true,
      displayPhoneNumber: true,
      verifiedName: true,
      qualityRating: true,
      status: true,
      lastError: true,
      checkedAt: true,
    },
  });
}
export type MyCloudNumber = NonNullable<Awaited<ReturnType<typeof getMyCloudNumber>>>;

export async function listCloudConversations(organizationId: string, userId: string) {
  const numberId = await myNumberId(organizationId, userId);
  if (!numberId) return [];
  const db = tenantDb(organizationId);
  const convos = await db.whatsappCloudConversation.findMany({
    where: { numberId },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      waId: true,
      bsuid: true,
      username: true,
      profileName: true,
      contactId: true,
      lastInboundAt: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      unreadCount: true,
    },
  });
  const contactIds = [...new Set(convos.map((c) => c.contactId).filter((id): id is string => !!id))];
  const contacts = contactIds.length
    ? await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(contacts.map((c) => [c.id, c.name]));
  return convos.map((c) => ({ ...c, contactName: c.contactId ? (names.get(c.contactId) ?? null) : null }));
}
export type CloudConversationRow = Awaited<ReturnType<typeof listCloudConversations>>[number];

/** Conversa em que o usuário pode agir (do número dele), ou null. */
export async function getOwnedCloudConversation(organizationId: string, userId: string, conversationId: string) {
  const numberId = await myNumberId(organizationId, userId);
  if (!numberId) return null;
  return tenantDb(organizationId).whatsappCloudConversation.findFirst({
    where: { id: conversationId, numberId },
    select: {
      id: true,
      numberId: true,
      waId: true,
      bsuid: true,
      contactId: true,
      profileName: true,
      lastInboundAt: true,
    },
  });
}

/** Últimas 200 mensagens, da mais antiga para a mais nova. */
export async function listCloudMessages(organizationId: string, userId: string, conversationId: string) {
  const convo = await getOwnedCloudConversation(organizationId, userId, conversationId);
  if (!convo) return [];
  const rows = await tenantDb(organizationId).whatsappCloudMessage.findMany({
    where: { conversationId },
    orderBy: { timestamp: "desc" },
    take: 200,
    select: {
      id: true,
      wamid: true,
      direction: true,
      type: true,
      body: true,
      templateName: true,
      mediaUrl: true,
      mediaMime: true,
      mediaName: true,
      mediaStatus: true,
      status: true,
      errorMessage: true,
      reactions: true,
      quotedWamid: true,
      quotedBody: true,
      timestamp: true,
    },
  });
  return rows.reverse();
}
export type CloudMessageRow = Awaited<ReturnType<typeof listCloudMessages>>[number];

export async function getOwnedCloudMessage(organizationId: string, userId: string, messageId: string) {
  const numberId = await myNumberId(organizationId, userId);
  if (!numberId) return null;
  return tenantDb(organizationId).whatsappCloudMessage.findFirst({
    where: { id: messageId, conversation: { numberId } },
    select: {
      id: true,
      wamid: true,
      reactions: true,
      timestamp: true,
      conversationId: true,
      conversation: { select: { numberId: true, waId: true, bsuid: true } },
    },
  });
}

export async function getCloudMessageMedia(organizationId: string, messageId: string) {
  return tenantDb(organizationId).whatsappCloudMessage.findFirst({
    where: { id: messageId },
    select: { mediaUrl: true, mediaMime: true, mediaStatus: true, mediaName: true, mediaSize: true },
  });
}

export async function listCloudTemplates(organizationId: string, wabaId: string, opts?: { approvedOnly?: boolean }) {
  return tenantDb(organizationId).whatsappCloudTemplate.findMany({
    where: { wabaId, ...(opts?.approvedOnly ? { status: "APPROVED" } : {}) },
    orderBy: [{ name: "asc" }, { language: "asc" }],
    select: {
      id: true,
      name: true,
      language: true,
      category: true,
      status: true,
      parameterFormat: true,
      components: true,
      rejectedReason: true,
    },
  });
}
export type CloudTemplateRow = Awaited<ReturnType<typeof listCloudTemplates>>[number];

/** Até 10 contatos com telefone, por nome ou telefone (Nova conversa). */
export async function searchContactsWithPhone(organizationId: string, q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  return tenantDb(organizationId).contact.findMany({
    where: {
      phone: { not: null },
      OR: [{ name: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }],
    },
    orderBy: { name: "asc" },
    take: 10,
    select: { id: true, name: true, phone: true },
  });
}

export async function getContactParams(organizationId: string, contactId: string): Promise<ParamContext | null> {
  const c = await tenantDb(organizationId).contact.findFirst({
    where: { id: contactId },
    select: { name: true, company: { select: { name: true } } },
  });
  return c ? { nome: c.name ?? "", empresa: c.company?.name ?? "" } : null;
}

import "server-only";
import type { Prisma, WhatsappCloudMessageType } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { postMessage } from "@/lib/whatsapp-cloud/meta-api";
import { categorizeMetaError, isNumberLevelError, type MetaErrorCategory } from "@/lib/whatsapp-cloud/errors";
import { markNumberError, type NumberWithToken } from "@/lib/whatsapp-cloud/numbers";
import { previewFor } from "@/lib/whatsapp-cloud/preview";
import { isUniqueViolation } from "@/lib/whatsapp-cloud/prisma-errors";
import { brPhoneVariants } from "@/lib/whatsapp-cloud/identity";

export type CallResult =
  | { ok: true; wamid: string; waId: string | null; bsuid: string | null }
  | { ok: false; category: MetaErrorCategory; code: number | null; message: string };

/**
 * Envia uma mensagem à Meta. Erro de número (token, registro, conta) marca o número ERROR.
 * No sucesso devolve também o `wa_id`/`user_id` que a Meta resolveu para o destino
 * (`contacts[0]`) — o `wa_id` pode vir sem o 9º dígito do celular brasileiro.
 */
export async function callSend(number: NumberWithToken, payload: Record<string, unknown>): Promise<CallResult> {
  const res = await postMessage(number.phoneNumberId, number.token, payload);
  if (!res.ok) {
    const category = categorizeMetaError(res.code, res.status);
    if (isNumberLevelError(category)) await markNumberError(number.organizationId, number.id, res.message);
    console.error(`[wa-cloud] send failed (${res.code ?? res.status}): ${res.message}`);
    return { ok: false, category, code: res.code, message: res.message };
  }
  const wamid = res.data.messages?.[0]?.id;
  if (!wamid) return { ok: false, category: "unknown", code: null, message: "A Meta não devolveu o id da mensagem." };
  const contact = res.data.contacts?.[0];
  return { ok: true, wamid, waId: contact?.wa_id || null, bsuid: contact?.user_id || null };
}

export type OutboundRecord = {
  conversationId: string;
  wamid: string;
  type: WhatsappCloudMessageType;
  body: string | null;
  templateName?: string;
  templateLanguage?: string;
  media?: { url: string; mime: string; name: string | null; size: number };
  quotedWamid?: string | null;
  quotedBody?: string | null;
  sentById: string | null;
  campaignId?: string | null;
};

/** Grava uma mensagem já aceita pela Meta e atualiza a prévia da conversa. */
export async function recordOutbound(organizationId: string, r: OutboundRecord): Promise<string> {
  const db = tenantDb(organizationId);
  const now = new Date();
  const created = await db.whatsappCloudMessage.create({
    data: {
      organizationId,
      conversationId: r.conversationId,
      wamid: r.wamid,
      direction: "OUTBOUND",
      type: r.type,
      body: r.body,
      templateName: r.templateName ?? null,
      templateLanguage: r.templateLanguage ?? null,
      ...(r.media
        ? {
            mediaUrl: r.media.url,
            mediaMime: r.media.mime,
            mediaName: r.media.name,
            mediaSize: r.media.size,
            mediaStatus: "READY" as const,
          }
        : {}),
      status: "SENT",
      quotedWamid: r.quotedWamid ?? null,
      quotedBody: r.quotedBody ?? null,
      sentById: r.sentById,
      campaignId: r.campaignId ?? null,
      timestamp: now,
    },
    select: { id: true },
  });
  await db.whatsappCloudConversation.updateMany({
    where: { id: r.conversationId },
    data: { lastMessageAt: now, lastMessagePreview: previewFor(r.type, r.body) },
  });
  return created.id;
}

/**
 * Conversa do número com um telefone (campanha, Nova conversa): acha ou cria.
 * Acha pelo telefone com e sem o 9º dígito (celular brasileiro) ou pelo BSUID,
 * quando conhecido — a resposta do cliente cai na mesma conversa.
 */
export async function conversationForPhone(
  organizationId: string,
  numberId: string,
  waId: string,
  contactId: string | null,
  bsuid?: string | null,
): Promise<string> {
  const db = tenantDb(organizationId);
  const identity: Prisma.WhatsappCloudConversationWhereInput = {
    numberId,
    OR: [{ waId: { in: brPhoneVariants(waId) } }, ...(bsuid ? [{ bsuid }] : [])],
  };
  const found = await db.whatsappCloudConversation.findFirst({
    where: identity,
    select: { id: true, contactId: true },
  });
  if (found) {
    if (contactId && !found.contactId) {
      await db.whatsappCloudConversation.updateMany({ where: { id: found.id }, data: { contactId } });
    }
    return found.id;
  }
  try {
    const created = await db.whatsappCloudConversation.create({
      data: { organizationId, numberId, waId, contactId, ...(bsuid ? { bsuid } : {}) },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const again = await db.whatsappCloudConversation.findFirst({ where: identity, select: { id: true } });
    if (!again) throw error;
    return again.id;
  }
}

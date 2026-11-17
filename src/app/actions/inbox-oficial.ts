"use server";

import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { looksLikeWhatsappMobile, normalizeWhatsappNumber } from "@/lib/phone";
import { applyReaction, myReaction } from "@/lib/whatsapp/reactions";
import { resolveContactId } from "@/lib/whatsapp/ingest";
import { cloudGuard } from "@/lib/whatsapp-cloud/guard";
import { loadNumber, type NumberWithToken } from "@/lib/whatsapp-cloud/numbers";
import { callSend, conversationForPhone, recordOutbound } from "@/lib/whatsapp-cloud/send";
import { postMessage } from "@/lib/whatsapp-cloud/meta-api";
import { isWindowOpen } from "@/lib/whatsapp-cloud/window";
import { quotedLabel } from "@/lib/whatsapp-cloud/preview";
import { reactionPayload, readPayload, templatePayload, textPayload } from "@/lib/whatsapp-cloud/payloads";
import {
  buildTemplateComponents,
  renderTemplateText,
  templateVariables,
  toTemplateDef,
  unsupportedReason,
  type ParamContext,
} from "@/lib/whatsapp-cloud/template-params";
import type { MetaErrorCategory } from "@/lib/whatsapp-cloud/errors";
import {
  getContactParams,
  getMyCloudNumber,
  getOwnedCloudConversation,
  getOwnedCloudMessage,
  searchContactsWithPhone,
} from "@/lib/queries/inbox-oficial";

export type CloudActionError =
  | "unauthorized"
  | "not_enabled"
  | "not_found"
  | "no_number"
  | "empty"
  | "invalid"
  | MetaErrorCategory;

export type CloudActionResult = { ok: true } | { ok: false; error: CloudActionError; detail?: string };

const MAX_TEXT = 4096;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type OwnedConvo = NonNullable<Awaited<ReturnType<typeof getOwnedCloudConversation>>>;
type Owned =
  | { ok: true; orgId: string; userId: string; convo: OwnedConvo; number: NumberWithToken }
  | { ok: false; error: CloudActionError };

/** Sessão → liberação → conversa do número do usuário → número ativo. */
async function ownedConversation(conversationId: string): Promise<Owned> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const convo = await getOwnedCloudConversation(ctx.organizationId, ctx.userId, conversationId);
  if (!convo) return { ok: false, error: "not_found" };
  const number = await loadNumber(ctx.organizationId, convo.numberId);
  if (!number || number.status !== "ACTIVE") return { ok: false, error: "no_number" };
  return { ok: true, orgId: ctx.organizationId, userId: ctx.userId, convo, number };
}

/** Texto livre — só com a janela de 24h aberta (checado aqui, não só na tela). */
export async function sendCloudText(
  conversationId: string,
  text: string,
  replyToMessageId?: string | null,
): Promise<CloudActionResult> {
  const o = await ownedConversation(conversationId);
  if (!o.ok) return o;
  const body = text.trim().slice(0, MAX_TEXT);
  if (!body) return { ok: false, error: "empty" };
  if (!isWindowOpen(o.convo.lastInboundAt)) return { ok: false, error: "window_closed" };
  try {
    let quotedWamid: string | null = null;
    let quotedBody: string | null = null;
    if (replyToMessageId) {
      const q = await tenantDb(o.orgId).whatsappCloudMessage.findFirst({
        where: { id: replyToMessageId, conversationId },
        select: { wamid: true, body: true, type: true },
      });
      if (q?.wamid) {
        quotedWamid = q.wamid;
        quotedBody = quotedLabel(q.type, q.body);
      }
    }
    const res = await callSend(o.number, textPayload(o.convo, body, quotedWamid));
    if (!res.ok) return { ok: false, error: res.category, detail: res.message };
    // A Meta já aceitou: uma falha ao gravar não pode virar erro pro vendedor
    // (ele reenviaria e duplicaria a mensagem pro cliente).
    try {
      await recordOutbound(o.orgId, {
        conversationId,
        wamid: res.wamid,
        type: "TEXT",
        body,
        quotedWamid,
        quotedBody,
        sentById: o.userId,
      });
    } catch (error) {
      console.error("[wa-cloud] sent but not recorded", { wamid: res.wamid, conversationId }, error);
    }
    return { ok: true };
  } catch (error) {
    console.error("[wa-cloud] send text failed", error);
    return { ok: false, error: "unknown", detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Modelo aprovado — permitido a qualquer momento (abre/reabre a conversa). */
export async function sendCloudTemplate(
  conversationId: string,
  templateId: string,
  values: Record<string, string>,
): Promise<CloudActionResult> {
  const o = await ownedConversation(conversationId);
  if (!o.ok) return o;
  try {
    const row = await tenantDb(o.orgId).whatsappCloudTemplate.findFirst({
      where: { id: templateId, wabaId: o.number.wabaId, status: "APPROVED" },
      select: { name: true, language: true, parameterFormat: true, components: true },
    });
    if (!row) return { ok: false, error: "invalid" };
    const def = toTemplateDef(row);
    if (unsupportedReason(def)) return { ok: false, error: "invalid" };
    const clean: Record<string, string> = {};
    for (const v of templateVariables(def)) clean[v.id] = (values[v.id] ?? "").trim().slice(0, 1000) || "-";
    const res = await callSend(
      o.number,
      templatePayload(o.convo, def.name, def.language, buildTemplateComponents(def, clean)),
    );
    if (!res.ok) return { ok: false, error: res.category, detail: res.message };
    // A Meta já aceitou: uma falha ao gravar não pode virar erro pro vendedor
    // (ele reenviaria e duplicaria a mensagem pro cliente).
    try {
      await recordOutbound(o.orgId, {
        conversationId,
        wamid: res.wamid,
        type: "TEMPLATE",
        body: renderTemplateText(def, clean),
        templateName: def.name,
        templateLanguage: def.language,
        sentById: o.userId,
      });
    } catch (error) {
      console.error("[wa-cloud] sent but not recorded", { wamid: res.wamid, conversationId }, error);
    }
    return { ok: true };
  } catch (error) {
    console.error("[wa-cloud] send template failed", error);
    return { ok: false, error: "unknown", detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Reage (ou remove a própria reação tocando no mesmo emoji). Até 30 dias. */
export async function reactCloudMessage(messageId: string, emoji: string): Promise<CloudActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const msg = await getOwnedCloudMessage(ctx.organizationId, ctx.userId, messageId);
  if (!msg?.wamid) return { ok: false, error: "not_found" };
  if (Date.now() - msg.timestamp.getTime() > THIRTY_DAYS_MS) return { ok: false, error: "invalid" };
  const number = await loadNumber(ctx.organizationId, msg.conversation.numberId);
  if (!number || number.status !== "ACTIVE") return { ok: false, error: "no_number" };
  const finalEmoji = myReaction(msg.reactions) === emoji ? "" : emoji;
  const res = await callSend(number, reactionPayload(msg.conversation, msg.wamid, finalEmoji));
  if (!res.ok) return { ok: false, error: res.category, detail: res.message };
  const reactions = applyReaction(msg.reactions, { emoji: finalEmoji, fromMe: true });
  await tenantDb(ctx.organizationId).whatsappCloudMessage.updateMany({
    where: { id: messageId },
    data: { reactions: reactions as Prisma.InputJsonValue },
  });
  return { ok: true };
}

/** Zera o contador e manda o "lido" da última mensagem do cliente (até 30 dias). */
export async function markCloudConversationRead(conversationId: string): Promise<{ ok: boolean }> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false };
  const { ctx } = g;
  const convo = await getOwnedCloudConversation(ctx.organizationId, ctx.userId, conversationId);
  if (!convo) return { ok: false };
  const db = tenantDb(ctx.organizationId);
  await db.whatsappCloudConversation.updateMany({ where: { id: conversationId }, data: { unreadCount: 0 } });
  const last = await db.whatsappCloudMessage.findFirst({
    where: { conversationId, direction: "INBOUND", wamid: { not: null } },
    orderBy: { timestamp: "desc" },
    select: { wamid: true, timestamp: true },
  });
  if (last?.wamid && Date.now() - last.timestamp.getTime() < THIRTY_DAYS_MS) {
    const number = await loadNumber(ctx.organizationId, convo.numberId);
    if (number?.status === "ACTIVE") {
      // Best-effort: falha no "lido" não é erro para o vendedor.
      await postMessage(number.phoneNumberId, number.token, readPayload(last.wamid)).catch(() => null);
    }
  }
  return { ok: true };
}

/** Nova conversa por contato do CRM ou número digitado. O primeiro envio é um modelo. */
export async function startCloudConversation(input: {
  phone?: string;
  contactId?: string;
}): Promise<{ ok: true; conversationId: string } | { ok: false; error: CloudActionError }> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const number = await getMyCloudNumber(ctx.organizationId, ctx.userId);
  if (!number || number.status !== "ACTIVE") return { ok: false, error: "no_number" };
  let phone = input.phone ?? "";
  let contactId = input.contactId ?? null;
  if (contactId) {
    const c = await tenantDb(ctx.organizationId).contact.findFirst({
      where: { id: contactId },
      select: { phone: true },
    });
    if (!c?.phone) return { ok: false, error: "invalid" };
    phone = c.phone;
  }
  const waId = normalizeWhatsappNumber(phone);
  if (!looksLikeWhatsappMobile(waId)) return { ok: false, error: "invalid" };
  try {
    if (!contactId) contactId = await resolveContactId(ctx.organizationId, waId, null);
    const conversationId = await conversationForPhone(ctx.organizationId, number.id, waId, contactId);
    return { ok: true, conversationId };
  } catch (error) {
    console.error("[wa-cloud] start conversation failed", error);
    return { ok: false, error: "unknown" };
  }
}

export async function searchCloudContacts(q: string): Promise<{ id: string; name: string; phone: string | null }[]> {
  const g = await cloudGuard();
  if (!g.ok) return [];
  return searchContactsWithPhone(g.ctx.organizationId, q);
}

/** Nome/empresa do contato da conversa, para sugerir as variáveis do modelo. */
export async function cloudContactParams(conversationId: string): Promise<ParamContext | null> {
  const g = await cloudGuard();
  if (!g.ok) return null;
  const { ctx } = g;
  const convo = await getOwnedCloudConversation(ctx.organizationId, ctx.userId, conversationId);
  if (!convo) return null;
  if (convo.contactId) {
    const p = await getContactParams(ctx.organizationId, convo.contactId);
    if (p) return p;
  }
  return { nome: convo.profileName ?? "", empresa: "" };
}

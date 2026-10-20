"use server";

import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { audit } from "@/lib/audit";
import { replyToInbox } from "@/lib/email-broadcast/microsoft/inbox";
import { REPLY_MAX_CHARS, isGraphId, replyHtmlFromText } from "@/lib/email-broadcast/microsoft/inbox-core";

export type InboxReplyResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "reconnect" | "not_found" | "uncertain" | "unknown" };

/**
 * Answer an e-mail of the connected Microsoft mailbox's Inbox. Same gates as
 * the inbox tab: E-mail and "Caixa de entrada do e-mail" screens plus the
 * Marketing module. The reply leaves from that mailbox, in the same
 * conversation, and is saved in its Sent Items.
 */
export async function replyToInboxMessage(messageId: string, text: string): Promise<InboxReplyResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !canAccessScreen(ctx, "emailInbox") || !hasModule(ctx.modules, "marketing")) {
    return { ok: false, error: "forbidden" };
  }
  if (!isGraphId(messageId) || typeof text !== "string") return { ok: false, error: "invalid" };
  const body = text.trim();
  if (!body || body.length > REPLY_MAX_CHARS) return { ok: false, error: "invalid" };

  try {
    const res = await replyToInbox(ctx.organizationId, messageId, replyHtmlFromText(body));
    if (!res.ok) {
      if (res.reason === "reconnect" || res.reason === "no_account") return { ok: false, error: "reconnect" };
      if (res.reason === "not_found") return { ok: false, error: "not_found" };
      return { ok: false, error: "unknown" };
    }
    // Microsoft didn't confirm: it may have gone out, so the member checks Sent Items first.
    if (res.data.uncertain) return { ok: false, error: "uncertain" };
    await audit(ctx, {
      action: "email_sender.replied",
      entity: "EmailSenderAccount",
      entityId: res.data.accountId,
      meta: { to: res.data.to },
    });
    return { ok: true };
  } catch (error) {
    console.error("Failed to reply from the Microsoft inbox", error);
    return { ok: false, error: "unknown" };
  }
}

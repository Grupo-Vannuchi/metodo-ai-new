"use server";

import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { audit } from "@/lib/audit";
import { replyToImapMessage } from "@/lib/email-broadcast/imap/inbox";
import { parseImapMessageRef } from "@/lib/email-broadcast/imap/core";
import { replyToInbox } from "@/lib/email-broadcast/microsoft/inbox";
import { REPLY_MAX_CHARS, isGraphId, replyHtmlFromText } from "@/lib/email-broadcast/microsoft/inbox-core";

/**
 * What a reply action answers. `savedToSent` is the SMTP channel's: false when the reply left but no copy could be kept in the
 * mailbox's Sent folder. Absent (the Microsoft channel, which saves its own) means the copy is there.
 */
export type InboxReplyResult =
  | { ok: true; savedToSent?: boolean }
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

/**
 * Answer an e-mail of the Inbox of the company's SMTP account (read over IMAP,
 * spec 2026-10-23). The same gates as the Microsoft one and the inbox tab:
 * E-mail and "Caixa de entrada do e-mail" screens plus the Marketing module. The
 * reply leaves by the account's own SMTP server, in the same conversation, and a
 * copy is saved in the mailbox's Sent folder when the server takes it: the answer
 * says whether it did (`savedToSent`), so the screen never claims a copy that
 * isn't there.
 */
export async function replyToSmtpInboxMessage(messageId: string, text: string): Promise<InboxReplyResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !canAccessScreen(ctx, "emailInbox") || !hasModule(ctx.modules, "marketing")) {
    return { ok: false, error: "forbidden" };
  }
  if (parseImapMessageRef(messageId) === null || typeof text !== "string") return { ok: false, error: "invalid" };
  const body = text.trim();
  if (!body || body.length > REPLY_MAX_CHARS) return { ok: false, error: "invalid" };

  try {
    const res = await replyToImapMessage(ctx.organizationId, messageId, body);
    if (!res.ok) {
      if (res.reason === "reconnect" || res.reason === "no_account") return { ok: false, error: "reconnect" };
      if (res.reason === "not_found") return { ok: false, error: "not_found" };
      return { ok: false, error: "unknown" };
    }
    // The hand-over may have reached the server: the member checks the Sent folder before trying again.
    if (res.data.uncertain) return { ok: false, error: "uncertain" };
    await audit(ctx, {
      action: "email_sender.replied",
      entity: "EmailSenderAccount",
      entityId: res.data.accountId,
      meta: { to: res.data.to, channel: "SMTP" },
    });
    return { ok: true, savedToSent: res.data.savedToSent };
  } catch (error) {
    // Not the error object: whatever it carries stays out of the log, and only its first line is kept.
    console.error("Failed to reply from the SMTP inbox", error instanceof Error ? error.message.split("\n")[0].slice(0, 300) : "unknown error");
    return { ok: false, error: "unknown" };
  }
}

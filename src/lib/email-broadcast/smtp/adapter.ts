import "server-only";
import { prisma } from "@/lib/prisma";
import { smtpRecipientError } from "../failure-reason";
import type { MailboxAdapter } from "../mailbox/deliver";
import { markNeedsReconnect } from "../mailbox/token";
import { smtpDailyLimit, smtpFailureAction, smtpHourlyLimit, smtpPaceMs, type SmtpSettings } from "./core";
import { openSmtpSettings } from "./credentials";
import { sendSmtpMail } from "./send";

/**
 * The SMTP points of the shared mailbox send loop (spec 2026-10-21, 5.1): the
 * stored server settings instead of a token, the company's own daily and
 * hourly limits, and a pace that spreads the hour's e-mails evenly. Settings
 * that no longer open mark the account NEEDS_RECONNECT, and the send pauses
 * until the form saves them again. Three hand-overs in a row that the server
 * drops without an answer (UNCERTAIN) pause the send too. System context: the
 * account is read with organizationId and the provider explicit.
 */
export const smtpAdapter: MailboxAdapter<SmtpSettings> = {
  channel: "SMTP",
  access: async (organizationId, accountId) => {
    try {
      const row = await prisma.emailSenderAccount.findFirst({
        where: { id: accountId, organizationId, provider: "SMTP" },
        select: { credentials: true, status: true },
      });
      if (!row || row.status !== "ACTIVE") {
        return { ok: false, reason: "reconnect", message: "account missing or disconnected" };
      }
      const settings = openSmtpSettings(row.credentials);
      if (!settings) {
        await markNeedsReconnect(organizationId, accountId, "unreadable credentials");
        return { ok: false, reason: "reconnect", message: "unreadable credentials" };
      }
      return { ok: true, access: settings };
    } catch (e) {
      // The database, not the account: wait and try again, as with a token that failed to renew.
      return { ok: false, reason: "temporary", message: e instanceof Error ? e.message : "account read failed" };
    }
  },
  dailyLimit: smtpDailyLimit,
  hourlyLimit: smtpHourlyLimit,
  paceMs: (account) => smtpPaceMs(smtpHourlyLimit(account)),
  send: sendSmtpMail,
  failureAction: (f, attempt) => smtpFailureAction(f.status, f.code, f.message, attempt),
  recipientError: smtpRecipientError,
  uncertainPauseAfter: 3,
};

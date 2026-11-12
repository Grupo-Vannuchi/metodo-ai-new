import "server-only";
import { googleRecipientError } from "../failure-reason";
import { MAILBOX_PACE_MS } from "../mailbox/core";
import type { MailboxAdapter } from "../mailbox/deliver";
import { getSenderAccessToken } from "../mailbox/token";
import { gmailFailureAction, googleDailyLimit } from "./core";
import { sendGoogleMail } from "./send";

/** The Google points of the shared mailbox send loop (Gmail API): an OAuth token, the estimated daily limit, no hourly one. */
export const googleAdapter: MailboxAdapter<string> = {
  channel: "GOOGLE",
  access: async (organizationId, accountId, opts) => {
    const token = await getSenderAccessToken(organizationId, accountId, "GOOGLE", opts);
    return token.ok ? { ok: true, access: token.accessToken } : token;
  },
  dailyLimit: (a) => googleDailyLimit(a.accountKind),
  hourlyLimit: () => null,
  paceMs: () => MAILBOX_PACE_MS,
  send: sendGoogleMail,
  failureAction: (f, attempt) => gmailFailureAction(f.status, f.code, f.message, attempt, f.stage),
  recipientError: googleRecipientError,
};

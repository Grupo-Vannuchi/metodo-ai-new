import "server-only";
import { microsoftRecipientError } from "../failure-reason";
import { MAILBOX_PACE_MS } from "../mailbox/core";
import type { MailboxAdapter } from "../mailbox/deliver";
import { getSenderAccessToken } from "../mailbox/token";
import { graphFailureAction, microsoftDailyLimit } from "./core";
import { sendMicrosoftMail } from "./send";

/** The Microsoft points of the shared mailbox send loop (Graph): an OAuth token, the estimated daily limit, no hourly one. */
export const microsoftAdapter: MailboxAdapter<string> = {
  channel: "MICROSOFT",
  access: async (organizationId, accountId, opts) => {
    const token = await getSenderAccessToken(organizationId, accountId, "MICROSOFT", opts);
    return token.ok ? { ok: true, access: token.accessToken } : token;
  },
  dailyLimit: (a) => microsoftDailyLimit(a.accountKind),
  hourlyLimit: () => null,
  paceMs: () => MAILBOX_PACE_MS,
  send: sendMicrosoftMail,
  failureAction: (f, attempt) => graphFailureAction(f.status, f.code, attempt, f.stage),
  recipientError: microsoftRecipientError,
};

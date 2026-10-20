import "server-only";
import { microsoftRecipientError } from "../failure-reason";
import type { MailboxAdapter } from "../mailbox/deliver";
import { graphFailureAction, microsoftDailyLimit } from "./core";
import { sendMicrosoftMail } from "./send";

/** The Microsoft points of the shared mailbox send loop (Graph). */
export const microsoftAdapter: MailboxAdapter = {
  channel: "MICROSOFT",
  dailyLimit: microsoftDailyLimit,
  send: sendMicrosoftMail,
  failureAction: (f, attempt) => graphFailureAction(f.status, f.code, attempt, f.stage),
  recipientError: microsoftRecipientError,
};

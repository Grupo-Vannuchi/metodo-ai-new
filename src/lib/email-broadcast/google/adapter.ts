import "server-only";
import { googleRecipientError } from "../failure-reason";
import type { MailboxAdapter } from "../mailbox/deliver";
import { gmailFailureAction, googleDailyLimit } from "./core";
import { sendGoogleMail } from "./send";

/** The Google points of the shared mailbox send loop (Gmail API). */
export const googleAdapter: MailboxAdapter = {
  channel: "GOOGLE",
  dailyLimit: googleDailyLimit,
  send: sendGoogleMail,
  failureAction: (f, attempt) => gmailFailureAction(f.status, f.code, f.message, attempt, f.stage),
  recipientError: googleRecipientError,
};

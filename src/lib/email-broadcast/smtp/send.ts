import "server-only";
import type SMTPConnection from "nodemailer/lib/smtp-connection";
import type { MailboxSendFailure, MailboxSendOutcome } from "../mailbox/core";
import { buildMime, type MimeFile, type MimeMail } from "../microsoft/mime";
import { openSmtpConnection, resolveSmtpHost, smtpClose, smtpConnect, smtpLogin, smtpSendRaw } from "./connect";
import { smtpFailureCode, smtpSendPhase, type SmtpPhase, type SmtpSettings } from "./core";
import { redactAndCut, redactSmtpSecrets } from "./redact";

/** Sending: 15 s to connect, 10 s for the greeting, 60 s of silence on the socket (a 10 MB file on a slow server). */
const SMTP_SEND_TIMEOUTS = { connection: 15_000, greeting: 10_000, socket: 60_000 };

/**
 * The longest one attempt takes, from building the MIME to the server's last
 * answer; past it the connection is closed. It must fit the dispatcher's 90 s
 * lease with what the send loop does between its last heartbeat and the
 * attempt: before a first attempt, the hourly reservation (at most 2 + 5 s,
 * HOURLY_CLAIM_TX in mailbox/deliver.ts); before a retry, one piece of its
 * wait (at most 10 s); a re-send after a renewed access has a heartbeat of its
 * own. So heartbeats are at most 82 s or 85 s apart.
 */
export const SMTP_SEND_BUDGET_MS = 75_000;

/**
 * A failed attempt as the loop reads it: the reply code (0 when the server gave none), "rcpt-550", the server's words.
 * The words are redacted of the account's secrets first, on the text as the server wrote it and before the cut to 400
 * characters (redactAndCut: a secret cut in half would no longer be found): a server may echo the login back, and this
 * text is stored on the recipient and shown on the report.
 */
function smtpFailure(
  settings: SmtpSettings,
  phase: SmtpPhase,
  responseCode: number | null,
  text: string,
): MailboxSendFailure {
  return {
    ok: false,
    status: responseCode ?? 0,
    code: smtpFailureCode(phase, responseCode),
    message: redactAndCut(text, settings, 400),
    retryAfter: null,
    stage: phase === "transfer" || phase === "message" ? "send" : "prepare",
  };
}

/**
 * One e-mail through the account's own SMTP server (spec 2026-10-21, 5.2): the
 * MIME of the other channels, built here and handed over by sendSmtpMime. The
 * envelope is MAIL FROM = the account's address and RCPT TO = the recipient. A
 * MIME that can't be built is a failure before anything left ("prepare").
 * Never throws.
 */
export async function sendSmtpMail(
  settings: SmtpSettings,
  mail: Omit<MimeMail, "attachments">,
  files: MimeFile[],
): Promise<MailboxSendOutcome> {
  const startedAt = Date.now();
  let mime: Buffer;
  try {
    mime = await buildMime({ ...mail, attachments: files });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      code: null,
      message: redactSmtpSecrets(e instanceof Error ? e.message : "could not build the e-mail", settings),
      retryAfter: null,
      stage: "prepare",
    };
  }
  return sendSmtpMime(settings, { from: mail.from.address, to: [mail.to] }, mime, startedAt);
}

/**
 * An e-mail that is already built (RFC 5322, as buildMime writes it) through the
 * account's own SMTP server (spec 2026-10-21, 5.2), delivered as it is over a
 * connection of its own, with the envelope given. The server's name goes through
 * the address guard first ("host_not_allowed" is the "guard" phase, a name that
 * doesn't resolve is a connection failure). Then connect, log in and hand the
 * e-mail over, one step straight after the other. A failure is named by the step
 * it came from (smtpSendPhase): before the content leaves, or with the server
 * answering no, the e-mail was not accepted; a network failure or a timeout while
 * handing it over may have come after the final dot ("transfer": uncertain, never
 * sent again). The whole attempt has SMTP_SEND_BUDGET_MS from `startedAt` (the
 * moment sendSmtpMail began building the MIME; now by default): out of time, the
 * connection is closed, and that is a connection failure before the hand-over and
 * "transfer" during it. The connection is always closed. Whatever the server wrote
 * back, a failure's `message` has the account's password (and what the login sent
 * of it) masked. Never throws.
 */
export async function sendSmtpMime(
  settings: SmtpSettings,
  envelope: { from: string; to: string[] },
  mime: Buffer,
  startedAt: number = Date.now(),
): Promise<MailboxSendOutcome> {
  const target = await resolveSmtpHost(settings.host);
  if (!target.ok) {
    return target.error === "host_not_allowed"
      ? smtpFailure(settings, "guard", null, `${settings.host}: internal or reserved address`)
      : smtpFailure(settings, "connect", null, `${settings.host}: name not found`);
  }

  let step: "connect" | "login" | "send" = "connect";
  let connection: SMTPConnection | null = null;
  let budget: NodeJS.Timeout | undefined;
  let expired = false;
  try {
    const opened = openSmtpConnection(settings, target.ip, SMTP_SEND_TIMEOUTS);
    connection = opened;
    // Out of time: closing the connection fails whichever step is still waiting.
    budget = setTimeout(
      () => {
        expired = true;
        smtpClose(opened);
      },
      Math.max(0, startedAt + SMTP_SEND_BUDGET_MS - Date.now()),
    );
    // One step straight after the other, nothing awaited in between: an error the server sent between two steps
    // would only reach the connection's silent listener, and the next step would fail without saying why.
    await smtpConnect(opened);
    step = "login";
    await smtpLogin(opened, settings.username, settings.password);
    step = "send";
    await smtpSendRaw(opened, envelope, mime);
    return { ok: true };
  } catch (e) {
    // Out of time, the step only failed because the budget closed the connection: the timeout is the real cause.
    if (expired) {
      return smtpFailure(
        settings,
        step === "send" ? "transfer" : "connect",
        null,
        `The attempt did not finish in ${SMTP_SEND_BUDGET_MS / 1000} s`,
      );
    }
    const err: SMTPConnection.SMTPError = e instanceof Error ? e : new Error(String(e));
    const phase = smtpSendPhase(step, err);
    return smtpFailure(settings, phase, err.responseCode ?? null, err.response || err.message);
  } finally {
    clearTimeout(budget);
    if (connection) smtpClose(connection);
  }
}

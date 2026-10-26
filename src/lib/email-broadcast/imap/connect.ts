/**
 * The connection to a company's own IMAP server, to read the inbox of its SMTP
 * account (spec 2026-10-23, "Decisões técnicas"): the address guard of the SMTP
 * channel, one connection per request, and the test the account form runs before
 * saving. The password is the SMTP account's own: it goes to the login, over TLS,
 * and nowhere else (no log, no message, no `technical` text).
 */
import "server-only";
import { isIP } from "node:net";
import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { resolveSmtpHost } from "../smtp/connect";
import { redactSmtpSecrets } from "../smtp/redact";
import { imapConnectError, type ImapConnectError, type ImapSettings } from "./core";

/** The login of the SMTP account, which is also the inbox's. */
export type ImapAuth = { user: string; pass: string };

/** One connection per request: 15 s to connect, 10 s for the greeting, 30 s of silence on the socket. */
const IMAP_TIMEOUTS = { connection: 15_000, greeting: 10_000, socket: 30_000 };
/** Opening, from the name lookup to the end of the login, never takes longer than this. */
const IMAP_OPEN_BUDGET_MS = 30_000;
/** How long the goodbye (LOGOUT) is waited for before the connection is cut. */
const IMAP_LOGOUT_WAIT_MS = 5_000;

/**
 * ImapFlow's options for one connection to `ip`: the address resolveSmtpHost
 * approved, never the name again, so a DNS change between the check and the
 * connection can't steer it elsewhere (the SMTP channel's rule, spec 2026-10-21,
 * 4.2). The typed name still goes as the TLS server name (SNI) and is what the
 * certificate must match, and the certificate is always checked. "ssl" is TLS
 * from the first byte; "starttls" upgrades before the login or fails: left
 * optional, imapflow goes on in clear text when the server doesn't offer it, and
 * the password would cross the wire. No logger: the conversation, the login
 * included, is never written anywhere. No IDLE: a request is one short session.
 *
 * Throws when `ip` is not an IP, a name included: imapflow would resolve a name
 * itself and connect around the guard. The IP is not judged here: openImap is
 * the way in, and check:imap points these same options at a loopback test server.
 */
export function imapFlowOptions(settings: ImapSettings, ip: string, auth: ImapAuth): ImapFlowOptions {
  if (isIP(ip) === 0) throw new Error("imapFlowOptions takes the address resolveSmtpHost approved");
  // A typed IP is its own name: SNI never carries an address, and the certificate is then checked against the IP.
  const servername = isIP(settings.host) === 0 ? settings.host : undefined;
  return {
    host: ip,
    port: settings.port,
    secure: settings.security === "ssl",
    doSTARTTLS: settings.security === "starttls",
    servername,
    tls: { servername, rejectUnauthorized: true },
    auth: { user: auth.user, pass: auth.pass },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: IMAP_TIMEOUTS.connection,
    greetingTimeout: IMAP_TIMEOUTS.greeting,
    socketTimeout: IMAP_TIMEOUTS.socket,
  };
}

/** What an imapflow error tells: its `code`, whether a login was refused, and the server's own words. */
type ImapErrorFacts = {
  authenticationFailed: boolean;
  code: string | null;
  message: string;
  /** The server's text for a command it refused ("Invalid credentials"), or for the BYE that ended the session. */
  said: string | null;
  /** The reply code the server put in brackets ("AUTHENTICATIONFAILED"). */
  replyCode: string | null;
};

function factsOf(e: unknown): ImapErrorFacts {
  const o = (typeof e === "object" && e !== null ? e : { message: String(e) }) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
  const message = text(o.message) ?? "IMAP error";
  // The BYE's reason ("Too many connections") says what "Unexpected close" doesn't;
  // Node's TLS errors repeat their own message in it, which is not worth saying twice.
  const reason = text(o.reason);
  return {
    authenticationFailed: o.authenticationFailed === true,
    code: text(o.code),
    message,
    said: text(o.responseText) ?? (reason && !message.includes(reason) ? reason : null),
    replyCode: text(o.serverResponseCode),
  };
}

/** The library's words for a failure on one line: "AUTHENTICATIONFAILED: Command failed (Invalid credentials)". */
function describe(f: ImapErrorFacts): string {
  const words = f.said ? `${f.message} (${f.said})` : f.message;
  const label = f.code ?? f.replyCode;
  return label ? `${label}: ${words}` : words;
}

/**
 * A text for the screen or the log, on one line and with the secrets of `auth`
 * redacted. Redacted before the whitespace is folded, so a password with spaces
 * is still found as echoed. Every `technical` goes through here: a server may
 * echo the login back, and the text reaches the browser.
 */
function technicalText(text: string, auth: ImapAuth): string {
  return redactSmtpSecrets(text, { username: auth.user, password: auth.pass }).replace(/\s+/g, " ").trim();
}

/** Cuts the connection without a goodbye. Never throws: fine on a client never connected or already closed. */
function closeNow(client: ImapFlow): void {
  try {
    client.close();
  } catch {
    // already closed
  }
}

/**
 * A connection to the server, logged in and with no mailbox open. The name goes
 * through the same address guard as the SMTP channel's (resolveSmtpHost) and the
 * connection is made to the address it approved. A failure comes back named by
 * imapConnectError, with the library's words as `technical`, redacted; the guard's
 * refusals ("host_not_found", "host_not_allowed") come back as they are. Never
 * throws and never takes more than IMAP_OPEN_BUDGET_MS: a server that goes quiet in
 * the middle of the login, or feeds it a byte at a time, is cut off there. On
 * success the caller owns the client and ends it with closeImap.
 */
export async function openImap(
  settings: ImapSettings,
  auth: ImapAuth,
): Promise<{ ok: true; client: ImapFlow } | { ok: false; error: ImapConnectError; technical: string }> {
  const startedAt = Date.now();
  const target = await resolveSmtpHost(settings.host);
  if (!target.ok) {
    const why = target.error === "host_not_found" ? "name not found" : "internal or reserved address";
    return { ok: false, error: target.error, technical: technicalText(`${settings.host}: ${why}`, auth) };
  }

  const client = new ImapFlow(imapFlowOptions(settings, target.ip, auth));
  // Besides failing the command in progress, imapflow reports a connection that dies as an "error" event, and an "error"
  // nobody listens to throws, which in a server would take the whole process down. Always listened to, and ignored: what
  // died mid-request fails the command it was in the middle of.
  client.on("error", () => {});
  let expired = false;
  // Out of time: closing the client fails whichever step is still waiting.
  const budget = setTimeout(
    () => {
      expired = true;
      closeNow(client);
    },
    Math.max(0, startedAt + IMAP_OPEN_BUDGET_MS - Date.now()),
  );
  try {
    await client.connect();
    return { ok: true, client };
  } catch (e) {
    closeNow(client);
    // Out of time, the step only failed because the budget closed the client: the timeout is the real cause.
    const facts: ImapErrorFacts = expired
      ? factsOf({ code: "ETIMEDOUT", message: `The connection did not finish in ${IMAP_OPEN_BUDGET_MS / 1000} s` })
      : factsOf(e);
    return { ok: false, error: imapConnectError(facts), technical: technicalText(describe(facts), auth) };
  } finally {
    clearTimeout(budget);
  }
}

/**
 * Ends a connection from openImap: says goodbye (LOGOUT) and, if the server
 * doesn't answer it in IMAP_LOGOUT_WAIT_MS or the goodbye fails, cuts the
 * connection. Never throws: fine on a client already closed or never connected.
 */
export async function closeImap(client: ImapFlow): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const silence = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, IMAP_LOGOUT_WAIT_MS);
    });
    await Promise.race([client.logout(), silence]);
  } catch {
    // The connection is gone, or the server refused the goodbye: it is cut below all the same.
  } finally {
    clearTimeout(timer);
  }
  closeNow(client);
}

/**
 * The save form's test: connect and log in, nothing more, and close. The inbox
 * isn't opened. The guard's refusals and every other failure come back as
 * openImap gives them, with `technical` redacted. The connection is always closed.
 */
export async function verifyImapSettings(
  settings: ImapSettings,
  auth: ImapAuth,
): Promise<{ ok: true } | { ok: false; error: ImapConnectError; technical: string }> {
  const opened = await openImap(settings, auth);
  if (!opened.ok) return opened;
  await closeImap(opened.client);
  return { ok: true };
}

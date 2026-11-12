/**
 * The connection to a company's own SMTP server (spec 2026-10-21, 4.1 and 4.2):
 * the address guard, the connection and its steps as promises, and the test the
 * account form runs before saving. The send path builds on the same steps.
 */
import "server-only";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import { env } from "@/lib/env";
import { isBlockedSmtpAddress, pickSmtpAddress } from "./address";
import { smtpConnectError, type SmtpConnectError, type SmtpSettings } from "./core";
import { redactSmtpSecrets } from "./redact";

/** The save form's test: 15 s to connect, 10 s for the greeting, 30 s of silence on the socket. */
const SMTP_TEST_TIMEOUTS = { connection: 15_000, greeting: 10_000, socket: 30_000 };
/** The whole test, from the name lookup to the end of the login, never takes longer than this. */
const SMTP_TEST_BUDGET_MS = 30_000;
/** A name lookup with no answer after this long counts as a name that doesn't resolve. */
const SMTP_DNS_TIMEOUT_MS = 10_000;

type SmtpError = SMTPConnection.SMTPError;

/** An error shaped like nodemailer's own, for the failures this module finds itself. */
function smtpError(message: string, code: string, command: string): SmtpError {
  return Object.assign(new Error(message), { code, command });
}

/**
 * Where to connect for the server the person typed (spec 4.2). An IP typed as
 * is goes through the same guard as the addresses a name resolves to (A and
 * AAAA); one internal address among them refuses the name. A lookup that fails,
 * or has no answer after SMTP_DNS_TIMEOUT_MS, is "host_not_found". Never throws.
 */
export async function resolveSmtpHost(
  host: string,
): Promise<{ ok: true; ip: string; family: 4 | 6 } | { ok: false; error: "host_not_found" | "host_not_allowed" }> {
  const family = isIP(host);
  if (family === 4 || family === 6) {
    return isBlockedSmtpAddress(host) ? { ok: false, error: "host_not_allowed" } : { ok: true, ip: host, family };
  }
  const addresses = await lookupAll(host);
  return addresses ? pickSmtpAddress(addresses) : { ok: false, error: "host_not_found" };
}

/** Every address of the name, as the system resolver returns them; null when the lookup fails or stalls. */
async function lookupAll(host: string): Promise<LookupAddress[] | null> {
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SMTP_DNS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([lookup(host, { all: true, verbatim: true }), stalled]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The name the platform gives in EHLO: its own site's host name. An address goes
 * in brackets, the way SMTP writes one ("[10.0.0.5]", "[IPv6:::1]").
 */
function ehloName(): string {
  const host = new URL(env.NEXT_PUBLIC_SITE_URL).hostname;
  if (isIP(host) === 4) return `[${host}]`;
  if (host.startsWith("[")) return `[IPv6:${host.slice(1, -1)}]`;
  return host;
}

/**
 * A connection, not opened yet, to `ip`: the address resolveSmtpHost checked,
 * never the name again, so a DNS change between the check and the connection
 * can't steer it elsewhere (spec 4.2). The typed name still goes as the TLS
 * server name (SNI) and is what the certificate must match, and the certificate
 * is always checked. "ssl" is TLS from the first byte; "starttls" upgrades
 * before anything else is sent, or fails. No logger: the conversation, AUTH
 * included, is never written anywhere.
 *
 * Throws when `ip` is anything the guard refuses, a name included: nodemailer
 * would resolve a name itself and connect around the guard.
 */
export function openSmtpConnection(
  settings: Omit<SmtpSettings, "password">,
  ip: string,
  timeouts: { connection: number; greeting: number; socket: number },
): SMTPConnection {
  if (isBlockedSmtpAddress(ip)) throw new Error("openSmtpConnection takes the address resolveSmtpHost approved");
  // A typed IP is its own name: SNI never carries an address, and the certificate is then checked against the IP.
  const servername = isIP(settings.host) === 0 ? settings.host : undefined;
  const connection = new SMTPConnection({
    host: ip,
    port: settings.port,
    secure: settings.security === "ssl",
    requireTLS: settings.security === "starttls",
    servername,
    tls: { servername, rejectUnauthorized: true },
    name: ehloName(),
    connectionTimeout: timeouts.connection,
    greetingTimeout: timeouts.greeting,
    socketTimeout: timeouts.socket,
  });
  // Besides failing the step in progress, SMTPConnection reports a failure as an "error" event, and an "error" with no
  // listener throws, which would take the whole process down. Each step listens for its own (smtpStep).
  connection.on("error", () => {});
  return connection;
}

/** The error of a step whose connection ended under it, closed by smtpClose or by the server, with nothing else said. */
function connectionClosed(): SmtpError {
  return smtpError("Connection closed", "ECONNECTION", "CONN");
}

/**
 * One step of the conversation, as a promise that always settles. nodemailer
 * ends a step in one of three ways: its callback (the server answered no), only
 * an "error" event (a timeout, a dropped socket, a failed TLS: connect() and
 * login() never call back then), or just closing (close() forgets a send in
 * flight). The step settles on the first of them, with nodemailer's error object
 * as it is (code, responseCode, command and response untouched), or with an
 * ECONNECTION error when the connection ended and nothing else was said.
 */
function smtpStep<T>(
  connection: SMTPConnection,
  start: (done: (err: SmtpError | null | undefined, result?: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (err: unknown, result?: T) => {
      if (settled) return;
      settled = true;
      connection.off("error", onError);
      connection.off("end", onEnd);
      if (err) reject(err);
      else resolve(result as T);
    };
    const onError = (err: unknown) => settle(err);
    // close() announces the end before it hands a send its error, so the end waits a turn and that error comes first.
    const onEnd = () => setImmediate(() => settle(connectionClosed()));
    connection.on("error", onError);
    connection.on("end", onEnd);
    try {
      start(settle);
    } catch (e) {
      settle(e);
    }
  });
}

/** Opens the connection: TCP or TLS from the start, the greeting, EHLO and, with STARTTLS, the upgrade. */
export function smtpConnect(connection: SMTPConnection): Promise<void> {
  return smtpStep<void>(connection, (done) => connection.connect(done));
}

/**
 * Logs in. A server whose EHLO offers no AUTH fails here with ENOAUTH, before
 * anything is sent: nodemailer would try AUTH PLAIN anyway, handing the password
 * to a server that takes none, and report its refusal as a wrong password (EAUTH).
 */
export async function smtpLogin(connection: SMTPConnection, user: string, pass: string): Promise<void> {
  if (!connection.allowsAuth) {
    throw smtpError("The server offers no login (no AUTH in its EHLO reply)", "ENOAUTH", "AUTH");
  }
  await smtpStep<boolean>(connection, (done) => connection.login({ user, pass }, done));
}

/**
 * Hands one message over: MAIL FROM, RCPT TO for each address, DATA and the raw
 * MIME as it is. Resolves once the server accepted it (its final answer is in
 * `response`). A refusal rejects with nodemailer's error (EENVELOPE at an
 * envelope command or DATA, EMESSAGE at the final answer); a network failure or
 * a timeout, with the socket's.
 */
export function smtpSendRaw(
  connection: SMTPConnection,
  envelope: { from: string; to: string[] },
  raw: Buffer,
): Promise<SMTPConnection.SentMessageInfo> {
  // nodemailer writes its bookkeeping into the envelope it gets: it gets a copy.
  return smtpStep<SMTPConnection.SentMessageInfo>(connection, (done) =>
    connection.send({ from: envelope.from, to: [...envelope.to] }, raw, done),
  );
}

/**
 * Says goodbye (QUIT) and closes. A step still waiting fails with ECONNECTION.
 * Never throws: fine on a connection never opened, already closed or failed.
 */
export function smtpClose(connection: SMTPConnection): void {
  try {
    if (connection.stage === "connected") connection.quit();
  } catch {
    // the socket is already gone: nobody to say goodbye to
  }
  try {
    connection.close();
  } catch {
    // already closed
  }
}

// The redaction itself is pure and lives in ./redact (check:email pins it); it stays reachable from here.
export { redactSmtpSecrets };

/**
 * The library's own words for a failure, on one line and with the secrets of
 * `s` redacted: "EAUTH: Invalid login: 535 5.7.8 ...". Redacted before the
 * whitespace is folded, so a password with spaces is still found as echoed.
 */
function technicalText(err: SmtpError, s: SmtpSettings): string {
  const raw = err.code ? `${err.code}: ${err.message}` : err.message;
  return redactSmtpSecrets(raw, s).replace(/\s+/g, " ").trim();
}

/**
 * The save form's connection test (spec 4.1): the name through the address
 * guard, then connect (TLS from the start or STARTTLS), log in and close.
 * Nothing is sent. 15 s to connect, 10 s for the greeting, 30 s of silence, and
 * never more than 30 s in all: a server that goes quiet in the middle of the
 * login is cut off there. The guard's refusals come back as they are; any other
 * failure is named by smtpConnectError, with the library's text as `technical`.
 * Every `technical` goes through redactSmtpSecrets: a server may echo the login
 * back, and the text reaches the browser. The connection is always closed.
 */
export async function verifySmtpSettings(
  s: SmtpSettings,
): Promise<{ ok: true } | { ok: false; error: SmtpConnectError; technical: string }> {
  const startedAt = Date.now();
  const target = await resolveSmtpHost(s.host);
  if (!target.ok) {
    const why = target.error === "host_not_found" ? "name not found" : "internal or reserved address";
    return { ok: false, error: target.error, technical: redactSmtpSecrets(`${s.host}: ${why}`, s) };
  }

  const connection = openSmtpConnection(s, target.ip, SMTP_TEST_TIMEOUTS);
  let expired = false;
  // Out of time: closing the connection fails whichever step is still waiting.
  const budget = setTimeout(
    () => {
      expired = true;
      smtpClose(connection);
    },
    Math.max(0, startedAt + SMTP_TEST_BUDGET_MS - Date.now()),
  );
  try {
    await smtpConnect(connection);
    await smtpLogin(connection, s.username, s.password);
    return { ok: true };
  } catch (e) {
    // Out of time, the step only failed because the budget closed the connection: the timeout is the real cause.
    const err: SmtpError = expired
      ? smtpError(`The test did not finish in ${SMTP_TEST_BUDGET_MS / 1000} s`, "ETIMEDOUT", "CONN")
      : e instanceof Error
        ? e
        : new Error(String(e));
    return { ok: false, error: smtpConnectError(err), technical: technicalText(err, s) };
  } finally {
    clearTimeout(budget);
    smtpClose(connection);
  }
}

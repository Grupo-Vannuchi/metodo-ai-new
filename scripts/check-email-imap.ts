/**
 * Integration check of the inbox read over IMAP from an SMTP account (spec
 * 2026-10-23): what check:email can't reach, the server code that talks to a real
 * mail server. The mailbox is a throwaway one from Ethereal (https://ethereal.email,
 * a real SMTP and IMAP server that delivers nothing outside itself), the data is in
 * the local Postgres, and the server modules (`server-only`, the `@/` alias, env.ts)
 * load through scripts/tsconfig.server.json.
 *
 * Creates its own data: the Ethereal mailbox and two organizations (`IMAP-E2E-<stamp>`
 * and, for the isolation check, `IMAP-E2E-<stamp>-B`), and ALWAYS deletes them and their
 * sender accounts, even on failure (Ethereal offers no way to delete a mailbox: it expires
 * by itself). A run that is killed (Ctrl+C, a timeout) leaves them behind: delete the
 * `IMAP-E2E-%` organizations by hand. Refuses to run against a database that isn't local.
 * The Ethereal password never reaches the terminal: whatever fails is printed with it redacted.
 *
 * Run: npm run check:imap   (needs the internet, the Docker Postgres and a valid .env)
 * Exits non-zero on the first failure. Every request to the server is a connection of its
 * own, so with a distant server the run takes minutes: each slow check prints its time.
 *
 * Later tasks add their checks with check(...) above main(), and the fixtures they
 * leave behind to `cleanups`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { inspect } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { createTestAccount, createTransport } from "nodemailer";
import PostalMime, { type Email } from "postal-mime";
import { env } from "@/lib/env";
import { prisma as appPrisma } from "@/lib/prisma";
import { closeImap, imapFailureOf, imapFlowOptions, openImap, verifyImapSettings } from "@/lib/email-broadcast/imap/connect";
import { imapConnectError, imapMessageRef, type ImapPort, type ImapSettings } from "@/lib/email-broadcast/imap/core";
import {
  downloadImapAttachment,
  fetchListRows,
  imapRequest,
  imapUnreadCount,
  loadImapInboxView,
  openMessage,
  replyToImapMessage,
} from "@/lib/email-broadcast/imap/inbox";
import { IMAP_MAX_MESSAGE_BYTES } from "@/lib/email-broadcast/imap/parse";
import type { MailboxSendOutcome } from "@/lib/email-broadcast/mailbox/core";
import { redactSmtpSecrets } from "@/lib/email-broadcast/smtp/redact";
import { sendSmtpMail, sendSmtpMime } from "@/lib/email-broadcast/smtp/send";
import type { SmtpSettings } from "@/lib/email-broadcast/smtp/core";
import { openSmtpSettings, sealSmtpSettings } from "@/lib/email-broadcast/smtp/credentials";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";
import { listenFakeImap, listenFakeMailbox, listenScripted, newFakeRecord, type FakeMailboxOptions } from "./shims/fake-imap";

type EtherealAccount = {
  user: string;
  pass: string;
  smtp: { host: string; port: number; secure: boolean };
  imap: { host: string; port: number; secure: boolean };
};

type ImapCtx = {
  stamp: number;
  ethereal: EtherealAccount;
  /** The test organization: the only one these checks touch. */
  orgId: string;
  prisma: PrismaClient;
};

/** Each task below registers its checks with check() and its fixtures with `cleanups`; main() runs them in order. */
const checks: { name: string; run: (ctx: ImapCtx) => Promise<void> }[] = [];
const cleanups: ((ctx: ImapCtx) => Promise<void>)[] = [];

function check(name: string, run: (ctx: ImapCtx) => Promise<void> | void): void {
  checks.push({ name, run: async (ctx) => run(ctx) });
}

/** The Ethereal login, once it exists: main()'s error report redacts it, so it can never be printed. */
let etherealLogin: { user: string; pass: string } | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The text holds none of the secrets, as typed or as the base64 an AUTH exchange may echo. */
function assertNoSecret(text: string, ...secrets: string[]): void {
  for (const secret of secrets) {
    // The message says nothing of the text or the secret: a failing assertion must not print either.
    assert.ok(!text.includes(secret), "a password is in the text of a failure");
    assert.ok(!text.includes(Buffer.from(secret).toString("base64")), "a password (base64) is in the text of a failure");
  }
}

function etherealImap(ctx: ImapCtx): ImapSettings {
  const { host, port, secure } = ctx.ethereal.imap;
  assert.ok(secure && port === 993, "Ethereal is expected to offer IMAP over TLS on port 993");
  return { host, port, security: "ssl" };
}

function etherealAuth(ctx: ImapCtx): { user: string; pass: string } {
  return { user: ctx.ethereal.user, pass: ctx.ethereal.pass };
}

/** Connects with these options: the error it failed with, or null when it connected. The client is closed either way. */
async function connectError(options: ImapFlowOptions): Promise<unknown> {
  const client = new ImapFlow(options);
  client.on("error", () => {});
  try {
    await client.connect();
    return null;
  } catch (e) {
    return e;
  } finally {
    client.close();
  }
}

// ── Credentials: the IMAP settings inside the SMTP account's sealed text ─────

const SMTP: SmtpSettings = {
  host: "smtpi.kinghost.net",
  port: 587,
  security: "starttls",
  username: "mkt@empresa.com.br",
  password: "senha-smtp-ficticia",
};
const KINGHOST: ImapSettings = { host: "imap.kinghost.net", port: 993, security: "ssl" };

/** What the account stored before the inbox existed: the SMTP fields and nothing else. */
const SMTP_FIELDS = {
  host: SMTP.host,
  port: String(SMTP.port),
  security: SMTP.security,
  username: SMTP.username,
  password: SMTP.password,
};
const IMAP_FIELDS = { imapHost: "imap.kinghost.net", imapPort: "993", imapSecurity: "ssl" };

check("sealSmtpSettings and openSmtpSettings carry the IMAP settings along with the SMTP ones", () => {
  assert.deepEqual(openSmtpSettings(sealSmtpSettings({ ...SMTP, imap: KINGHOST })), { ...SMTP, imap: KINGHOST });
  const starttls: ImapSettings = { host: "mail.empresa.com.br", port: 143, security: "starttls" };
  assert.deepEqual(openSmtpSettings(sealSmtpSettings({ ...SMTP, imap: starttls })), { ...SMTP, imap: starttls });
});

check("an account without IMAP opens with imap: null, the rest unchanged, and is sealed with no IMAP key", () => {
  assert.deepEqual(openSmtpSettings(sealSmtpSettings(SMTP)), { ...SMTP, imap: null });
  assert.deepEqual(openSmtpSettings(sealSmtpSettings({ ...SMTP, imap: null })), { ...SMTP, imap: null });
  // The stored shape of an account that only sends stays exactly the one it always had.
  assert.deepEqual(Object.keys(decryptCredentials(sealSmtpSettings(SMTP))).sort(), Object.keys(SMTP_FIELDS).sort());
  assert.deepEqual(Object.keys(decryptCredentials(sealSmtpSettings({ ...SMTP, imap: null }))).sort(), Object.keys(SMTP_FIELDS).sort());
});

check("a credential sealed before the inbox existed (SMTP fields only) opens with imap: null", () => {
  assert.deepEqual(openSmtpSettings(encryptCredentials(SMTP_FIELDS)), { ...SMTP, imap: null });
});

check("IMAP keys that can't be used leave imap: null and never make the SMTP half unusable", () => {
  const variants: [string, Record<string, string>][] = [
    ["a port outside IMAP_PORTS (110)", { ...IMAP_FIELDS, imapPort: "110" }],
    ["the SMTP port (587)", { ...IMAP_FIELDS, imapPort: "587" }],
    ["a port with a leading zero", { ...IMAP_FIELDS, imapPort: "0993" }],
    ["a port with a trailing space", { ...IMAP_FIELDS, imapPort: "993 " }],
    ["no port", { imapHost: IMAP_FIELDS.imapHost, imapSecurity: IMAP_FIELDS.imapSecurity }],
    ["an unknown security", { ...IMAP_FIELDS, imapSecurity: "tls" }],
    ["no security", { imapHost: IMAP_FIELDS.imapHost, imapPort: IMAP_FIELDS.imapPort }],
    ["an empty host", { ...IMAP_FIELDS, imapHost: "" }],
    ["no host", { imapPort: IMAP_FIELDS.imapPort, imapSecurity: IMAP_FIELDS.imapSecurity }],
  ];
  for (const [label, extra] of variants) {
    assert.deepEqual(openSmtpSettings(encryptCredentials({ ...SMTP_FIELDS, ...extra })), { ...SMTP, imap: null }, label);
  }
  // The control: the same keys, valid, do open, so the table above fails for the right reason.
  assert.deepEqual(openSmtpSettings(encryptCredentials({ ...SMTP_FIELDS, ...IMAP_FIELDS }))?.imap, KINGHOST);
  // The SMTP half still decides on its own: a valid inbox doesn't rescue an SMTP port that isn't one.
  assert.equal(openSmtpSettings(encryptCredentials({ ...SMTP_FIELDS, port: "25", ...IMAP_FIELDS })), null);
});

// ── Harness ──────────────────────────────────────────────────────────────────

check("the test organization exists and holds no sender account yet", async (ctx) => {
  const org = await ctx.prisma.organization.findFirst({ where: { id: ctx.orgId }, select: { name: true } });
  assert.equal(org?.name, `IMAP-E2E-${ctx.stamp}`);
  assert.equal(await ctx.prisma.emailSenderAccount.count({ where: { organizationId: ctx.orgId } }), 0);
});

// ── Connection: the options, then a real server ──────────────────────────────

/** An address the guard lets through (198.51.100.0/24, the documentation range, is refused). No check here dials it. */
const PUBLIC_IP = "8.8.8.8";

check("imapFlowOptions: ssl, mandatory STARTTLS, the typed name as SNI, the certificate always checked, a hostile server's reach limited", () => {
  const auth = { user: "u", pass: "p" };
  const common = {
    auth,
    logger: false,
    disableAutoIdle: true,
    // What a hostile server can weigh on the process with: no compression (a few bytes inflate into gigabytes) and nothing
    // bigger in one piece than a message read whole plus headroom (imapflow's defaults are 1 GB a line or literal, 2 GB a response).
    disableCompression: true,
    maxLineLength: 4_194_304,
    maxLiteralSize: 16_777_216,
    maxResponseSize: 20_971_520,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
  assert.ok(common.maxLiteralSize > IMAP_MAX_MESSAGE_BYTES, "a message read whole (the 15 MB cap) has to fit in one literal");
  assert.ok(common.maxResponseSize > common.maxLiteralSize, "imapflow wants the response limit above the literal limit");
  const name = "imap.empresa.com.br";
  const tls = { servername: name, rejectUnauthorized: true };
  // The address is the one the guard approved; the typed name only travels as SNI and as the name the certificate must carry.
  assert.deepEqual(imapFlowOptions({ host: name, port: 993, security: "ssl" }, PUBLIC_IP, auth), {
    ...common,
    host: PUBLIC_IP,
    port: 993,
    secure: true,
    doSTARTTLS: false,
    servername: name,
    tls,
  });
  assert.deepEqual(imapFlowOptions({ host: name, port: 143, security: "starttls" }, PUBLIC_IP, auth), {
    ...common,
    host: PUBLIC_IP,
    port: 143,
    secure: false,
    doSTARTTLS: true,
    servername: name,
    tls,
  });
  // A typed IP is its own name: no SNI, and the certificate is then checked against the IP.
  assert.deepEqual(imapFlowOptions({ host: PUBLIC_IP, port: 993, security: "ssl" }, PUBLIC_IP, auth), {
    ...common,
    host: PUBLIC_IP,
    port: 993,
    secure: true,
    doSTARTTLS: false,
    servername: undefined,
    tls: { servername: undefined, rejectUnauthorized: true },
  });
  // Like openSmtpConnection, never an address the guard refuses, so no caller has to remember to ask it first: not a name
  // (imapflow would resolve it itself and connect around the guard), nor a loopback, private, link-local, scoped or mapped address.
  const refusal = { message: "imapFlowOptions takes the address resolveSmtpHost approved" };
  for (const refused of [name, "127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "fe80::1%eth0", "::ffff:127.0.0.1"]) {
    assert.throws(() => imapFlowOptions({ host: name, port: 993, security: "ssl" }, refused, auth), refusal, `${refused} must be refused`);
  }
  // The control: a public IPv6 address goes through, so the refusals above are the guard's and not a blanket no.
  assert.equal(imapFlowOptions({ host: name, port: 993, security: "ssl" }, "2606:4700:4700::1111", auth).host, "2606:4700:4700::1111");
});

check("143 with STARTTLS: a server that doesn't offer STARTTLS gets no login at all, never in clear text", async () => {
  const fake = await listenFakeImap("IMAP4rev1 AUTH=PLAIN SASL-IR ID");
  const secret = `senha-${Date.now()}`;
  try {
    const settings: ImapSettings = { host: "imap.empresa.com.br", port: 143, security: "starttls" };
    // The options openImap connects with for a public address, pointed at the loopback server: only where they dial changes
    // (imapFlowOptions itself refuses 127.0.0.1, and openImap never dials a loopback address).
    const options = { ...imapFlowOptions(settings, PUBLIC_IP, { user: "u", pass: secret }), host: "127.0.0.1", port: fake.port };
    const loginSent = () =>
      /\b(AUTHENTICATE|LOGIN)\b/i.test(fake.received()) || fake.received().includes(Buffer.from(`\0u\0${secret}`).toString("base64"));

    const error = await connectError(options);
    assert.ok(error instanceof Error, "the connection must fail");
    assert.equal(imapConnectError(error), "tls_failed");
    assert.equal(fake.connections(), 1);
    assert.equal(loginSent(), false, "a login was sent to a server that offers no STARTTLS");
    assert.ok(!fake.received().includes(secret), "the password reached the server in clear text");

    // The control: with the requirement off, this same server does get the clear-text login, so the assertions above can fail.
    await connectError({ ...options, doSTARTTLS: undefined });
    assert.equal(loginSent(), true, "the fake server should have seen a login once STARTTLS is optional");
  } finally {
    await fake.close();
  }
});

/** The options openImap connects with for a public address, pointed at a loopback server and made plain text (only where they dial changes). */
function loopbackOptions(port: number, overrides: Partial<ImapFlowOptions> = {}): ImapFlowOptions {
  const settings: ImapSettings = { host: "imap.empresa.com.br", port: 143, security: "starttls" };
  return {
    ...imapFlowOptions(settings, PUBLIC_IP, { user: "u", pass: "senha-ficticia" }),
    host: "127.0.0.1",
    port,
    doSTARTTLS: false,
    ...overrides,
  };
}

check("a server that never ends a line is cut off at the line limit, not read to the end", async () => {
  const hostile = await listenScripted((socket) => {
    // Twice the limit, with no line break: with imapflow's own default (1 GB) the client would still be waiting for more.
    socket.write("* OK ");
    for (let i = 0; i < 8; i++) socket.write(Buffer.alloc(1024 * 1024, 0x41));
  });
  try {
    const error = await connectError(loopbackOptions(hostile.port));
    assert.equal((error as { code?: string } | null)?.code, "LineTooLarge");
  } finally {
    await hostile.close();
  }
});

check("a server that announces a literal over the limit is cut off before it is sent", async () => {
  const hostile = await listenScripted((socket) => {
    // 20 MB announced (the limit is 16 MiB) and not a byte of it sent: refused on the marker alone.
    socket.write("* OK [CAPABILITY IMAP4rev1] ready\r\n* 1 FETCH (BODY[] {20000000}\r\n");
  });
  try {
    const error = await connectError(loopbackOptions(hostile.port));
    assert.equal((error as { code?: string } | null)?.code, "LiteralTooLarge");
  } finally {
    await hostile.close();
  }
});

check("COMPRESS=DEFLATE is never asked for, even from a server that offers it", async () => {
  const fake = await listenFakeImap("IMAP4rev1 AUTH=PLAIN SASL-IR ID NAMESPACE ENABLE COMPRESS=DEFLATE", { loginOk: true });
  try {
    const compressAsked = () => /\bCOMPRESS\b/i.test(fake.received());
    assert.equal(await connectError(loopbackOptions(fake.port)), null, "the fake server lets the login through");
    assert.equal(compressAsked(), false, "COMPRESS was sent");

    // The control: without disableCompression this same server is asked, so the assertion above can fail.
    await connectError(loopbackOptions(fake.port, { disableCompression: false }));
    assert.equal(compressAsked(), true, "the fake server should have been offered COMPRESS once compression is allowed");
  } finally {
    await fake.close();
  }
});

check("a failure text is redacted and then cut to 400 characters: a password the cut would split doesn't stay half in it", async () => {
  // The name that doesn't resolve is whatever the person typed, as long as they like, and it ends up in `technical`. A random
  // placeholder is the "password" here (the name goes out in a DNS query): the real login never touches this check.
  const placeholder = `placeholder-${randomUUID()}`;
  // Before redaction the placeholder starts 4 characters before the cut, so cutting first would leave its first 4 characters behind.
  const host = `${"x".repeat(396)}${placeholder}.invalid`;
  const result = await verifyImapSettings({ host, port: 993, security: "ssl" }, { user: "u@empresa.com.br", pass: placeholder });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "host_not_found");
  assert.ok(result.technical.length <= 400, `${result.technical.length} characters`);
  assert.ok(result.technical.includes("***"), "the placeholder was not redacted");
  assert.ok(!result.technical.includes(placeholder.slice(0, 4)), "the first characters of the placeholder stayed in the text");
});

check("an e-mail whose body structure is too deep for imapflow isn't dropped: it comes back without the structure", async () => {
  // Servers differ in how deep a structure they report (Ethereal stops at about 20 levels); imapflow reads 25 levels of
  // nesting in an answer, the answer's own included, and drops a deeper one without an error. This server reports 30
  // for its second e-mail, as one that doesn't cut it would.
  const fake = await listenFakeMailbox({ levels: 30 });
  const client = new ImapFlow(loopbackOptions(fake.port));
  client.on("error", () => {});
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // The control: asked for plainly, imapflow gives the first e-mail and loses the second.
      assert.deepEqual(
        (await client.fetchAll("1:*", { uid: true, bodyStructure: true })).map((row) => row.uid),
        [1],
      );
      // The page of an unfiltered Inbox (sequence numbers) and of a search (UIDs): both get the two e-mails, the first with
      // the mark of its PDF (its structure was read), the second with none to tell (it came back without the structure).
      for (const [range, byUid] of [
        ["1:*", false],
        ["1,2", true],
      ] as const) {
        const rows = await fetchListRows(client, range, { byUid, ids: [1, 2] });
        assert.deepEqual(
          rows.map((row) => [row.uid, row.envelope.subject, row.hasAttachments]).sort(),
          [
            [1, "m1", true],
            [2, "m2", undefined],
          ],
          range,
        );
      }
      // Opened: the deep e-mail is there with its body; one that isn't there is still not_found.
      const opened = await openMessage(client, 1000, 2, IMAP_MAX_MESSAGE_BYTES);
      assert.ok(opened.ok, "the deep e-mail opens");
      assert.ok(opened.data.bodyDocument.includes("corpo da mensagem 2"));
      assert.deepEqual(await openMessage(client, 1000, 3, IMAP_MAX_MESSAGE_BYTES), { ok: false, reason: "not_found" });
    } finally {
      lock.release();
    }
  } finally {
    client.close();
    await fake.close();
  }
});

check("verifyImapSettings logs in to a real server over TLS", async (ctx) => {
  assert.deepEqual(await verifyImapSettings(etherealImap(ctx), etherealAuth(ctx)), { ok: true });
});

check("openImap takes the time it may spend opening as an argument: a login that doesn't finish in it fails as a timeout that says how long", async (ctx) => {
  // 1 ms: a TLS connection to a real server can't be up by then (the name lookup has used it already). The request after a
  // reply's hand-over asks for 10 s this way (imapRequest.postSendOpenMs); the connection that is made in time is the control.
  const cut = await openImap(etherealImap(ctx), etherealAuth(ctx), 1);
  assert.equal(cut.ok, false);
  if (cut.ok) return;
  assert.deepEqual([cut.error, cut.technical], ["connection_failed", "ETIMEDOUT: The connection did not finish in 0.001 s"]);
  const opened = await openImap(etherealImap(ctx), etherealAuth(ctx), 20_000);
  assert.ok(opened.ok, "a login that has time for it goes through");
  if (opened.ok) await closeImap(opened.client);
});

check("a wrong password is auth_failed, and no text of the failure holds a password", async (ctx) => {
  const wrong = `senha-errada-${ctx.stamp}`;
  const result = await verifyImapSettings(etherealImap(ctx), { user: ctx.ethereal.user, pass: wrong });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "auth_failed");
  assert.ok(result.technical.length > 0, "the failure carries the library's words");
  assertNoSecret(result.technical, wrong, ctx.ethereal.pass);
});

check("the library's own words are redacted too: a password they contain comes back as ***", async (ctx) => {
  // imapflow's message for a refused login is "Command failed": a password with those words finds them in the text.
  const result = await verifyImapSettings(etherealImap(ctx), { user: ctx.ethereal.user, pass: "Command failed" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "auth_failed");
  assert.ok(result.technical.includes("***") && !result.technical.includes("Command failed"), result.technical);
});

check("the certificate is always checked: the server by its IP, a name its certificate doesn't carry, is tls_failed", async (ctx) => {
  const { address } = await lookup(ctx.ethereal.imap.host, { family: 4 });
  const result = await verifyImapSettings({ host: address, port: 993, security: "ssl" }, etherealAuth(ctx));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "tls_failed");
  assertNoSecret(result.technical, ctx.ethereal.pass);
});

check("an internal address, or a name that leads to one, is host_not_allowed before any connection", async (ctx) => {
  const fake = await listenFakeImap("IMAP4rev1");
  try {
    // The loopback server is really there: the guard has to answer before anything dials it.
    for (const host of ["127.0.0.1", "localhost"]) {
      const result = await verifyImapSettings({ host, port: fake.port as ImapPort, security: "starttls" }, etherealAuth(ctx));
      assert.equal(result.ok, false, host);
      if (result.ok) return;
      assert.equal(result.error, "host_not_allowed", host);
      assertNoSecret(result.technical, ctx.ethereal.pass);
    }
    assert.equal(fake.connections(), 0, "the guard let a connection through");
  } finally {
    await fake.close();
  }
  for (const host of ["10.1.2.3", "169.254.169.254", "::1", "::ffff:127.0.0.1"]) {
    const result = await verifyImapSettings({ host, port: 993, security: "ssl" }, etherealAuth(ctx));
    assert.equal(result.ok === false && result.error, "host_not_allowed", host);
  }
});

check("a name that doesn't resolve is host_not_found, and a password typed as the name is redacted from the text", async (ctx) => {
  // ".invalid" never resolves (RFC 6761). The name is the password, so the failure text, which names the host, has to hide it.
  const host = `${ctx.ethereal.pass}.invalid`;
  const result = await verifyImapSettings({ host, port: 993, security: "ssl" }, etherealAuth(ctx));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "host_not_found");
  assert.ok(result.technical.includes("***"), "the host name was not redacted");
  assertNoSecret(result.technical, ctx.ethereal.pass);
});

check("openImap connects to the checked address with the typed name as SNI; closeImap and error events never throw", async (ctx) => {
  const opened = await openImap(etherealImap(ctx), etherealAuth(ctx));
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const { client } = opened;
  try {
    assert.notEqual(net.isIP(client.host), 0, "it must connect to the address, not to the name");
    assert.equal(client.servername, ctx.ethereal.imap.host);
    assert.equal(client.secureConnection, true);
    assert.equal(client.usable, true);
    // An "error" event with nobody listening throws, and in a server that is the process.
    assert.doesNotThrow(() => client.emit("error", new Error("the socket reset")));
  } finally {
    await closeImap(client);
  }
  assert.equal(client.isClosed, true);
  await assert.doesNotReject(closeImap(client), "closing twice");
  await assert.doesNotReject(closeImap(new ImapFlow({ host: "127.0.0.1", logger: false })), "closing a client that never connected");
});

// ── Caixa: reading the Inbox (imap/inbox.ts) ─────────────────────────────────
//
// The test organization's SMTP account points at the Ethereal mailbox, with its IMAP. The e-mails get in the way a real one
// does, through Ethereal's own SMTP, which keeps everything sent through it in the account's Inbox. The checks of this
// section run in order and share the Inbox: they read it (and open two e-mails), and the last two add to it and spoil it.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4 tabela de precos");
const M1_SUBJECT = "Promoção de outubro";
const M2_SUBJECT = "Tabela de preços";

/** M1: plain text in ISO-8859-1 (quoted-printable, accents as =E7=E3), from a customer: the Brazilian case. */
const M1 = [
  "From: Cliente <cliente@exemplo.com.br>",
  "To: caixa@exemplo.com.br",
  "Subject: =?ISO-8859-1?Q?Promo=E7=E3o_de_outubro?=",
  "Message-ID: <m1@exemplo.com.br>",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=iso-8859-1",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Promo=E7=E3o de outubro: 10% de desconto",
  "",
].join("\r\n");

/** M2: HTML with an inline image (cid:) and the file tabela.pdf. */
const M2 = [
  "From: Fornecedor <fornecedor@exemplo.com.br>",
  "To: caixa@exemplo.com.br",
  "Cc: Financeiro <financeiro@exemplo.com.br>",
  "Subject: =?UTF-8?Q?Tabela_de_pre=C3=A7os?=",
  "Message-ID: <m2@exemplo.com.br>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="MIXED"',
  "",
  "--MIXED",
  'Content-Type: multipart/related; boundary="REL"',
  "",
  "--REL",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Segue a tabela <img src="cid:img1"></p>',
  "--REL",
  "Content-Type: image/png; name=logo.png",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <img1>",
  "Content-Disposition: inline; filename=logo.png",
  "",
  PNG.toString("base64"),
  "--REL--",
  "--MIXED",
  'Content-Type: application/pdf; name="tabela.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="tabela.pdf"',
  "",
  PDF.toString("base64"),
  "--MIXED--",
  "",
].join("\r\n");

/** What the checks of this section hand to one another: the two e-mails' ids as the list gave them, the PDF's id in M2. */
const box = { m1: "", m2: "", uidValidity: 0, pdf: "" };
const uidOf = (id: string) => Number(id.split(".")[1]);

/** Sends through the Ethereal account's own SMTP, which files the e-mail in that account's Inbox. */
async function sendThroughEthereal(ctx: ImapCtx, raw: string): Promise<void> {
  const { host, port, secure } = ctx.ethereal.smtp;
  const transport = createTransport({
    host,
    port,
    secure,
    auth: { user: ctx.ethereal.user, pass: ctx.ethereal.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
  try {
    let last = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await transport.sendMail({ envelope: { from: ctx.ethereal.user, to: [ctx.ethereal.user] }, raw });
        return;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        if (attempt < 3) await sleep(1_500 * attempt);
      }
    }
    throw new Error(`Ethereal's SMTP did not take the e-mail after 3 tries (${last})`);
  } finally {
    transport.close();
  }
}

/** Waits (up to 30 s) until the Ethereal Inbox holds `count` e-mails, asking the server itself, not the code under test. */
async function waitForInbox(ctx: ImapCtx, count: number): Promise<void> {
  const opened = await openImap(etherealImap(ctx), etherealAuth(ctx));
  if (!opened.ok) throw new Error(`could not open the Ethereal inbox (${opened.error})`);
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      const status = await opened.client.status("INBOX", { messages: true });
      if (status && (status.messages ?? 0) >= count) return;
      await sleep(1_000);
    }
    throw new Error(`${count} e-mail(s) did not reach the Ethereal inbox in 30 s`);
  } finally {
    await closeImap(opened.client);
  }
}

/** The SMTP account's credentials as stored, here pointed at Ethereal (587 STARTTLS) with the given IMAP half. */
function etherealCredentials(ctx: ImapCtx, imap: ImapSettings | null, pass = ctx.ethereal.pass): string {
  return sealSmtpSettings({
    host: ctx.ethereal.smtp.host,
    port: 587,
    security: "starttls",
    username: ctx.ethereal.user,
    password: pass,
    imap,
  });
}

/** The test organization's SMTP account row as the database has it now. */
function accountRow(ctx: ImapCtx) {
  return ctx.prisma.emailSenderAccount.findFirst({
    where: { organizationId: ctx.orgId, provider: "SMTP" },
    select: { status: true, lastError: true },
  });
}

/** Changes the test organization's SMTP account row. */
function updateAccount(
  ctx: ImapCtx,
  data: { credentials?: string; status?: "ACTIVE" | "NEEDS_RECONNECT"; lastError?: string | null },
) {
  return ctx.prisma.emailSenderAccount.updateMany({ where: { organizationId: ctx.orgId, provider: "SMTP" }, data });
}

type Answer<T> = { ok: true; data: T } | { ok: false; reason: string };

/**
 * Asks again (twice at most) while the answer is "temporary". For the calls that must get a real answer from the public
 * test server, which is slow now and then (a greeting that doesn't come in 10 s, say): a failure of the link is not what
 * these checks look for, and a real "temporary" bug still shows, since it comes back all three times.
 */
async function untilAnswered<T>(call: () => Promise<Answer<T>>): Promise<Answer<T>> {
  for (let attempt = 1; ; attempt++) {
    const res = await call();
    if (res.ok || res.reason !== "temporary" || attempt === 3) return res;
  }
}

/** `fn` on a connection to the Ethereal mailbox itself with the Inbox open: for what a check does to the mailbox behind the code's back. */
async function withEtherealInbox<T>(ctx: ImapCtx, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const opened = await openImap(etherealImap(ctx), etherealAuth(ctx));
  if (!opened.ok) throw new Error(`could not open the Ethereal inbox (${opened.error})`);
  try {
    const lock = await opened.client.getMailboxLock("INBOX");
    try {
      return await fn(opened.client);
    } finally {
      lock.release();
    }
  } finally {
    await closeImap(opened.client);
  }
}

/** The inbox view that must succeed. `maxMessageBytes` lowers the size above which an e-mail isn't downloaded. */
async function view(
  ctx: ImapCtx,
  opts: { search?: string; unreadOnly?: boolean; messageId?: string | null; maxMessageBytes?: number } = {},
) {
  const res = await untilAnswered(() => loadImapInboxView(ctx.orgId, { search: "", unreadOnly: false, messageId: null, ...opts }));
  if (!res.ok) throw new Error(`the inbox view failed: ${res.reason}`);
  return res.data;
}

/** An attachment download that gets a real answer (the file or "not_found"). */
const download = (ctx: ImapCtx, messageId: string, index: string, maxMessageBytes?: number) =>
  untilAnswered(() => downloadImapAttachment(ctx.orgId, messageId, index, maxMessageBytes));

/** The unread count of a mailbox that can be read: asked again while the link fails (null). */
async function unread(ctx: ImapCtx): Promise<number | null> {
  for (let attempt = 1; ; attempt++) {
    const count = await imapUnreadCount(ctx.orgId);
    if (count !== null || attempt === 3) return count;
  }
}

/** "ok", or why a call failed. */
const reason = (res: { ok: true } | { ok: false; reason: string }): string => (res.ok ? "ok" : res.reason);

/**
 * Runs `fn` (a view, a count or a download of the code under test) against a fake mailbox of its own instead of the
 * account's server: openImap refuses loopback on purpose, so the connector is swapped for one that dials the fake
 * with the options a real connection would have. `tuning` also lowers the budget and the byte cap (and, for a reply,
 * the limits of the request after the hand-over). The connector takes openImap's third argument, the time to open the
 * connection, and does what openImap does with it: a login that doesn't finish in that time fails as a timeout.
 * `openedWith` collects the time each connection asked for (undefined: the usual one), in the order they were made.
 */
async function againstFake<T>(
  options: FakeMailboxOptions,
  fn: () => Promise<T>,
  tuning: Partial<Omit<typeof imapRequest, "open">> = {},
  openedWith: (number | undefined)[] = [],
): Promise<T> {
  const fake = await listenFakeMailbox(options);
  const saved = { ...imapRequest };
  imapRequest.open = async (_settings, _auth, openMs): ReturnType<typeof openImap> => {
    openedWith.push(openMs);
    const client = new ImapFlow(loopbackOptions(fake.port));
    client.on("error", () => {});
    let expired = false;
    const budget =
      openMs === undefined
        ? undefined
        : setTimeout(() => {
            expired = true;
            client.close();
          }, openMs);
    try {
      await client.connect();
      return { ok: true, client };
    } catch (e) {
      client.close();
      // Out of time, the login only failed because the budget closed the client: the timeout is the cause (as in openImap).
      const failure = expired ? { code: "ETIMEDOUT", message: `The connection did not finish in ${(openMs ?? 0) / 1000} s` } : e;
      // What it refuses is named the way a real server's refusal is (the fake's login uses these credentials).
      return { ok: false, ...imapFailureOf(failure, { user: "u", pass: "senha-ficticia" }) };
    } finally {
      clearTimeout(budget);
    }
  };
  Object.assign(imapRequest, tuning);
  try {
    return await fn();
  } finally {
    Object.assign(imapRequest, saved);
    await fake.close();
  }
}

/** The inbox view of the test organization as a fake mailbox answers it; its logged failures are collected, not printed. */
async function fakeView(
  options: FakeMailboxOptions,
  ctx: ImapCtx,
  opts: { search?: string; unreadOnly?: boolean; messageId?: string | null } = {},
  tuning: Partial<Omit<typeof imapRequest, "open">> = {},
) {
  let result!: Awaited<ReturnType<typeof loadImapInboxView>>;
  const logged = await errorsLoggedBy(async () => {
    result = await againstFake(
      options,
      () => loadImapInboxView(ctx.orgId, { search: "", unreadOnly: false, messageId: null, ...opts }),
      tuning,
    );
  });
  return { result, logged };
}

/** What `fn` writes with console.error, as one text, without printing it. */
async function errorsLoggedBy(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : inspect(a))).join(" "));
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

check("the test organization's SMTP account points at the Ethereal inbox", async (ctx) => {
  await ctx.prisma.emailSenderAccount.create({
    data: {
      organizationId: ctx.orgId,
      provider: "SMTP",
      email: ctx.ethereal.user.toLowerCase(),
      displayName: "IMAP E2E",
      accountKind: "smtp",
      credentials: etherealCredentials(ctx, etherealImap(ctx)),
      connectedById: "imap-e2e",
    },
  });
});

// The next checks run the code under test against a fake mailbox of their own (againstFake): a server that refuses, drops,
// hangs or floods is not something a real one can be asked to be, and what imapflow does about it is not what it looks like.

type FakeOn = NonNullable<FakeMailboxOptions["on"]>;
const refuse =
  (verb: string): FakeOn =>
  ({ name, tag }, socket) =>
    name === verb ? (socket.write(`${tag} BAD [CLIENTBUG] refused\r\n`), true) : false;
const dropOn =
  (verb: string, only?: RegExp): FakeOn =>
  ({ name, line }, socket) =>
    name === verb && (!only || only.test(line)) ? (socket.destroy(), true) : false;
const hangOn =
  (verb: string): FakeOn =>
  ({ name }) =>
    name === verb;
/** Answers the command as usual and hangs up right after: the next command finds no connection (and imapflow no mailbox). */
const dropAfter =
  (verb: string, only?: RegExp): FakeOn =>
  ({ name, line, tag, set, rows }, socket) => {
    if (name !== verb || (only && !only.test(line))) return false;
    socket.end(`${rows(set)}${tag} OK done\r\n`);
    return true;
  };
const SOURCE_FETCH = /BODY\.PEEK\[\]/i;
const SIZE_FETCH = /RFC822\.SIZE/i;

check("a search the server refuses is not_found; a refused list or count is not the text's fault; one that accepts is ok", async (ctx) => {
  const accepted = await fakeView({}, ctx, { search: "x" });
  assert.equal(reason(accepted.result), "ok", accepted.logged);
  assert.ok(accepted.result.ok);
  assert.deepEqual(
    accepted.result.data.page.messages.map((m) => m.subject),
    ["m2", "m1"],
  );

  // BAD to the search itself: nothing found because of the text ("try other words"), also with only the unread filter.
  for (const opts of [{ search: "x" }, { search: "promoção" }, { unreadOnly: true }]) {
    const { result } = await fakeView({ on: refuse("UID SEARCH") }, ctx, opts);
    assert.equal(reason(result), "not_found", JSON.stringify(opts));
  }
  // BAD to the list or to the count after it is no fault of the text: try again later.
  for (const [verb, opts] of [
    ["UID FETCH", { search: "x" }],
    ["FETCH", {}],
    ["STATUS", {}],
  ] as const) {
    const { result } = await fakeView({ on: refuse(verb) }, ctx, opts);
    assert.equal(reason(result), "temporary", `${verb}: ${JSON.stringify(result)}`);
  }
  // The count on its own, with its STATUS refused: no number, which is not a zero.
  assert.equal(await againstFake({ on: refuse("STATUS") }, () => imapUnreadCount(ctx.orgId)), null);
  assert.equal(await againstFake({}, () => imapUnreadCount(ctx.orgId)), 2, "the control: the same count against a server that answers");
});

check("a connection lost or cut in the middle of a request is temporary: never an empty inbox, a 404 or a zero", async (ctx) => {
  // [what the server does, what is asked of it]
  const views: [string, FakeOn, { search?: string; messageId?: string }][] = [
    ["drops on STATUS", dropOn("STATUS"), {}],
    ["drops on the search", dropOn("UID SEARCH"), { search: "x" }],
    ["drops on the list by sequence number", dropOn("FETCH"), {}],
    ["drops on the list by UID", dropOn("UID FETCH"), { search: "x" }],
    ["drops on the opened e-mail's source", dropOn("UID FETCH", SOURCE_FETCH), { messageId: "1000.1" }],
    // Between two commands: imapflow answers the next with nothing, without an error (no mailbox any more).
    ["hangs up after the list, before the e-mail is opened", dropAfter("FETCH"), { messageId: "1000.1" }],
    // The read mark is the one write, and imapflow's answer to a mark that couldn't be made is a quiet `false`: the page
    // came out whole, but over a connection that is gone, and that is a "try again", not an answer.
    ["hangs up after the e-mail's source, before the read mark", dropAfter("UID FETCH", SOURCE_FETCH), { messageId: "1000.1" }],
  ];
  for (const [label, on, opts] of views) {
    const { result, logged } = await fakeView({ on }, ctx, opts);
    assert.equal(reason(result), "temporary", `${label}: ${JSON.stringify(result)}`);
    assert.ok(logged.length > 0, `${label}: the failure is logged`);
  }
  // The budget runs out while STATUS is in flight (the case the 60 s budget meets on a slow search of a big mailbox).
  const started = Date.now();
  const slow = await fakeView({ on: hangOn("STATUS") }, ctx, {}, { budgetMs: 300 });
  assert.equal(reason(slow.result), "temporary", JSON.stringify(slow.result));
  assert.ok(Date.now() - started < 5_000, `${Date.now() - started} ms`);
  assert.ok(slow.logged.includes("more than"), slow.logged);

  // The count and the download.
  let lostCount: number | null = -1;
  const lostDownloads: Record<string, string> = {};
  const loggedBoth = await errorsLoggedBy(async () => {
    lostCount = await againstFake({ on: dropOn("STATUS") }, () => imapUnreadCount(ctx.orgId));
    const downloads: [string, FakeOn][] = [
      ["drops on the source", dropOn("UID FETCH", SOURCE_FETCH)],
      // The case of a download turned into a 404: the size comes, the connection goes, and the source is asked of nothing.
      ["hangs up between the size and the source", dropAfter("UID FETCH", SIZE_FETCH)],
    ];
    for (const [label, on] of downloads) {
      lostDownloads[label] = reason(await againstFake({ on }, () => downloadImapAttachment(ctx.orgId, "1000.1", "0")));
    }
  });
  assert.equal(lostCount, null);
  assert.deepEqual(lostDownloads, { "drops on the source": "temporary", "hangs up between the size and the source": "temporary" });
  assert.ok(loggedBoth.length > 0, "the failures are logged");
});

check("a server that floods rows nobody asked for is cut off after a few, not read until the budget is gone", async (ctx) => {
  const flood: FakeOn = ({ name }, socket) => {
    if (name !== "FETCH") return false;
    let n = 1_000;
    const pump = () => {
      if (socket.destroyed) return;
      let out = "";
      for (let i = 0; i < 2_000; i++, n++) out += `* ${n} FETCH (UID ${n} FLAGS ())\r\n`;
      if (socket.write(out)) setImmediate(pump);
      else socket.once("drain", pump);
    };
    pump();
    return true;
  };
  const started = Date.now();
  // A 5 s budget: reading the flood to the end would stop only there.
  const { result, logged } = await fakeView({ on: flood }, ctx, {}, { budgetMs: 5_000 });
  assert.equal(reason(result), "temporary", JSON.stringify(result));
  assert.ok(Date.now() - started < 2_500, `${Date.now() - started} ms`);
  assert.ok(logged.includes("more than"), logged);
});

check("a request that takes in more than its byte cap is cut off", async (ctx) => {
  // Four answers of 1 MiB each, one every 120 ms: a request with a 2 MiB cap (looked at every 100 ms) meets it in the middle of one.
  const numbers = "1 ".repeat(512 * 1024);
  const slowSearch: FakeOn = ({ name, tag }, socket) => {
    if (name !== "UID SEARCH") return false;
    let sent = 0;
    const timer = setInterval(() => {
      if (socket.destroyed) return clearInterval(timer);
      if (sent++ < 4) return void socket.write(`* SEARCH ${numbers}\r\n`);
      clearInterval(timer);
      socket.write(`${tag} OK done\r\n`);
    }, 120);
    return true;
  };
  // The control: the default cap takes those 4 MiB in.
  const taken = await fakeView({ on: slowSearch }, ctx, { search: "x" });
  assert.equal(reason(taken.result), "ok", taken.logged);
  const cut = await fakeView({ on: slowSearch }, ctx, { search: "x" }, { maxReceivedBytes: 2 * 1024 * 1024 });
  assert.equal(reason(cut.result), "temporary", JSON.stringify(cut.result));
  assert.ok(cut.logged.includes("more than"), cut.logged);
});

check("a watchdog that fails cuts the request as temporary at once; it is not an uncaught exception in the shared process", async (ctx) => {
  // The watchdog is a timer, so what throws in it belongs to no try of the request: in the server that is an uncaught
  // exception, which takes down every company's requests. Here the connection's byte counter breaks (with a listener,
  // the exception is only recorded, as the check must go on).
  const uncaught: unknown[] = [];
  const onUncaught = (e: unknown) => void uncaught.push(e);
  process.on("uncaughtException", onUncaught);
  try {
    const startedAt = Date.now();
    let result!: Awaited<ReturnType<typeof loadImapInboxView>>;
    const logged = await errorsLoggedBy(async () => {
      result = await againstFake(
        // The STATUS never answers, so the request is alive when the watchdog looks.
        { on: hangOn("STATUS") },
        async () => {
          const dial = imapRequest.open;
          imapRequest.open = async (...args) => {
            const opened = await dial(...args);
            if (opened.ok) {
              opened.client.stats = () => {
                throw new Error("the counter broke");
              };
            }
            return opened;
          };
          return loadImapInboxView(ctx.orgId, { search: "", unreadOnly: false, messageId: null });
        },
        // The budget is the stop the request would meet if the watchdog just died: 3 s, far past the first look (100 ms).
        { budgetMs: 3_000 },
      );
    });
    assert.deepEqual(uncaught, [], "the watchdog's failure reached the process");
    assert.equal(reason(result), "temporary", JSON.stringify(result));
    assert.ok(Date.now() - startedAt < 2_000, `${Date.now() - startedAt} ms: cut at the first look, not by the budget`);
    assert.ok(logged.includes("IMAP request cut: its watchdog failed (the counter broke)"), logged);
  } finally {
    process.off("uncaughtException", onUncaught);
  }
});

check("rows nobody asked for, split in two or repeated don't turn into blank or doubled e-mails", async (ctx) => {
  const noisy: FakeOn = ({ name, tag, rows }, socket) => {
    if (name !== "FETCH") return false;
    // E-mail 1; a flags-only row for e-mail 2 ahead of its own; e-mail 2; e-mail 1 again; a flags-only row that
    // marks e-mail 1 read (someone read it meanwhile); and two e-mails nobody asked for, one of them complete.
    const stray = rows("1").replace("* 1 FETCH (UID 1 ", "* 99 FETCH (UID 99 ");
    socket.write(
      `${rows("1")}* 2 FETCH (FLAGS (\\Flagged))\r\n${rows("2")}${rows("1")}* 1 FETCH (FLAGS (\\Seen))\r\n` +
        `${stray}* 98 FETCH (UID 98 FLAGS ())\r\n${tag} OK done\r\n`,
    );
    return true;
  };
  const { result } = await fakeView({ on: noisy }, ctx);
  assert.ok(result.ok, JSON.stringify(result));
  // The extra rows add to the e-mail they are about (its PDF mark survives the later flags-only row; the read mark
  // is the latest), and nothing of them becomes an e-mail of its own.
  assert.deepEqual(
    result.data.page.messages.map((m) => [m.id, m.subject, m.hasAttachments, m.isRead]),
    [
      ["1000.2", "m2", false, false],
      ["1000.1", "m1", true, true],
    ],
  );
});

/** A raw client logged in to a fake mailbox with its Inbox open, for what is checked below the level of a view. */
async function withFakeClient<T>(options: FakeMailboxOptions, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const fake = await listenFakeMailbox(options);
  const client = new ImapFlow(loopbackOptions(fake.port));
  client.on("error", () => {});
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  } finally {
    client.close();
    await fake.close();
  }
}

check("a row keeps only what the list asked for, and a refused second FETCH only leaves that e-mail out of the page", async () => {
  // A literal nobody asked for hung on every row (16 MB in real life; five bytes show whether it is kept).
  const withLiteral: FakeOn = ({ name, tag, set, rows }, socket) => {
    if (name !== "FETCH") return false;
    socket.write(`${rows(set).replace(/\)\r\n/g, " BODY[] {5}\r\nHELLO)\r\n")}${tag} OK done\r\n`);
    return true;
  };
  await withFakeClient({ on: withLiteral }, async (client) => {
    // The control: imapflow's own fetchAll hands that literal over.
    const raw = await client.fetchAll("1:*", { uid: true, flags: true });
    assert.deepEqual(
      raw.map((row) => row.source?.toString()),
      ["HELLO", "HELLO"],
    );
    const rows = await fetchListRows(client, "1:*", { byUid: false, ids: [1, 2] });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ["envelope", "flags", "hasAttachments", "internalDate", "seq", "uid"], String(row.uid));
    }
  });

  // The second FETCH (without the structure) is the one refused; the first lost e-mail 2 to its deep structure.
  const refuseFlat: FakeOn = ({ name, line, tag }, socket) =>
    name === "FETCH" && !/BODYSTRUCTURE/i.test(line) ? (socket.write(`${tag} BAD refused\r\n`), true) : false;
  const kept = await withFakeClient({ levels: 30, on: refuseFlat }, (client) =>
    fetchListRows(client, "1:*", { byUid: false, ids: [1, 2] }),
  );
  assert.deepEqual(
    kept.map((row) => row.uid),
    [1],
  );
});

check("the two e-mails reach the Ethereal inbox, in order", async (ctx) => {
  await sendThroughEthereal(ctx, M1);
  await waitForInbox(ctx, 1);
  await sendThroughEthereal(ctx, M2);
  await waitForInbox(ctx, 2);
});

check("the list has the newest first, both unread, only the second with attachments, and nothing opened", async (ctx) => {
  const { page, detail } = await view(ctx);
  assert.equal(detail, null);
  assert.deepEqual(
    page.messages.map((m) => m.subject),
    [M2_SUBJECT, M1_SUBJECT],
  );
  assert.deepEqual(
    page.messages.map((m) => m.isRead),
    [false, false],
  );
  assert.deepEqual(
    page.messages.map((m) => m.hasAttachments),
    [true, false],
  );
  assert.equal(page.unreadCount, 2);
  const [m2, m1] = page.messages;
  assert.deepEqual(m1.from, { name: "Cliente", email: "cliente@exemplo.com.br" });
  assert.deepEqual(m2.from, { name: "Fornecedor", email: "fornecedor@exemplo.com.br" });
  assert.equal(m1.preview, "", "the list never downloads a body, so it has no preview");
  // The date is the server's INTERNALDATE (the delivery), not a header the sender wrote.
  assert.ok(Math.abs(Date.now() - Date.parse(m2.receivedAt)) < 30 * 60_000, m2.receivedAt);
  assert.ok(Date.parse(m2.receivedAt) >= Date.parse(m1.receivedAt));
  const ref = /^(\d+)\.(\d+)$/.exec(m1.id);
  assert.ok(ref, `an id is <uidvalidity>.<uid>: ${m1.id}`);
  box.m1 = m1.id;
  box.m2 = m2.id;
  box.uidValidity = Number(ref[1]);
  assert.equal(m2.id, `${ref[1]}.${uidOf(m1.id) + 1}`, "the second e-mail has the next UID of the same numbering");
});

check("unreadOnly lists both; a search for \"promoção\" finds only the ISO-8859-1 one, typed with or without accents", async (ctx) => {
  // Read-only requests, each on a connection of its own: asked together, so the slow link is paid once.
  const asks: [string, { search?: string; unreadOnly?: boolean }, string[]][] = [
    ["unreadOnly", { unreadOnly: true }, [M2_SUBJECT, M1_SUBJECT]],
    // Ethereal's index ignores accents and a server like Dovecot keeps them: both spellings are asked for, so either finds it.
    // One word at a time: Ethereal reads a phrase as any of its words, which a server like Dovecot doesn't.
    ["promoção", { search: "promoção" }, [M1_SUBJECT]],
    ["PROMOÇÃO", { search: "PROMOÇÃO" }, [M1_SUBJECT]],
    ["promocao", { search: "promocao" }, [M1_SUBJECT]],
    ["desconto (only in the body)", { search: "desconto" }, [M1_SUBJECT]],
    ["promoção + unreadOnly", { search: "promoção", unreadOnly: true }, [M1_SUBJECT]],
    ["tabela", { search: "tabela" }, [M2_SUBJECT]],
    ["a word no e-mail has", { search: "palavra-que-nenhum-email-tem" }, []],
  ];
  const answers = await Promise.all(asks.map(async ([, opts]) => (await view(ctx, opts)).page.messages.map((m) => m.subject)));
  asks.forEach(([label, , expected], i) => assert.deepEqual(answers[i], expected, label));
});

check("a search with quotes, a backslash, a line break or control characters is answered, never a protocol error", async (ctx) => {
  const asks: [string, string, number][] = [
    ["a quote and a backslash", 'a"b\\', 0],
    ["a line break, then a command", "x\r\n* BAD", 0],
    ["a NUL", "x\0y", 0],
    // Nothing is left of it once the accents are taken away, and a search for nothing would match everything.
    ["a combining accent alone", "́", 0],
    // Blanks are no search at all: both e-mails.
    ["blanks", "   ", 2],
  ];
  const answers = await Promise.all(asks.map(async ([, search]) => await view(ctx, { search })));
  asks.forEach(([label, , count], i) => {
    assert.equal(answers[i].detail, null, label);
    assert.equal(answers[i].page.messages.length, count, label);
  });
});

check("imapUnreadCount counts the unread e-mails of the Inbox", async (ctx) => {
  assert.equal(await unread(ctx), 2);
});

check("opening an e-mail shows the body with its inline image and lists its attachment; the same answer shows it read", async (ctx) => {
  const { page, detail } = await view(ctx, { messageId: box.m2 });
  assert.ok(detail?.ok, "the e-mail opens");
  const d = detail.data;
  assert.equal(d.id, box.m2);
  assert.equal(d.subject, M2_SUBJECT);
  assert.ok(d.bodyDocument.includes("data:image/png;base64,"), "the cid image is a data URI");
  assert.ok(d.bodyDocument.includes(PNG.toString("base64")));
  assert.ok(!d.bodyDocument.includes("cid:"));
  assert.deepEqual(
    d.attachments.map((a) => [a.name, a.contentType, a.size, a.downloadable]),
    [["tabela.pdf", "application/pdf", PDF.length, true]],
    "the image the body shows itself is not listed",
  );
  assert.deepEqual(d.to, [{ name: null, email: "caixa@exemplo.com.br" }]);
  assert.deepEqual(d.cc, [{ name: "Financeiro", email: "financeiro@exemplo.com.br" }]);
  assert.equal(d.webLink, null);
  assert.equal(d.isRead, true);
  assert.deepEqual(
    page.messages.map((m) => [m.subject, m.isRead]),
    [
      [M2_SUBJECT, true],
      [M1_SUBJECT, false],
    ],
    "the list in the same answer already shows it read",
  );
  assert.equal(page.unreadCount, 1);
  box.pdf = d.attachments[0].id;
});

check("the read mark is on the server, and reading never marks anything else: the other e-mail stays unread", async (ctx) => {
  const [{ page }, count, unreadOnly] = await Promise.all([view(ctx), unread(ctx), view(ctx, { unreadOnly: true })]);
  assert.deepEqual(
    page.messages.map((m) => [m.subject, m.isRead]),
    [
      [M2_SUBJECT, true],
      [M1_SUBJECT, false],
    ],
  );
  assert.equal(page.unreadCount, 1);
  assert.equal(count, 1);
  // Now that one is read, the filter tells the two apart.
  assert.deepEqual(
    unreadOnly.page.messages.map((m) => m.subject),
    [M1_SUBJECT],
  );
});

check("the attachment downloads with the PDF's own bytes; an id outside the e-mail's list is not_found", async (ctx) => {
  assert.equal(box.pdf, "1", "the image comes first in the parsed e-mail, the PDF second");
  // The file, then what the list doesn't have: the image the body shows itself (0), past the end (9), a spelling the list
  // never gave (01), and an e-mail with no attachment at all. Read-only, so asked together.
  const [file, ...misses] = await Promise.all([
    download(ctx, box.m2, box.pdf),
    download(ctx, box.m2, "0"),
    download(ctx, box.m2, "9"),
    download(ctx, box.m2, "01"),
    download(ctx, box.m1, "0"),
  ]);
  assert.ok(file.ok, `the download: ${reason(file)}`);
  assert.equal(file.data.name, "tabela.pdf");
  assert.equal(file.data.size, PDF.length);
  assert.deepEqual(Buffer.from(await new Response(file.data.body).arrayBuffer()), PDF);
  assert.deepEqual(misses.map(reason), ["not_found", "not_found", "not_found", "not_found"]);

  // Ids the URL could have been tampered into are refused before any connection is made.
  for (const [m, a] of [["abc", "1"], ["1.0", "1"], [box.m2, "x"], [box.m2, "1000"], [box.m2, ""]]) {
    assert.equal(reason(await downloadImapAttachment(ctx.orgId, m, a)), "not_found", `${m} / ${a}`);
  }
});

check("an id from another numbering (UIDVALIDITY) or for an e-mail that isn't there finds nothing, and the list still loads", async (ctx) => {
  const staleNumbering = imapMessageRef(box.uidValidity + 1, uidOf(box.m2));
  const missingUid = imapMessageRef(box.uidValidity, 9_999);
  const ids = [staleNumbering, missingUid, "abc"];
  const [views, staleDownload] = await Promise.all([
    Promise.all(ids.map((messageId) => view(ctx, { messageId }))),
    download(ctx, staleNumbering, box.pdf),
  ]);
  views.forEach(({ page, detail }, i) => {
    assert.deepEqual(detail, { ok: false, reason: "not_found" }, ids[i]);
    assert.equal(page.messages.length, 2, `${ids[i]}: the list loads all the same`);
    assert.equal(page.unreadCount, 1, `${ids[i]}: and nothing was marked`);
  });
  assert.equal(reason(staleDownload), "not_found");
});

check("a plain-text ISO-8859-1 e-mail opens with its accents intact; once both are read nothing is unread", async (ctx) => {
  const { page, detail } = await view(ctx, { messageId: box.m1 });
  assert.ok(detail?.ok, "the e-mail opens");
  assert.equal(detail.data.subject, M1_SUBJECT);
  assert.ok(detail.data.bodyDocument.includes("Promoção de outubro: 10% de desconto"), detail.data.bodyDocument);
  assert.deepEqual(detail.data.attachments, []);
  assert.equal(detail.data.isRead, true);
  assert.deepEqual(
    page.messages.map((m) => m.isRead),
    [true, true],
  );
  assert.equal(page.unreadCount, 0);
  // Opening one that is already read changes nothing, and the server agrees nothing is unread.
  const [again, count] = await Promise.all([view(ctx, { messageId: box.m2 }), unread(ctx)]);
  assert.ok(again.detail?.ok);
  assert.equal(again.page.unreadCount, 0);
  assert.equal(count, 0);
});

check("with more than 50 e-mails the list is the newest 50 and older ones come by search; the unread count is of all of them", async (ctx) => {
  // The server copies the Inbox into itself (one COPY doubles it: 2 → 64 in five) and every e-mail goes back to unread.
  await withEtherealInbox(ctx, async (client) => {
    for (let i = 0; i < 5; i++) assert.ok(await client.messageCopy("1:*", "INBOX"), "the server copied the Inbox into itself");
    assert.ok(await client.messageFlagsRemove("1:*", ["\\Seen"]), "the e-mails are unread again");
  });
  try {
    const [{ page }, found, count] = await Promise.all([view(ctx), view(ctx, { search: "promoção" }), unread(ctx)]);
    const ids = page.messages.map((m) => m.id);
    assert.equal(ids.length, 50, "a page is 50 e-mails");
    const uids = ids.map(uidOf);
    assert.deepEqual(
      uids,
      [...uids].sort((a, b) => b - a),
      "newest first",
    );
    assert.ok(!ids.includes(box.m1) && !ids.includes(box.m2), "the two oldest are past the page");
    assert.equal(page.unreadCount, 64, "the count is of the whole Inbox, not of the page");
    assert.equal(count, 64);
    // The oldest e-mail comes back by search, with its copies (one per doubling plus itself, all with the word).
    assert.ok(found.page.messages.some((m) => m.id === box.m1), "a search reaches the e-mail the page left out");
    assert.ok(found.page.messages.every((m) => m.subject === M1_SUBJECT));
  } finally {
    await withEtherealInbox(ctx, (client) => client.messageFlagsAdd("1:*", ["\\Seen"]));
  }
});

check("another company has its own inbox: with no SMTP account of its own it sees none of this one's", async (ctx) => {
  const other = await ctx.prisma.organization.create({
    data: { name: `IMAP-E2E-${ctx.stamp}-B`, slug: `imap-e2e-${ctx.stamp}-b` },
  });
  cleanups.push(async (c) => {
    await c.prisma.emailSenderAccount.deleteMany({ where: { organizationId: other.id } });
    await c.prisma.organization.deleteMany({ where: { id: other.id } });
  });
  assert.equal(reason(await loadImapInboxView(other.id, { search: "", unreadOnly: false, messageId: box.m2 })), "no_account");
  assert.equal(reason(await downloadImapAttachment(other.id, box.m2, box.pdf)), "no_account");
  assert.equal(await imapUnreadCount(other.id), null);
});

check("an account with no IMAP has no inbox; a disconnected one, or credentials that don't open, asks to reconnect", async (ctx) => {
  const cases: [string, { credentials?: string; status?: "ACTIVE" | "NEEDS_RECONNECT" }, string][] = [
    ["no IMAP half", { credentials: etherealCredentials(ctx, null) }, "no_account"],
    ["NEEDS_RECONNECT", { credentials: etherealCredentials(ctx, etherealImap(ctx)), status: "NEEDS_RECONNECT" }, "reconnect"],
    ["credentials that don't open", { credentials: "not-a-sealed-text", status: "ACTIVE" }, "reconnect"],
  ];
  try {
    for (const [label, data, expected] of cases) {
      await updateAccount(ctx, data);
      assert.equal(reason(await loadImapInboxView(ctx.orgId, { search: "", unreadOnly: false, messageId: null })), expected, label);
      assert.equal(reason(await downloadImapAttachment(ctx.orgId, box.m2, box.pdf)), expected, label);
      assert.equal(await imapUnreadCount(ctx.orgId), null, label);
    }
  } finally {
    await updateAccount(ctx, { credentials: etherealCredentials(ctx, etherealImap(ctx)), status: "ACTIVE" });
  }
});

check("a server that can't be reached is temporary, and nothing it logs holds the password", async (ctx) => {
  const { address } = await lookup(ctx.ethereal.imap.host, { family: 4 });
  // The server by its IP (its certificate doesn't carry one), and a name that doesn't resolve.
  const hosts = [address, `nao-existe-${ctx.stamp}.invalid`];
  try {
    for (const host of hosts) {
      await updateAccount(ctx, { credentials: etherealCredentials(ctx, { host, port: 993, security: "ssl" }) });
      const logged = await errorsLoggedBy(async () => {
        const [listed, downloaded, count] = await Promise.all([
          loadImapInboxView(ctx.orgId, { search: "", unreadOnly: false, messageId: null }),
          downloadImapAttachment(ctx.orgId, box.m2, box.pdf),
          imapUnreadCount(ctx.orgId),
        ]);
        assert.deepEqual([reason(listed), reason(downloaded), count], ["temporary", "temporary", null], host);
      });
      assert.ok(logged.length > 0, `${host}: the failure is logged`);
      assertNoSecret(logged, ctx.ethereal.pass);
      // Trouble with the server is not trouble with the login: the account is left as it was, and sending goes on.
      assert.equal((await accountRow(ctx))?.status, "ACTIVE", host);
    }
  } finally {
    await updateAccount(ctx, { credentials: etherealCredentials(ctx, etherealImap(ctx)) });
  }
});

check("an e-mail over the size cap is not downloaded: its headers and a notice are shown; one at the cap is read whole", async (ctx) => {
  // The cap is lowered to the size of the first e-mail instead of moving 15 MB: that one sits exactly at the cap, the second is over it.
  const sizes = await withEtherealInbox(ctx, async (client) => {
    const rows = await client.fetchAll("1:2", { uid: true, size: true });
    return new Map(rows.map((row) => [row.uid, row.size ?? 0]));
  });
  const cap = sizes.get(uidOf(box.m1)) ?? 0;
  assert.ok(cap > 0 && (sizes.get(uidOf(box.m2)) ?? 0) > cap, `the second e-mail is the bigger one (${[...sizes]})`);

  const [atCap, overCap, file] = await Promise.all([
    view(ctx, { messageId: box.m1, maxMessageBytes: cap }),
    view(ctx, { messageId: box.m2, maxMessageBytes: cap }),
    download(ctx, box.m2, box.pdf, cap),
  ]);
  assert.ok(atCap.detail?.ok, "the e-mail at the cap opens");
  assert.ok(atCap.detail.data.bodyDocument.includes("Promoção de outubro: 10% de desconto"), "at the cap it is read whole");
  assert.ok(overCap.detail?.ok, "the e-mail over the cap opens");
  const d = overCap.detail.data;
  assert.equal(d.subject, M2_SUBJECT);
  assert.deepEqual(d.from, { name: "Fornecedor", email: "fornecedor@exemplo.com.br" });
  assert.deepEqual(d.to, [{ name: null, email: "caixa@exemplo.com.br" }]);
  assert.deepEqual(d.cc, [{ name: "Financeiro", email: "financeiro@exemplo.com.br" }]);
  assert.deepEqual(d.attachments, []);
  assert.equal(d.webLink, null);
  assert.equal(d.notice, "tooBig", "the screen words the notice");
  assert.ok(!d.bodyDocument.includes("Segue a tabela") && !d.bodyDocument.includes("data:image"), "the body was not downloaded");
  assert.equal(reason(file), "not_found", "nor are its attachments");
});

check("a message the parser refuses shows its headers and a notice, not an error, and has no attachment to fetch", async (ctx) => {
  // 300 multiparts inside one another: more levels than postal-mime reads (256), in a few KB. The server's own structure is shorter.
  const levels = 300;
  const lines = [
    "From: Estranho <estranho@exemplo.com.br>",
    "To: caixa@exemplo.com.br",
    "Subject: Mensagem em camadas",
    "Message-ID: <camadas@exemplo.com.br>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b0"',
    "",
  ];
  for (let i = 0; i < levels; i++) lines.push(`--b${i}`, `Content-Type: multipart/mixed; boundary="b${i + 1}"`, "");
  lines.push(`--b${levels}`, "Content-Type: text/plain", "", "no fundo");
  for (let i = levels; i >= 0; i--) lines.push(`--b${i}--`);
  lines.push("");
  const id = await withEtherealInbox(ctx, async (client) => {
    const appended = await client.append("INBOX", Buffer.from(lines.join("\r\n")));
    // UIDPLUS: the server says which UID the e-mail got.
    assert.ok(appended && appended.uid !== undefined && appended.uidValidity !== undefined, "Ethereal took the e-mail");
    return imapMessageRef(Number(appended.uidValidity), appended.uid);
  });

  // Opening marks it read, the download only reads: asked together. Each logs why the parser refused, in one line.
  let answers!: [Awaited<ReturnType<typeof view>>, Awaited<ReturnType<typeof download>>];
  const logged = await errorsLoggedBy(async () => {
    answers = await Promise.all([view(ctx, { messageId: id }), download(ctx, id, "0")]);
  });
  const [{ page, detail }, downloaded] = answers;
  const logLines = logged.split("\n");
  assert.equal(logLines.length, 2, logged);
  assert.ok(logLines.every((line) => line.startsWith("IMAP message could not be parsed:") && line.length <= 250), logged);
  assert.ok(detail?.ok, "the e-mail opens");
  assert.equal(detail.data.subject, "Mensagem em camadas");
  assert.deepEqual(detail.data.from, { name: "Estranho", email: "estranho@exemplo.com.br" });
  assert.deepEqual(detail.data.attachments, []);
  assert.equal(detail.data.notice, "unreadable", "the screen words the notice");
  assert.ok(!detail.data.bodyDocument.includes("no fundo"));
  assert.equal(detail.data.isRead, true);
  assert.equal(page.messages[0].id, id);
  assert.equal(page.messages[0].isRead, true);
  // It was the only unread e-mail: counted before it was opened, and one less after.
  assert.equal(page.unreadCount, 0);
  assert.equal(reason(downloaded), "not_found");
});

check("a password the server refuses is reconnect and pauses the account: the next requests don't try it again", async (ctx) => {
  const wrong = `senha-errada-${ctx.stamp}`;
  // Counts the connections the requests make (the real connector underneath).
  const real = imapRequest.open;
  let opens = 0;
  imapRequest.open = (settings, auth, openMs) => {
    opens++;
    return real(settings, auth, openMs);
  };
  try {
    await updateAccount(ctx, { credentials: etherealCredentials(ctx, etherealImap(ctx), wrong) });
    const logged = await errorsLoggedBy(async () => {
      const [listed, downloaded] = await Promise.all([
        loadImapInboxView(ctx.orgId, { search: "", unreadOnly: false, messageId: null }),
        downloadImapAttachment(ctx.orgId, box.m2, box.pdf),
      ]);
      assert.deepEqual([reason(listed), reason(downloaded)], ["reconnect", "reconnect"]);
    });
    assertNoSecret(logged, wrong, ctx.ethereal.pass);
    assert.equal(opens, 2, "each request tried the login once");

    // The refused login paused the account (sending included, as with the other providers), and said why without the password.
    const paused = await accountRow(ctx);
    assert.equal(paused?.status, "NEEDS_RECONNECT");
    assert.ok(paused?.lastError?.startsWith("imap login refused"), String(paused?.lastError));
    assertNoSecret(paused?.lastError ?? "", wrong, ctx.ethereal.pass);

    // From here on every kind of request answers reconnect without opening a connection (and the count, null).
    opens = 0;
    const [listed, downloaded, count] = await Promise.all([
      loadImapInboxView(ctx.orgId, { search: "", unreadOnly: false, messageId: null }),
      downloadImapAttachment(ctx.orgId, box.m2, box.pdf),
      imapUnreadCount(ctx.orgId),
    ]);
    assert.deepEqual([reason(listed), reason(downloaded), count], ["reconnect", "reconnect", null]);
    assert.equal(opens, 0, "a paused account is not dialed");
  } finally {
    imapRequest.open = real;
    await updateAccount(ctx, { credentials: etherealCredentials(ctx, etherealImap(ctx)), status: "ACTIVE", lastError: null });
  }
});

check("a login the server refuses only for now is temporary and leaves the account alone; a refusal of the credentials pauses it", async (ctx) => {
  // imapflow calls every tagged NO of a login "authentication failed": a provider that is down or has too many of this
  // person's connections open says it so in the reply code, and pausing the account (its sends included) for that would
  // punish the person for the provider's bad moment.
  const refusingLogin =
    (reply: string): FakeOn =>
    ({ name, tag }, socket) =>
      name === "AUTHENTICATE" || name === "LOGIN" ? (socket.write(`${tag} NO ${reply}\r\n`), true) : false;
  // [what the server says, what the request answers, the account afterwards]
  const cases: [string, string, string][] = [
    ["[UNAVAILABLE] Temporary authentication failure.", "temporary", "ACTIVE"],
    ["[LIMIT] Maximum number of connections from user+IP exceeded", "temporary", "ACTIVE"],
    ["[INUSE] The mailbox is in use", "temporary", "ACTIVE"],
    ["[AUTHENTICATIONFAILED] Invalid credentials", "reconnect", "NEEDS_RECONNECT"],
    // With no code, nothing says it isn't the credentials.
    ["Login failed.", "reconnect", "NEEDS_RECONNECT"],
  ];
  try {
    for (const [said, answered, status] of cases) {
      const { result } = await fakeView({ on: refusingLogin(said) }, ctx);
      assert.equal(reason(result), answered, said);
      assert.equal((await accountRow(ctx))?.status, status, said);
      await updateAccount(ctx, { status: "ACTIVE", lastError: null });
    }
  } finally {
    await updateAccount(ctx, { status: "ACTIVE", lastError: null });
  }
});

// ── Resposta: answering an e-mail of the Inbox (imap/inbox.ts) ───────────────
//
// The reply leaves by the account's own SMTP server, a copy goes to its Sent folder and the e-mail answered is marked
// \Answered. Ethereal files whatever goes out through its SMTP in the sender's own Inbox (outside recipients included: it
// delivers nothing) and keeps no copy in Sent by itself, so what the Sent folder gains is the code's own APPEND. These
// checks come last: the replies land in the Inbox and would spoil the counts of the ones above. The ones that run the code
// against a fake mailbox hand the e-mail to a stub instead of Ethereal's SMTP (imapRequest.send), to make that step fail the
// ways a server does and to see exactly what it is given.

const REPLY_TEXT = "Olá!\nObrigado pelo contato <b>não</b> & até breve.";

/** What the code under test hands to the SMTP server: the account's settings, the envelope and the e-mail itself. */
type HandedOver = { settings: SmtpSettings; envelope: { from: string; to: string[] }; mime: Buffer };

const HAND_OVER_OK: MailboxSendOutcome = { ok: true };
const handOverFailed = (status: number, stage: "prepare" | "send", message: string): MailboxSendOutcome => ({
  ok: false,
  status,
  code: null,
  message,
  retryAfter: null,
  stage,
});

/** Runs `fn` with the hand-over to the SMTP server replaced by `answer`, and the list of what it was given. The real one is back at the end. */
async function withHandOver<T>(
  answer: (handed: HandedOver) => Promise<MailboxSendOutcome> | MailboxSendOutcome,
  fn: (handedOver: HandedOver[]) => Promise<T>,
): Promise<T> {
  const handedOver: HandedOver[] = [];
  const real = imapRequest.send;
  imapRequest.send = async (settings, envelope, mime) => {
    const handed = { settings, envelope, mime };
    handedOver.push(handed);
    return answer(handed);
  };
  try {
    return await fn(handedOver);
  } finally {
    imapRequest.send = real;
  }
}

/**
 * A reply to the fake mailbox's first e-mail (m1, from Fulano) by the test organization's account, with the hand-over stubbed:
 * what it answered, what was handed over, what the fake mailbox was asked, what time to open each connection was asked for
 * (`openedWith`, see againstFake) and what the code logged (collected, not printed). `limits` shrinks the limits of the request
 * after the hand-over (imapRequest.postSendOpenMs, postSendBudgetMs) and nothing else.
 */
async function replyAgainstFake(
  ctx: ImapCtx,
  options: FakeMailboxOptions,
  answer: (handed: HandedOver) => Promise<MailboxSendOutcome> | MailboxSendOutcome = () => HAND_OVER_OK,
  messageId = "1000.1",
  limits: Pick<Partial<typeof imapRequest>, "postSendOpenMs" | "postSendBudgetMs"> = {},
) {
  const record = newFakeRecord();
  const handedOver: HandedOver[] = [];
  const openedWith: (number | undefined)[] = [];
  let result!: Awaited<ReturnType<typeof replyToImapMessage>>;
  const logged = await errorsLoggedBy(async () => {
    result = await againstFake(
      { ...options, record },
      () => replyToImapMessage(ctx.orgId, messageId, REPLY_TEXT),
      {
        ...limits,
        send: async (settings, envelope, mime) => {
          const handed = { settings, envelope, mime };
          handedOver.push(handed);
          return answer(handed);
        },
      },
      openedWith,
    );
  });
  return { result, handedOver, record, logged, openedWith };
}

/** `fn` on a connection to the Ethereal mailbox itself, no folder open. */
async function withEtherealClient<T>(ctx: ImapCtx, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const opened = await openImap(etherealImap(ctx), etherealAuth(ctx));
  if (!opened.ok) throw new Error(`could not open the Ethereal mailbox (${opened.error})`);
  try {
    return await fn(opened.client);
  } finally {
    await closeImap(opened.client);
  }
}

/** What the Ethereal mailbox holds, asked of the server itself. */
type MailboxState = { sent: string; inbox: number; sentCount: number; answered: number[] };

async function readState(client: ImapFlow): Promise<MailboxState> {
  const sent = (await client.list()).find((folder) => folder.specialUse === "\\Sent")?.path;
  assert.ok(sent, "Ethereal marks one folder \\Sent");
  const inbox = await client.status("INBOX", { messages: true });
  const sentStatus = await client.status(sent, { messages: true });
  assert.ok(inbox && sentStatus, "the server answered the counts");
  const lock = await client.getMailboxLock("INBOX");
  try {
    const rows = await client.fetchAll("1:*", { uid: true, flags: true });
    const answered = rows.filter((row) => row.flags?.has("\\Answered")).map((row) => row.uid);
    return { sent, inbox: inbox.messages ?? 0, sentCount: sentStatus.messages ?? 0, answered };
  } finally {
    lock.release();
  }
}

type Arrived = {
  state: MailboxState;
  /** The e-mails of the Inbox that answer `inReplyTo`, parsed. */
  replies: Email[];
  /** The newest e-mail of the Sent folder. */
  newestSent: { seen: boolean; bytes: Buffer; email: Email } | null;
};

/** Waits (up to 30 s) until the Ethereal Inbox holds `inboxCount` e-mails, then reads what a reply left: the answers to `inReplyTo` and the newest e-mail of Sent. */
async function etherealAfterReply(ctx: ImapCtx, inboxCount: number, inReplyTo: string): Promise<Arrived> {
  return withEtherealClient(ctx, async (client) => {
    for (let attempt = 0; ; attempt++) {
      const status = await client.status("INBOX", { messages: true });
      if (status && (status.messages ?? 0) >= inboxCount) break;
      if (attempt === 30) throw new Error(`${inboxCount} e-mail(s) did not reach the Ethereal inbox in 30 s`);
      await sleep(1_000);
    }
    const state = await readState(client);
    const replies: Email[] = [];
    const inbox = await client.getMailboxLock("INBOX");
    try {
      for (const uid of (await client.search({ header: { "in-reply-to": inReplyTo } }, { uid: true })) || []) {
        const row = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
        if (row && row.source) replies.push(await PostalMime.parse(row.source));
      }
    } finally {
      inbox.release();
    }
    let newestSent: Arrived["newestSent"] = null;
    if (state.sentCount > 0) {
      const sent = await client.getMailboxLock(state.sent);
      try {
        const row = await client.fetchOne("*", { uid: true, flags: true, source: true });
        if (row && row.source) {
          newestSent = { seen: row.flags?.has("\\Seen") ?? false, bytes: row.source, email: await PostalMime.parse(row.source) };
        }
      } finally {
        sent.release();
      }
    }
    return { state, replies, newestSent };
  });
}

/** A header value on one line: PostalMime hands a folded one back as the server folded it. */
const oneLine = (value: string | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();

/** The test organization's SMTP account row. */
async function smtpAccountRow(ctx: ImapCtx) {
  const row = await ctx.prisma.emailSenderAccount.findFirst({ where: { organizationId: ctx.orgId, provider: "SMTP" } });
  assert.ok(row, "the test organization has its SMTP account");
  return row;
}

check("sendSmtpMail still delivers through the account's SMTP server; sendSmtpMime refuses an internal server and a wrong password without echoing it", async (ctx) => {
  const settings: SmtpSettings = {
    host: ctx.ethereal.smtp.host,
    port: 587,
    security: "starttls",
    username: ctx.ethereal.user,
    password: ctx.ethereal.pass,
  };
  const delivered = await sendSmtpMail(
    settings,
    {
      from: { name: "IMAP E2E", address: ctx.ethereal.user },
      to: ctx.ethereal.user,
      replyTo: null,
      subject: `Envio de regressao ${ctx.stamp}`,
      html: "<p>oi</p>",
      text: "oi",
      headers: {},
    },
    [],
  );
  assert.deepEqual(delivered, { ok: true });
  // The address guard answers before any connection, in the shape of every other refusal of the send path.
  const envelope = { from: ctx.ethereal.user, to: [ctx.ethereal.user] };
  assert.deepEqual(await sendSmtpMime({ ...settings, host: "127.0.0.1" }, envelope, Buffer.from("x")), {
    ok: false,
    status: 0,
    code: "guard",
    message: "127.0.0.1: internal or reserved address",
    retryAfter: null,
    stage: "prepare",
  });
  const wrong = `senha-errada-${ctx.stamp}`;
  const refused = await sendSmtpMime({ ...settings, password: wrong }, envelope, Buffer.from("x"));
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.stage, "prepare", "a refused login left nothing");
  assert.match(refused.code ?? "", /^auth/);
  assertNoSecret(refused.message, wrong, ctx.ethereal.pass);
});

const replyBox = { account: "" };

/**
 * `fn` with the request after a reply's hand-over given the time the other requests have (30 s to open, the usual budget). The
 * replies that go to Ethereal over the internet look for the copy in Sent, and a test server that is slow for a moment (a greeting
 * that takes 10 s, say) would cost them the copy for no fault of the code. The short limits themselves are checked against fake
 * servers, in "the request after the hand-over has limits of its own".
 */
async function withUsualPostSendLimits<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { openMs: imapRequest.postSendOpenMs, budgetMs: imapRequest.postSendBudgetMs };
  imapRequest.postSendOpenMs = 30_000;
  imapRequest.postSendBudgetMs = imapRequest.budgetMs;
  try {
    return await fn();
  } finally {
    imapRequest.postSendOpenMs = saved.openMs;
    imapRequest.postSendBudgetMs = saved.budgetMs;
  }
}

check("replying to M1 sends the answer by the account's SMTP in the same conversation, keeps a copy in Sent and marks M1 answered", async (ctx) => {
  replyBox.account = (await smtpAccountRow(ctx)).id;
  const before = await withEtherealClient(ctx, readState);
  assert.deepEqual(before.answered, [], "nothing is answered yet");
  assert.equal(before.sentCount, 0, "Ethereal keeps no copy in Sent by itself");

  const res = await withUsualPostSendLimits(() => untilAnswered(() => replyToImapMessage(ctx.orgId, box.m1, REPLY_TEXT)));
  assert.ok(res.ok, `the reply: ${reason(res)}`);
  assert.deepEqual(res.data, { accountId: replyBox.account, to: "cliente@exemplo.com.br", uncertain: false, savedToSent: true });

  // The answer comes back to the Inbox (Ethereal files what leaves it there), threaded under M1: its own copies in the Inbox have its
  // Message-ID too, but no In-Reply-To.
  const after = await etherealAfterReply(ctx, before.inbox + 1, "<m1@exemplo.com.br>");
  assert.equal(after.replies.length, 1, "exactly one answer was sent");
  const [mail] = after.replies;
  assert.equal(mail.subject, "Re: Promoção de outubro");
  assert.equal(mail.inReplyTo, "<m1@exemplo.com.br>");
  assert.equal(oneLine(mail.references), "<m1@exemplo.com.br>");
  assert.deepEqual(
    mail.to?.map((a) => a.address),
    ["cliente@exemplo.com.br"],
  );
  assert.equal(mail.from?.address, ctx.ethereal.user.toLowerCase());
  assert.equal(mail.from?.name, "IMAP E2E");
  assert.equal(mail.text?.replace(/\r\n/g, "\n").trim(), REPLY_TEXT);
  assert.ok(mail.html?.includes("Olá!<br>Obrigado pelo contato &lt;b&gt;não&lt;/b&gt; &amp; até breve."), mail.html);

  // The copy in Sent is that same e-mail, read (the person wrote it); and M1 is the only e-mail of the Inbox marked answered.
  assert.equal(after.state.sentCount, 1, "the Sent folder gained the copy");
  assert.ok(after.newestSent, "the copy is there");
  assert.equal(after.newestSent.seen, true);
  assert.equal(after.newestSent.email.messageId, mail.messageId);
  assert.equal(after.newestSent.email.subject, "Re: Promoção de outubro");
  assert.deepEqual(after.state.answered, [uidOf(box.m1)]);
});

/** The e-mails a sender can make hard to answer; appended to the Inbox as a sender's server would have delivered them. */
const REPLY_FIXTURES = {
  // Two Reply-To addresses, a subject padded with blanks, a comment after the Message-ID and a folded References.
  reply: [
    "From: Cliente <cliente@exemplo.com.br>",
    "Reply-To: Atendimento <atendimento@exemplo.com.br>, outro@exemplo.com.br",
    "To: caixa@exemplo.com.br",
    "Subject: Assunto    com   muitos     espacos",
    "Message-ID: <f1@exemplo.com.br> (comentario)",
    "References: <raiz@exemplo.com.br>",
    " <f0@exemplo.com.br>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "corpo",
    "",
  ].join("\r\n"),
  // A subject that decodes to a line break and a header of its own.
  lineBreak: [
    "From: Cliente <cliente@exemplo.com.br>",
    "To: caixa@exemplo.com.br",
    "Subject: =?UTF-8?Q?a=0D=0AX-Evil:_1?=",
    "Message-ID: <f4@exemplo.com.br>",
    "",
    "corpo",
    "",
  ].join("\r\n"),
  // A From whose address would end the RCPT TO line and start another command.
  hostile: [
    'From: <"a> RCPT TO:<z"@exemplo.com.br>',
    "To: caixa@exemplo.com.br",
    "Subject: x",
    "Message-ID: <f3@exemplo.com.br>",
    "",
    "corpo",
    "",
  ].join("\r\n"),
  // No From and no Reply-To at all.
  nobody: ["To: caixa@exemplo.com.br", "Subject: sem remetente", "", "corpo", ""].join("\r\n"),
};

check("a reply goes to the Reply-To, with the subject on one line and the original's chain; an e-mail with no plain address to answer gets none", async (ctx) => {
  const refs = await withEtherealInbox(ctx, async (client) => {
    const out = {} as Record<keyof typeof REPLY_FIXTURES, string>;
    for (const key of Object.keys(REPLY_FIXTURES) as (keyof typeof REPLY_FIXTURES)[]) {
      const appended = await client.append("INBOX", Buffer.from(REPLY_FIXTURES[key]));
      assert.ok(appended && appended.uid !== undefined && appended.uidValidity !== undefined, `Ethereal took the ${key} e-mail`);
      out[key] = imapMessageRef(Number(appended.uidValidity), appended.uid);
    }
    return out;
  });
  const account = await smtpAccountRow(ctx);

  // Read-only for the two with nothing to answer, and writing for the two with something: all four at once.
  const { answers, handedOver } = await withHandOver(
    () => HAND_OVER_OK,
    async (handed) => {
      const answers = await withUsualPostSendLimits(() =>
        Promise.all(
          (["reply", "lineBreak", "hostile", "nobody"] as const).map((key) => untilAnswered(() => replyToImapMessage(ctx.orgId, refs[key], REPLY_TEXT))),
        ),
      );
      return { answers, handedOver: [...handed] };
    },
  );
  const [reply, lineBreak, hostile, nobody] = answers;
  assert.deepEqual(
    [reason(hostile), reason(nobody)],
    ["not_found", "not_found"],
    "an address that is no plain mailbox, and no address at all, leave nothing to answer",
  );
  assert.ok(reply.ok && lineBreak.ok, `the replies: ${reason(reply)} / ${reason(lineBreak)}`);
  assert.deepEqual(reply.data, { accountId: account.id, to: "atendimento@exemplo.com.br", uncertain: false, savedToSent: true });
  assert.equal(lineBreak.data.to, "cliente@exemplo.com.br");
  assert.equal(handedOver.length, 2, "only the two with someone to answer were handed over");

  const handedFor = (to: string) => {
    const handed = handedOver.find((h) => h.envelope.to.join() === to);
    assert.ok(handed, `something was handed over for ${to}`);
    return handed;
  };
  const toReply = handedFor("atendimento@exemplo.com.br");
  assert.equal(toReply.envelope.from, account.email);
  const mail = await PostalMime.parse(toReply.mime);
  assert.equal(mail.subject, "Re: Assunto com muitos espacos", "the blanks collapse");
  assert.equal(mail.inReplyTo, "<f1@exemplo.com.br>", "without the comment the envelope keeps after the id");
  assert.equal(oneLine(mail.references), "<raiz@exemplo.com.br> <f0@exemplo.com.br> <f1@exemplo.com.br>");
  assert.deepEqual(
    mail.to?.map((a) => a.address),
    ["atendimento@exemplo.com.br"],
    "to the first Reply-To address only",
  );

  const toLineBreak = handedFor("cliente@exemplo.com.br");
  const flat = await PostalMime.parse(toLineBreak.mime);
  assert.equal(flat.subject, "Re: a X-Evil: 1");
  assert.ok(!flat.headers.some((h) => h.key === "x-evil"), "the subject started no header of its own");
  assert.ok(!toLineBreak.mime.toString("latin1").includes("\r\nX-Evil"), "nor a line of the MIME");

  // On the server: the two answered e-mails are marked (with M1 before them), the two with nobody to answer are not, and Sent holds the three copies.
  const state = await withEtherealClient(ctx, readState);
  assert.deepEqual(
    state.answered,
    [uidOf(box.m1), uidOf(refs.reply), uidOf(refs.lineBreak)].sort((a, b) => a - b),
  );
  assert.equal(state.sentCount, 3);
});

check("a hand-over the server refuses is temporary and one that may have gone out is uncertain: neither keeps a copy or marks anything, and no password reaches the log", async (ctx) => {
  const secret = ctx.ethereal.pass;
  const echo = `550 5.7.1 rejected for ${ctx.ethereal.user} with ${secret}`;
  const temporary = "temporary" as const;
  const uncertain = "uncertain" as const;
  // [what happens at the SMTP server, what the reply comes to]
  const cases: [string, () => Promise<MailboxSendOutcome>, typeof temporary | typeof uncertain][] = [
    ["the server says no after the content", async () => handOverFailed(550, "send", echo), temporary],
    ["the server hangs up with a 4xx", async () => handOverFailed(421, "send", echo), temporary],
    ["it never connected or logged in", async () => handOverFailed(0, "prepare", echo), temporary],
    ["the line drops while the e-mail is handed over", async () => handOverFailed(0, "send", echo), uncertain],
    [
      "something throws that should not",
      async () => {
        throw new Error(echo);
      },
      uncertain,
    ],
  ];
  for (const [label, answer, comes] of cases) {
    const { result, handedOver, record, logged } = await replyAgainstFake(ctx, {}, answer);
    assert.equal(handedOver.length, 1, `${label}: handed over once`);
    if (comes === temporary) {
      assert.equal(reason(result), "temporary", label);
    } else {
      assert.ok(result.ok, `${label}: ${JSON.stringify(result)}`);
      assert.equal(result.data.uncertain, true, label);
      assert.equal(result.data.savedToSent, false, label);
    }
    assert.equal(record.connections, 1, `${label}: no second request`);
    assert.equal(record.appended.length, 0, `${label}: no copy`);
    assert.ok(!record.lines.some((line) => /\bSTORE\b/.test(line)), `${label}: nothing marked`);
    assert.ok(logged.length > 0, `${label}: it is logged`);
    assertNoSecret(logged, secret);
  }
});

check("once the reply is sent nothing the mailbox does turns it into a failure: the copy and the mark are best effort, and it is sent once", async (ctx) => {
  const account = await smtpAccountRow(ctx);
  const answered = /\bUID STORE 1 \+FLAGS \(\\Answered\)$/;
  const marksAnswered = (lines: string[]) => lines.some((line) => answered.test(line));

  // The shape of KingHost's Dovecot: the Sent folder is INBOX.Sent and carries no mark. The copy is what was sent, byte for byte.
  const dovecot = await replyAgainstFake(ctx, { folders: [{ path: "INBOX.Sent" }] });
  assert.deepEqual(dovecot.result, {
    ok: true,
    data: { accountId: account.id, to: "fulano@exemplo.com.br", uncertain: false, savedToSent: true },
  });
  assert.equal(dovecot.handedOver.length, 1);
  const [handed] = dovecot.handedOver;
  assert.deepEqual(handed.envelope, { from: account.email, to: ["fulano@exemplo.com.br"] });
  const mail = await PostalMime.parse(handed.mime);
  assert.equal(mail.subject, "Re: m1");
  assert.equal(mail.inReplyTo, "<m1@exemplo.com.br>");
  assert.equal(oneLine(mail.references), "<raiz@exemplo.com.br> <meio@exemplo.com.br> <m1@exemplo.com.br>");
  assert.equal(mail.from?.address, account.email);
  assert.equal(dovecot.record.connections, 2, "one request to read, one to keep the copy and the mark");
  assert.equal(dovecot.record.appended.length, 1);
  const [copy] = dovecot.record.appended;
  assert.deepEqual([copy.destination, copy.flags], ["INBOX.Sent", "\\Seen"]);
  assert.ok(copy.bytes.equals(handed.mime), "the copy is the e-mail that was sent");
  assert.ok(marksAnswered(dovecot.record.lines), dovecot.record.lines.join("\n"));
  assert.equal(dovecot.logged, "", "a reply that went through logs nothing");

  // [what the mailbox does, the folders it has, whether the copy is kept, how many copies it was given, whether the e-mail is marked]
  const refusingCopy: FakeOn = ({ name, tag }, socket) =>
    name === "APPEND" ? (socket.write(`${tag} NO [OVERQUOTA] The mailbox is full\r\n`), true) : false;
  // (getMailboxLock asks for the INBOX alone; the folders are asked for with a *.)
  const refusingFolderList: FakeOn = ({ name, tag, line }, socket) =>
    name === "LIST" && line.endsWith('"*"') ? (socket.write(`${tag} BAD [CLIENTBUG] refused\r\n`), true) : false;
  let selects = 0;
  const renumberedAfterReading: FakeOn = ({ name, tag }, socket) => {
    if (name !== "SELECT" || ++selects === 1) return false;
    socket.write(`* FLAGS (\\Seen \\Answered)\r\n* 2 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 2000] ok\r\n* OK [UIDNEXT 3] ok\r\n${tag} OK [READ-WRITE] SELECT completed\r\n`);
    return true;
  };
  let logins = 0;
  const downForTheSecondRequest: FakeOn = ({ name, tag }, socket) =>
    (name === "AUTHENTICATE" || name === "LOGIN") && ++logins === 2 ? (socket.write(`${tag} NO [UNAVAILABLE] Try again later\r\n`), true) : false;
  const sentFolder = [{ path: "INBOX.Sent" }];
  type Want = { saved: boolean; copies: number; marked: boolean; to?: string };
  const variants: [string, FakeMailboxOptions, Want][] = [
    [
      "a folder the server marks \\Sent wins over a name that fits",
      { folders: [{ path: "Sent" }, { path: "Arquivo", flags: "\\Sent" }] },
      { saved: true, copies: 1, marked: true, to: "Arquivo" },
    ],
    ["no Sent folder: no copy, the mark all the same", { folders: [{ path: "INBOX.Drafts", flags: "\\Drafts" }] }, { saved: false, copies: 0, marked: true }],
    ["the server refuses the copy", { folders: sentFolder, on: refusingCopy }, { saved: false, copies: 0, marked: true }],
    ["the server refuses to list its folders", { folders: sentFolder, on: refusingFolderList }, { saved: false, copies: 0, marked: true }],
    ["the connection drops on the copy", { folders: sentFolder, on: dropOn("APPEND") }, { saved: false, copies: 0, marked: false }],
    ["the connection drops after the copy, on the mark (asked for, never taken): the copy still counts", { folders: sentFolder, on: dropOn("UID STORE") }, { saved: true, copies: 1, marked: true }],
    [
      "the Inbox was renumbered since the e-mail was read: the copy is kept, the mark would land on another e-mail",
      { folders: sentFolder, on: renumberedAfterReading },
      { saved: true, copies: 1, marked: false },
    ],
    ["the server can't be logged in to for the second request", { folders: sentFolder, on: downForTheSecondRequest }, { saved: false, copies: 0, marked: false }],
  ];
  for (const [label, options, want] of variants) {
    selects = 0;
    logins = 0;
    const run = await replyAgainstFake(ctx, options);
    assert.ok(run.result.ok, `${label}: ${JSON.stringify(run.result)}`);
    assert.deepEqual([run.result.data.uncertain, run.result.data.savedToSent], [false, want.saved], label);
    assert.equal(run.handedOver.length, 1, `${label}: sent exactly once`);
    assert.equal(run.record.appended.length, want.copies, `${label}: copies`);
    if (want.to) assert.equal(run.record.appended[0]?.destination, want.to, label);
    assert.equal(marksAnswered(run.record.lines), want.marked, `${label}: the mark`);
  }
  // A login the server refuses for good in that second request pauses the account, as anywhere (the credentials changed), and the reply is still ok.
  try {
    let revokedLogins = 0;
    const revoked: FakeOn = ({ name, tag }, socket) =>
      (name === "AUTHENTICATE" || name === "LOGIN") && ++revokedLogins === 2
        ? (socket.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`), true)
        : false;
    const run = await replyAgainstFake(ctx, { folders: sentFolder, on: revoked });
    assert.ok(run.result.ok && run.result.data.savedToSent === false && run.handedOver.length === 1, JSON.stringify(run.result));
    assert.equal((await accountRow(ctx))?.status, "NEEDS_RECONNECT");
  } finally {
    await updateAccount(ctx, { status: "ACTIVE", lastError: null });
  }
});

check("the request after the hand-over has limits of its own: a mailbox that stalls it costs the reply its copy, not a minute, and nothing is sent twice", async (ctx) => {
  const sentFolder = [{ path: "INBOX.Sent" }];
  const marksAnswered = (lines: string[]) => lines.some((line) => /\bUID STORE 1 \+FLAGS \(\\Answered\)$/.test(line));
  // The values in production: any request is allowed 60 s; the one after a reply, 10 s to open and 10 s of work after the login.
  assert.deepEqual([imapRequest.budgetMs, imapRequest.postSendOpenMs, imapRequest.postSendBudgetMs], [60_000, 10_000, 10_000]);

  // The control: asked for nothing special, the read request is opened with the usual time and the one after the hand-over with the short one.
  const normal = await replyAgainstFake(ctx, { folders: sentFolder });
  assert.ok(normal.result.ok && normal.result.data.savedToSent, JSON.stringify(normal.result));
  assert.deepEqual(normal.openedWith, [undefined, 10_000]);
  assert.equal(normal.logged, "");

  // The mailbox answers the reading and then goes quiet on the folders, or on the copy itself. The general budget stays at its
  // 60 s; only the limit of the request after the hand-over is lowered, and that is what ends it. The reply left, once.
  const stallFolderList: FakeOn = ({ name, line }) => name === "LIST" && line.endsWith('"*"');
  const stallCopy: FakeOn = ({ name }) => name === "APPEND";
  for (const [label, on] of [
    ["quiet on the folder list", stallFolderList],
    ["quiet on the copy", stallCopy],
  ] as const) {
    const startedAt = Date.now();
    const run = await replyAgainstFake(ctx, { folders: sentFolder, on }, undefined, "1000.1", { postSendBudgetMs: 400 });
    const took = Date.now() - startedAt;
    assert.ok(run.result.ok, `${label}: ${JSON.stringify(run.result)}`);
    assert.deepEqual([run.result.data.uncertain, run.result.data.savedToSent], [false, false], label);
    assert.ok(took < 8_000, `${label}: ${took} ms; only the limit of its own ends a stall this soon`);
    assert.ok(run.logged.includes("IMAP request cut: it took more than 0.4 s"), `${label}: ${run.logged}`);
    assert.equal(run.handedOver.length, 1, `${label}: handed over once`);
    assert.equal(run.record.connections, 2, `${label}: the read and the cut request, no third`);
    assert.equal(run.record.appended.length, 0, `${label}: no copy`);
    assert.equal(marksAnswered(run.record.lines), false, `${label}: cut before the mark`);
  }

  // The same short limit does not touch the request that reads: it takes longer than that to answer here and is not cut.
  const slowRead: FakeOn = ({ name, tag, set, rows }, socket) => {
    if (name !== "UID FETCH") return false;
    setTimeout(() => {
      if (!socket.destroyed) socket.write(`${rows(set)}${tag} OK done\r\n`);
    }, 1_500);
    return true;
  };
  const slow = await replyAgainstFake(ctx, { folders: sentFolder, on: slowRead }, undefined, "1000.1", { postSendBudgetMs: 1_000 });
  assert.ok(slow.result.ok && slow.result.data.savedToSent, JSON.stringify(slow.result));
  assert.equal(slow.handedOver.length, 1);
  assert.ok(marksAnswered(slow.record.lines), "the request after the hand-over, quick, did its work");
  assert.equal(slow.logged, "", "the slow reading was not cut");

  // Its opening has a limit of its own too: the second login is never answered, and the reply is back at that limit, not at 30 s.
  let logins = 0;
  const stallSecondLogin: FakeOn = ({ name }) => (name === "AUTHENTICATE" || name === "LOGIN") && ++logins === 2;
  const startedAt = Date.now();
  const stalledOpen = await replyAgainstFake(ctx, { folders: sentFolder, on: stallSecondLogin }, undefined, "1000.1", { postSendOpenMs: 400 });
  const took = Date.now() - startedAt;
  assert.deepEqual(stalledOpen.openedWith, [undefined, 400], "only the request after the hand-over asked for a shorter opening");
  assert.ok(stalledOpen.result.ok, JSON.stringify(stalledOpen.result));
  assert.deepEqual([stalledOpen.result.data.uncertain, stalledOpen.result.data.savedToSent], [false, false]);
  assert.ok(took < 8_000, `${took} ms`);
  assert.ok(
    stalledOpen.logged.includes("IMAP inbox connection failed connection_failed ETIMEDOUT: The connection did not finish in 0.4 s"),
    stalledOpen.logged,
  );
  assert.equal(stalledOpen.handedOver.length, 1, "handed over once");
  assert.equal(stalledOpen.record.appended.length, 0);
  assert.equal(marksAnswered(stalledOpen.record.lines), false);
});

check("the copy belongs to the mailbox the reply left from: another address connected meanwhile gets no copy and no mark", async (ctx) => {
  const original = await smtpAccountRow(ctx);
  const { id: replacedId, ...data } = original;
  void replacedId;
  let created: string | null = null;
  try {
    const run = await replyAgainstFake(ctx, { folders: [{ path: "INBOX.Sent" }] }, async () => {
      // While the e-mail is on its way the company connects another SMTP address: the old row goes, a new one (another id) comes.
      await ctx.prisma.emailSenderAccount.deleteMany({ where: { id: original.id } });
      created = (await ctx.prisma.emailSenderAccount.create({ data: { ...data, email: `outro-${ctx.stamp}@exemplo.com.br` } })).id;
      return HAND_OVER_OK;
    });
    assert.ok(run.result.ok, JSON.stringify(run.result));
    assert.deepEqual(
      [run.result.data.accountId, run.result.data.savedToSent],
      [original.id, false],
    );
    assert.equal(run.handedOver.length, 1);
    assert.equal(run.record.appended.length, 0, "no copy in the other address's mailbox");
    assert.ok(!run.record.lines.some((line) => /\bSTORE\b/.test(line)), "no mark");
  } finally {
    if (created) await ctx.prisma.emailSenderAccount.deleteMany({ where: { id: created } });
    if (!(await ctx.prisma.emailSenderAccount.findFirst({ where: { id: original.id } }))) {
      await ctx.prisma.emailSenderAccount.create({ data: { ...data, id: original.id } });
    }
  }
});

check("nothing is sent for another company, an account that can't be used or an id that names no e-mail", async (ctx) => {
  const other = await ctx.prisma.organization.create({
    data: { name: `IMAP-E2E-${ctx.stamp}-C`, slug: `imap-e2e-${ctx.stamp}-c` },
  });
  cleanups.push(async (c) => {
    await c.prisma.emailSenderAccount.deleteMany({ where: { organizationId: other.id } });
    await c.prisma.organization.deleteMany({ where: { id: other.id } });
  });
  await withHandOver(
    () => HAND_OVER_OK,
    async (handedOver) => {
      // Another company has no account of its own to answer from.
      assert.equal(reason(await replyToImapMessage(other.id, box.m1, REPLY_TEXT)), "no_account");
      // The account is not in a state to read an inbox.
      const accounts: [string, { credentials?: string; status?: "ACTIVE" | "NEEDS_RECONNECT" }, string][] = [
        ["no IMAP half", { credentials: etherealCredentials(ctx, null) }, "no_account"],
        ["NEEDS_RECONNECT", { credentials: etherealCredentials(ctx, etherealImap(ctx)), status: "NEEDS_RECONNECT" }, "reconnect"],
        ["credentials that don't open", { credentials: "not-a-sealed-text", status: "ACTIVE" }, "reconnect"],
      ];
      try {
        for (const [label, data, expected] of accounts) {
          await updateAccount(ctx, data);
          assert.equal(reason(await replyToImapMessage(ctx.orgId, box.m1, REPLY_TEXT)), expected, label);
        }
      } finally {
        await updateAccount(ctx, { credentials: etherealCredentials(ctx, etherealImap(ctx)), status: "ACTIVE" });
      }
      // Ids the URL could have been tampered into are refused before any connection.
      for (const id of ["", "abc", "1.0", "1000.0", "01000.1", "1000.1 ", "1000.1.1", "4294967296.1", "-1.1"]) {
        assert.equal(reason(await replyToImapMessage(ctx.orgId, id, REPLY_TEXT)), "not_found", JSON.stringify(id));
      }
      assert.equal(handedOver.length, 0, "nothing was handed over");
    },
  );
  // An id from another numbering of the mailbox, or an e-mail that is not there: the request reads, finds nothing to answer, sends and marks nothing.
  for (const [label, id] of [["another numbering", "999.1"], ["an e-mail that isn't there", "1000.9"]]) {
    const run = await replyAgainstFake(ctx, { folders: [{ path: "INBOX.Sent" }] }, undefined, id);
    assert.equal(reason(run.result), "not_found", label);
    assert.equal(run.handedOver.length, 0, label);
    assert.equal(run.record.connections, 1, label);
    assert.equal(run.record.appended.length, 0, label);
  }
});

check("a sender's giant References chain is cut: the reply repeats the newest ids of what was read, and the e-mail it answers last", async (ctx) => {
  // 4 MB of ids (the server can send up to 16 MiB in one piece); only the first 64 KiB are read, and the reply carries at most 25 of them.
  const ids = Array.from({ length: 200_000 }, (_, i) => `<r${i}@exemplo.com.br>`);
  const headerBlock = () => `Message-ID: <m1@exemplo.com.br>\r\nReferences: ${ids.join(" ")}\r\n\r\n`;
  const startedAt = Date.now();
  const run = await replyAgainstFake(ctx, { folders: [{ path: "INBOX.Sent" }], headerBlock });
  assert.ok(run.result.ok, JSON.stringify(run.result));
  assert.ok(Date.now() - startedAt < 10_000, `${Date.now() - startedAt} ms`);
  const mail = await PostalMime.parse(run.handedOver[0].mime);
  const chain = oneLine(mail.references).split(" ");
  assert.equal(chain.length, 25);
  assert.equal(chain[24], "<m1@exemplo.com.br>");
  assert.equal(mail.inReplyTo, "<m1@exemplo.com.br>");
  assert.ok(run.handedOver[0].mime.length < 4_096, `${run.handedOver[0].mime.length} bytes`);
});

// ── Run ──────────────────────────────────────────────────────────────────────

/** The check creates and deletes an organization: only against the local database, never a shared one. */
function assertLocalDatabase(): void {
  const host = new URL(env.DATABASE_URL).hostname; // never the whole URL: it holds the password
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error(
      `check:imap creates and deletes a test organization: it only runs against the local Postgres (DATABASE_URL points at ${host}).`,
    );
  }
}

/** Ethereal's API is on a network that may be slow or flaky: up to 3 tries, each cut off after 20 s. */
async function etherealAccount(): Promise<EtherealAccount> {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("no answer in 20 s")), 20_000);
      });
      const { user, pass, smtp, imap } = await Promise.race([createTestAccount(), timeout]);
      return { user, pass, smtp, imap };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      console.log(`  Ethereal account: attempt ${attempt} of 3 failed (${last})`);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Could not create the Ethereal test account after 3 attempts (${last}).`);
}

/** The sender accounts carry organizationId with no foreign key to the organization: removed first, by hand. */
async function baseCleanup(ctx: ImapCtx): Promise<void> {
  await ctx.prisma.emailSenderAccount.deleteMany({ where: { organizationId: ctx.orgId } });
  await ctx.prisma.organization.deleteMany({ where: { id: ctx.orgId } });
}

async function main(): Promise<number> {
  assertLocalDatabase();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  const stamp = Date.now();
  let ctx: ImapCtx | null = null;
  let passed = 0;
  try {
    const ethereal = await etherealAccount();
    etherealLogin = { user: ethereal.user, pass: ethereal.pass };
    const org = await prisma.organization.create({ data: { name: `IMAP-E2E-${stamp}`, slug: `imap-e2e-${stamp}` } });
    ctx = { stamp, ethereal, orgId: org.id, prisma };
    for (const c of checks) {
      const startedAt = Date.now();
      await c.run(ctx);
      passed++;
      // Every request to a real server is a new connection (about a dozen round trips): the slow checks say so.
      const took = Date.now() - startedAt;
      console.log(`  ✓ ${c.name}${took >= 1_000 ? ` (${(took / 1_000).toFixed(1)} s)` : ""}`);
    }
    return passed;
  } finally {
    if (ctx) {
      for (const cleanup of [...cleanups].reverse()) {
        await cleanup(ctx).catch((e) => console.error("cleanup failed:", e instanceof Error ? e.message : "unknown error"));
      }
      await baseCleanup(ctx).catch((e) => console.error("base cleanup failed:", e instanceof Error ? e.message : "unknown error"));
    }
    await prisma.$disconnect();
    // The app's own client (imap/inbox.ts reads the account through tenantDb) has a pool of its own.
    await appPrisma.$disconnect();
  }
}

main()
  .then((passed) => console.log(`\ncheck:imap — ${passed} checks passed`))
  .catch((e) => {
    // An assertion prints the values it compared and a library error may echo the login: nothing reaches the terminal unredacted.
    const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    const safe = etherealLogin
      ? redactSmtpSecrets(detail, { username: etherealLogin.user, password: etherealLogin.pass })
      : detail;
    console.error("\nIMAP CHECK FAILED:", safe.slice(0, 4000));
    process.exit(1);
  });

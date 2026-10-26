/**
 * Integration check of the inbox read over IMAP from an SMTP account (spec
 * 2026-10-23): what check:email can't reach, the server code that talks to a real
 * mail server. The mailbox is a throwaway one from Ethereal (https://ethereal.email,
 * a real SMTP and IMAP server that delivers nothing outside itself), the data is in
 * the local Postgres, and the server modules (`server-only`, the `@/` alias, env.ts)
 * load through scripts/tsconfig.server.json.
 *
 * Creates its own data: the Ethereal mailbox and one organization (`IMAP-E2E-<stamp>`),
 * and ALWAYS deletes the organization and its sender accounts, even on failure
 * (Ethereal offers no way to delete a mailbox: it expires by itself). Refuses to run
 * against a database that isn't local. The Ethereal password never reaches the
 * terminal: whatever fails is printed with it redacted.
 *
 * Run: npm run check:imap   (needs the internet, the Docker Postgres and a valid .env)
 * Exits non-zero on the first failure.
 *
 * Later tasks add their checks with check(...) above main(), and the fixtures they
 * leave behind to `cleanups`.
 */
import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { createTestAccount } from "nodemailer";
import { env } from "@/lib/env";
import { closeImap, imapFlowOptions, openImap, verifyImapSettings } from "@/lib/email-broadcast/imap/connect";
import { imapConnectError, type ImapPort, type ImapSettings } from "@/lib/email-broadcast/imap/core";
import { redactSmtpSecrets } from "@/lib/email-broadcast/smtp/redact";
import type { SmtpSettings } from "@/lib/email-broadcast/smtp/core";
import { openSmtpSettings, sealSmtpSettings } from "@/lib/email-broadcast/smtp/credentials";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";

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

/** A plain-text IMAP server on loopback: counts its connections and keeps every byte its clients send. */
type FakeImap = { port: number; connections: () => number; received: () => string; close: () => Promise<void> };

async function listenFakeImap(capabilities: string): Promise<FakeImap> {
  let connections = 0;
  let received = "";
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let pending = "";
    socket.write(`* OK [CAPABILITY ${capabilities}] fake IMAP ready\r\n`);
    socket.on("data", (chunk) => {
      const text = chunk.toString("latin1");
      received += text;
      pending += text;
      for (let end = pending.indexOf("\r\n"); end >= 0; end = pending.indexOf("\r\n")) {
        const [tag, command = ""] = pending.slice(0, end).split(" ");
        pending = pending.slice(end + 2);
        const word = command.toUpperCase();
        if (word === "CAPABILITY") socket.write(`* CAPABILITY ${capabilities}\r\n${tag} OK done\r\n`);
        else if (word === "ID") socket.write(`* ID NIL\r\n${tag} OK done\r\n`);
        else socket.write(`${tag} NO not here\r\n`);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: (server.address() as net.AddressInfo).port,
    connections: () => connections,
    received: () => received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
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

check("imapFlowOptions: ssl, mandatory STARTTLS, the typed name as SNI, the certificate always checked", () => {
  const auth = { user: "u", pass: "p" };
  const common = {
    auth,
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
  const name = "imap.empresa.com.br";
  const tls = { servername: name, rejectUnauthorized: true };
  // The address is the one the guard approved; the typed name only travels as SNI and as the name the certificate must carry.
  assert.deepEqual(imapFlowOptions({ host: name, port: 993, security: "ssl" }, "198.51.100.7", auth), {
    ...common,
    host: "198.51.100.7",
    port: 993,
    secure: true,
    doSTARTTLS: false,
    servername: name,
    tls,
  });
  assert.deepEqual(imapFlowOptions({ host: name, port: 143, security: "starttls" }, "198.51.100.7", auth), {
    ...common,
    host: "198.51.100.7",
    port: 143,
    secure: false,
    doSTARTTLS: true,
    servername: name,
    tls,
  });
  // A typed IP is its own name: no SNI, and the certificate is then checked against the IP.
  assert.deepEqual(imapFlowOptions({ host: "198.51.100.7", port: 993, security: "ssl" }, "198.51.100.7", auth), {
    ...common,
    host: "198.51.100.7",
    port: 993,
    secure: true,
    doSTARTTLS: false,
    servername: undefined,
    tls: { servername: undefined, rejectUnauthorized: true },
  });
  // Never a name: imapflow would resolve it itself and connect around the guard.
  assert.throws(() => imapFlowOptions({ host: name, port: 993, security: "ssl" }, name, auth));
});

check("143 with STARTTLS: a server that doesn't offer STARTTLS gets no login at all, never in clear text", async () => {
  const fake = await listenFakeImap("IMAP4rev1 AUTH=PLAIN SASL-IR ID");
  const secret = `senha-${Date.now()}`;
  try {
    const settings: ImapSettings = { host: "imap.empresa.com.br", port: 143, security: "starttls" };
    // The options openImap connects with, pointed at the loopback server (openImap itself never dials one).
    const options = { ...imapFlowOptions(settings, "127.0.0.1", { user: "u", pass: secret }), port: fake.port };
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

check("verifyImapSettings logs in to a real server over TLS", async (ctx) => {
  assert.deepEqual(await verifyImapSettings(etherealImap(ctx), etherealAuth(ctx)), { ok: true });
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
      await c.run(ctx);
      passed++;
      console.log(`  ✓ ${c.name}`);
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

"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { audit } from "@/lib/audit";
import type { ImapConnectError } from "@/lib/email-broadcast/imap/core";
import { verifyImapSettings } from "@/lib/email-broadcast/imap/connect";
import { storeSmtpAccount } from "@/lib/email-broadcast/smtp/accounts";
import { verifySmtpSettings } from "@/lib/email-broadcast/smtp/connect";
import { withSavedSmtpPassword, type SmtpConnectError, type SmtpSettings } from "@/lib/email-broadcast/smtp/core";
import { openSmtpSettings } from "@/lib/email-broadcast/smtp/credentials";
import { smtpAccountSchema, type SmtpAccountInput } from "@/lib/validations/email-smtp-account";

export type SenderAccountActionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "forbidden" | "not_found" | "unknown" };

export type SmtpSaveResult =
  | { ok: true; replaced: boolean }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "forbidden"
        | "invalid"
        | "invalid_imap_host"
        | "password_required"
        | "busy"
        | "too_many_tests"
        | SmtpConnectError
        // The sending server answered; the inbox's (IMAP) did not.
        | `imap_${ImapConnectError}`
        | "unknown";
      technical?: string;
    };

/**
 * Companies whose connection test is running right now (in this process). A test
 * opens a connection from the site's address to a server the person typed and
 * can take up to 30 s, so it runs one at a time per company: a second call
 * answers "busy" without connecting, and the form can't be used to try
 * password after password on someone else's server.
 */
const testingNow = new Set<string>();

/** Connection tests one company may start in TEST_WINDOW_MS (in this process). */
const TESTS_PER_WINDOW = 10;
const TEST_WINDOW_MS = 10 * 60_000;
/**
 * When each company's recent connection tests started (in this process, ms).
 * One at a time is not enough on its own: a test answers in a second or two,
 * so the form would still try password after password against a server.
 */
const recentTests = new Map<string, number[]>();

/**
 * Takes one of the company's tests: false when it already started
 * TESTS_PER_WINDOW in the last 10 minutes. A sliding window: each test frees
 * its place 10 minutes after it started.
 */
function takeTestSlot(organizationId: string): boolean {
  const now = Date.now();
  const recent = (recentTests.get(organizationId) ?? []).filter((startedAt) => now - startedAt < TEST_WINDOW_MS);
  const allowed = recent.length < TESTS_PER_WINDOW;
  if (allowed) recent.push(now);
  recentTests.set(organizationId, recent);
  return allowed;
}

/**
 * Disconnect the org's mailbox for a provider (spec §5.3). The row goes away, so
 * sends tied to it lose senderAccountId (FK SET NULL) and the dispatcher
 * pauses them at their next e-mail with "no_sender_account".
 */
export async function disconnectSenderAccount(
  provider: "MICROSOFT" | "GOOGLE" | "SMTP",
): Promise<SenderAccountActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) return { ok: false, error: "forbidden" };
  // Server actions are public endpoints: the TS union is not enforced at runtime.
  if (provider !== "MICROSOFT" && provider !== "GOOGLE" && provider !== "SMTP") return { ok: false, error: "not_found" };
  try {
    const db = tenantDb(ctx.organizationId);
    const row = await db.emailSenderAccount.findFirst({
      where: { provider },
      select: { id: true, email: true, credentials: true },
    });
    if (!row) return { ok: false, error: "not_found" };
    await db.emailSenderAccount.deleteMany({ where: { id: row.id } });
    // The SMTP server's name is audited with the address, never the password (spec 2026-10-21 §4.1).
    const host = provider === "SMTP" ? openSmtpSettings(row.credentials)?.host : undefined;
    await audit(ctx, {
      action: "email_sender.disconnected",
      entity: "EmailSenderAccount",
      entityId: row.id,
      meta: { email: row.email, provider, ...(host ? { host } : {}) },
    });
    revalidatePath("/app/email");
    return { ok: true };
  } catch (error) {
    console.error("Failed to disconnect the sender account", provider, error);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Test the SMTP account's connection and save it (spec 2026-10-21, 4.1). The
 * test runs on every save, a kept password included, and nothing is stored
 * when it fails. With the inbox on (spec 2026-10-23) the IMAP server is tested
 * too, with the same user and password, once the sending server has accepted
 * them. An empty password keeps the saved one only for the server, port,
 * security and user it was typed for, and the IMAP server, port and security
 * when there is an inbox (canKeepSmtpPassword), so a stored password is never
 * sent anywhere else. The inbox the form sends is what is saved: an edit that
 * leaves it alone keeps it, and switching it off removes it. One test at a time
 * per company (see `testingNow`), and at most 10 tests per company in 10
 * minutes (see `takeTestSlot`); both are kept in this process's memory. The
 * password never leaves the server: not in the result (`technical` comes
 * redacted), the log or the audit.
 */
export async function saveSmtpAccount(input: SmtpAccountInput): Promise<SmtpSaveResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) return { ok: false, error: "forbidden" };
  // Server actions are public endpoints: the TS type of `input` is not enforced at runtime.
  const parsed = smtpAccountSchema.safeParse(input);
  if (!parsed.success) {
    // The inbox server has a message of its own; the form tells every other problem at its field before it gets here.
    const inboxServer = parsed.error.issues.some((issue) => issue.message === "invalid_imap_host");
    return { ok: false, error: inboxServer ? "invalid_imap_host" : "invalid" };
  }
  const { email, displayName, hourlyLimit, dailyLimit, password, ...destination } = parsed.data;
  // Checked and taken in the same turn (no await between), so two calls can't both pass.
  if (testingNow.has(ctx.organizationId)) return { ok: false, error: "busy" };
  testingNow.add(ctx.organizationId);
  try {
    const settings = password ? { ...destination, password } : await withSavedPassword(ctx.organizationId, destination);
    if (!settings) return { ok: false, error: "password_required" };
    // Only a call that is about to connect counts. No race: `testingNow` lets one call per company through at a time.
    if (!takeTestSlot(ctx.organizationId)) return { ok: false, error: "too_many_tests" };
    const test = await verifySmtpSettings(settings);
    if (!test.ok) return { ok: false, error: test.error, technical: test.technical.slice(0, 300) };
    // The inbox is read with the sending login, so its server is tried with it too before anything is saved.
    if (settings.imap) {
      const inbox = await verifyImapSettings(settings.imap, { user: settings.username, pass: settings.password });
      if (!inbox.ok) return { ok: false, error: `imap_${inbox.error}`, technical: inbox.technical.slice(0, 300) };
    }
    const saved = await storeSmtpAccount(ctx.organizationId, ctx.userId, {
      email,
      displayName,
      settings,
      hourlyLimit,
      dailyLimit,
    });
    await audit(ctx, {
      action: saved.replaced ? "email_sender.replaced" : "email_sender.connected",
      entity: "EmailSenderAccount",
      entityId: saved.id,
      meta: { provider: "SMTP", email, host: settings.host },
    });
    revalidatePath("/app/email");
    revalidatePath("/app/email/new");
    return { ok: true, replaced: saved.replaced };
  } catch (error) {
    // The message only: nothing thrown here carries the password (the test's own failures come back as results).
    console.error("[email-smtp] save failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, error: "unknown" };
  } finally {
    testingNow.delete(ctx.organizationId);
  }
}

/**
 * The settings typed now with the saved password, for an edit that left the
 * field empty: only when the connected account's server, port, security and
 * user are the ones typed now, and so are the IMAP server, port and security
 * when there is an inbox (withSavedSmtpPassword). The inbox typed now comes along
 * as it is. Null when the password must be typed: no account, one that needs
 * reconnecting, credentials that no longer open, or a destination the saved
 * password was not typed for.
 */
async function withSavedPassword(
  organizationId: string,
  next: Omit<SmtpSettings, "password">,
): Promise<SmtpSettings | null> {
  const row = await tenantDb(organizationId).emailSenderAccount.findFirst({
    where: { provider: "SMTP" },
    select: { status: true, credentials: true },
  });
  const saved = row ? openSmtpSettings(row.credentials) : null;
  return withSavedSmtpPassword(row && saved ? { ...saved, status: row.status } : null, next);
}

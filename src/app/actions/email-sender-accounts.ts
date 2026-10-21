"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { audit } from "@/lib/audit";
import { storeSmtpAccount } from "@/lib/email-broadcast/smtp/accounts";
import { verifySmtpSettings } from "@/lib/email-broadcast/smtp/connect";
import { canKeepSmtpPassword, type SmtpConnectError, type SmtpSettings } from "@/lib/email-broadcast/smtp/core";
import { openSmtpSettings } from "@/lib/email-broadcast/smtp/credentials";
import { smtpAccountSchema, type SmtpAccountInput } from "@/lib/validations/email-smtp-account";

export type SenderAccountActionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "forbidden" | "not_found" | "unknown" };

export type SmtpSaveResult =
  | { ok: true; replaced: boolean }
  | {
      ok: false;
      error: "unauthorized" | "forbidden" | "invalid" | "password_required" | SmtpConnectError | "unknown";
      technical?: string;
    };

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
 * when it fails. An empty password keeps the saved one only for the server,
 * port, security and user it was typed for (canKeepSmtpPassword), so a stored
 * password is never sent anywhere else. The password never leaves the server:
 * not in the result (`technical` comes redacted), the log or the audit.
 */
export async function saveSmtpAccount(input: SmtpAccountInput): Promise<SmtpSaveResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) return { ok: false, error: "forbidden" };
  // Server actions are public endpoints: the TS type of `input` is not enforced at runtime.
  const parsed = smtpAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { email, displayName, hourlyLimit, dailyLimit, password, ...destination } = parsed.data;
  try {
    const settings = password ? { ...destination, password } : await withSavedPassword(ctx.organizationId, destination);
    if (!settings) return { ok: false, error: "password_required" };
    const test = await verifySmtpSettings(settings);
    if (!test.ok) return { ok: false, error: test.error, technical: test.technical.slice(0, 300) };
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
  }
}

/**
 * The settings typed now with the saved password, for an edit that left the
 * field empty: only when the connected account's server, port, security and
 * user are the ones typed now. Null when the password must be typed: no
 * account, one that needs reconnecting, credentials that no longer open, or a
 * destination the saved password was not typed for.
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
  if (!row || !saved || !canKeepSmtpPassword({ ...saved, status: row.status }, next)) return null;
  return { ...next, password: saved.password };
}

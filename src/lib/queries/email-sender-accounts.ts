import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { remainingToday, sentLast24hWhere } from "@/lib/email-broadcast/mailbox/core";
import { googleDailyLimit } from "@/lib/email-broadcast/google/core";
import { microsoftDailyLimit } from "@/lib/email-broadcast/microsoft/core";
import { defaultSmtpSecurity, smtpDailyLimit, smtpHourlyLimit } from "@/lib/email-broadcast/smtp/core";
import { openSmtpSettings } from "@/lib/email-broadcast/smtp/credentials";
import type { SenderAccountView, SmtpAccountFormView } from "@/lib/email-broadcast/types";

/**
 * The org's connected mailbox for a provider, with today's estimate, or null.
 * The SMTP account carries the company's own limits, its server name and, when
 * it reads its inbox, the IMAP server's; its credentials are opened only for
 * those names, and the password stays here.
 * Credentials that no longer open can't send anything, so that account reads
 * NEEDS_RECONNECT (the same as getSmtpAccountForm, so the panel and the form agree).
 */
export async function getSenderAccountView(
  organizationId: string,
  provider: "MICROSOFT" | "GOOGLE" | "SMTP",
): Promise<SenderAccountView | null> {
  const db = tenantDb(organizationId);
  const row = await db.emailSenderAccount.findFirst({
    where: { provider },
    select: {
      id: true,
      email: true,
      displayName: true,
      accountKind: true,
      status: true,
      credentials: true,
      hourlyLimit: true,
      dailyLimit: true,
    },
  });
  if (!row) return null;
  const sentLast24h = await db.emailBroadcastRecipient.count({ where: sentLast24hWhere(row.id, new Date()) });
  if (provider === "SMTP") {
    const dailyLimit = smtpDailyLimit(row);
    const settings = openSmtpSettings(row.credentials);
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      accountKind: "smtp",
      status: settings ? row.status : "NEEDS_RECONNECT",
      dailyLimit,
      hourlyLimit: smtpHourlyLimit(row),
      host: settings?.host ?? null,
      imapHost: settings?.imap?.host ?? null,
      sentLast24h,
      remaining: remainingToday(dailyLimit, sentLast24h),
    };
  }
  const dailyLimit = provider === "GOOGLE" ? googleDailyLimit(row.accountKind) : microsoftDailyLimit(row.accountKind);
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    accountKind: row.accountKind === "personal" ? "personal" : "work",
    status: row.status,
    dailyLimit,
    hourlyLimit: null,
    host: null,
    imapHost: null,
    sentLast24h,
    remaining: remainingToday(dailyLimit, sentLast24h),
  };
}

/**
 * The org's SMTP account as its form is filled (edit or reconnect), or null
 * when there is none. The credentials are opened here and only the server,
 * port, security, user and inbox (IMAP) settings leave: never the password.
 * Credentials that no longer open (a changed key, a damaged row) can't send
 * anything, so the account reads as NEEDS_RECONNECT, with the server and the
 * user to be typed again (and the form's defaults for port and security, and
 * no inbox).
 */
export async function getSmtpAccountForm(organizationId: string): Promise<SmtpAccountFormView | null> {
  const row = await tenantDb(organizationId).emailSenderAccount.findFirst({
    where: { provider: "SMTP" },
    select: { email: true, displayName: true, status: true, credentials: true, hourlyLimit: true, dailyLimit: true },
  });
  if (!row) return null;
  const settings = openSmtpSettings(row.credentials);
  const port = settings?.port ?? 587;
  return {
    email: row.email,
    displayName: row.displayName,
    host: settings?.host ?? "",
    port,
    security: settings?.security ?? defaultSmtpSecurity(port),
    username: settings?.username ?? "",
    imap: settings?.imap ?? null,
    hourlyLimit: smtpHourlyLimit(row),
    dailyLimit: smtpDailyLimit(row),
    status: settings ? row.status : "NEEDS_RECONNECT",
  };
}

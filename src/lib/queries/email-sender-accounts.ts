import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { remainingToday, sentLast24hWhere } from "@/lib/email-broadcast/mailbox/core";
import { googleDailyLimit } from "@/lib/email-broadcast/google/core";
import { microsoftDailyLimit } from "@/lib/email-broadcast/microsoft/core";
import { smtpDailyLimit, smtpHourlyLimit } from "@/lib/email-broadcast/smtp/core";
import { openSmtpSettings } from "@/lib/email-broadcast/smtp/credentials";
import type { SenderAccountView } from "@/lib/email-broadcast/types";

/**
 * The org's connected mailbox for a provider, with today's estimate, or null.
 * The SMTP account carries the company's own limits and its server name; its
 * credentials are opened only for that name, and the password stays here.
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
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      accountKind: "smtp",
      status: row.status,
      dailyLimit,
      hourlyLimit: smtpHourlyLimit(row),
      host: openSmtpSettings(row.credentials)?.host ?? null,
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
    sentLast24h,
    remaining: remainingToday(dailyLimit, sentLast24h),
  };
}

import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { remainingToday, sentLast24hWhere } from "@/lib/email-broadcast/mailbox/core";
import { microsoftDailyLimit } from "@/lib/email-broadcast/microsoft/core";
import type { SenderAccountView } from "@/lib/email-broadcast/types";

/** The org's connected Microsoft mailbox with today's estimate, or null. */
export async function getSenderAccountView(organizationId: string): Promise<SenderAccountView | null> {
  const db = tenantDb(organizationId);
  const row = await db.emailSenderAccount.findFirst({
    select: { id: true, email: true, displayName: true, accountKind: true, status: true },
  });
  if (!row) return null;
  const sentLast24h = await db.emailBroadcastRecipient.count({ where: sentLast24hWhere(row.id, new Date()) });
  const dailyLimit = microsoftDailyLimit(row.accountKind);
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    accountKind: row.accountKind === "personal" ? "personal" : "work",
    status: row.status,
    dailyLimit,
    sentLast24h,
    remaining: remainingToday(dailyLimit, sentLast24h),
  };
}

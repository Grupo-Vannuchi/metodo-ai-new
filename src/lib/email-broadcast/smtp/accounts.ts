import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import type { SmtpSettings } from "./core";
import { sealSmtpSettings } from "./credentials";

/**
 * Save the SMTP account a company just tested (spec 2026-10-21, 4.1), by the
 * Google account's rule: the same address again keeps the row (same id: its
 * sends and 24 h count carry on); a different address replaces it with a new
 * row, so sends tied to the old one lose their senderAccountId (FK SET NULL)
 * and pause until resumed. One SMTP account per company, next to the Microsoft
 * and Google ones. The settings are stored sealed, with the company's own
 * limits; the caller has already tested them (verifySmtpSettings).
 */
export async function storeSmtpAccount(
  organizationId: string,
  userId: string,
  input: { email: string; displayName: string | null; settings: SmtpSettings; hourlyLimit: number; dailyLimit: number },
): Promise<{ id: string; replaced: boolean }> {
  const email = input.email.trim().toLowerCase();
  const data = {
    email,
    displayName: input.displayName,
    accountKind: "smtp",
    credentials: sealSmtpSettings(input.settings),
    hourlyLimit: input.hourlyLimit,
    dailyLimit: input.dailyLimit,
    status: "ACTIVE" as const,
    lastError: null,
    connectedById: userId,
  };
  return tenantDb(organizationId).$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`email_sender:${organizationId}:SMTP`}))`;
      const current = await tx.emailSenderAccount.findFirst({
        where: { organizationId, provider: "SMTP" },
        select: { id: true, email: true },
      });
      if (current && current.email === email) {
        await tx.emailSenderAccount.updateMany({ where: { id: current.id, organizationId }, data });
        return { id: current.id, replaced: false };
      }
      if (current) await tx.emailSenderAccount.deleteMany({ where: { id: current.id, organizationId } });
      const created = await tx.emailSenderAccount.create({
        data: { organizationId, provider: "SMTP", ...data },
        select: { id: true },
      });
      return { id: created.id, replaced: Boolean(current) };
    },
    { timeout: 20_000 },
  );
}

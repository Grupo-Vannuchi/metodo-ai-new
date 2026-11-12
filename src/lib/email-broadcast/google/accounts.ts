import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { sealSenderCredentials, type SenderCredentials } from "../mailbox/token";
import type { GoogleAccountKind } from "./core";

/**
 * Save the Google account a company just connected. The same address again
 * keeps the row (same id: its sends and 24 h count carry on); a different
 * address replaces it with a new row, so sends tied to the old one lose their
 * senderAccountId (FK SET NULL) and pause until resumed (spec 2026-10-19).
 * One Google account per company; the Microsoft one is a separate row.
 */
export async function saveGoogleAccount(
  organizationId: string,
  userId: string,
  input: { email: string; displayName: string | null; accountKind: GoogleAccountKind; credentials: SenderCredentials },
): Promise<{ id: string; replaced: boolean }> {
  const email = input.email.trim().toLowerCase();
  const data = {
    email,
    displayName: input.displayName,
    accountKind: input.accountKind,
    credentials: sealSenderCredentials(input.credentials),
    status: "ACTIVE" as const,
    lastError: null,
    connectedById: userId,
  };
  return tenantDb(organizationId).$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`email_sender:${organizationId}:GOOGLE`}))`;
      const current = await tx.emailSenderAccount.findFirst({
        where: { organizationId, provider: "GOOGLE" },
        select: { id: true, email: true },
      });
      if (current && current.email === email) {
        await tx.emailSenderAccount.updateMany({ where: { id: current.id, organizationId }, data });
        return { id: current.id, replaced: false };
      }
      if (current) await tx.emailSenderAccount.deleteMany({ where: { id: current.id, organizationId } });
      const created = await tx.emailSenderAccount.create({
        data: { organizationId, provider: "GOOGLE", ...data },
        select: { id: true },
      });
      return { id: created.id, replaced: Boolean(current) };
    },
    { timeout: 20_000 },
  );
}

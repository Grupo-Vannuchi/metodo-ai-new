import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import type { MicrosoftAccountKind } from "./core";
import { sealMicrosoftCredentials, type MicrosoftCredentials } from "./token";

/**
 * Save the mailbox a company just connected. The same mailbox again keeps the
 * row (same id: its sends and 24 h count carry on); a different mailbox
 * replaces it with a new row, so sends tied to the old one lose their
 * senderAccountId (FK SET NULL) and pause until resumed (spec §5.1).
 */
export async function saveMicrosoftAccount(
  organizationId: string,
  userId: string,
  input: { email: string; displayName: string | null; accountKind: MicrosoftAccountKind; credentials: MicrosoftCredentials },
): Promise<{ id: string; replaced: boolean }> {
  const email = input.email.trim().toLowerCase();
  const data = {
    email,
    displayName: input.displayName,
    accountKind: input.accountKind,
    credentials: sealMicrosoftCredentials(input.credentials),
    status: "ACTIVE" as const,
    lastError: null,
    connectedById: userId,
  };
  return tenantDb(organizationId).$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`email_sender:${organizationId}`}))`;
      const current = await tx.emailSenderAccount.findFirst({
        where: { organizationId, provider: "MICROSOFT" },
        select: { id: true, email: true },
      });
      if (current && current.email === email) {
        await tx.emailSenderAccount.updateMany({ where: { id: current.id, organizationId }, data });
        return { id: current.id, replaced: false };
      }
      if (current) await tx.emailSenderAccount.deleteMany({ where: { id: current.id, organizationId } });
      const created = await tx.emailSenderAccount.create({
        data: { organizationId, provider: "MICROSOFT", ...data },
        select: { id: true },
      });
      return { id: created.id, replaced: Boolean(current) };
    },
    { timeout: 20_000 },
  );
}

import "server-only";
import type { tenantDb } from "@/lib/tenant-db";

type Db = ReturnType<typeof tenantDb>;

/**
 * Who may act on an integration connection (org-scoped by `db`). A WhatsApp
 * number is personal: the inbox shows each user only the numbers they
 * connected (lib/queries/inbox.ts), so a MEMBER may only manage their own.
 * OWNER/ADMIN may manage any, e.g. to disconnect a number someone left behind.
 */
export async function canManageConnection(
  db: Db,
  ctx: { role: string; userId: string },
  id: string,
): Promise<boolean> {
  if (ctx.role !== "MEMBER") return true;
  return ownsConnection(db, ctx.userId, id);
}

/**
 * Whether `userId` owns connection `id`. Connecting a number (asking for the QR
 * to scan) is always the owner's own act, for every role: scanning a
 * colleague's QR would put your phone's chats in their inbox.
 */
export async function ownsConnection(db: Db, userId: string, id: string): Promise<boolean> {
  const conn = await db.integrationConnection.findFirst({ where: { id }, select: { ownerId: true } });
  return conn !== null && conn.ownerId === userId;
}

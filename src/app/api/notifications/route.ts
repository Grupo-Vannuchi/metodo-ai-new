import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

export const runtime = "nodejs";

/** Fetch persistent notifications for the user. */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const db = tenantDb(ctx.organizationId);
  const [items, total] = await Promise.all([
    db.notification.findMany({
      where: { userId: ctx.userId, readAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, data: true, link: true, createdAt: true },
    }),
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
  ]);

  return Response.json({ total, items });
}

import { getOrgContext } from "@/lib/tenant";
import {
  findDriveConnection,
  getDriveAccessToken,
  listDriveFiles,
} from "@/lib/integrations/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Browse the connected user's Drive (root or a folder), or search by name. */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return json({ error: "unauthorized" }, 401);

  const conn = await findDriveConnection(ctx.organizationId, ctx.userId);
  if (!conn) return json({ connected: false }, 200);

  const token = await getDriveAccessToken(ctx.organizationId, conn.id);
  if (!token) return json({ connected: true, needsReconnect: true }, 200);

  const url = new URL(req.url);
  const folderId = url.searchParams.get("folderId") || undefined;
  const search = url.searchParams.get("q") || undefined;
  const files = await listDriveFiles(token, { folderId, search });
  return json({ connected: true, files }, 200);
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

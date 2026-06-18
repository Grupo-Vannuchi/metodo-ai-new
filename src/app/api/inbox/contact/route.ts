import { getOrgContext } from "@/lib/tenant";
import { getContactPanel } from "@/lib/queries/inbox";

export const runtime = "nodejs";

/** Contact details for the inbox side panel (fetched when opened). */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const id = new URL(req.url).searchParams.get("contactId");
  if (!id) return Response.json(null);
  return Response.json(await getContactPanel(ctx.organizationId, id));
}

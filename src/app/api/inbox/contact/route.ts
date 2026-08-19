import { getOrgContext } from "@/lib/tenant";
import { getContactPanel } from "@/lib/queries/inbox";
import { hasModule } from "@/config/modules";

export const runtime = "nodejs";

/** Contact details for the inbox side panel (fetched when opened). */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const id = new URL(req.url).searchParams.get("contactId");
  if (!id) return Response.json(null);
  const panel = await getContactPanel(ctx.organizationId, id);
  // Don't leak the CRM funnel into the inbox when the CRM module isn't installed.
  if (panel && !hasModule(ctx.modules, "crm")) panel.opportunities = [];
  return Response.json(panel);
}

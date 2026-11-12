import { getOrgContext } from "@/lib/tenant";
import { getContactRows, getGroupRows } from "@/lib/whatsapp/export";
import { exportResponse, parseFormat, type ExportTable } from "@/lib/export/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = ["Nome", "Número"];

/** Download the WhatsApp contact list, or a group's members, as PDF/Excel/Word. */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "group" ? "group" : "contacts";
  const format = parseFormat(url.searchParams.get("format"));
  const conversationId = url.searchParams.get("conversationId");

  let table: ExportTable;
  if (type === "group") {
    if (!conversationId) return new Response("Missing conversationId", { status: 400 });
    const group = await getGroupRows(ctx.organizationId, conversationId, ctx.userId);
    if (!group) return new Response("Group not found", { status: 404 });
    // WhatsApp only shows the members to someone in the group (and connected):
    // say so instead of handing over an empty file. The menu reads this code.
    if (!group.readable) return Response.json({ error: "group_unreadable" }, { status: 422 });
    table = { title: `Grupo - ${group.title}`, headers: HEADERS, rows: group.rows.map((r) => [r.name, r.number]) };
  } else {
    const rows = await getContactRows(ctx.organizationId, ctx.userId);
    table = { title: "Contatos do WhatsApp", headers: HEADERS, rows: rows.map((r) => [r.name, r.number]) };
  }

  const res = await exportResponse(table, format);
  // Lets the menu say how many rows the file has.
  res.headers.set("X-Export-Rows", String(table.rows.length));
  return res;
}

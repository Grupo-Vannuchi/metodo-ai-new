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
    const group = await getGroupRows(ctx.organizationId, conversationId);
    if (!group) return new Response("Group not found", { status: 404 });
    table = { title: `Grupo - ${group.title}`, headers: HEADERS, rows: group.rows.map((r) => [r.name, r.number]) };
  } else {
    const rows = await getContactRows(ctx.organizationId);
    table = { title: "Contatos do WhatsApp", headers: HEADERS, rows: rows.map((r) => [r.name, r.number]) };
  }

  return exportResponse(table, format);
}

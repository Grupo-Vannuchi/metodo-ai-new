import { getOrgContext } from "@/lib/tenant";
import {
  getContactRows,
  getGroupRows,
  toPdf,
  toXlsx,
  toDoc,
  type ExportFormat,
  type ExportRow,
} from "@/lib/whatsapp/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export"
  );
}

/** Download the WhatsApp contact list, or a group's members, as PDF/XML/Word. */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "group" ? "group" : "contacts";
  const format = (url.searchParams.get("format") ?? "pdf") as ExportFormat;
  const conversationId = url.searchParams.get("conversationId");

  let title = "Contatos do WhatsApp";
  let rows: ExportRow[];

  if (type === "group") {
    if (!conversationId) return new Response("Missing conversationId", { status: 400 });
    const group = await getGroupRows(ctx.organizationId, conversationId);
    if (!group) return new Response("Group not found", { status: 404 });
    title = `Grupo - ${group.title}`;
    rows = group.rows;
  } else {
    rows = await getContactRows(ctx.organizationId);
  }

  const filename = slugify(title);

  if (format === "xlsx") {
    const buf = await toXlsx(title, rows);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      },
    });
  }
  if (format === "doc") {
    return new Response(toDoc(title, rows), {
      headers: {
        "Content-Type": "application/msword; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.doc"`,
      },
    });
  }

  const bytes = await toPdf(title, rows);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
    },
  });
}

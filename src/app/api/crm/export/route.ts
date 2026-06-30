import { getOrgContext } from "@/lib/tenant";
import { getContactsExport, getCompaniesExport } from "@/lib/crm/export";
import { exportResponse, parseFormat } from "@/lib/export/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download the CRM contacts or companies list as PDF/Excel/Word. */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const entity = url.searchParams.get("entity") === "companies" ? "companies" : "contacts";
  const format = parseFormat(url.searchParams.get("format"));

  const table =
    entity === "companies"
      ? await getCompaniesExport(ctx.organizationId)
      : await getContactsExport(ctx.organizationId);

  return exportResponse(table, format);
}

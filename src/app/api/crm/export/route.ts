import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { getContactsExport, getCompaniesExport } from "@/lib/crm/export";
import { exportResponse, parseFormat } from "@/lib/export/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download the CRM contacts or companies list as PDF/Excel/Word. The same
 * gate as the screen it comes from (contacts/ or companies/ layout.tsx): the
 * CRM module and that screen, so a member an access template keeps out of
 * Contacts can't take the whole list through this URL.
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const entity = url.searchParams.get("entity") === "companies" ? "companies" : "contacts";
  if (!hasModule(ctx.modules, "crm") || !canAccessScreen(ctx, entity)) {
    return new Response("Forbidden", { status: 403 });
  }
  const format = parseFormat(url.searchParams.get("format"));

  const table =
    entity === "companies"
      ? await getCompaniesExport(ctx.organizationId)
      : await getContactsExport(ctx.organizationId);

  return exportResponse(table, format);
}

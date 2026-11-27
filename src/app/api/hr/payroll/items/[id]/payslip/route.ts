import { getOrgContext } from "@/lib/tenant";
import { canUseScreen } from "@/lib/access";
import { getPayslip } from "@/lib/queries/payroll";
import { renderPayslip } from "@/lib/hr/payslip";
import { documentHtmlHeaders } from "@/lib/print-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Render one payslip (holerite) as a document. `?format=pdf` returns a
 * print-ready page that opens the print dialog; `?format=word` downloads the
 * same HTML as a .doc. Mirrors the proposal document route.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  // The payslip shows a salary: the same permission as the HR screen (module +
  // access template), answered as "not found" like an id from another company.
  if (!canUseScreen(ctx, "hr")) return new Response("Not found", { status: 404 });

  const { id } = await params;
  const payslip = await getPayslip(ctx.organizationId, id);
  if (!payslip) return new Response("Not found", { status: 404 });

  const format = new URL(req.url).searchParams.get("format");
  const html = renderPayslip(payslip, {
    orgName: ctx.organization.name,
    autoPrint: format === "pdf",
  });

  if (format === "word") {
    const mm = String(payslip.month).padStart(2, "0");
    const filename = `holerite-${mm}-${payslip.year}-${payslip.employeeName}.doc`.replace(/[^\w.\-]+/g, "_");
    return new Response("﻿" + html, {
      headers: {
        "Content-Type": "application/msword; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return new Response(html, { headers: documentHtmlHeaders() });
}

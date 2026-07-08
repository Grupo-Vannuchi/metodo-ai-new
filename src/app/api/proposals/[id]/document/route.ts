import { getOrgContext } from "@/lib/tenant";
import { getProposal } from "@/lib/queries/proposals";
import { renderProposalDocument, renderProposalBuilderDocument } from "@/lib/proposals/document";
import { buildProposalVars } from "@/lib/proposals/variables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Render a proposal as a document. `?format=pdf` returns a print-ready HTML page
 * that auto-opens the print dialog (Save as PDF); `?format=word` downloads the
 * same HTML as a .doc; anything else just returns the HTML preview.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const proposal = await getProposal(ctx.organizationId, id);
  if (!proposal) return new Response("Not found", { status: 404 });

  const format = new URL(req.url).searchParams.get("format");
  const autoPrint = format === "pdf";
  const orgName = ctx.organization.name;

  // A proposal generated from a rich template carries a `document`; render that
  // layout (resolving {{variables}}) instead of the default structured sheet.
  const html =
    proposal.document.sections.length > 0
      ? renderProposalBuilderDocument(
          proposal.document,
          buildProposalVars({
            clientName: proposal.clientName,
            clientCompany: proposal.clientCompany,
            clientEmail: proposal.clientEmail,
            clientPhone: proposal.clientPhone,
            clientAddress: proposal.clientAddress,
            city: proposal.document.city,
            title: proposal.title,
            code: proposal.code,
            subtotal: proposal.subtotal,
            discount: proposal.discount,
            total: proposal.total,
            validUntil: proposal.validUntil,
            date: proposal.createdAt,
            ownerName: proposal.ownerName,
            orgName,
          }),
          { orgName, title: proposal.title, code: proposal.code, createdAt: proposal.createdAt, autoPrint },
        )
      : renderProposalDocument(proposal, { orgName, autoPrint });

  if (format === "word") {
    const filename = `${proposal.code ?? "proposta"}.doc`.replace(/[^\w.\-]+/g, "_");
    return new Response("﻿" + html, {
      headers: {
        "Content-Type": "application/msword; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

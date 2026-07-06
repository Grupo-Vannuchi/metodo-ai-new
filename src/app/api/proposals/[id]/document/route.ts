import { getOrgContext } from "@/lib/tenant";
import { getProposal } from "@/lib/queries/proposals";
import { renderProposalDocument } from "@/lib/proposals/document";

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
  const html = renderProposalDocument(proposal, {
    orgName: ctx.organization.name,
    autoPrint: format === "pdf",
  });

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

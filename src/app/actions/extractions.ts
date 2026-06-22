"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { audit } from "@/lib/audit";
import { planConfig, assertFeature, type PlanKey } from "@/config/plans";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import { runExtractionToCompletion, MAX_TOTAL } from "@/lib/prospecting/runner";
import { countLeadsSince, countJobsSince } from "@/lib/queries/extractions";
import { createOpportunity } from "@/app/actions/opportunities";
import { formatBrPhone } from "@/lib/phone";
import { extractionSchema, type ExtractionInput } from "@/lib/validations/extraction";

export type ExtractionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "invalid"
        | "forbidden"
        | "no_connection"
        | "quota"
        | "search_quota"
        | "unknown";
    };

const DEFAULT_TARGET = 50;

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Start a prospecting run. Requires the tenant's own Google connection (BYO key)
 * and respects the plan's monthly lead quota. */
export async function startExtraction(input: ExtractionInput): Promise<ExtractionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = extractionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const plan = ctx.organization.plan as PlanKey;
  try {
    assertFeature(plan, "prospecting");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  try {
    const db = tenantDb(ctx.organizationId);

    // BYO key: the tenant must have connected their own Google Places API key.
    const conn = await db.integrationConnection.findFirst({
      where: { provider: "GOOGLE" },
      select: { id: true },
    });
    if (!conn) return { ok: false, error: "no_connection" };

    const cfg = planConfig(plan);
    const monthStart = startOfMonth();

    // Per-plan limit on the number of searches (extraction runs) this month.
    const searches = await countJobsSince(ctx.organizationId, monthStart);
    if (searches >= cfg.extractionsPerMonth) return { ok: false, error: "search_quota" };

    // Per-plan limit on the number of leads extracted this month.
    const quota = cfg.prospectingQuotaPerMonth;
    const used = await countLeadsSince(ctx.organizationId, monthStart);
    const remaining = quota - used;
    if (remaining <= 0) return { ok: false, error: "quota" };

    const requested =
      typeof parsed.data.limit === "number" && parsed.data.limit > 0
        ? parsed.data.limit
        : DEFAULT_TARGET;
    const target = Math.max(1, Math.min(requested, remaining, MAX_TOTAL));

    const job = await db.extractionJob.create({
      data: {
        organizationId: ctx.organizationId,
        query: {
          segmento: parsed.data.segmento ?? "",
          localidade: parsed.data.localidade ?? "",
          nome: parsed.data.nome ?? "",
          cnpj: parsed.data.cnpj ?? "",
        },
        target,
        status: "QUEUED",
        createdById: ctx.userId,
      },
      select: { id: true },
    });

    await audit(ctx, {
      action: "extraction.started",
      entity: "ExtractionJob",
      entityId: job.id,
      meta: { target },
    });

    if (isQueueConfigured()) {
      await enqueue("extraction-run", { jobId: job.id });
    } else {
      await runExtractionToCompletion(job.id);
    }

    revalidatePath("/app/prospecting");
    return { ok: true, id: job.id };
  } catch (error) {
    console.error("Failed to start extraction", error);
    return { ok: false, error: "unknown" };
  }
}

function buildNotes(lead: {
  address: string | null;
  rating: number | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
}): string {
  const lines: string[] = [];
  if (lead.address) lines.push(lead.address);
  if (lead.rating) lines.push(`Avaliação Google: ${lead.rating}`);
  if (lead.instagram) lines.push(`Instagram: ${lead.instagram}`);
  if (lead.facebook) lines.push(`Facebook: ${lead.facebook}`);
  if (lead.linkedin) lines.push(`LinkedIn: ${lead.linkedin}`);
  return lines.join("\n");
}

export type ImportResult =
  | { ok: true; imported: number }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  rating: number | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
};

/** Import a single lead into the CRM: dedupes a company by name (creating it if
 * needed) and ensures a reachable contact. Returns the resolved ids + a label,
 * and marks the lead imported. Shared by importLeads and sendLeadsToFunnel. */
async function importLeadCore(
  db: ReturnType<typeof tenantDb>,
  organizationId: string,
  lead: LeadRow,
): Promise<{ companyId: string; contactId: string | null; name: string }> {
  const name = (lead.name ?? "").trim() || (lead.website ?? "").trim() || "Empresa";

  // Dedupe by name within the org.
  let company = await db.company.findFirst({ where: { name }, select: { id: true } });
  if (!company) {
    company = await db.company.create({
      data: {
        organizationId,
        name,
        phone: lead.phone,
        email: lead.email,
        website: lead.website,
        address: lead.address ? { street: lead.address } : {},
        notes: buildNotes(lead) || null,
        source: "extractor:google",
      },
      select: { id: true },
    });
  }

  // A reachable contact so the lead can enter campaigns / be linked to deals.
  let contactId: string | null = null;
  const existing = await db.contact.findFirst({
    where: { companyId: company.id },
    select: { id: true },
  });
  if (existing) {
    contactId = existing.id;
  } else if (lead.phone || lead.email) {
    const created = await db.contact.create({
      data: {
        organizationId,
        companyId: company.id,
        name,
        phone: lead.phone ? formatBrPhone(lead.phone) : null,
        email: lead.email,
        tags: ["prospecção"],
        source: "extractor:google",
      },
      select: { id: true },
    });
    contactId = created.id;
  }

  await db.extractedLead.updateMany({
    where: { id: lead.id },
    data: { importedCompanyId: company.id, importedAt: new Date() },
  });

  return { companyId: company.id, contactId, name };
}

/** Import selected leads into the CRM as companies (+ a reachable contact).
 * Idempotent: an already-imported lead is skipped. LGPD: imported records carry
 * `source` and respect the contact opt-out flow. */
export async function importLeads(jobId: string, leadIds: string[]): Promise<ImportResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return { ok: false, error: "invalid" };
  }

  try {
    const db = tenantDb(ctx.organizationId);
    const leads = await db.extractedLead.findMany({
      where: { jobId, id: { in: leadIds }, importedAt: null },
    });

    for (const lead of leads) await importLeadCore(db, ctx.organizationId, lead);
    const imported = leads.length;

    await audit(ctx, {
      action: "extraction.imported",
      entity: "ExtractionJob",
      entityId: jobId,
      meta: { imported },
    });
    revalidatePath(`/app/prospecting/${jobId}`);
    revalidatePath("/app/companies");
    revalidatePath("/app/contacts");
    return { ok: true, imported };
  } catch (error) {
    console.error("Failed to import leads", error);
    return { ok: false, error: "unknown" };
  }
}

export type FunnelResult =
  | { ok: true; sent: number }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

/** Send selected leads straight into the sales funnel: imports each lead
 * (company + contact) and opens an opportunity in the chosen stage. */
export async function sendLeadsToFunnel(
  jobId: string,
  leadIds: string[],
  stageId: string,
  productServiceId?: string,
): Promise<FunnelResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!Array.isArray(leadIds) || leadIds.length === 0 || !stageId) {
    return { ok: false, error: "invalid" };
  }

  try {
    const db = tenantDb(ctx.organizationId);
    const stage = await db.stage.findFirst({ where: { id: stageId }, select: { id: true } });
    if (!stage) return { ok: false, error: "invalid" };

    let baseValue = 0;
    if (productServiceId) {
      const ps = await db.productService.findFirst({
        where: { id: productServiceId },
        select: { price: true },
      });
      if (ps && ps.price) {
        baseValue = Number(ps.price);
      }
    }

    const leads = await db.extractedLead.findMany({
      where: { jobId, id: { in: leadIds }, importedAt: null },
    });

    let sent = 0;
    for (const lead of leads) {
      const { companyId, contactId, name } = await importLeadCore(db, ctx.organizationId, lead);
      const res = await createOpportunity({
        title: name,
        value: baseValue,
        stageId,
        companyId,
        contactId: contactId ?? undefined,
        productServiceId,
      });
      if (res.ok) sent++;
    }

    await audit(ctx, {
      action: "extraction.toFunnel",
      entity: "ExtractionJob",
      entityId: jobId,
      meta: { sent, stageId },
    });
    revalidatePath(`/app/prospecting/${jobId}`);
    revalidatePath("/app/companies");
    revalidatePath("/app/contacts");
    revalidatePath("/app/crm");
    return { ok: true, sent };
  } catch (error) {
    console.error("Failed to send leads to funnel", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteExtraction(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    await db.extractionJob.deleteMany({ where: { id } });
    revalidatePath("/app/prospecting");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete extraction", error);
    return { ok: false };
  }
}

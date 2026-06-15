"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { assertFeature, type PlanKey } from "@/config/plans";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import { runExtractionToCompletion } from "@/lib/extraction";
import {
  EXTRACTOR_META,
  type ExtractorProviderKey,
} from "@/lib/integrations/extractors/meta";
import { extractionSchema, type ExtractionInput } from "@/lib/validations/extraction";

export type ExtractionActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "unauthorized" | "invalid" | "forbidden" | "no_connection" | "unknown";
    };

export async function startExtraction(
  input: ExtractionInput,
): Promise<ExtractionActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = extractionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const provider = parsed.data.provider as ExtractorProviderKey;
  const meta = EXTRACTOR_META[provider];
  if (!meta.available) return { ok: false, error: "invalid" };

  try {
    assertFeature(ctx.organization.plan as PlanKey, meta.feature);
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const db = tenantDb(ctx.organizationId);

  if (meta.needsGoogle) {
    const googleConn = await db.integrationConnection.count({
      where: { provider: "GOOGLE" },
    });
    if (googleConn === 0) return { ok: false, error: "no_connection" };
  }

  try {
    const job = await db.extractionJob.create({
      data: {
        organizationId: ctx.organizationId,
        provider,
        params: { query: parsed.data.query },
        createdById: ctx.userId,
        status: "QUEUED",
      },
    });

    if (isQueueConfigured()) {
      await enqueue("extraction-run", { jobId: job.id });
    } else {
      // Dev / no queue: run synchronously so the flow works locally.
      await runExtractionToCompletion(job.id);
    }

    revalidatePath("/app/prospecting");
    return { ok: true, id: job.id };
  } catch (error) {
    console.error("Failed to start extraction", error);
    return { ok: false, error: "unknown" };
  }
}

export type ImportResult = { ok: boolean; count?: number };

/** Import selected leads into the CRM as companies. */
export async function importLeads(
  jobId: string,
  leadIds: string[],
): Promise<ImportResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  if (leadIds.length === 0) return { ok: true, count: 0 };

  try {
    const db = tenantDb(ctx.organizationId);
    const leads = await db.extractedLead.findMany({
      where: { id: { in: leadIds }, extractionJobId: jobId, importedAt: null },
    });

    let count = 0;
    for (const lead of leads) {
      const company = await db.company.create({
        data: {
          organizationId: ctx.organizationId,
          name: lead.name || lead.cnpj || "Empresa",
          cnpj: lead.cnpj,
          email: lead.email,
          phone: lead.phone,
          source: "extractor",
        },
      });
      await db.extractedLead.updateMany({
        where: { id: lead.id },
        data: { importedCompanyId: company.id, importedAt: new Date() },
      });
      count++;
    }

    revalidatePath(`/app/prospecting/${jobId}`);
    revalidatePath("/app/companies");
    return { ok: true, count };
  } catch (error) {
    console.error("Failed to import leads", error);
    return { ok: false };
  }
}

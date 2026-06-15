import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getExtractor } from "@/lib/integrations/extractors";
import { resolveCredentials } from "@/lib/integrations/credentials";
import type { ExtractorProviderKey } from "@/lib/integrations/extractors/meta";
import type { Cursor } from "@/lib/integrations/extractors/types";

/** Safety cap on total leads per job (also bounds inline runs). */
const MAX_TOTAL = 200;

/**
 * Process ONE batch of an extraction job. Runs as system (no session): the
 * job's `organizationId` is the tenant boundary, set explicitly on every write.
 * Returns `{ done }` so the caller (queue handler or inline runner) knows
 * whether to schedule the next batch.
 */
export async function runExtractionBatch(
  jobId: string,
): Promise<{ done: boolean }> {
  const job = await prisma.extractionJob.findUnique({ where: { id: jobId } });
  if (!job) return { done: true };
  if (["DONE", "FAILED", "CANCELED"].includes(job.status)) return { done: true };

  const adapter = getExtractor(job.provider as ExtractorProviderKey);
  if (!adapter) {
    await fail(jobId, "Extrator não disponível.");
    return { done: true };
  }

  let credentials: Record<string, string> | null = null;
  if (adapter.requiresConnection === "GOOGLE") {
    // Tenant's own Google connection, or the platform-managed key as fallback.
    const resolved = await resolveCredentials(job.organizationId, "GOOGLE");
    if (!resolved) {
      await fail(
        jobId,
        "Conecte o Google em Conexões (ou aguarde a credencial padrão da plataforma).",
      );
      return { done: true };
    }
    credentials = resolved.credentials;
  }

  await prisma.extractionJob.update({
    where: { id: jobId },
    data: { status: "RUNNING" },
  });

  try {
    const params = (job.params ?? {}) as Record<string, unknown>;
    const cursor = (job.cursor ?? null) as Cursor;
    const result = await adapter.run(params, cursor, { credentials });

    if (result.leads.length) {
      await prisma.extractedLead.createMany({
        data: result.leads.map((l) => ({
          organizationId: job.organizationId,
          extractionJobId: job.id,
          name: l.name ?? null,
          cnpj: l.cnpj ?? null,
          email: l.email ?? null,
          phone: l.phone ?? null,
          raw: l.raw as Prisma.InputJsonValue,
        })),
      });
    }

    const totalFound = job.totalFound + result.leads.length;
    const done = result.nextCursor === null || totalFound >= MAX_TOTAL;

    await prisma.extractionJob.update({
      where: { id: jobId },
      data: {
        totalFound,
        status: done ? "DONE" : "QUEUED",
        cursor: done
          ? Prisma.DbNull
          : (result.nextCursor as Prisma.InputJsonValue),
      },
    });
    return { done };
  } catch (e) {
    await fail(jobId, e instanceof Error ? e.message : "Erro na extração.");
    return { done: true };
  }
}

async function fail(jobId: string, error: string): Promise<void> {
  await prisma.extractionJob.update({
    where: { id: jobId },
    data: { status: "FAILED", error },
  });
}

/**
 * Run a job to completion in-process. Used in dev / when the queue isn't
 * configured. Bounded by an iteration cap as a backstop.
 */
export async function runExtractionToCompletion(jobId: string): Promise<void> {
  for (let i = 0; i < 25; i++) {
    const { done } = await runExtractionBatch(jobId);
    if (done) return;
  }
}

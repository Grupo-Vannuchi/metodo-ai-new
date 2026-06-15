import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export async function listPipelines(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.pipeline.findMany({
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      isDefault: true,
      _count: { select: { stages: true } },
    },
  });
}

/** Lightweight pipeline options for the board switcher. */
export async function pipelineOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.pipeline.findMany({
    orderBy: { order: "asc" },
    select: { id: true, name: true, isDefault: true },
  });
}

/** A pipeline with its stages (each with its open-opportunity count). */
export async function getPipeline(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  const pipeline = await db.pipeline.findFirst({
    where: { id },
    select: { id: true, name: true, isDefault: true },
  });
  if (!pipeline) return null;

  const stages = await db.stage.findMany({
    where: { pipelineId: id },
    orderBy: { order: "asc" },
    select: { id: true, name: true, probability: true, order: true },
  });

  const counts = await db.opportunity.groupBy({
    by: ["stageId"],
    where: { pipelineId: id },
    _count: { _all: true },
  });
  const byStage = new Map(counts.map((c) => [c.stageId, c._count._all]));

  return {
    pipeline,
    stages: stages.map((s) => ({ ...s, oppCount: byStage.get(s.id) ?? 0 })),
  };
}

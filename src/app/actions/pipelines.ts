"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { DEFAULT_STAGES } from "@/lib/default-pipeline";
import {
  pipelineSchema,
  stageSchema,
  type PipelineInput,
  type StageInput,
} from "@/lib/validations/pipeline";

export type PipelineResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "unauthorized" | "invalid" | "last_pipeline" | "stage_in_use" | "unknown";
    };

export type SimpleResult = { ok: boolean; error?: string };

function revalidate(): void {
  revalidatePath("/app/crm/pipelines");
  revalidatePath("/app/crm");
}

// --------------------------------------------------------------- Pipelines

export async function createPipeline(input: PipelineInput): Promise<PipelineResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = pipelineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const count = await db.pipeline.count();
    const pipeline = await db.pipeline.create({
      data: {
        organizationId: ctx.organizationId,
        name: parsed.data.name,
        order: count,
        isDefault: count === 0,
      },
    });
    await db.stage.createMany({
      data: DEFAULT_STAGES.map((s, i) => ({
        organizationId: ctx.organizationId,
        pipelineId: pipeline.id,
        name: s.name,
        probability: s.probability,
        order: i,
      })),
    });
    revalidate();
    return { ok: true, id: pipeline.id };
  } catch (error) {
    console.error("Failed to create pipeline", error);
    return { ok: false, error: "unknown" };
  }
}

export async function renamePipeline(
  id: string,
  input: PipelineInput,
): Promise<PipelineResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = pipelineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const res = await db.pipeline.updateMany({ where: { id }, data: { name: parsed.data.name } });
    if (res.count === 0) return { ok: false, error: "unknown" };
    revalidate();
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to rename pipeline", error);
    return { ok: false, error: "unknown" };
  }
}

export async function setDefaultPipeline(id: string): Promise<SimpleResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const exists = await db.pipeline.findFirst({ where: { id }, select: { id: true } });
    if (!exists) return { ok: false };
    await db.pipeline.updateMany({ data: { isDefault: false } });
    await db.pipeline.updateMany({ where: { id }, data: { isDefault: true } });
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("Failed to set default pipeline", error);
    return { ok: false };
  }
}

export async function deletePipeline(id: string): Promise<PipelineResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const total = await db.pipeline.count();
    if (total <= 1) return { ok: false, error: "last_pipeline" };

    const target = await db.pipeline.findFirst({ where: { id }, select: { id: true, isDefault: true } });
    if (!target) return { ok: false, error: "unknown" };

    // Cascades stages + opportunities (schema onDelete: Cascade).
    await db.pipeline.deleteMany({ where: { id } });

    if (target.isDefault) {
      const next = await db.pipeline.findFirst({ orderBy: { order: "asc" }, select: { id: true } });
      if (next) await db.pipeline.updateMany({ where: { id: next.id }, data: { isDefault: true } });
    }
    revalidate();
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to delete pipeline", error);
    return { ok: false, error: "unknown" };
  }
}

// ----------------------------------------------------------------- Stages

export async function createStage(
  pipelineId: string,
  input: StageInput,
): Promise<PipelineResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const pipeline = await db.pipeline.findFirst({ where: { id: pipelineId }, select: { id: true } });
    if (!pipeline) return { ok: false, error: "invalid" };

    const order = await db.stage.count({ where: { pipelineId } });
    const stage = await db.stage.create({
      data: {
        organizationId: ctx.organizationId,
        pipelineId,
        name: parsed.data.name,
        probability: parsed.data.probability,
        order,
      },
    });
    revalidate();
    return { ok: true, id: stage.id };
  } catch (error) {
    console.error("Failed to create stage", error);
    return { ok: false, error: "unknown" };
  }
}

export async function updateStage(id: string, input: StageInput): Promise<PipelineResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const res = await db.stage.updateMany({
      where: { id },
      data: { name: parsed.data.name, probability: parsed.data.probability },
    });
    if (res.count === 0) return { ok: false, error: "unknown" };
    revalidate();
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update stage", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteStage(id: string): Promise<PipelineResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const inUse = await db.opportunity.count({ where: { stageId: id } });
    if (inUse > 0) return { ok: false, error: "stage_in_use" };
    await db.stage.deleteMany({ where: { id } });
    revalidate();
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to delete stage", error);
    return { ok: false, error: "unknown" };
  }
}

/** Swap a stage's order with its neighbor (up = earlier, down = later). */
export async function moveStage(
  id: string,
  direction: "up" | "down",
): Promise<SimpleResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const stage = await db.stage.findFirst({
      where: { id },
      select: { id: true, pipelineId: true, order: true },
    });
    if (!stage) return { ok: false };

    const neighbor = await db.stage.findFirst({
      where:
        direction === "up"
          ? { pipelineId: stage.pipelineId, order: { lt: stage.order } }
          : { pipelineId: stage.pipelineId, order: { gt: stage.order } },
      orderBy: { order: direction === "up" ? "desc" : "asc" },
      select: { id: true, order: true },
    });
    if (!neighbor) return { ok: true }; // already at the edge

    await db.stage.updateMany({ where: { id: stage.id }, data: { order: neighbor.order } });
    await db.stage.updateMany({ where: { id: neighbor.id }, data: { order: stage.order } });
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("Failed to move stage", error);
    return { ok: false };
  }
}

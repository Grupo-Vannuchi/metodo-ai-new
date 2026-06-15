import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type BoardCard = {
  id: string;
  title: string;
  value: number;
  companyName: string | null;
  contactName: string | null;
  order: number;
};

export type BoardColumn = {
  id: string;
  name: string;
  probability: number;
  cards: BoardCard[];
};

export type Board = {
  pipelineId: string;
  pipelineName: string;
  columns: BoardColumn[];
};

/** The default pipeline (or the first one) for this org. */
async function defaultPipeline(organizationId: string) {
  const db = tenantDb(organizationId);
  return (
    (await db.pipeline.findFirst({
      where: { isDefault: true },
      orderBy: { order: "asc" },
    })) ?? (await db.pipeline.findFirst({ orderBy: { order: "asc" } }))
  );
}

/** The full Kanban board: ordered stages, each with its ordered cards. */
export async function getBoard(organizationId: string): Promise<Board | null> {
  const db = tenantDb(organizationId);
  const pipeline = await defaultPipeline(organizationId);
  if (!pipeline) return null;

  const [stages, opportunities] = await Promise.all([
    db.stage.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { order: "asc" },
      select: { id: true, name: true, probability: true },
    }),
    db.opportunity.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { order: "asc" },
      select: {
        id: true,
        title: true,
        value: true,
        order: true,
        stageId: true,
        company: { select: { name: true } },
        contact: { select: { name: true } },
      },
    }),
  ]);

  const columns: BoardColumn[] = stages.map((s) => ({
    id: s.id,
    name: s.name,
    probability: s.probability,
    cards: opportunities
      .filter((o) => o.stageId === s.id)
      .map((o) => ({
        id: o.id,
        title: o.title,
        value: Number(o.value),
        companyName: o.company?.name ?? null,
        contactName: o.contact?.name ?? null,
        order: o.order,
      })),
  }));

  return { pipelineId: pipeline.id, pipelineName: pipeline.name, columns };
}

/** Stage options of the default pipeline (for the create form). */
export async function stageOptions(organizationId: string) {
  const pipeline = await defaultPipeline(organizationId);
  if (!pipeline) return { pipelineId: null as string | null, stages: [] };
  const db = tenantDb(organizationId);
  const stages = await db.stage.findMany({
    where: { pipelineId: pipeline.id },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });
  return { pipelineId: pipeline.id, stages };
}

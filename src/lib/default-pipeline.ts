import type { Prisma } from "@prisma/client";

/**
 * The default funnel every new organization starts with. Kept free of "@/"
 * aliases / "server-only" so it can be imported by both the signup action and
 * the Prisma seed (which runs under tsx without path resolution).
 */
export const DEFAULT_STAGES: { name: string; probability: number }[] = [
  { name: "Novo", probability: 10 },
  { name: "Qualificado", probability: 30 },
  { name: "Proposta", probability: 60 },
  { name: "Negociação", probability: 80 },
  { name: "Ganho", probability: 100 },
];

/**
 * Create the default pipeline + stages for an organization, inside a
 * transaction. Returns the created pipeline.
 */
export async function createDefaultPipeline(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  const pipeline = await tx.pipeline.create({
    data: { organizationId, name: "Funil de Vendas", isDefault: true, order: 0 },
  });
  await tx.stage.createMany({
    data: DEFAULT_STAGES.map((s, i) => ({
      organizationId,
      pipelineId: pipeline.id,
      name: s.name,
      probability: s.probability,
      order: i,
    })),
  });
  return pipeline;
}

import { z } from "zod";

export const pipelineSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome.").max(120),
});

export type PipelineInput = z.infer<typeof pipelineSchema>;

export const stageSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome.").max(60),
  probability: z.coerce.number().int().min(0).max(100).default(0),
});

export type StageInput = z.infer<typeof stageSchema>;

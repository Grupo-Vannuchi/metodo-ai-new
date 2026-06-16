import { z } from "zod";

const optional = z.string().trim().max(160).optional().or(z.literal(""));

/** Allowed result targets (mirrors the prospecting form options). */
export const EXTRACTION_LIMITS = [50, 100, 200] as const;

export const extractionSchema = z
  .object({
    segmento: optional,
    localidade: optional,
    nome: optional,
    cnpj: z.string().trim().max(20).optional().or(z.literal("")),
    /** "" = provider default (capped server-side); otherwise one of the limits. */
    limit: z
      .union([z.literal(""), z.coerce.number().int().positive().max(1000)])
      .optional(),
  })
  .refine(
    (v) => Boolean(v.segmento || v.localidade || v.nome || v.cnpj),
    { message: "Informe pelo menos um campo de busca.", path: ["segmento"] },
  );

export type ExtractionInput = z.infer<typeof extractionSchema>;

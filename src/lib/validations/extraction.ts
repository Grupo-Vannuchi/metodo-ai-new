import { z } from "zod";
import { EXTRACTOR_KEYS } from "@/lib/integrations/extractors/meta";

export const extractionSchema = z.object({
  provider: z.string().refine((v) => EXTRACTOR_KEYS.includes(v as never), {
    message: "Extrator inválido.",
  }),
  query: z.string().trim().min(1, "Informe a busca.").max(200),
});

export type ExtractionInput = z.infer<typeof extractionSchema>;

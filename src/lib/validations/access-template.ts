import { z } from "zod";
import { GATEABLE_SCREENS } from "@/config/screens";

const VALID = GATEABLE_SCREENS as readonly string[];

export const accessTemplateSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome.").max(60),
  /** Only known screen keys are kept. */
  screens: z
    .array(z.string())
    .default([])
    .transform((arr) => [...new Set(arr.filter((s) => VALID.includes(s)))]),
});

export type AccessTemplateInput = z.infer<typeof accessTemplateSchema>;

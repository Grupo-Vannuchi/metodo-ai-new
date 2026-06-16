import { z } from "zod";
import { PROVIDER_KEYS } from "@/lib/integrations/registry";

export const connectionSchema = z.object({
  provider: z.string().refine((v) => PROVIDER_KEYS.includes(v as never), {
    message: "Provedor inválido.",
  }),
  label: z.string().trim().min(1, "Informe um rótulo.").max(120),
  /** Provider-specific key/value credentials. */
  credentials: z.record(z.string(), z.string()),
});

export type ConnectionInput = z.infer<typeof connectionSchema>;

/** Editing keeps the provider fixed; only the label and credentials change.
 * Blank credential fields mean "keep the current value". */
export const connectionUpdateSchema = z.object({
  label: z.string().trim().min(1, "Informe um rótulo.").max(120),
  credentials: z.record(z.string(), z.string()),
});

export type ConnectionUpdateInput = z.infer<typeof connectionUpdateSchema>;

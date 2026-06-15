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

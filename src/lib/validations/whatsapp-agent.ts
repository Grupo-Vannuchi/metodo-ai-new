import { z } from "zod";

/** AI models offered for the WhatsApp agent (fast/cheap first). */
export const AGENT_MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5"] as const;

/** Longest prompt accepted, in characters. The whole prompt goes with every reply, so it also caps the per-reply cost. */
export const AGENT_PROMPT_MAX = 16_000;

const emptyToUndef = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

export const whatsappAgentSchema = z
  .object({
    enabled: z.boolean().default(false),
    name: z.string().trim().max(80).optional().default(""),
    prompt: z.string().trim().max(AGENT_PROMPT_MAX).optional().default(""),
    model: z.enum(["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5"]).default("claude-haiku-4-5-20251001"),
    handoffMinutes: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).max(1440).default(30)),
  })
  // A live, customer-facing bot must have a prompt.
  .refine((d) => !d.enabled || d.prompt.trim().length > 0, {
    message: "prompt required when enabled",
    path: ["prompt"],
  });

export type WhatsappAgentInput = z.infer<typeof whatsappAgentSchema>;

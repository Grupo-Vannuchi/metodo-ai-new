/**
 * Shared pieces of the MCP tools' input schemas (zod 3, like the rest of the
 * repo). The descriptions are what the model reads, so they are in Portuguese.
 * Out-of-range limits are clamped by `page()` (src/lib/mcp/core.ts), not here.
 */
import { z } from "zod";

/**
 * A fresh schema per field, on purpose: the SDK's JSON Schema conversion turns
 * a zod instance used twice in one tool into a `$ref` to the first use, which
 * some MCP clients don't resolve.
 */
export function dayParam(description: string) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")
    .describe(description);
}

export const periodShape = {
  from: dayParam("Início do período, AAAA-MM-DD (inclusivo)").optional(),
  to: dayParam("Fim do período, AAAA-MM-DD (inclusivo)").optional(),
};

export const pageShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Quantos itens devolver (padrão 50, máximo 200)"),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Quantos itens pular, para paginar (padrão 0)"),
};

export const searchParam = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional()
  .describe("Texto a buscar (sem diferenciar maiúsculas de minúsculas)");

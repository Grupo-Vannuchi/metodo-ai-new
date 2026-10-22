/**
 * Shared pieces of the MCP tools' input schemas (zod 3, like the rest of the
 * repo). The descriptions are what the model reads, so they are in Portuguese.
 * Out-of-range limits are clamped by `page()` (src/lib/mcp/core.ts), not here.
 */
import { z } from "zod";

export const dayParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")
  .describe("Data no formato AAAA-MM-DD");

export const periodShape = {
  from: dayParam.optional().describe("Início do período, AAAA-MM-DD (inclusivo)"),
  to: dayParam.optional().describe("Fim do período, AAAA-MM-DD (inclusivo)"),
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

import { z } from "zod";

/**
 * Validation + types for org-shared proposal templates (the reusable rich
 * "document builder" blueprints). The `document` shape is stored as JSON on both
 * ProposalTemplate and Proposal; its HTML fields are sanitized at render time
 * (see src/lib/proposals/sanitize.ts), never trusted raw.
 */

const optionalId = z.string().trim().max(40).optional().or(z.literal(""));
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const url = z.string().trim().max(1000).optional().or(z.literal(""));
/** Rich-text HTML body of a section/header/footer (bounded; sanitized on render). */
const html = z.string().max(20000).optional().or(z.literal(""));

/** One document section: a titled block of rich text. */
export const docSectionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().max(255).default(""),
  html: html.default(""),
});
export type DocSection = z.infer<typeof docSectionSchema>;

/** An image + rich-text band (used for header, footer and signature). */
const bandSchema = z.object({ imageUrl: url.default(""), html: html.default("") });

/** The rich document builder payload (cover/header/footer/signature/sections). */
export const proposalDocumentSchema = z.object({
  city: optionalText(160).default(""),
  cover: z.object({ imageUrl: url.default(""), subtitle: optionalText(255).default("") }).default({}),
  header: bandSchema.default({}),
  footer: bandSchema.default({}),
  signature: bandSchema.default({}),
  clientLogos: z.array(z.string().trim().max(1000)).max(15).default([]),
  sections: z.array(docSectionSchema).max(40).default([]),
});
export type ProposalDocument = z.infer<typeof proposalDocumentSchema>;

/** A default line item of a template (catalog link optional; free text allowed). */
export const templateItemSchema = z.object({
  productServiceId: optionalId,
  name: z.string().trim().min(1, "Informe o item.").max(200),
  description: optionalText(1000),
  quantity: z.coerce.number().min(0).max(1_000_000).default(1),
  unitPrice: z.coerce.number().min(0).max(1_000_000_000).default(0),
});
export type TemplateItemInput = z.infer<typeof templateItemSchema>;

export const proposalTemplateSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do modelo.").max(160),
  document: proposalDocumentSchema,
  validityDays: z.coerce.number().int().min(0).max(3650).optional().nullable(),
  discount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  items: z.array(templateItemSchema).max(100).default([]),
});
export type ProposalTemplateInput = z.infer<typeof proposalTemplateSchema>;

/** A blank document — the starting point for a new template. */
export function emptyDocument(): ProposalDocument {
  return {
    city: "",
    cover: { imageUrl: "", subtitle: "" },
    header: { imageUrl: "", html: "" },
    footer: { imageUrl: "", html: "" },
    signature: { imageUrl: "", html: "" },
    clientLogos: [],
    sections: [],
  };
}

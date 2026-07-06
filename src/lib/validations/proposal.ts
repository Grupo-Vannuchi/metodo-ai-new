import { z } from "zod";

const optionalId = z.string().trim().max(40).optional().or(z.literal(""));
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

/** A single line item: catalog link is optional (free-text items allowed). */
export const proposalItemSchema = z.object({
  productServiceId: optionalId,
  name: z.string().trim().min(1, "Informe o item.").max(200),
  description: optionalText(1000),
  quantity: z.coerce.number().min(0).max(1_000_000).default(1),
  unitPrice: z.coerce.number().min(0).max(1_000_000_000).default(0),
});

export type ProposalItemInput = z.infer<typeof proposalItemSchema>;

/** Fields shared by create and edit. */
const baseFields = {
  title: z.string().trim().min(1, "Informe o título.").max(200),
  opportunityId: optionalId,
  companyId: optionalId,
  contactId: optionalId,
  clientCompany: optionalText(200),
  clientName: optionalText(200),
  clientEmail: optionalText(200),
  clientPhone: optionalText(60),
  clientAddress: optionalText(500),
  intro: optionalText(12000),
  notes: optionalText(4000),
  validUntil: optionalText(10), // yyyy-mm-dd
  discount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  items: z.array(proposalItemSchema).max(100).default([]),
};

export const proposalSchema = z.object(baseFields);
export type ProposalInput = z.infer<typeof proposalSchema>;

export const updateProposalSchema = z.object({
  ...baseFields,
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]),
});
export type UpdateProposalInput = z.infer<typeof updateProposalSchema>;

export const PROPOSAL_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"] as const;
export type ProposalStatusKey = (typeof PROPOSAL_STATUSES)[number];

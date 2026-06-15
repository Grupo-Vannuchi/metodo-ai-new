import { z } from "zod";

export const opportunitySchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(200),
  value: z.coerce.number().min(0).max(1_000_000_000).default(0),
  stageId: z.string().trim().min(1, "Selecione um estágio."),
  companyId: z.string().trim().max(40).optional().or(z.literal("")),
  contactId: z.string().trim().max(40).optional().or(z.literal("")),
});

export type OpportunityInput = z.infer<typeof opportunitySchema>;

/** Move a card to another stage (appended to the end of the destination column). */
export const moveOpportunitySchema = z.object({
  opportunityId: z.string().trim().min(1),
  toStageId: z.string().trim().min(1),
});

export type MoveOpportunityInput = z.infer<typeof moveOpportunitySchema>;

/** Edit a card (detail page). */
export const updateOpportunitySchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(200),
  value: z.coerce.number().min(0).max(1_000_000_000).default(0),
  stageId: z.string().trim().min(1, "Selecione um estágio."),
  status: z.enum(["OPEN", "WON", "LOST"]),
  companyId: z.string().trim().max(40).optional().or(z.literal("")),
  contactId: z.string().trim().max(40).optional().or(z.literal("")),
});

export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

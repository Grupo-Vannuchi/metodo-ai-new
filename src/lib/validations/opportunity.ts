import { z } from "zod";

const optionalId = z.string().trim().max(40).optional().or(z.literal(""));
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

/** Fields shared by create and edit. */
const baseFields = {
  title: z.string().trim().min(1, "Informe o título.").max(200),
  value: z.coerce.number().min(0).max(1_000_000_000).default(0),
  stageId: z.string().trim().min(1, "Selecione um estágio."),
  companyId: optionalId,
  contactId: optionalId,
  productServiceId: optionalId,
  ownerId: optionalId,
  expectedCloseDate: optionalText(10), // yyyy-mm-dd
  notes: optionalText(2000),
};

export const opportunitySchema = z.object(baseFields);

export type OpportunityInput = z.infer<typeof opportunitySchema>;

/** Move a card to another stage (appended to the end of the destination column). */
export const moveOpportunitySchema = z.object({
  opportunityId: z.string().trim().min(1),
  toStageId: z.string().trim().min(1),
});

export type MoveOpportunityInput = z.infer<typeof moveOpportunitySchema>;

/** Edit a card (detail page). Adds status + outcome reason (required when the
 * deal is lost/canceled). */
export const updateOpportunitySchema = z
  .object({
    ...baseFields,
    status: z.enum(["OPEN", "ON_HOLD", "WON", "LOST", "CANCELED"]),
    outcomeReason: optionalText(500),
  })
  .superRefine((data, ctx) => {
    if ((data.status === "LOST" || data.status === "CANCELED") && !(data.outcomeReason ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcomeReason"],
        message: "Informe o motivo.",
      });
    }
  });

export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

/** Product/service catalog item. */
export const productServiceSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120),
  kind: z.enum(["PRODUCT", "SERVICE"]),
  price: z.coerce.number().min(0).max(1_000_000_000).optional(),
  active: z.boolean().optional(),
});

export type ProductServiceInput = z.infer<typeof productServiceSchema>;

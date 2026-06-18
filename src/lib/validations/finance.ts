import { z } from "zod";

/** Finance validation — runs on the client and re-runs on the server. */

export const financeTypeEnum = z.enum(["INCOME", "EXPENSE"]);
export const financeStatusEnum = z.enum(["PENDING", "SETTLED"]);
export const financeMethodEnum = z.enum(["PIX", "BOLETO", "CARD", "CASH", "TRANSFER", "OTHER"]);

const optionalId = z.string().trim().max(40).optional().or(z.literal(""));

export const entrySchema = z.object({
  type: financeTypeEnum,
  description: z.string().trim().min(1, "Informe uma descrição.").max(200),
  amount: z.coerce.number().positive("Valor deve ser maior que zero.").max(99_999_999.99),
  status: financeStatusEnum.default("PENDING"),
  dueDate: z.string().min(1, "Informe a data."), // yyyy-mm-dd
  settledAt: z.string().optional().or(z.literal("")),
  method: financeMethodEnum.optional().or(z.literal("")),
  categoryId: optionalId,
  contactId: optionalId,
  companyId: optionalId,
  opportunityId: optionalId,
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: financeTypeEnum,
});

export type EntryInput = z.infer<typeof entrySchema>;

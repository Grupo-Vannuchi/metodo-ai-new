import { z } from "zod";

/** Validation for the payroll run and its payslip lines. */

const optionalId = z.string().trim().max(40).optional().or(z.literal(""));
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const PAYROLL_STATUSES = ["DRAFT", "APPROVED", "PAID"] as const;
export const PAYROLL_LINE_TYPES = ["EARNING", "DEDUCTION"] as const;

export type PayrollStatusKey = (typeof PAYROLL_STATUSES)[number];
export type PayrollLineTypeKey = (typeof PAYROLL_LINE_TYPES)[number];

export const payrollRunSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  /** yyyy-mm-dd — becomes the finance entries' due/settled date. */
  payDate: z.string().trim().min(1, "Informe a data de pagamento.").max(10),
  /** Finance category for the generated expenses (drives the DRE). */
  categoryId: optionalId,
  notes: optionalText(1000),
});
export type PayrollRunInput = z.infer<typeof payrollRunSchema>;

export const payrollLineSchema = z.object({
  type: z.enum(PAYROLL_LINE_TYPES),
  label: z.string().trim().min(1, "Informe a descrição.").max(120),
  amount: z.coerce.number().min(0).max(1_000_000_000),
});
export type PayrollLineInput = z.infer<typeof payrollLineSchema>;

export const payrollLinesSchema = z.array(payrollLineSchema).max(40);

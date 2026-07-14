import { z } from "zod";

/** Validation for time-off (férias/licenças/faltas) requests and decisions. */

export const TIME_OFF_TYPES = ["VACATION", "SICK", "LEAVE", "ABSENCE", "OTHER"] as const;
export const TIME_OFF_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export type TimeOffTypeKey = (typeof TIME_OFF_TYPES)[number];
export type TimeOffStatusKey = (typeof TIME_OFF_STATUSES)[number];

/** Status filter for the list (client-safe — the toolbar imports it). */
export type TimeOffStatusFilter = "ALL" | TimeOffStatusKey;
export const TIME_OFF_STATUS_FILTERS: TimeOffStatusFilter[] = ["ALL", ...TIME_OFF_STATUSES];

export const timeOffSchema = z
  .object({
    employeeId: z.string().trim().min(1, "Selecione o funcionário.").max(40),
    type: z.enum(TIME_OFF_TYPES).default("VACATION"),
    startDate: z.string().trim().min(1, "Informe o início.").max(10),
    endDate: z.string().trim().min(1, "Informe o fim.").max(10),
    reason: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .refine((v) => new Date(v.endDate) >= new Date(v.startDate), {
    message: "O fim não pode ser antes do início.",
    path: ["endDate"],
  });

export type TimeOffInput = z.infer<typeof timeOffSchema>;

export const timeOffDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  decisionNote: z.string().trim().max(500).optional().or(z.literal("")),
});
export type TimeOffDecisionInput = z.infer<typeof timeOffDecisionSchema>;

/** Inclusive calendar-day span of a period. */
export function daysBetween(start: Date, end: Date): number {
  const ms = new Date(end).setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

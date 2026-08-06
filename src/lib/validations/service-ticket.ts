import { z } from "zod";

export const SERVICE_TICKET_STATUSES = ["RECEIVED", "IN_SERVICE", "READY", "RETURNED", "CANCELED"] as const;

const optStr = (max: number) => z.string().trim().max(max).optional().default("");
const emptyToUndef = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const reqDate = z.preprocess(emptyToUndef, z.coerce.date());
const optDate = z.preprocess(emptyToUndef, z.coerce.date().optional());
const optNum = z.preprocess(emptyToUndef, z.coerce.number().finite().nonnegative().optional());

export const serviceTicketSchema = z.object({
  equipment: z.string().trim().min(1).max(240),
  assetId: optStr(40),
  companyId: optStr(40),
  description: optStr(2000),
  receivedAt: reqDate,
  expectedReturn: optDate,
  responsible: optStr(160),
  notes: optStr(2000),
});

export const returnServiceSchema = z.object({
  returnedAt: optDate,
  cost: optNum,
  notes: optStr(2000),
});

export type ServiceTicketInput = z.infer<typeof serviceTicketSchema>;
export type ReturnServiceInput = z.infer<typeof returnServiceSchema>;

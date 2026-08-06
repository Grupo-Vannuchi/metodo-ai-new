import { z } from "zod";

export const MAINTENANCE_TYPES = ["MAINTENANCE", "CALIBRATION"] as const;

const optStr = (max: number) => z.string().trim().max(max).optional().default("");
const emptyToUndef = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const reqDate = z.preprocess(emptyToUndef, z.coerce.date());
const optDate = z.preprocess(emptyToUndef, z.coerce.date().optional());
const optNum = z.preprocess(emptyToUndef, z.coerce.number().finite().nonnegative().optional());

export const scheduleMaintenanceSchema = z.object({
  assetId: z.string().trim().min(1),
  type: z.enum(["MAINTENANCE", "CALIBRATION"]),
  dueDate: reqDate,
  provider: optStr(160),
  notes: optStr(2000),
});

export const completeMaintenanceSchema = z.object({
  performedAt: optDate,
  provider: optStr(160),
  cost: optNum,
  certificate: optStr(120),
  result: optStr(500),
  notes: optStr(2000),
  /// When true, auto-schedule the next event from the item's periodicity.
  autoNext: z.boolean().default(true),
});

export type ScheduleMaintenanceInput = z.infer<typeof scheduleMaintenanceSchema>;
export type CompleteMaintenanceInput = z.infer<typeof completeMaintenanceSchema>;

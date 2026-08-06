import { z } from "zod";

/** Movement kind as chosen in the form (TRANSFER expands to two ledger rows). */
export const STOCK_MOVEMENT_KINDS = ["IN", "OUT", "ADJUST", "TRANSFER"] as const;

const optStr = (max: number) => z.string().trim().max(max).optional().default("");
const emptyToUndef = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const posNum = z.preprocess(emptyToUndef, z.coerce.number().finite().positive());
const optNum = z.preprocess(emptyToUndef, z.coerce.number().finite().nonnegative().optional());
const optDate = z.preprocess(emptyToUndef, z.coerce.date().optional());

export const stockMovementSchema = z
  .object({
    kind: z.enum(["IN", "OUT", "ADJUST", "TRANSFER"]),
    itemId: z.string().trim().min(1),
    warehouseId: optStr(40),
    toWarehouseId: optStr(40),
    quantity: posNum,
    // For ADJUST: whether the entered quantity increases or decreases the balance.
    adjustDirection: z.enum(["increase", "decrease"]).optional().default("increase"),
    lot: optStr(80),
    validity: optDate,
    unitCost: optNum,
    reason: optStr(160),
    reference: optStr(160),
    note: optStr(500),
  })
  .refine((d) => d.kind !== "TRANSFER" || (d.warehouseId && d.toWarehouseId), {
    message: "transfer requires source and destination",
    path: ["toWarehouseId"],
  })
  .refine((d) => d.kind !== "TRANSFER" || d.warehouseId !== d.toWarehouseId, {
    message: "source and destination must differ",
    path: ["toWarehouseId"],
  });

export type StockMovementInput = z.infer<typeof stockMovementSchema>;

export const stockReservationSchema = z.object({
  itemId: z.string().trim().min(1),
  warehouseId: optStr(40),
  quantity: posNum,
  reason: optStr(160),
  reference: optStr(160),
  note: optStr(500),
});

export type StockReservationInput = z.infer<typeof stockReservationSchema>;

import { z } from "zod";

const optStr = (max: number) => z.string().trim().max(max).optional().default("");
const emptyToUndef = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const optDate = z.preprocess(emptyToUndef, z.coerce.date().optional());
const nonNeg = z.preprocess(emptyToUndef, z.coerce.number().finite().nonnegative().default(0));
const pos = z.preprocess(emptyToUndef, z.coerce.number().finite().positive());

export const purchaseItemSchema = z.object({
  itemId: optStr(40),
  description: z.string().trim().min(1).max(240),
  quantity: pos,
  unitPrice: nonNeg,
});

export const purchaseOrderSchema = z.object({
  supplierId: optStr(40),
  warehouseId: optStr(40),
  expectedAt: optDate,
  notes: optStr(2000),
  items: z.array(purchaseItemSchema).min(1),
});

export type PurchaseItemInput = z.infer<typeof purchaseItemSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

/** Receiving: how much of each line to receive now (keyed by line id). */
export const receiveSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().trim().min(1),
        qty: z.preprocess(emptyToUndef, z.coerce.number().finite().nonnegative().default(0)),
      }),
    )
    .min(1),
});

export type ReceiveInput = z.infer<typeof receiveSchema>;

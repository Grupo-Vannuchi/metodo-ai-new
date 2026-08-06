import { z } from "zod";

export const ASSET_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED"] as const;
export const ASSET_NATURES = ["OWN", "CLIENT", "THIRD_PARTY", "RESALE"] as const;

const optStr = (max: number) => z.string().trim().max(max).optional().default("");
const emptyToUndef = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const optNum = z.preprocess(emptyToUndef, z.coerce.number().finite().nonnegative().optional());
const optDate = z.preprocess(emptyToUndef, z.coerce.date().optional());

export const assetSchema = z.object({
  code: optStr(60),
  name: z.string().trim().min(1).max(240),
  itemId: optStr(40),
  serialNumber: optStr(120),
  nature: z.enum(["OWN", "CLIENT", "THIRD_PARTY", "RESALE"]).default("OWN"),
  status: z.enum(["AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED"]).default("AVAILABLE"),
  supplierId: optStr(40),
  warehouseId: optStr(40),
  location: optStr(160),
  custodian: optStr(160),
  ownerCompanyId: optStr(40),
  acquisitionDate: optDate,
  acquisitionValue: optNum,
  notes: optStr(2000),
  active: z.boolean().default(true),
});

export type AssetInput = z.infer<typeof assetSchema>;

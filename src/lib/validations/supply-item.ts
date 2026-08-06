import { z } from "zod";

export const SUPPLY_ITEM_TYPES = ["MATERIAL", "INSUMO", "PATRIMONIO", "CLIENT_EQUIPMENT", "SERVICE", "KIT"] as const;
export const PROPERTY_NATURES = ["OWN", "CLIENT", "THIRD_PARTY", "RESALE"] as const;

const optStr = (max: number) => z.string().trim().max(max).optional().default("");
const emptyToUndef = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const optNum = z.preprocess(emptyToUndef, z.coerce.number().finite().nonnegative().optional());
const optInt = z.preprocess(emptyToUndef, z.coerce.number().int().nonnegative().optional());

export const supplyItemSchema = z.object({
  // Identificação
  code: optStr(60),
  description: z.string().trim().min(1).max(240),
  shortName: optStr(120),
  unit: optStr(20),
  category: optStr(120),
  brand: optStr(120),
  model: optStr(120),
  barcode: optStr(60),
  ncm: optStr(20),
  manufacturerCode: optStr(60),
  // Classificação
  type: z.enum(["MATERIAL", "INSUMO", "PATRIMONIO", "CLIENT_EQUIPMENT", "SERVICE", "KIT"]).default("MATERIAL"),
  nature: z.enum(["OWN", "CLIENT", "THIRD_PARTY", "RESALE"]).default("OWN"),
  controlsStock: z.boolean().default(true),
  controlsLot: z.boolean().default(false),
  controlsValidity: z.boolean().default(false),
  individualControl: z.boolean().default(false),
  canSell: z.boolean().default(false),
  canRent: z.boolean().default(false),
  canReserve: z.boolean().default(true),
  requiresCalibration: z.boolean().default(false),
  requiresMaintenance: z.boolean().default(false),
  critical: z.boolean().default(false),
  // Suprimento e custo
  supplierId: optStr(40),
  leadTimeDays: optInt,
  minStock: optNum,
  maxStock: optNum,
  reorderPoint: optNum,
  lastCost: optNum,
  avgCost: optNum,
  salePrice: optNum,
  rentPrice: optNum,
  costCenter: optStr(80),
  // Armazenamento
  defaultWarehouse: optStr(120),
  location: optStr(120),
  shelf: optStr(60),
  weight: optNum,
  dimensions: optStr(80),
  hazardous: z.boolean().default(false),
  logisticsNotes: optStr(2000),
  // Conformidade
  calibrationPeriodMonths: optInt,
  maintenancePeriodMonths: optInt,
  warningDays: optInt,
  measurementRange: optStr(120),
  resolution: optStr(120),
  notes: optStr(2000),
  active: z.boolean().default(true),
});

export type SupplyItemInput = z.infer<typeof supplyItemSchema>;

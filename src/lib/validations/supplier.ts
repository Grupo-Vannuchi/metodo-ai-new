import { z } from "zod";

export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(160),
  tradeName: z.string().trim().max(160).optional().default(""),
  document: z.string().trim().max(32).optional().default(""),
  email: z.string().trim().max(160).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  contactName: z.string().trim().max(120).optional().default(""),
  city: z.string().trim().max(80).optional().default(""),
  uf: z.string().trim().max(2).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  active: z.boolean().optional().default(true),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

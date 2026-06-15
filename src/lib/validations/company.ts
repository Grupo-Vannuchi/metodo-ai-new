import { z } from "zod";

const optional = z.string().trim().max(200).optional().or(z.literal(""));

export const companySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(160),
  cnpj: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("E-mail inválido.").max(200).optional().or(z.literal("")),
  phone: optional,
  website: z.string().trim().url("URL inválida.").max(300).optional().or(z.literal("")),
  street: optional,
  city: optional,
  uf: z.string().trim().max(2).optional().or(z.literal("")),
  zip: z.string().trim().max(12).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type CompanyInput = z.infer<typeof companySchema>;

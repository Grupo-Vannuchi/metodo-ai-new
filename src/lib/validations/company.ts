import { z } from "zod";

const optional = z.string().trim().max(200).optional().or(z.literal(""));

/** Websites are usually typed without a scheme ("www.site.com"). Prepend
 * https:// so the URL validates instead of failing the whole form. */
const website = z.preprocess((v) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}, z.string().url("URL inválida.").max(300).optional().or(z.literal("")));

export const companySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(160),
  cnpj: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("E-mail inválido.").max(200).optional().or(z.literal("")),
  phone: optional,
  website,
  street: optional,
  city: optional,
  uf: z.string().trim().max(2).optional().or(z.literal("")),
  zip: z.string().trim().max(12).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type CompanyInput = z.infer<typeof companySchema>;

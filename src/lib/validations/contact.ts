import { z } from "zod";

const optional = z.string().trim().max(200).optional().or(z.literal(""));

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(160),
  email: z.string().trim().email("E-mail inválido.").max(200).optional().or(z.literal("")),
  phone: optional,
  role: optional,
  companyId: z.string().trim().max(40).optional().or(z.literal("")),
  /** Comma-separated in the form; normalized to an array before persisting. */
  tags: z.string().trim().max(300).optional().or(z.literal("")),
});

export type ContactInput = z.infer<typeof contactSchema>;

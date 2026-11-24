import { z } from "zod";
import { isValidBrPhone } from "@/lib/phone";
import { isValidCPF } from "@/lib/document";

const optional = z.string().trim().max(200).optional().or(z.literal(""));

/**
 * The manual contact form (create and edit). A contact must belong to a company or carry a CPF (request of
 * 10/09/2026); imports and the contacts WhatsApp creates don't go through this schema and may have neither.
 */
export const contactSchema = z
  .object({
    name: z.string().trim().min(1, "Informe o nome.").max(160),
    email: z.string().trim().email("E-mail inválido.").max(200).optional().or(z.literal("")),
    phone: z.string().trim().max(20).refine(isValidBrPhone, "Telefone inválido."),
    role: optional,
    companyId: z.string().trim().max(40).optional().or(z.literal("")),
    /** CPF as typed (mask allowed); stored as digits only. */
    cpf: z
      .string()
      .trim()
      .max(14)
      .optional()
      .or(z.literal(""))
      .refine((v) => !v || isValidCPF(v), "CPF inválido."),
    /** Comma-separated in the form; normalized to an array before persisting. */
    tags: z.string().trim().max(300).optional().or(z.literal("")),
    /** LGPD opt-out (excluded from campaigns). */
    optedOut: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.companyId && !data.cpf) {
      ctx.addIssue({ code: "custom", path: ["cpf"], message: "Informe a empresa ou o CPF do contato." });
    }
  });

export type ContactInput = z.infer<typeof contactSchema>;

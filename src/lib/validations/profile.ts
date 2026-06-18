import { z } from "zod";
import { isValidBrPhone } from "@/lib/phone";
import { isValidDocument } from "@/lib/document";

/**
 * User profile validation. The "core" fields (phone + document) are required at
 * account creation (signup / invite acceptance); the full schema covers the
 * editable profile tab. Runs on the client and re-runs on the server.
 */

export const documentTypeEnum = z.enum(["CPF", "CNPJ"]);

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

/** Shape of the fields captured at account creation (merged into auth schemas). */
export const coreProfileShape = {
  phone: z
    .string()
    .trim()
    .min(1, "Informe o telefone.")
    .max(20)
    .refine(isValidBrPhone, "Telefone inválido."),
  documentType: documentTypeEnum,
  document: z.string().trim().min(1, "Informe o documento.").max(20),
};

/** Cross-field check: the document must be a valid CPF/CNPJ for its type. */
export function refineDocument(
  data: { documentType?: "CPF" | "CNPJ"; document?: string },
  ctx: z.RefinementCtx,
): void {
  if (data.documentType && data.document && !isValidDocument(data.documentType, data.document)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["document"],
      message: data.documentType === "CPF" ? "CPF inválido." : "CNPJ inválido.",
    });
  }
}

/** Full editable profile (profile tab). Address/position/etc. are optional. */
export const profileSchema = z
  .object({
    name: z.string().trim().min(2, "Informe seu nome.").max(120),
    ...coreProfileShape,
    position: optionalText(120),
    birthDate: optionalText(10), // yyyy-mm-dd from <input type="date">
    avatarUrl: z.string().trim().url("URL inválida.").max(500).optional().or(z.literal("")),
    addressZip: optionalText(12),
    addressStreet: optionalText(160),
    addressNumber: optionalText(20),
    addressCity: optionalText(120),
    addressState: optionalText(2),
  })
  .superRefine(refineDocument);

export type ProfileInput = z.infer<typeof profileSchema>;

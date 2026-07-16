import { z } from "zod";
import { coreProfileShape, refineDocument } from "./profile";

/**
 * Auth validation schemas. Run on the client (react-hook-form) and re-run on the
 * server (security boundary) — see PLANO.md §11, rule 3.
 *
 * Signup and invite acceptance also capture the core profile fields (phone +
 * CPF/CNPJ) so every account is created with a complete profile.
 */

export const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export const signupSchema = z
  .object({
    name: z.string().trim().min(2, "Informe seu nome.").max(120),
    email: z.string().trim().email("E-mail inválido.").max(200),
    password: z
      .string()
      .min(8, "A senha deve ter ao menos 8 caracteres.")
      .max(200),
    organizationName: z
      .string()
      .trim()
      .min(2, "Informe o nome da organização.")
      .max(120),
    ...coreProfileShape,
  })
  .superRefine(refineDocument);

export const acceptInviteSchema = z
  .object({
    name: z.string().trim().min(2, "Informe seu nome.").max(120),
    password: z
      .string()
      .min(8, "A senha deve ter ao menos 8 caracteres.")
      .max(200),
    ...coreProfileShape,
  })
  .superRefine(refineDocument);

/** "Forgot password" — just the e-mail to send the reset link to. */
export const emailOnlySchema = z.object({
  email: z.string().trim().email().max(200),
});

/** Choosing a new password from a reset link. */
export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1).max(200),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres.").max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

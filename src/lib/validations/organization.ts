import { z } from "zod";

/** A member can be invited as ADMIN or MEMBER (ownership is not transferable here). */
export const invitableRoles = ["ADMIN", "MEMBER"] as const;

export const inviteSchema = z.object({
  email: z.string().trim().email("E-mail inválido.").max(200),
  role: z.enum(invitableRoles).default("MEMBER"),
});

export type InviteInput = z.infer<typeof inviteSchema>;

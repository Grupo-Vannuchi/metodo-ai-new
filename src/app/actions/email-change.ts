"use server";

import { z } from "zod";
import { hasLocale } from "next-intl";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/tenant";
import { verifyPassword } from "@/lib/password";
import { consumeAuthToken } from "@/lib/auth-tokens";
import { sendEmailChangeVerification } from "@/lib/auth-email";
import { defaultLocale, routing } from "@/i18n/routing";

export type EmailChangeResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "invalid" | "same" | "taken" | "wrong_password" | "unknown" };

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().optional(),
});

/**
 * Request an e-mail change (double opt-in). Verifies the current password when
 * the account has one, checks the new address is free, stores it as
 * `pendingEmail` and sends a confirmation link TO the new address. Nothing
 * changes until that link is confirmed (see `confirmEmailChange`).
 */
export async function requestEmailChange(formData: FormData): Promise<EmailChangeResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = requestSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const newEmail = parsed.data.email;

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { name: true, email: true, passwordHash: true },
  });
  if (!user) return { ok: false, error: "unauthorized" };

  if (newEmail === user.email.toLowerCase()) return { ok: false, error: "same" };

  // Re-authenticate with the current password when the account has one.
  if (user.passwordHash) {
    const password = parsed.data.password ?? "";
    if (!password || !(await verifyPassword(password, user.passwordHash))) {
      return { ok: false, error: "wrong_password" };
    }
  }

  // The address must not already belong to another account.
  const existing = await prisma.user.findFirst({
    where: { email: newEmail, NOT: { id: ctx.userId } },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "taken" };

  try {
    await prisma.user.update({ where: { id: ctx.userId }, data: { pendingEmail: newEmail } });
    await sendEmailChangeVerification(ctx.userId, user.name, newEmail);
    revalidatePath("/app/settings/profile");
    return { ok: true };
  } catch (error) {
    console.error("Failed to request email change", error);
    return { ok: false, error: "unknown" };
  }
}

/** Cancel a pending e-mail change (drops the stored pendingEmail). */
export async function cancelEmailChange(): Promise<EmailChangeResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    await prisma.$transaction([
      prisma.user.update({ where: { id: ctx.userId }, data: { pendingEmail: null } }),
      prisma.authToken.deleteMany({ where: { userId: ctx.userId, purpose: "EMAIL_CHANGE", consumedAt: null } }),
    ]);
    revalidatePath("/app/settings/profile");
    return { ok: true };
  } catch (error) {
    console.error("Failed to cancel email change", error);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Confirm an e-mail change from the link sent to the new address. No session is
 * required — the single-use token is the proof. Applies `pendingEmail` to
 * `email`, marks it verified and clears the pending state. Re-checks uniqueness
 * at confirmation time (someone may have claimed the address in the meantime).
 */
export async function confirmEmailChange(
  token: string,
  localeStr: string,
): Promise<{ ok: true; email: string } | { ok: false; error: "invalid" | "taken" }> {
  // Locale kept for parity with other confirm flows / future redirects.
  void (hasLocale(routing.locales, localeStr) ? localeStr : defaultLocale);

  const userId = await consumeAuthToken(token, "EMAIL_CHANGE");
  if (!userId) return { ok: false, error: "invalid" };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pendingEmail: true } });
  if (!user?.pendingEmail) return { ok: false, error: "invalid" };
  const newEmail = user.pendingEmail;

  const taken = await prisma.user.findFirst({
    where: { email: newEmail, NOT: { id: userId } },
    select: { id: true },
  });
  if (taken) {
    await prisma.user.update({ where: { id: userId }, data: { pendingEmail: null } });
    return { ok: false, error: "taken" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { email: newEmail, pendingEmail: null, emailVerified: new Date() },
  });
  return { ok: true, email: newEmail };
}

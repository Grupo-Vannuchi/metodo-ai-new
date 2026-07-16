"use server";

import { hasLocale } from "next-intl";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { hashPassword } from "@/lib/password";
import { makeRateLimiter } from "@/lib/ratelimit";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email/send";
import { renderPasswordResetEmail } from "@/lib/email/templates";
import { consumeAuthToken, issueAuthToken, RESET_TTL_MS } from "@/lib/auth-tokens";
import { sendVerificationEmail, sendWelcomeEmail } from "@/lib/auth-email";
import { emailOnlySchema, resetPasswordSchema } from "@/lib/validations/auth";
import { redirect } from "@/i18n/navigation";
import { defaultLocale, routing } from "@/i18n/routing";

/**
 * Confirm an e-mail from the verification link. On success it verifies the
 * account, sends the welcome e-mail and signs the user in (the link came from a
 * confirm button, not a GET, so this can't be triggered by an e-mail scanner).
 * Returns an error only on a bad/expired/used token.
 */
export async function verifyEmail(token: string, localeStr: string): Promise<{ error: "invalid" }> {
  const locale = hasLocale(routing.locales, localeStr) ? localeStr : defaultLocale;

  const userId = await consumeAuthToken(token, "EMAIL_VERIFICATION");
  if (!userId) return { error: "invalid" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!user) return { error: "invalid" };

  await prisma.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
  await sendWelcomeEmail(user.name, user.email);

  const membership = user.memberships[0];
  if (membership) {
    await createSession({
      userId: user.id,
      organizationId: membership.organizationId,
      role: membership.role,
    });
    redirect({ href: "/app", locale });
  } else {
    redirect({ href: "/login", locale });
  }
  throw new Error("unreachable: redirect halts execution");
}

/**
 * Resend the verification e-mail. Anti-enumeration: always reports success and
 * only actually sends when the address maps to an unverified account. Rate-
 * limited to curb abuse.
 */
export async function resendVerification(email: string): Promise<{ ok: true }> {
  const parsed = emailOnlySchema.safeParse({ email });
  if (!parsed.success) return { ok: true };

  const limiter = makeRateLimiter("verify-resend", 3, 300);
  if (limiter) {
    const { success } = await limiter.limit(parsed.data.email.toLowerCase());
    if (!success) return { ok: true };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, name: true, email: true, emailVerified: true },
  });
  if (user && !user.emailVerified) {
    await sendVerificationEmail(user.id, user.name, user.email);
  }
  return { ok: true };
}

/**
 * Start a password reset. Anti-enumeration: always reports success; only sends
 * when the address exists. Rate-limited.
 */
export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const parsed = emailOnlySchema.safeParse({ email });
  if (!parsed.success) return { ok: true };

  const limiter = makeRateLimiter("pw-reset", 3, 300);
  if (limiter) {
    const { success } = await limiter.limit(parsed.data.email.toLowerCase());
    if (!success) return { ok: true };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, name: true, email: true },
  });
  if (user) {
    const token = await issueAuthToken(user.id, "PASSWORD_RESET", RESET_TTL_MS);
    const { subject, html } = renderPasswordResetEmail({
      name: user.name,
      resetUrl: `${env.NEXT_PUBLIC_SITE_URL}/reset/${token}`,
    });
    await sendEmail({ to: user.email, subject, html });
  }
  return { ok: true };
}

/**
 * Set a new password from a reset link. Consuming the token also verifies the
 * e-mail (a valid reset proves ownership of the address).
 */
export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: "invalid" | "weak" }> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "weak" };

  const userId = await consumeAuthToken(parsed.data.token, "PASSWORD_RESET");
  if (!userId) return { ok: false, error: "invalid" };

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  // A successful reset proves the address — verify it if it wasn't already.
  await prisma.user.updateMany({
    where: { id: userId, emailVerified: null },
    data: { emailVerified: new Date() },
  });
  return { ok: true };
}

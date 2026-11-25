"use server";

import { hasLocale } from "next-intl";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";
import { makeRateLimiter } from "@/lib/ratelimit";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email/send";
import { renderPasswordResetEmail } from "@/lib/email/templates";
import { consumeAuthToken, issueAuthToken, peekAuthToken, RESET_TTL_MS } from "@/lib/auth-tokens";
import { sendVerificationEmail, sendWelcomeEmail } from "@/lib/auth-email";
import { emailOnlySchema, resetPasswordSchema } from "@/lib/validations/auth";
import { redirect } from "@/i18n/navigation";
import { defaultLocale, routing } from "@/i18n/routing";

/**
 * Confirm an e-mail from the verification link. On success it verifies the
 * account, sends the welcome e-mail and signs the user in (the link came from a
 * confirm button, not a GET, so this can't be triggered by an e-mail scanner).
 *
 * An account with a password confirms only with it. Whoever created the account chose the password; the owner of the
 * inbox may be someone else (a signup with another person's address, or an invite accepted by whoever sent it), and a
 * click alone would confirm the account with a password the owner doesn't know. That owner can't confirm and gets the
 * account back through "Esqueci a senha" (the reset confirms the address and ends every session). A wrong password does
 * not spend the link; attempts per link are limited.
 */
export async function verifyEmail(
  token: string,
  password: string,
  localeStr: string,
): Promise<{ error: "invalid" | "wrong_password" | "rate_limited" }> {
  const locale = hasLocale(routing.locales, localeStr) ? localeStr : defaultLocale;
  if (typeof token !== "string" || typeof password !== "string" || password.length > 200) return { error: "invalid" };

  const owner = await peekAuthToken(token, "EMAIL_VERIFICATION");
  if (!owner) return { error: "invalid" };
  const limiter = makeRateLimiter("verify-email", 10, 600);
  if (limiter) {
    const { success } = await limiter.limit(owner);
    if (!success) return { error: "rate_limited" };
  }
  const account = await prisma.user.findUnique({ where: { id: owner }, select: { passwordHash: true } });
  if (account?.passwordHash && !(await verifyPassword(password, account.passwordHash))) {
    return { error: "wrong_password" };
  }

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
  // A reset ends every session signed so far (src/lib/session.ts): whoever was in with the old password is out.
  await prisma.user.update({ where: { id: userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
  // A successful reset proves the address — verify it if it wasn't already.
  await prisma.user.updateMany({
    where: { id: userId, emailVerified: null },
    data: { emailVerified: new Date() },
  });
  return { ok: true };
}

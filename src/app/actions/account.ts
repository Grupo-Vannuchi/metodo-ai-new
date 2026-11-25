"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/tenant";
import { createSession, revokeUserSessions } from "@/lib/session";
import { makeRateLimiter } from "@/lib/ratelimit";
import { issueAuthToken, RESET_TTL_MS } from "@/lib/auth-tokens";
import { renderPasswordResetEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/lib/password";
import { changePasswordSchema } from "@/lib/validations/auth";

export type PasswordResult =
  | { ok: true; hadPassword: boolean }
  | { ok: false; error: "unauthorized" | "invalid" | "current_required" | "current_invalid" | "use_link" | "unknown" };

/**
 * Change (or first-set) the signed-in user's password from the Security tab.
 * Accounts that already have a password must supply and match the current one;
 * Google-only accounts (no password yet) may set one without a current password.
 */
export async function changePassword(formData: FormData): Promise<PasswordResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { passwordHash: true },
    });
    if (!user) return { ok: false, error: "unauthorized" };

    const hadPassword = Boolean(user.passwordHash);
    // An account without a password (Google/Microsoft only) sets its first one through a link sent to its inbox
    // (sendSetPasswordLink), never here: a session alone would let whoever holds it add a password and keep the account.
    if (!hadPassword) return { ok: false, error: "use_link" };
    const current = parsed.data.currentPassword ?? "";
    if (!current) return { ok: false, error: "current_required" };
    const valid = await verifyPassword(current, user.passwordHash!);
    if (!valid) return { ok: false, error: "current_invalid" };

    const passwordHash = await hashPassword(parsed.data.password);
    // A new password ends every other session (one opened with the old password, or copied, stops working); this device
    // gets a fresh session signed with the new version.
    await prisma.user.update({
      where: { id: ctx.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    await createSession({ userId: ctx.userId, organizationId: ctx.organizationId, role: ctx.role });
    revalidatePath("/app/settings/profile");
    return { ok: true, hadPassword };
  } catch (error) {
    console.error("Failed to change password", error);
    return { ok: false, error: "unknown" };
  }
}

/**
 * First password of an account that signs in only with Google/Microsoft: sends the password link to the account's own
 * e-mail (the same "redefinir senha" link, which also ends every session when used). Whoever holds the session but not the
 * inbox can't set it. Limited to 3 links per 5 minutes per account.
 */
export async function sendSetPasswordLink(): Promise<{ ok: true; email: string } | { ok: false; error: "unauthorized" | "has_password" | "rate_limited" | "unknown" }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true, passwordHash: true } });
    if (!user) return { ok: false, error: "unauthorized" };
    if (user.passwordHash) return { ok: false, error: "has_password" };
    const limiter = makeRateLimiter("set-password-link", 3, 300);
    if (limiter) {
      const { success } = await limiter.limit(ctx.userId);
      if (!success) return { ok: false, error: "rate_limited" };
    }
    const token = await issueAuthToken(ctx.userId, "PASSWORD_RESET", RESET_TTL_MS);
    const { subject, html } = renderPasswordResetEmail({ name: user.name, resetUrl: `${env.NEXT_PUBLIC_SITE_URL}/reset/${token}` });
    await sendEmail({ to: user.email, subject, html });
    return { ok: true, email: user.email };
  } catch (error) {
    console.error("Failed to send the set-password link", error);
    return { ok: false, error: "unknown" };
  }
}

/**
 * "Sair dos outros aparelhos": ends every session of the signed-in user except this one (src/lib/session.ts raises the
 * user's session version; this device gets a fresh session). For a lost phone, a shared computer, a suspicion.
 */
export async function signOutOtherDevices(): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    await revokeUserSessions(ctx.userId);
    await createSession({ userId: ctx.userId, organizationId: ctx.organizationId, role: ctx.role });
    return { ok: true };
  } catch (error) {
    console.error("Failed to sign out other devices", error);
    return { ok: false };
  }
}

export type UnlinkResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "not_found" | "last_method" | "unknown" };

/**
 * Unlink an OAuth identity (e.g. Google). Guarded so the user can never lock
 * themselves out: refuses if this would leave the account with no way to sign
 * in (no password AND no other linked provider).
 */
export async function unlinkAccount(accountId: string): Promise<UnlinkResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  try {
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: {
        passwordHash: true,
        accounts: { select: { id: true } },
      },
    });
    if (!user) return { ok: false, error: "unauthorized" };

    // The account must belong to the signed-in user (ownership boundary).
    if (!user.accounts.some((a) => a.id === accountId)) {
      return { ok: false, error: "not_found" };
    }

    const otherSignIn = Boolean(user.passwordHash) || user.accounts.length > 1;
    if (!otherSignIn) return { ok: false, error: "last_method" };

    await prisma.account.delete({ where: { id: accountId } });
    revalidatePath("/app/settings/profile");
    return { ok: true };
  } catch (error) {
    console.error("Failed to unlink account", error);
    return { ok: false, error: "unknown" };
  }
}

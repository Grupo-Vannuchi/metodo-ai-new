"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/tenant";
import { hashPassword, verifyPassword } from "@/lib/password";
import { changePasswordSchema } from "@/lib/validations/auth";

export type PasswordResult =
  | { ok: true; hadPassword: boolean }
  | { ok: false; error: "unauthorized" | "invalid" | "current_required" | "current_invalid" | "unknown" };

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
    if (hadPassword) {
      const current = parsed.data.currentPassword ?? "";
      if (!current) return { ok: false, error: "current_required" };
      const valid = await verifyPassword(current, user.passwordHash!);
      if (!valid) return { ok: false, error: "current_invalid" };
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.update({ where: { id: ctx.userId }, data: { passwordHash } });
    revalidatePath("/app/settings/profile");
    return { ok: true, hadPassword };
  } catch (error) {
    console.error("Failed to change password", error);
    return { ok: false, error: "unknown" };
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

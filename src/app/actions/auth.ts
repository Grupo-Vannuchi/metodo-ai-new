"use server";

import { hasLocale } from "next-intl";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSession, deleteSession } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";
import { slugify } from "@/lib/slug";
import { createDefaultPipeline } from "@/lib/default-pipeline";
import { coreProfileData } from "@/lib/profile";
import { makeRateLimiter } from "@/lib/ratelimit";
import { sendVerificationEmail } from "@/lib/auth-email";
import { PLANS } from "@/config/plans";
import { loginSchema, signupSchema } from "@/lib/validations/auth";
import { redirect } from "@/i18n/navigation";
import { defaultLocale, routing, type Locale } from "@/i18n/routing";

/** Error codes returned to the form; the client maps them to translated copy. */
export type AuthState = {
  error: "invalid" | "email_taken" | "generic" | "rate_limited" | "email_not_verified" | null;
  /** Signup succeeded but the account must confirm its e-mail before logging in. */
  needsVerification?: boolean;
  /** Carries the typed e-mail so the form can offer "resend verification". */
  email?: string;
};

function localeFrom(formData: FormData): Locale {
  const value = String(formData.get("locale") ?? "");
  return hasLocale(routing.locales, value) ? value : defaultLocale;
}

/** Build a slug that is unique across organizations. */
async function uniqueOrgSlug(name: string): Promise<string> {
  const base = slugify(name) || "org";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await prisma.organization.findUnique({ where: { slug } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Authenticate a user (react `useActionState` signature). On success it creates
 * the session bound to the user's first organization and redirects to the app;
 * on failure it returns a generic error (no user enumeration).
 */
export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const locale = localeFrom(formData);

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "invalid" };

  // Throttle login attempts per email (5/min). Degrades to allow when Redis
  // isn't configured (local dev).
  const limiter = makeRateLimiter("login", 5, 60);
  if (limiter) {
    const { success } = await limiter.limit(parsed.data.email.toLowerCase());
    if (!success) return { error: "rate_limited" };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: {
      memberships: { orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (!user) return { error: "invalid" };

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) return { error: "invalid" };

  // Rigid gate: the e-mail must be confirmed before the first login. Revealed
  // only after the password checks out, so it isn't a user-enumeration vector.
  if (!user.emailVerified) {
    return { error: "email_not_verified", email: user.email };
  }

  const membership = user.memberships[0];
  if (!membership) return { error: "generic" };

  await createSession({
    userId: user.id,
    organizationId: membership.organizationId,
    role: membership.role,
  });
  redirect({ href: "/app", locale });
  throw new Error("unreachable: redirect halts execution");
}

/**
 * Sign up: create the user, their first organization and an OWNER membership in
 * one transaction, then open a session and redirect into the app.
 */
export async function signup(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    organizationName: formData.get("organizationName"),
    phone: formData.get("phone"),
    documentType: formData.get("documentType"),
    document: formData.get("document"),
  });
  if (!parsed.success) return { error: "invalid" };

  const { name, email, password, organizationName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "email_taken" };

  const passwordHash = await hashPassword(password);
  const slug = await uniqueOrgSlug(organizationName);

  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: organizationName,
          slug,
          plan: "STANDARD",
          seatLimit: PLANS.STANDARD.seatLimit,
        },
      });
      const user = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          // emailVerified stays null — the account is gated until confirmed.
          profile: { create: coreProfileData(parsed.data) },
        },
      });
      await tx.membership.create({
        data: { organizationId: org.id, userId: user.id, role: "OWNER" },
      });
      await createDefaultPipeline(tx, org.id);
      return user.id;
    });
  } catch (e) {
    // Unique violation on email between the check and the insert.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "email_taken" };
    }
    console.error("Signup failed", e);
    return { error: "generic" };
  }

  // Rigid gate: no session yet. Send the confirmation link and ask them to
  // verify before logging in.
  await sendVerificationEmail(userId, name, email);
  return { error: null, needsVerification: true, email };
}

/** Clear the session and return to the login screen. */
export async function logout(locale: Locale): Promise<void> {
  await deleteSession();
  redirect({ href: "/login", locale });
}

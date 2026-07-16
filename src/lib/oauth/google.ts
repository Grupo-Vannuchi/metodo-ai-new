import "server-only";
import { Google } from "arctic";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { createDefaultPipeline } from "@/lib/default-pipeline";
import { PLANS } from "@/config/plans";
import type { SessionPayload } from "@/lib/session";

/** The OAuth callback the app handles (must match the Google console exactly). */
export const GOOGLE_REDIRECT_PATH = "/api/auth/google/callback";

export function isGoogleConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function googleClient(): Google {
  return new Google(
    env.GOOGLE_CLIENT_ID!,
    env.GOOGLE_CLIENT_SECRET!,
    `${env.NEXT_PUBLIC_SITE_URL}${GOOGLE_REDIRECT_PATH}`,
  );
}

export type GoogleUser = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

/** Fetch the OpenID Connect profile with the access token. */
export async function fetchGoogleUser(accessToken: string): Promise<GoogleUser | null> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const c = (await res.json().catch(() => null)) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  } | null;
  if (!c?.sub || !c.email) return null;
  return {
    sub: String(c.sub),
    email: String(c.email).toLowerCase(),
    emailVerified: Boolean(c.email_verified),
    name: (c.name || c.email) as string,
  };
}

/** A slug unique across organizations (mirrors the signup flow). */
async function uniqueOrgSlug(name: string): Promise<string> {
  const base = slugify(name) || "org";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await prisma.organization.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base}-${Date.now()}`;
}

async function firstMembership(userId: string): Promise<SessionPayload | null> {
  const m = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  return m ? { userId, organizationId: m.organizationId, role: m.role } : null;
}

export type ResolveResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; error: "unverified" | "no_membership" };

/**
 * Map a Google identity to a session:
 *  1. reuse the already-linked account;
 *  2. link to an existing user with the same (verified) e-mail — only when
 *     Google verified it, to avoid account takeover;
 *  3. otherwise provision a fresh user + default organization.
 */
export async function resolveGoogleSession(gu: GoogleUser): Promise<ResolveResult> {
  // 1. Existing linked account → just sign in.
  const account = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: "google", providerAccountId: gu.sub } },
    select: { userId: true },
  });
  if (account) {
    const s = await firstMembership(account.userId);
    return s ? { ok: true, session: s } : { ok: false, error: "no_membership" };
  }

  // We only trust the e-mail (for linking/creation) when Google verified it.
  if (!gu.emailVerified) return { ok: false, error: "unverified" };

  // 2. Existing user with this e-mail → link the Google identity to it.
  const existing = await prisma.user.findUnique({
    where: { email: gu.email },
    select: { id: true, emailVerified: true },
  });
  if (existing) {
    await prisma.$transaction([
      prisma.account.create({
        data: { userId: existing.id, provider: "google", providerAccountId: gu.sub },
      }),
      ...(existing.emailVerified
        ? []
        : [prisma.user.update({ where: { id: existing.id }, data: { emailVerified: new Date() } })]),
    ]);
    const s = await firstMembership(existing.id);
    return s ? { ok: true, session: s } : { ok: false, error: "no_membership" };
  }

  // 3. Brand-new user → provision user + a default org (OWNER) + pipeline.
  const slug = await uniqueOrgSlug(gu.name);
  const session = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: gu.name, slug, plan: "STANDARD", seatLimit: PLANS.STANDARD.seatLimit },
    });
    const user = await tx.user.create({
      // No passwordHash — this account signs in via Google only.
      data: { name: gu.name, email: gu.email, emailVerified: new Date() },
    });
    await tx.account.create({
      data: { userId: user.id, provider: "google", providerAccountId: gu.sub },
    });
    await tx.membership.create({
      data: { organizationId: org.id, userId: user.id, role: "OWNER" },
    });
    await createDefaultPipeline(tx, org.id);
    return { userId: user.id, organizationId: org.id, role: "OWNER" as const };
  });
  return { ok: true, session };
}

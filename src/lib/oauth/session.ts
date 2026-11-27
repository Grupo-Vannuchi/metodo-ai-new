import "server-only";
import { prisma } from "@/lib/prisma";
import { findUserIdByEmail, normalizeEmail } from "@/lib/user-email";
import { slugify } from "@/lib/slug";
import { createDefaultPipeline } from "@/lib/default-pipeline";
import type { SessionPayload } from "@/lib/session";
import type { OAuthProvider } from "@/lib/oauth/shared";
import type { OAuthProfile } from "@/lib/oauth/providers";

/**
 * Maps a provider identity onto our own users/sessions. Provider-agnostic: the
 * `Account` table keys on (provider, providerAccountId), so every provider goes
 * through exactly this path.
 */

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

export type LinkResult = { ok: true } | { ok: false; error: "taken" };

/**
 * Link a provider identity to an already-signed-in user (the "Conectar" buttons
 * on the profile). Idempotent when it's already linked to this same user;
 * refuses when that identity belongs to someone else. Leaves the session alone —
 * the caller stays logged in as themselves.
 */
export async function linkOAuthAccount(
  userId: string,
  provider: OAuthProvider,
  profile: OAuthProfile,
): Promise<LinkResult> {
  const existing = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: profile.sub } },
    select: { userId: true },
  });
  if (existing) {
    return existing.userId === userId ? { ok: true } : { ok: false, error: "taken" };
  }
  await prisma.account.create({
    data: { userId, provider, providerAccountId: profile.sub },
  });
  return { ok: true };
}

/**
 * Map a provider identity to a session:
 *  1. reuse the already-linked account;
 *  2. link to an existing user with the same (verified) e-mail — only when the
 *     provider verified it, to avoid account takeover;
 *  3. otherwise provision a fresh user + default organization.
 */
export async function resolveOAuthSession(
  provider: OAuthProvider,
  profile: OAuthProfile,
): Promise<ResolveResult> {
  // 1. Existing linked account → just sign in.
  const account = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: profile.sub } },
    select: { userId: true },
  });
  if (account) {
    const s = await firstMembership(account.userId);
    return s ? { ok: true, session: s } : { ok: false, error: "no_membership" };
  }

  // We only trust the e-mail (for linking/creation) when the provider verified it.
  if (!profile.emailVerified) return { ok: false, error: "unverified" };

  // 2. Existing user with this e-mail (in any case: an account saved as "Fulano@…" before 27/11/2026
  // is the same inbox) → link the identity to it.
  const existingId = await findUserIdByEmail(profile.email);
  const existing = existingId
    ? await prisma.user.findUnique({ where: { id: existingId }, select: { id: true, emailVerified: true } })
    : null;
  if (existing) {
    await prisma.$transaction([
      prisma.account.create({
        data: { userId: existing.id, provider, providerAccountId: profile.sub },
      }),
      // The address was never confirmed on this account, and the provider has just proven who owns
      // it. A password set before that was not proven to be the owner's, so it is dropped; the owner
      // sets a new one through "Esqueci a senha" if they want one.
      ...(existing.emailVerified
        ? []
        : [
            prisma.user.update({
              where: { id: existing.id },
              // And any session signed for it so far ends (src/lib/session.ts): it came from that unproven password.
              data: { emailVerified: new Date(), passwordHash: null, sessionVersion: { increment: 1 } },
            }),
          ]),
    ]);
    const s = await firstMembership(existing.id);
    return s ? { ok: true, session: s } : { ok: false, error: "no_membership" };
  }

  // 3. Brand-new user → provision user + a default org (OWNER) + pipeline.
  const slug = await uniqueOrgSlug(profile.name);
  const session = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: profile.name, slug },
    });
    const user = await tx.user.create({
      // No passwordHash — this account signs in through the provider only.
      data: { name: profile.name, email: normalizeEmail(profile.email), emailVerified: new Date() },
    });
    await tx.account.create({
      data: { userId: user.id, provider, providerAccountId: profile.sub },
    });
    await tx.membership.create({
      data: { organizationId: org.id, userId: user.id, role: "OWNER" },
    });
    await createDefaultPipeline(tx, org.id);
    return { userId: user.id, organizationId: org.id, role: "OWNER" as const };
  });
  return { ok: true, session };
}

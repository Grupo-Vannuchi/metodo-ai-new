"use server";

import { hasLocale } from "next-intl";
import { prisma } from "@/lib/prisma";
import { createSession, getSession } from "@/lib/session";
import { getOrgContext, assertRole } from "@/lib/tenant";
import { hashPassword } from "@/lib/password";
import {
  generateInvitationToken,
  hashInvitationToken,
  INVITATION_TTL_MS,
} from "@/lib/invitations";
import { countMembers } from "@/lib/queries/organizations";
import { inviteSchema } from "@/lib/validations/organization";
import { acceptInviteSchema } from "@/lib/validations/auth";
import { redirect } from "@/i18n/navigation";
import { revalidatePath } from "next/cache";
import { defaultLocale, routing, type Locale } from "@/i18n/routing";

function localeFrom(formData: FormData): Locale {
  const value = String(formData.get("locale") ?? "");
  return hasLocale(routing.locales, value) ? value : defaultLocale;
}

/**
 * Switch the active organization. Re-issues the session bound to the chosen org
 * (only if the user actually belongs to it — the security check).
 */
export async function switchOrganization(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const organizationId = String(formData.get("organizationId") ?? "");

  const session = await getSession();
  if (!session) {
    redirect({ href: "/login", locale });
    return;
  }

  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: session.userId },
    },
    select: { role: true },
  });
  // Silently ignore a switch to an org the user isn't a member of.
  if (membership) {
    await createSession({
      userId: session.userId,
      organizationId,
      role: membership.role,
    });
  }
  revalidatePath("/app");
  redirect({ href: "/app", locale });
}

export type InviteState = {
  error: "forbidden" | "invalid" | "seat_limit" | "already_member" | "generic" | null;
  token?: string;
};

/**
 * Create an invitation to the current organization (ADMIN+). Returns the raw
 * token so the UI can surface the invite link; email delivery lands in a later
 * phase.
 */
export async function inviteMember(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const ctx = await getOrgContext();
  if (!ctx) return { error: "forbidden" };
  try {
    assertRole(ctx, "ADMIN");
  } catch {
    return { error: "forbidden" };
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role") ?? "MEMBER",
  });
  if (!parsed.success) return { error: "invalid" };

  // Seat limit: refuse if the org is already full.
  const members = await countMembers(ctx.organizationId);
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { seatLimit: true },
  });
  if (org && members >= org.seatLimit) return { error: "seat_limit" };

  // Already a member?
  const existingMember = await prisma.membership.findFirst({
    where: {
      organizationId: ctx.organizationId,
      user: { email: parsed.data.email },
    },
    select: { id: true },
  });
  if (existingMember) return { error: "already_member" };

  const { token, tokenHash } = generateInvitationToken();
  try {
    await prisma.invitation.create({
      data: {
        organizationId: ctx.organizationId,
        email: parsed.data.email,
        role: parsed.data.role,
        tokenHash,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });
  } catch (e) {
    console.error("Invite failed", e);
    return { error: "generic" };
  }

  revalidatePath("/app/settings/team");
  return { error: null, token };
}

export type AcceptState = {
  error: "invalid" | "expired" | "seat_limit" | "generic" | null;
  /** Set when an existing user joined — they must log in to continue. */
  joinedExisting?: boolean;
};

/**
 * Accept an invitation. For a brand-new email it creates the user + membership
 * and opens a session. For an email that already has an account it just adds the
 * membership and asks the user to log in.
 */
export async function acceptInvitation(
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const locale = localeFrom(formData);
  const token = String(formData.get("token") ?? "");
  if (!token) return { error: "invalid" };

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
  });
  if (!invitation || invitation.acceptedAt) return { error: "invalid" };
  if (invitation.expiresAt.getTime() < Date.now()) return { error: "expired" };

  const members = await countMembers(invitation.organizationId);
  const org = await prisma.organization.findUnique({
    where: { id: invitation.organizationId },
    select: { seatLimit: true },
  });
  if (org && members >= org.seatLimit) return { error: "seat_limit" };

  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
  });

  // Existing account → just add membership (idempotent) and ask them to log in.
  if (existingUser) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.membership.upsert({
          where: {
            organizationId_userId: {
              organizationId: invitation.organizationId,
              userId: existingUser.id,
            },
          },
          update: {},
          create: {
            organizationId: invitation.organizationId,
            userId: existingUser.id,
            role: invitation.role,
          },
        });
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });
      });
    } catch (e) {
      console.error("Accept (existing) failed", e);
      return { error: "generic" };
    }
    return { error: null, joinedExisting: true };
  }

  // New account → require name + password, create user + membership, sign in.
  const parsed = acceptInviteSchema.safeParse({
    name: formData.get("name"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "invalid" };

  const passwordHash = await hashPassword(parsed.data.password);
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: parsed.data.name,
          email: invitation.email,
          passwordHash,
        },
      });
      await tx.membership.create({
        data: {
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitation.role,
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      return user.id;
    });
  } catch (e) {
    console.error("Accept (new) failed", e);
    return { error: "generic" };
  }

  await createSession({
    userId,
    organizationId: invitation.organizationId,
    role: invitation.role,
  });
  redirect({ href: "/app", locale });
  throw new Error("unreachable: redirect halts execution");
}

"use server";

import { hasLocale } from "next-intl";
import { prisma } from "@/lib/prisma";
import { createSession, deleteSession } from "@/lib/session";
import { getOrgContext, assertRole } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { coreProfileData } from "@/lib/profile";
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
 * Leave the current team. A user belongs to exactly one team; leaving removes
 * their membership and signs them out (they can then accept another invite).
 * The OWNER can't leave their own organization.
 */
export async function leaveTeam(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const ctx = await getOrgContext();
  if (!ctx) {
    redirect({ href: "/login", locale });
    return;
  }
  if (ctx.role === "OWNER") {
    // Owners can't abandon their own org here.
    redirect({ href: "/app/settings", locale });
    return;
  }

  await prisma.membership.deleteMany({
    where: { organizationId: ctx.organizationId, userId: ctx.userId },
  });
  await audit(ctx, { action: "member.left", entity: "Membership", meta: { userId: ctx.userId } });
  await deleteSession();
  redirect({ href: "/login", locale });
}

export type InviteState = {
  error:
    | "forbidden"
    | "invalid"
    | "seat_limit"
    | "already_member"
    | "already_in_team"
    | "generic"
    | null;
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

  // One team per user: refuse if the invitee already belongs to a team.
  const target = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { memberships: { select: { organizationId: true }, take: 1 } },
  });
  if (target && target.memberships.length > 0) {
    return {
      error:
        target.memberships[0].organizationId === ctx.organizationId
          ? "already_member"
          : "already_in_team",
    };
  }

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

  await audit(ctx, {
    action: "member.invited",
    entity: "Invitation",
    meta: { email: parsed.data.email, role: parsed.data.role },
  });
  revalidatePath("/app/settings/team");
  return { error: null, token };
}

export type AcceptState = {
  error: "invalid" | "expired" | "seat_limit" | "already_in_team" | "generic" | null;
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
    include: { memberships: { select: { organizationId: true } } },
  });

  // One team per user: an existing user already in another team must leave it
  // before joining. Being already in THIS org is fine (idempotent re-accept).
  if (
    existingUser &&
    existingUser.memberships.some((m) => m.organizationId !== invitation.organizationId)
  ) {
    return { error: "already_in_team" };
  }

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

  // New account → require name + password + profile, create user + membership, sign in.
  const parsed = acceptInviteSchema.safeParse({
    name: formData.get("name"),
    password: formData.get("password"),
    phone: formData.get("phone"),
    documentType: formData.get("documentType"),
    document: formData.get("document"),
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
          profile: { create: coreProfileData(parsed.data) },
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

export type MemberActionResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "not_found" | "invalid" | "self" | "owner" | "unknown" };

/** Remove a member from the org (ADMIN+). Cannot remove yourself or an OWNER. */
export async function removeMember(membershipId: string): Promise<MemberActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "forbidden" };
  try {
    assertRole(ctx, "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const member = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: ctx.organizationId },
    select: { id: true, role: true, userId: true },
  });
  if (!member) return { ok: false, error: "not_found" };
  if (member.userId === ctx.userId) return { ok: false, error: "self" };
  if (member.role === "OWNER") return { ok: false, error: "owner" };

  try {
    await prisma.membership.deleteMany({
      where: { id: membershipId, organizationId: ctx.organizationId },
    });
    await audit(ctx, {
      action: "member.removed",
      entity: "Membership",
      entityId: membershipId,
      meta: { userId: member.userId },
    });
    revalidatePath("/app/settings/team");
    return { ok: true };
  } catch (e) {
    console.error("Remove member failed", e);
    return { ok: false, error: "unknown" };
  }
}

/** Change a member's role (ADMIN+). Cannot touch yourself or an OWNER; only an
 * OWNER may grant or revoke ADMIN. */
export async function changeMemberRole(
  membershipId: string,
  role: string,
): Promise<MemberActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "forbidden" };
  try {
    assertRole(ctx, "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (role !== "ADMIN" && role !== "MEMBER") return { ok: false, error: "invalid" };

  const member = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: ctx.organizationId },
    select: { id: true, role: true, userId: true },
  });
  if (!member) return { ok: false, error: "not_found" };
  if (member.userId === ctx.userId) return { ok: false, error: "self" };
  if (member.role === "OWNER") return { ok: false, error: "owner" };
  if ((role === "ADMIN" || member.role === "ADMIN") && ctx.role !== "OWNER") {
    return { ok: false, error: "forbidden" };
  }

  try {
    await prisma.membership.updateMany({
      where: { id: membershipId, organizationId: ctx.organizationId },
      data: { role },
    });
    await audit(ctx, {
      action: "member.role_changed",
      entity: "Membership",
      entityId: membershipId,
      meta: { role },
    });
    revalidatePath("/app/settings/team");
    return { ok: true };
  } catch (e) {
    console.error("Change role failed", e);
    return { ok: false, error: "unknown" };
  }
}

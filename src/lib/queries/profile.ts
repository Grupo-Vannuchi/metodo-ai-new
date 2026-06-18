import "server-only";
import { prisma } from "@/lib/prisma";

/** Profile + identity fields for the profile tab / admin view. */
export type ProfileView = {
  name: string;
  email: string;
  phone: string | null;
  documentType: "CPF" | "CNPJ" | null;
  document: string | null;
  position: string | null;
  birthDate: Date | null;
  avatarUrl: string | null;
  addressZip: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressCity: string | null;
  addressState: string | null;
};

function toView(user: {
  name: string;
  email: string;
  profile: Omit<ProfileView, "name" | "email"> | null;
}): ProfileView {
  const p = user.profile;
  return {
    name: user.name,
    email: user.email,
    phone: p?.phone ?? null,
    documentType: p?.documentType ?? null,
    document: p?.document ?? null,
    position: p?.position ?? null,
    birthDate: p?.birthDate ?? null,
    avatarUrl: p?.avatarUrl ?? null,
    addressZip: p?.addressZip ?? null,
    addressStreet: p?.addressStreet ?? null,
    addressNumber: p?.addressNumber ?? null,
    addressCity: p?.addressCity ?? null,
    addressState: p?.addressState ?? null,
  };
}

const PROFILE_SELECT = {
  name: true,
  email: true,
  profile: {
    select: {
      phone: true,
      documentType: true,
      document: true,
      position: true,
      birthDate: true,
      avatarUrl: true,
      addressZip: true,
      addressStreet: true,
      addressNumber: true,
      addressCity: true,
      addressState: true,
    },
  },
} as const;

/** The signed-in user's own profile. Identity-level read (by userId). */
export async function getMyProfile(userId: string): Promise<ProfileView | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
  return user ? toView(user) : null;
}

/**
 * A member's profile, readable by an admin of `organizationId`. The membership
 * join is the security boundary: returns null unless the user belongs to the
 * org. Caller must still enforce the admin role.
 */
export async function getMemberProfile(
  organizationId: string,
  userId: string,
): Promise<ProfileView | null> {
  const membership = await prisma.membership.findFirst({
    where: { organizationId, userId },
    select: { user: { select: PROFILE_SELECT } },
  });
  return membership ? toView(membership.user) : null;
}

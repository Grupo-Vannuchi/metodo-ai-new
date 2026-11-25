import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
/** Exposed so route handlers can set the session cookie on a NextResponse. */
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_SECONDS;

export type SessionRole = "OWNER" | "ADMIN" | "MEMBER";

/**
 * The signed session payload. Carries the user identity AND the active
 * organization + the user's role within it — so every request knows which
 * tenant it operates on without an extra DB round-trip in the hot path.
 */
export type SessionPayload = {
  userId: string;
  organizationId: string;
  role: SessionRole;
  /**
   * The user's session version when the session was signed (claim "sv"). A session is valid only while it equals
   * User.sessionVersion: raising that (password changed or reset, "Sair dos outros aparelhos") ends every older session.
   * Sessions signed before the claim existed read as 0, the column's default. Filled from the database when not given.
   */
  sv?: number;
};

const encodedKey = new TextEncoder().encode(env.SESSION_SECRET);

/** The user's current session version (0 when the user is gone: no session of theirs is valid anyway). */
async function currentSessionVersion(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  return user?.sessionVersion ?? 0;
}

async function encrypt(payload: SessionPayload): Promise<string> {
  const sv = payload.sv ?? (await currentSessionVersion(payload.userId));
  return new SignJWT({ userId: payload.userId, organizationId: payload.organizationId, role: payload.role, sv })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encodedKey);
}

export async function decrypt(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.userId === "string" &&
      typeof payload.organizationId === "string" &&
      typeof payload.role === "string"
    ) {
      return {
        userId: payload.userId,
        organizationId: payload.organizationId,
        role: payload.role as SessionRole,
        sv: typeof payload.sv === "number" && Number.isInteger(payload.sv) ? payload.sv : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Sign the session payload into a JWT (without touching cookies) — for route
 * handlers that set the cookie directly on a NextResponse. */
export async function sealSession(payload: SessionPayload): Promise<string> {
  return encrypt(payload);
}

/** Create the signed session cookie after a successful login. */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await encrypt(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Read and verify the current session's signature, if any. Does NOT check the session version: anything that acts for the
 * user goes through getOrgContext (src/lib/tenant.ts), getCurrentUser (src/lib/auth.ts) or getValidSession, which do.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get(SESSION_COOKIE)?.value);
}

/** True when a session's version is still the user's (see SessionPayload.sv). */
export function sessionVersionMatches(session: SessionPayload, current: number): boolean {
  return (session.sv ?? 0) === current;
}

/** The current session when it is signed AND its version is still the user's; null otherwise. */
export async function getValidSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { sessionVersion: true } });
  if (!user || !sessionVersionMatches(session, user.sessionVersion)) return null;
  return session;
}

/**
 * Ends every session of the user signed until now (raises User.sessionVersion). The caller signs a new session for the
 * device it wants to keep (createSession reads the new version).
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.user.updateMany({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
}

/** Clear the session cookie on logout. */
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

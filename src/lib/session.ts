import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

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
};

const encodedKey = new TextEncoder().encode(env.SESSION_SECRET);

async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
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
      };
    }
    return null;
  } catch {
    return null;
  }
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

/** Read and verify the current session, if any. */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get(SESSION_COOKIE)?.value);
}

/** Clear the session cookie on logout. */
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

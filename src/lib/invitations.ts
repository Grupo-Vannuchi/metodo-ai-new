import "server-only";
import { randomBytes, createHash } from "crypto";

/**
 * Invitations are looked up by a SHA-256 hash of an opaque random token. The
 * raw token travels in the invite link; only its hash is stored, so a database
 * leak can't be used to accept invitations.
 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generate a fresh invitation token plus the hash to persist. */
export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashInvitationToken(token) };
}

/** Default invitation validity window. */
export const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/** Whether an invitation is past its expiry. Kept out of component render. */
export function isInvitationExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() < Date.now();
}

import "server-only";
import { randomBytes, createHash } from "crypto";
import type { AuthTokenPurpose } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Single-use, expiring tokens for e-mail verification and password reset. Only
 * the SHA-256 hash is stored; the raw token travels in the e-mail link. Mirrors
 * the invitation-token approach.
 */

export const VERIFY_TTL_MS = 1000 * 60 * 60 * 24; // 24h
export const RESET_TTL_MS = 1000 * 60 * 60; // 1h

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a fresh token for a purpose and return the raw token for the link. Any
 * prior unconsumed token of the same purpose is dropped, so only the newest
 * link works.
 */
export async function issueAuthToken(
  userId: string,
  purpose: AuthTokenPurpose,
  ttlMs: number,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId, purpose, consumedAt: null } }),
    prisma.authToken.create({
      data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return token;
}

/**
 * Consume a token: returns the userId if it is valid (right purpose, not
 * expired, not already used) and atomically marks it consumed. Returns null
 * otherwise. The `updateMany` guard on `consumedAt` makes it strictly single-use
 * even under a race (e.g. an e-mail scanner prefetch + a real click).
 */
export async function consumeAuthToken(
  token: string,
  purpose: AuthTokenPurpose,
): Promise<string | null> {
  const row = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  });
  if (!row || row.purpose !== purpose || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
    return null;
  }
  const res = await prisma.authToken.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return res.count === 1 ? row.userId : null;
}

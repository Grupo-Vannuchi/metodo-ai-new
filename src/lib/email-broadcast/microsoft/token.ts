import "server-only";
import { OAuth2RequestError } from "arctic";
import { prisma } from "@/lib/prisma";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";
import { MICROSOFT_MAIL_SCOPES, microsoftMailClient } from "./oauth";

export type MicrosoftCredentials = { accessToken: string; refreshToken: string; expiresAt: string };

export function sealMicrosoftCredentials(c: MicrosoftCredentials): string {
  return encryptCredentials({ accessToken: c.accessToken, refreshToken: c.refreshToken, expiresAt: c.expiresAt });
}

function openCredentials(sealed: string): MicrosoftCredentials | null {
  try {
    const c = decryptCredentials(sealed);
    return c.accessToken && c.refreshToken && c.expiresAt
      ? { accessToken: c.accessToken, refreshToken: c.refreshToken, expiresAt: c.expiresAt }
      : null;
  } catch {
    return null;
  }
}

export type TokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "reconnect" | "temporary"; message: string };

/** Renew when the access token ends within this. */
const SKEW_MS = 5 * 60 * 1000;
/** Refusals that only a new consent fixes (revoked access, password change, expired app secret). */
const RECONNECT_CODES = new Set(["invalid_grant", "invalid_client", "interaction_required", "consent_required"]);

export async function markNeedsReconnect(organizationId: string, accountId: string, message: string): Promise<void> {
  await prisma.emailSenderAccount.updateMany({
    where: { id: accountId, organizationId },
    data: { status: "NEEDS_RECONNECT", lastError: message.slice(0, 500) },
  });
}

/**
 * A usable Graph access token for the org's mailbox. Renews it when it ends
 * within 5 minutes (or when `force`d after a 401), under a per-org advisory
 * lock so two sends never spend the same rotating refresh token. A refusal
 * that needs a new consent marks the account NEEDS_RECONNECT. System context:
 * organizationId is explicit in every query.
 */
export async function getMicrosoftAccessToken(
  organizationId: string,
  accountId: string,
  opts: { force?: boolean } = {},
): Promise<TokenResult> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<TokenResult> => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`email_sender:${organizationId}`}))`;
        const row = await tx.emailSenderAccount.findFirst({
          where: { id: accountId, organizationId },
          select: { credentials: true, status: true },
        });
        if (!row || row.status !== "ACTIVE") return { ok: false, reason: "reconnect", message: "account missing or disconnected" };
        const creds = openCredentials(row.credentials);
        if (!creds) {
          await tx.emailSenderAccount.updateMany({
            where: { id: accountId, organizationId },
            data: { status: "NEEDS_RECONNECT", lastError: "unreadable credentials" },
          });
          return { ok: false, reason: "reconnect", message: "unreadable credentials" };
        }
        if (!opts.force && new Date(creds.expiresAt).getTime() - Date.now() > SKEW_MS) {
          return { ok: true, accessToken: creds.accessToken };
        }
        try {
          const tokens = await microsoftMailClient().refreshAccessToken(creds.refreshToken, MICROSOFT_MAIL_SCOPES);
          const next: MicrosoftCredentials = {
            accessToken: tokens.accessToken(),
            refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : creds.refreshToken,
            expiresAt: tokens.accessTokenExpiresAt().toISOString(),
          };
          await tx.emailSenderAccount.updateMany({
            where: { id: accountId, organizationId },
            data: { credentials: sealMicrosoftCredentials(next), lastError: null },
          });
          return { ok: true, accessToken: next.accessToken };
        } catch (e) {
          if (e instanceof OAuth2RequestError && RECONNECT_CODES.has(e.code)) {
            const message = `${e.code}: ${e.description ?? ""}`.slice(0, 500);
            await tx.emailSenderAccount.updateMany({
              where: { id: accountId, organizationId },
              data: { status: "NEEDS_RECONNECT", lastError: message },
            });
            return { ok: false, reason: "reconnect", message };
          }
          return { ok: false, reason: "temporary", message: e instanceof Error ? e.message : "token refresh failed" };
        }
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    return { ok: false, reason: "temporary", message: e instanceof Error ? e.message : "token error" };
  }
}

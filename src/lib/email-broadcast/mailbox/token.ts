import "server-only";
import { OAuth2RequestError } from "arctic";
import { prisma } from "@/lib/prisma";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";
import { googleMailClient } from "../google/oauth";
import { MICROSOFT_MAIL_SCOPES, microsoftMailClient } from "../microsoft/oauth";
import { isReconnectCode } from "./core";

export type SenderCredentials = { accessToken: string; refreshToken: string; expiresAt: string };

export function sealSenderCredentials(c: SenderCredentials): string {
  return encryptCredentials({ accessToken: c.accessToken, refreshToken: c.refreshToken, expiresAt: c.expiresAt });
}

function openCredentials(sealed: string): SenderCredentials | null {
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

export async function markNeedsReconnect(organizationId: string, accountId: string, message: string): Promise<void> {
  await prisma.emailSenderAccount.updateMany({
    where: { id: accountId, organizationId },
    data: { status: "NEEDS_RECONNECT", lastError: message.slice(0, 500) },
  });
}

/** The provider's own client renews the access token; Google's call takes no scopes. */
function refreshWithProvider(provider: "MICROSOFT" | "GOOGLE", refreshToken: string) {
  return provider === "GOOGLE"
    ? googleMailClient().refreshAccessToken(refreshToken)
    : microsoftMailClient().refreshAccessToken(refreshToken, MICROSOFT_MAIL_SCOPES);
}

/**
 * A usable access token for the org's connected account (Graph for MICROSOFT,
 * Gmail for GOOGLE). Renews it when it ends within 5 minutes (or when `force`d
 * after a 401), under a per-org, per-provider advisory lock so two sends never
 * spend the same rotating refresh token. A refusal that needs a new consent
 * (isReconnectCode) marks the account NEEDS_RECONNECT. System context:
 * organizationId is explicit in every query, and the account filter carries
 * the provider so a send never reads the other channel's credentials.
 */
export async function getSenderAccessToken(
  organizationId: string,
  accountId: string,
  provider: "MICROSOFT" | "GOOGLE",
  opts: { force?: boolean } = {},
): Promise<TokenResult> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<TokenResult> => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`email_sender:${organizationId}:${provider}`}))`;
        const row = await tx.emailSenderAccount.findFirst({
          where: { id: accountId, organizationId, provider },
          select: { credentials: true, status: true },
        });
        if (!row || row.status !== "ACTIVE") return { ok: false, reason: "reconnect", message: "account missing or disconnected" };
        const creds = openCredentials(row.credentials);
        if (!creds) {
          await tx.emailSenderAccount.updateMany({
            where: { id: accountId, organizationId, provider },
            data: { status: "NEEDS_RECONNECT", lastError: "unreadable credentials" },
          });
          return { ok: false, reason: "reconnect", message: "unreadable credentials" };
        }
        if (!opts.force && new Date(creds.expiresAt).getTime() - Date.now() > SKEW_MS) {
          return { ok: true, accessToken: creds.accessToken };
        }
        try {
          const tokens = await refreshWithProvider(provider, creds.refreshToken);
          const next: SenderCredentials = {
            accessToken: tokens.accessToken(),
            refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : creds.refreshToken,
            expiresAt: tokens.accessTokenExpiresAt().toISOString(),
          };
          await tx.emailSenderAccount.updateMany({
            where: { id: accountId, organizationId, provider },
            data: { credentials: sealSenderCredentials(next), lastError: null },
          });
          return { ok: true, accessToken: next.accessToken };
        } catch (e) {
          // An invalid app secret ("invalid_client") is a platform problem, so it stays temporary.
          if (e instanceof OAuth2RequestError && isReconnectCode(e.code)) {
            const message = `${e.code}: ${e.description ?? ""}`.slice(0, 500);
            await tx.emailSenderAccount.updateMany({
              where: { id: accountId, organizationId, provider },
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

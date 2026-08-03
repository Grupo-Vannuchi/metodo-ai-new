import "server-only";
import { Google } from "arctic";
import { env } from "@/lib/env";
import { encryptCredentials, decryptCredentials } from "@/lib/integrations/crypto";
import { tenantDb } from "@/lib/tenant-db";

/**
 * Google Drive integration — per-user OAuth. Distinct from the sign-in Google
 * OAuth (which is OIDC-only and stores no tokens) and from the GOOGLE provider
 * (Places API key). Tokens live encrypted in an IntegrationConnection
 * (provider GOOGLE_DRIVE, ownerId = the connecting user).
 */
export const DRIVE_CALLBACK_PATH = "/api/integrations/google-drive/callback";

// Full read mirror. RESTRICTED scope: usable in OAuth "testing" mode now; going
// live for all customers needs Google verification + a CASA assessment.
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

export function isDriveConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function client() {
  return new Google(
    env.GOOGLE_CLIENT_ID!,
    env.GOOGLE_CLIENT_SECRET!,
    `${env.NEXT_PUBLIC_SITE_URL}${DRIVE_CALLBACK_PATH}`,
  );
}

export function buildDriveAuthUrl(state: string, verifier: string): URL {
  const url = client().createAuthorizationURL(state, verifier, DRIVE_SCOPES);
  // offline + forced consent so Google returns a refresh_token every time.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url;
}

export type DriveCreds = { accessToken: string; refreshToken: string; expiresAt: number };

/** Exchange the auth code. Returns null when no refresh_token came back (the
 * connection would be unrenewable — treat as failure and ask to reconnect). */
export async function exchangeDriveCode(code: string, verifier: string): Promise<DriveCreds | null> {
  const tokens = await client().validateAuthorizationCode(code, verifier);
  if (!tokens.hasRefreshToken()) return null;
  return {
    accessToken: tokens.accessToken(),
    refreshToken: tokens.refreshToken(),
    expiresAt: tokens.accessTokenExpiresAt().getTime(),
  };
}

export function encodeDriveCreds(c: DriveCreds): string {
  return encryptCredentials({
    accessToken: c.accessToken,
    refreshToken: c.refreshToken,
    expiresAt: String(c.expiresAt),
  });
}
function decodeDriveCreds(payload: string): DriveCreds {
  const c = decryptCredentials(payload);
  return {
    accessToken: c.accessToken ?? "",
    refreshToken: c.refreshToken ?? "",
    expiresAt: Number(c.expiresAt ?? 0),
  };
}

/** A valid access token for the org's Drive connection, refreshing + persisting
 * when near expiry. Null if it can't be refreshed (user must reconnect). */
export async function getDriveAccessToken(
  organizationId: string,
  connectionId: string,
): Promise<string | null> {
  const db = tenantDb(organizationId);
  const conn = await db.integrationConnection.findFirst({
    where: { id: connectionId, provider: "GOOGLE_DRIVE" },
    select: { id: true, credentialsEnc: true },
  });
  if (!conn) return null;
  const creds = decodeDriveCreds(conn.credentialsEnc);
  if (creds.accessToken && creds.expiresAt > Date.now() + 60_000) return creds.accessToken;
  if (!creds.refreshToken) return null;
  try {
    const tokens = await client().refreshAccessToken(creds.refreshToken);
    const next: DriveCreds = {
      accessToken: tokens.accessToken(),
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : creds.refreshToken,
      expiresAt: tokens.accessTokenExpiresAt().getTime(),
    };
    await db.integrationConnection.updateMany({
      where: { id: connectionId },
      data: { credentialsEnc: encodeDriveCreds(next), status: "ACTIVE" },
    });
    return next.accessToken;
  } catch (e) {
    console.error("[drive] token refresh failed", e);
    await db.integrationConnection.updateMany({ where: { id: connectionId }, data: { status: "ERROR" } });
    return null;
  }
}

export type DriveUser = { displayName: string | null; emailAddress: string | null; photoLink: string | null };

/** Drive `about(user)` — used for the connection label and as a health check. */
export async function driveAbout(accessToken: string): Promise<DriveUser | null> {
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { user?: DriveUser } | null;
  return j?.user ?? null;
}

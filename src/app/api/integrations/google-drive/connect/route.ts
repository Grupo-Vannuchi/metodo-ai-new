import { NextResponse } from "next/server";
import { generateState, generateCodeVerifier } from "arctic";
import { env } from "@/lib/env";
import { getOrgContext } from "@/lib/tenant";
import { buildDriveAuthUrl, isDriveConfigured } from "@/lib/integrations/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 10,
};

/** Start the per-user Google Drive OAuth flow (offline access + forced consent). */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_SITE_URL));
  if (!isDriveConfigured()) {
    return NextResponse.redirect(new URL("/app/files?error=drive_config", env.NEXT_PUBLIC_SITE_URL));
  }

  const state = generateState();
  const verifier = generateCodeVerifier();
  const res = NextResponse.redirect(buildDriveAuthUrl(state, verifier));
  res.cookies.set("gdrive_oauth_state", state, COOKIE_OPTS);
  res.cookies.set("gdrive_code_verifier", verifier, COOKIE_OPTS);
  return res;
}

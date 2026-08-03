import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { driveAbout, encodeDriveCreds, exchangeDriveCode } from "@/lib/integrations/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth callback: exchange the code, store the tokens (encrypted) on a per-user
 * GOOGLE_DRIVE connection, and bounce back to /app/connections. */
export async function GET(req: NextRequest) {
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/app/connections?${q}`, env.NEXT_PUBLIC_SITE_URL));

  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_SITE_URL));

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("gdrive_oauth_state")?.value;
  const verifier = req.cookies.get("gdrive_code_verifier")?.value;

  if (url.searchParams.get("error")) return back("error=drive_denied");
  if (!code || !state || !cookieState || !verifier || state !== cookieState) {
    return back("error=drive_state");
  }

  const creds = await exchangeDriveCode(code, verifier).catch((e) => {
    console.error("[drive] code exchange failed", e);
    return null;
  });
  if (!creds) return back("error=drive_norefresh");

  const user = await driveAbout(creds.accessToken);
  const label = user?.emailAddress ? `Google Drive · ${user.emailAddress}` : "Google Drive";
  const credentialsEnc = encodeDriveCreds(creds);

  try {
    const db = tenantDb(ctx.organizationId);
    const existing = await db.integrationConnection.findFirst({
      where: { provider: "GOOGLE_DRIVE", ownerId: ctx.userId },
      select: { id: true },
    });
    if (existing) {
      await db.integrationConnection.updateMany({
        where: { id: existing.id },
        data: { credentialsEnc, label, status: "ACTIVE", lastTestAt: new Date() },
      });
    } else {
      await db.integrationConnection.create({
        data: {
          organizationId: ctx.organizationId,
          ownerId: ctx.userId,
          provider: "GOOGLE_DRIVE",
          label,
          credentialsEnc,
          status: "ACTIVE",
          lastTestAt: new Date(),
        },
      });
    }
  } catch (e) {
    console.error("[drive] failed to store connection", e);
    return back("error=drive_store");
  }

  const res = back("connected=drive");
  res.cookies.delete("gdrive_oauth_state");
  res.cookies.delete("gdrive_code_verifier");
  return res;
}

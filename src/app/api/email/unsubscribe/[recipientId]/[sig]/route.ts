import type { NextRequest } from "next/server";
import { verifyEmailUnsubscribeSig } from "@/lib/email-broadcast/unsubscribe";
import { unsubscribeRecipient } from "@/lib/email-broadcast/suppression";

export const runtime = "nodejs";

/**
 * RFC 8058 one-click unsubscribe (the List-Unsubscribe-Post header Gmail and
 * Yahoo require for bulk mail). PUBLIC ON PURPOSE: the HMAC in the path is
 * the authorization — it's checked first, before any read. POST only, so a
 * link preview (GET) never unsubscribes; idempotent.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ recipientId: string; sig: string }> },
) {
  const { recipientId, sig } = await params;
  if (!verifyEmailUnsubscribeSig(recipientId, sig)) {
    return new Response("Invalid link", { status: 403 });
  }
  try {
    const r = await unsubscribeRecipient(recipientId);
    return r.ok ? new Response(null, { status: 200 }) : new Response("Not found", { status: 404 });
  } catch (error) {
    console.error("[email] one-click unsubscribe failed", error);
    return new Response("error", { status: 500 });
  }
}

import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { downloadInboxAttachment } from "@/lib/email-broadcast/microsoft/inbox";
import { attachmentDisposition, isGraphId } from "@/lib/email-broadcast/microsoft/inbox-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download a file attached to an e-mail of the connected Microsoft mailbox's
 * Inbox (`?m=<message id>&a=<attachment id>`). Logged-in only, with the same
 * gates as the inbox tab, checked first. The token is the org's own mailbox
 * and the message must sit in its Inbox. Always served as a download
 * (octet-stream + nosniff), never rendered on our origin, and streamed from
 * Microsoft without buffering (attachments may be 150 MB).
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!canAccessScreen(ctx, "email") || !canAccessScreen(ctx, "emailInbox") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const messageId = url.searchParams.get("m");
  const attachmentId = url.searchParams.get("a");
  if (!isGraphId(messageId) || !isGraphId(attachmentId)) return new Response("Bad request", { status: 400 });

  const res = await downloadInboxAttachment(ctx.organizationId, messageId, attachmentId);
  if (!res.ok) {
    if (res.reason === "not_found") return new Response("Not found", { status: 404 });
    if (res.reason === "reconnect" || res.reason === "no_account") return new Response("Reconnect", { status: 409 });
    return new Response("Try again", { status: 502 });
  }

  // Streamed straight from Microsoft: the file is never held in memory here.
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": attachmentDisposition(res.data.name),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  if (res.data.size !== null) headers.set("Content-Length", String(res.data.size));
  return new Response(res.data.body, { headers });
}

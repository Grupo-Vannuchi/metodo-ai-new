import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { isAttachmentIndex, parseImapMessageRef } from "@/lib/email-broadcast/imap/core";
import { downloadImapAttachment } from "@/lib/email-broadcast/imap/inbox";
import { attachmentDisposition } from "@/lib/email-broadcast/microsoft/inbox-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download a file attached to an e-mail of the Inbox of the company's SMTP
 * account, read over IMAP (`?m=<uidvalidity>.<uid>&a=<index in the e-mail's
 * attachment list>`). Logged-in only, with the same gates as the inbox tab,
 * checked first. The account is the session company's own, and the file has to
 * be one the opened e-mail lists. Always served as a download (octet-stream +
 * nosniff), never rendered on our origin.
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!canAccessScreen(ctx, "email") || !canAccessScreen(ctx, "emailInbox") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const messageId = url.searchParams.get("m");
  const index = url.searchParams.get("a");
  if (messageId === null || parseImapMessageRef(messageId) === null || !isAttachmentIndex(index)) {
    return new Response("Bad request", { status: 400 });
  }

  const res = await downloadImapAttachment(ctx.organizationId, messageId, index);
  if (!res.ok) {
    if (res.reason === "not_found") return new Response("Not found", { status: 404 });
    if (res.reason === "reconnect" || res.reason === "no_account") return new Response("Reconnect", { status: 409 });
    return new Response("Try again", { status: 502 });
  }

  // The file was read with the e-mail (15 MB at most), so its size is known.
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": attachmentDisposition(res.data.name),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  if (res.data.size !== null) headers.set("Content-Length", String(res.data.size));
  return new Response(res.data.body, { headers });
}

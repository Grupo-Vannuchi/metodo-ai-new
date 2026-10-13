import { randomUUID } from "crypto";
import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { mediaReadable, putMedia } from "@/lib/storage/blob";
import {
  MAX_ATTACHMENTS_BYTES,
  attachmentContentType,
  attachmentStorageKey,
  cleanAttachmentName,
} from "@/lib/email-broadcast/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload ONE attachment for a mass e-mail. Same gates as the E-mail screen
 * (session + "email" screen + Marketing module), checked before reading the
 * body. The type comes from the extension (never the browser's MIME) and the
 * size is measured here. Returns the storage KEY: the dispatcher reads
 * attachments by key, never by a client-supplied URL.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!mediaReadable()) return Response.json({ ok: false, error: "storage" }, { status: 503 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    /* ignore */
  }
  if (!file || file.size === 0) return Response.json({ ok: false, error: "invalid" }, { status: 400 });

  const filename = cleanAttachmentName(file.name);
  const contentType = filename ? attachmentContentType(filename) : null;
  if (!filename || !contentType) return Response.json({ ok: false, error: "type" }, { status: 400 });
  if (file.size > MAX_ATTACHMENTS_BYTES) return Response.json({ ok: false, error: "size" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = attachmentStorageKey(ctx.organizationId, randomUUID(), filename);
  try {
    await putMedia(key, buffer, contentType);
    return Response.json({ ok: true, attachment: { key, filename, size: buffer.byteLength } });
  } catch (error) {
    console.error("[email-attachment] upload failed", error);
    return Response.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

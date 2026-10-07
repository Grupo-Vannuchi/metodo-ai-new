import { randomUUID } from "crypto";
import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { putMedia } from "@/lib/storage/blob";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
/** Raster images only — no SVG (avoids embedding untrusted markup). */
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Upload an image for a mass e-mail body. Same gates as the E-mail screen
 * (session + "email" screen + Marketing module), checked before reading the
 * body. Returns an ABSOLUTE public URL: the image is loaded by the
 * recipient's mail client, so a site-relative path (local-disk storage in
 * dev) is prefixed with the public site URL.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    /* ignore */
  }
  if (!file) return Response.json({ ok: false, error: "invalid" }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ ok: false, error: "size" }, { status: 400 });

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) return Response.json({ ok: false, error: "type" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = (file.name || "img").replace(/[^\w.\-]+/g, "_").slice(0, 80) || "img";
  const key = `email/${ctx.organizationId}/${randomUUID()}-${safeName}`;

  try {
    const stored = await putMedia(key, buffer, mime);
    const url = stored.url.startsWith("/")
      ? `${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")}${stored.url}`
      : stored.url;
    return Response.json({ ok: true, url });
  } catch (error) {
    console.error("[email-image] upload failed", error);
    return Response.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

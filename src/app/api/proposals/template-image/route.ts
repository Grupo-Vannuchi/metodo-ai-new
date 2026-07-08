import { randomUUID } from "crypto";
import { getOrgContext } from "@/lib/tenant";
import { putMedia } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
/** Raster images only — no SVG (avoids embedding untrusted markup). */
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Upload an image used by a proposal template's document (cover / header /
 * footer / signature / client logo). Org-scoped; returns the public URL, which
 * is stored inside the template's (and any generated proposal's) document JSON.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

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
  const key = `proposal-templates/${ctx.organizationId}/${randomUUID()}-${safeName}`;

  try {
    const stored = await putMedia(key, buffer, mime);
    return Response.json({ ok: true, url: stored.url });
  } catch (error) {
    console.error("[template-image] upload failed", error);
    return Response.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { putMedia } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_COUNT = 20; // per proposal

/** Allowed file types: documents + images. */
const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * Upload a file attachment to a proposal. Bytes go straight to object storage
 * (Supabase/local) — never Postgres; only the metadata + URL is stored.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const db = tenantDb(ctx.organizationId);
  const proposal = await db.proposal.findFirst({ where: { id }, select: { id: true } });
  if (!proposal) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const count = await db.proposalAttachment.count({ where: { proposalId: id } });
  if (count >= MAX_COUNT) return Response.json({ ok: false, error: "count" }, { status: 400 });

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
  const safeName = (file.name || "arquivo").replace(/[^\w.\-]+/g, "_").slice(0, 120) || "arquivo";
  const key = `proposals/${id}/${randomUUID()}-${safeName}`;

  try {
    const stored = await putMedia(key, buffer, mime);
    const attachment = await db.proposalAttachment.create({
      data: {
        organizationId: ctx.organizationId,
        proposalId: id,
        name: (file.name || safeName).slice(0, 200),
        mime,
        size: stored.size,
        url: stored.url,
        uploadedById: ctx.userId,
      },
      select: { id: true, name: true, mime: true, size: true, url: true, createdAt: true },
    });
    revalidatePath(`/app/proposals/${id}`);
    return Response.json({ ok: true, attachment });
  } catch (error) {
    console.error("[proposal-attachments] upload failed", error);
    return Response.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

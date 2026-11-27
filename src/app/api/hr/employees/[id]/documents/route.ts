import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { putPrivate } from "@/lib/storage/blob";
import { canUseScreen } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_COUNT = 30; // per employee

/** Allowed document types: documents + images (contract, ID, medical cert…). */
const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * Upload a document to an employee's record. Bytes go to PRIVATE storage (putPrivate) — never
 * Postgres nor a public URL; the row keeps a `private:` reference, and the file is only served by
 * /api/hr/documents/[id]. `expiresAt` (optional) drives the
 * "document expiring" alert on the HR dashboard.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  // Same gate as the HR pages.
  if (!canUseScreen(ctx, "hr")) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const db = tenantDb(ctx.organizationId);
  const employee = await db.employee.findFirst({ where: { id }, select: { id: true } });
  if (!employee) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const count = await db.employeeDocument.count({ where: { employeeId: id } });
  if (count >= MAX_COUNT) return Response.json({ ok: false, error: "count" }, { status: 400 });

  let file: File | null = null;
  let expiresAt: string | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    const exp = form.get("expiresAt");
    if (typeof exp === "string" && exp.trim()) expiresAt = exp.trim();
  } catch {
    /* ignore */
  }
  if (!file) return Response.json({ ok: false, error: "invalid" }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ ok: false, error: "size" }, { status: 400 });

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) return Response.json({ ok: false, error: "type" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = (file.name || "documento").replace(/[^\w.\-]+/g, "_").slice(0, 120) || "documento";
  const key = `employees/${id}/${randomUUID()}-${safeName}`;

  try {
    const stored = await putPrivate(key, buffer, mime);
    const document = await db.employeeDocument.create({
      data: {
        organizationId: ctx.organizationId,
        employeeId: id,
        name: (file.name || safeName).slice(0, 200),
        mime,
        size: stored.size,
        url: stored.ref,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        uploadedById: ctx.userId,
      },
      select: { id: true, name: true, mime: true, size: true, expiresAt: true, createdAt: true },
    });
    revalidatePath(`/app/hr/employees/${id}`);
    return Response.json({ ok: true, document });
  } catch (error) {
    console.error("[employee-documents] upload failed", error);
    return Response.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

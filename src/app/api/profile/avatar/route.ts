import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { putMedia, deleteMedia } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB — the client sends an already-cropped image
/** Raster images only — no SVG (avoids embedding untrusted markup). */
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Upload the signed-in user's profile photo. The client sends an already-cropped
 * square image; we store it, point `UserProfile.avatarUrl` at it (upserting the
 * profile row — OAuth users may not have one yet) and best-effort delete the
 * previous photo. Identity-level: the file is keyed by userId, not org.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

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

  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `avatars/${ctx.userId}/${randomUUID()}.${ext}`;

  try {
    const previous = await prisma.userProfile.findUnique({
      where: { userId: ctx.userId },
      select: { avatarUrl: true },
    });

    const stored = await putMedia(key, buffer, mime);

    await prisma.user.update({
      where: { id: ctx.userId },
      data: {
        profile: {
          upsert: {
            create: { avatarUrl: stored.url },
            update: { avatarUrl: stored.url },
          },
        },
      },
    });

    if (previous?.avatarUrl) await deleteMedia(previous.avatarUrl);

    revalidatePath("/app/settings/profile");
    revalidatePath("/app/settings/team");
    return Response.json({ ok: true, url: stored.url });
  } catch (error) {
    console.error("[profile-avatar] upload failed", error);
    return Response.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

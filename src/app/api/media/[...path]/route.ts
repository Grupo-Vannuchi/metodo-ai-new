import { promises as fs } from "node:fs";
import path from "node:path";
import { getOrgContext } from "@/lib/tenant";

export const runtime = "nodejs";

/**
 * Serves locally-stored chat media in development (the `.media/` fallback used
 * when Vercel Blob isn't configured). Paths are `whatsapp/<orgId>/<file>`, so we
 * require the caller's org to match — media is personal data (LGPD). In
 * production media lives on Blob's CDN and this route is never hit.
 */
const LOCAL_DIR = path.join(process.cwd(), ".media");

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  pdf: "application/pdf",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const parts = (await params).path ?? [];
  // Expected: whatsapp/<orgId>/<file>. Enforce tenant ownership.
  if (parts[0] !== "whatsapp" || parts[1] !== ctx.organizationId) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = path.join(LOCAL_DIR, ...parts);
  if (!file.startsWith(LOCAL_DIR)) return new Response("Bad request", { status: 400 });

  try {
    const buf = await fs.readFile(file);
    const ext = (parts.at(-1)?.split(".").pop() ?? "").toLowerCase();
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

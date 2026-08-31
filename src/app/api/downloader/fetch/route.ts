import { getOrgContext } from "@/lib/tenant";
import { hasModule } from "@/config/modules";
import { isAllowedMediaHost } from "@/lib/downloader";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Download proxy: streams a resolved media URL back to the browser as an
 * attachment. Module-gated + host-allowlisted (anti-SSRF). Streaming from the
 * server keeps the same IP that resolved the (often IP-signed) URL.
 */
export async function GET(req: Request): Promise<Response> {
  const ctx = await getOrgContext();
  if (!ctx || !hasModule(ctx.modules, "downloader")) return new Response("Forbidden", { status: 403 });

  const { searchParams } = new URL(req.url);
  const u = searchParams.get("u");
  const name = (searchParams.get("name") || "video").replace(/[^\w.\-]+/g, "_").slice(0, 80) || "video";
  if (!u || !isAllowedMediaHost(u)) return new Response("Invalid URL", { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(u, { headers: { "User-Agent": UA }, cache: "no-store" });
  } catch {
    return new Response("Upstream error", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) return new Response("Upstream error", { status: 502 });

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  return new Response(upstream.body, { status: 200, headers });
}

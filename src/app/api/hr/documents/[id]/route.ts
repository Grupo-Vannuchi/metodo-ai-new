import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasFeatureByModules } from "@/config/modules";
import { isPrivateRef, readPrivate } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `attachment` with the original name: an ASCII fallback plus the UTF-8 form (RFC 6266 / 5987). */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "documento";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Download of an employee document. The HR screen links here, never to the file itself. Same gate as the
 * HR pages (session, the "hr" screen and the HR module), and the document must be of the caller's company
 * (tenantDb). A private file is sent from storage, so no link to it reaches the browser. A document
 * uploaded before files went private still has a public URL; it is redirected there until it is moved.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!canAccessScreen(ctx, "hr") || !hasFeatureByModules(ctx.modules, "hr")) {
    return new Response("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const doc = await tenantDb(ctx.organizationId).employeeDocument.findFirst({
    where: { id },
    select: { url: true, name: true, mime: true },
  });
  if (!doc) return new Response("Not found", { status: 404 });

  if (!isPrivateRef(doc.url)) {
    // Only a URL this app wrote: https object storage or the local media route.
    if (!doc.url.startsWith("https://") && !doc.url.startsWith("/api/media/")) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: doc.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }

  const file = await readPrivate(doc.url);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.body, {
    headers: {
      "Content-Type": doc.mime || "application/octet-stream",
      "Content-Disposition": contentDisposition(doc.name),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

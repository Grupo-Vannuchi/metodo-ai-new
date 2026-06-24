import { getOrgContext } from "@/lib/tenant";
import { processMessageMedia } from "@/lib/whatsapp/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On-demand media fetch. The inbox calls this when it renders a PENDING media
 * bubble, so we only download what the user actually opens (lazy) and the bubble
 * resolves to READY/FAILED — no eager fetching, no infinite spinner.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  let messageId = "";
  try {
    messageId = String(((await req.json()) as { messageId?: string })?.messageId ?? "");
  } catch {
    /* ignore */
  }
  if (!messageId) return new Response("Bad request", { status: 400 });

  const media = await processMessageMedia(ctx.organizationId, messageId);
  if (!media) return new Response("Not found", { status: 404 });
  return Response.json(media);
}

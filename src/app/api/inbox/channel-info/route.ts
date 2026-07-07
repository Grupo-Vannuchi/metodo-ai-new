import type { NextRequest } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { getChannelInfo } from "@/lib/queries/team-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Members + metadata of a team channel, for the chat info panel. */
export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const chatId = new URL(req.url).searchParams.get("chatId");
  if (!chatId) return new Response("Missing chatId", { status: 400 });

  const info = await getChannelInfo(ctx.organizationId, chatId, ctx.userId);
  if (!info) return new Response("Not found", { status: 404 });
  return Response.json(info);
}

import type { NextRequest } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { listTeamChatMessages } from "@/lib/queries/team-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const chatId = new URL(req.url).searchParams.get("chatId");
  if (!chatId) return new Response("Missing chatId", { status: 400 });

  // listTeamChatMessages returns [] when the caller isn't a participant.
  const messages = await listTeamChatMessages(ctx.organizationId, chatId, ctx.userId);
  return Response.json(messages);
}

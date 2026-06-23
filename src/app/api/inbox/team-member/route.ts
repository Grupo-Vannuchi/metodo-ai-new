import type { NextRequest } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { getTeamMemberInfo } from "@/lib/queries/team-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Profile + open work of a team member, for the chat info panel. */
export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return new Response("Missing userId", { status: 400 });

  const info = await getTeamMemberInfo(ctx.organizationId, userId);
  if (!info) return new Response("Not found", { status: 404 });
  return Response.json(info);
}

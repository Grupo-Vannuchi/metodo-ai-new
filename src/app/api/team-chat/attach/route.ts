import type { NextRequest } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { searchAttachables, type AttachKind } from "@/lib/queries/team-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: AttachKind[] = ["TASK", "CONTACT", "COMPANY", "OPP", "LEAD"];

/** Search the org's entities for the team-chat attachment picker. */
export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as AttachKind | null;
  if (!type || !KINDS.includes(type)) return new Response("Bad request", { status: 400 });

  const results = await searchAttachables(ctx.organizationId, type, searchParams.get("q") ?? "");
  return Response.json(results);
}

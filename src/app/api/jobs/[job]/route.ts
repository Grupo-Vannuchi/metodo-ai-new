import type { NextRequest } from "next/server";
import { verifyQStashSignature } from "@/lib/queue";
import { JOB_HANDLERS } from "@/lib/jobs";

export const runtime = "nodejs";

/**
 * Job endpoint. QStash POSTs here; the request is rejected unless its signature
 * verifies (so jobs can't be triggered by anyone). The `job` segment selects a
 * handler from the registry.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ job: string }> },
) {
  const { job } = await params;
  const body = await req.text();

  const valid = await verifyQStashSignature(
    body,
    req.headers.get("Upstash-Signature"),
  );
  if (!valid) return new Response("Unauthorized", { status: 401 });

  const handler = JOB_HANDLERS[job];
  if (!handler) return new Response("Unknown job", { status: 404 });

  let payload: unknown = null;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    payload = null;
  }

  try {
    await handler(payload);
    return Response.json({ ok: true });
  } catch (error) {
    console.error(`[job:${job}] failed`, error);
    return new Response("Job failed", { status: 500 });
  }
}

import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { Prisma, type IntegrationProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PROVIDER_KEYS } from "@/lib/integrations/registry";

export const runtime = "nodejs";

/**
 * Inbound webhook sink. Stores each event idempotently (dedupe by a hash of the
 * provider + raw body) so retries don't double-process. Provider signature
 * verification and routing to campaign-recipient status updates land in P6.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const up = provider.toUpperCase();
  if (!PROVIDER_KEYS.includes(up as never)) {
    return new Response("Unknown provider", { status: 404 });
  }

  const body = await req.text();

  // TODO(P6): verify provider signature (e.g. Meta X-Hub-Signature-256) before trusting.
  let payload: Record<string, unknown> = {};
  try {
    payload = body ? (JSON.parse(body) as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }

  const eventType = String(payload.event ?? payload.type ?? "unknown");
  const dedupeKey = `${up}:${createHash("sha256").update(body).digest("hex")}`;

  try {
    await prisma.webhookEvent.create({
      data: {
        provider: up as IntegrationProvider,
        eventType,
        dedupeKey,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // Already received — acknowledge so the provider stops retrying.
      return Response.json({ ok: true, duplicate: true });
    }
    console.error("[webhook] failed to store event", error);
    return new Response("error", { status: 500 });
  }

  return Response.json({ ok: true });
}

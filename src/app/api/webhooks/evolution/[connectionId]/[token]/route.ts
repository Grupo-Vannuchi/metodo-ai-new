import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseInboundMessages } from "@/lib/whatsapp/inbound";
import { ingestInbound } from "@/lib/whatsapp/ingest";
import { parseDeliveryUpdates } from "@/lib/integrations/webhooks/delivery";
import {
  applyCampaignDeliveryUpdates,
  applyInboxMessageStatus,
} from "@/lib/integrations/webhooks/apply";

export const runtime = "nodejs";

/**
 * Per-connection Evolution webhook. The connection id resolves the tenant and
 * the token (stored in `connection.meta.webhookToken`) authenticates the call
 * (Evolution doesn't sign webhooks). Handles inbound messages (inbox) and status
 * updates (campaign recipients + inbox messages).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string; token: string }> },
) {
  const { connectionId, token } = await params;

  const conn = await prisma.integrationConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, organizationId: true, provider: true, meta: true },
  });
  if (!conn || conn.provider !== "EVOLUTION") {
    return new Response("Unknown connection", { status: 404 });
  }
  const expected = (conn.meta as { webhookToken?: string } | null)?.webhookToken;
  if (!expected || token !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = body ? (JSON.parse(body) as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }

  const eventType = String(payload.event ?? payload.type ?? "unknown");
  const dedupeKey = `EVOLUTION:${conn.id}:${createHash("sha256").update(body).digest("hex")}`;

  try {
    await prisma.webhookEvent.create({
      data: {
        organizationId: conn.organizationId,
        provider: "EVOLUTION",
        eventType,
        dedupeKey,
        payload: payload as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return Response.json({ ok: true, duplicate: true });
    }
    console.error("[evolution-webhook] failed to store event", error);
    return new Response("error", { status: 500 });
  }

  const ev = eventType.toLowerCase();
  try {
    if (ev.includes("messages.upsert") || ev.includes("messages_upsert")) {
      for (const m of parseInboundMessages(payload)) {
        await ingestInbound(conn.organizationId, conn.id, m);
      }
    } else if (ev.includes("messages.update") || ev.includes("messages_update")) {
      const updates = parseDeliveryUpdates("EVOLUTION", payload);
      if (updates.length > 0) {
        await applyCampaignDeliveryUpdates(updates);
        await applyInboxMessageStatus(conn.organizationId, updates);
      }
    }
  } catch (error) {
    // Best-effort: never 500 on processing (the provider would just retry).
    console.error("[evolution-webhook] failed to process event", error);
  }

  return Response.json({ ok: true });
}

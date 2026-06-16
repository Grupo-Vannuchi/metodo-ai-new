import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { Prisma, type IntegrationProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PROVIDER_KEYS } from "@/lib/integrations/registry";
import {
  parseDeliveryUpdates,
  resolveTransition,
  type DeliveryUpdate,
  type RecipientStatusName,
} from "@/lib/integrations/webhooks/delivery";

export const runtime = "nodejs";

/**
 * Apply provider delivery acks to campaign recipients. Matches by the
 * provider's message id (stored on send) and only moves status forward. Runs as
 * system — the recipient row already carries its organizationId — and returns
 * the matched org (to stamp on the webhook event) or null if nothing matched.
 */
async function applyDeliveryUpdates(
  updates: DeliveryUpdate[],
): Promise<string | null> {
  let orgId: string | null = null;
  for (const u of updates) {
    const recipients = await prisma.campaignRecipient.findMany({
      where: { providerMessageId: u.providerMessageId },
      select: { id: true, status: true, organizationId: true },
    });
    for (const r of recipients) {
      orgId ??= r.organizationId;
      const next = resolveTransition(r.status as RecipientStatusName, u.status);
      if (!next) continue;
      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: {
          status: next,
          ...(next === "FAILED"
            ? { error: u.error || "Falha relatada pelo provedor." }
            : {}),
        },
      });
    }
  }
  return orgId;
}

/**
 * Inbound webhook sink. Stores each event idempotently (dedupe by a hash of the
 * provider + raw body) so retries don't double-process, then routes provider
 * delivery acks (Evolution / Meta Cloud) to the matching campaign recipients.
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

  // TODO(P9): verify provider signature (e.g. Meta X-Hub-Signature-256) once the
  // app secret is configured per-connection, before trusting the payload.
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

  // Route delivery acks to campaign recipients. Best-effort: a failure here must
  // not make us 500 (the provider would retry and re-store a duplicate).
  const updates = parseDeliveryUpdates(up as IntegrationProvider, payload);
  if (updates.length > 0) {
    try {
      const orgId = await applyDeliveryUpdates(updates);
      await prisma.webhookEvent.update({
        where: { dedupeKey },
        data: { processedAt: new Date(), organizationId: orgId ?? undefined },
      });
    } catch (error) {
      console.error("[webhook] failed to apply delivery updates", error);
    }
  }

  return Response.json({ ok: true });
}

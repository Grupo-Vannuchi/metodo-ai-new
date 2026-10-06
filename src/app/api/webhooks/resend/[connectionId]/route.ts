import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { webhookSecret } from "@/lib/email-broadcast/connection";
import { parseResendEvent, suppressionFor, TRANSITIONS, verifySvixSignature } from "@/lib/email-broadcast/webhook";
import { suppressEmail } from "@/lib/email-broadcast/suppression";

export const runtime = "nodejs";

/**
 * Delivery events for the mass e-mail, posted by the CLIENT's Resend account
 * (registered by ensureResendWebhook). Authorization: the Svix signature with
 * the per-connection secret, checked before anything else is trusted. The
 * connection row gives the org; every write filters by it. Separate from the
 * generic /api/webhooks/[provider] sink (Campaigns), which stays untouched.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const body = await req.text();

  const conn = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, provider: "RESEND" },
    select: { id: true, organizationId: true, meta: true },
  });
  if (!conn) return new Response("Unknown connection", { status: 404 });

  const secret = webhookSecret(conn.meta);
  const svixId = req.headers.get("svix-id");
  if (
    !secret ||
    !verifySvixSignature({
      secret,
      id: svixId,
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
      body,
    })
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const dedupeKey = `RESEND:${svixId}`;
  try {
    await prisma.webhookEvent.create({
      data: {
        organizationId: conn.organizationId,
        provider: "RESEND",
        eventType: String((payload as { type?: unknown })?.type ?? "unknown"),
        dedupeKey,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ ok: true, duplicate: true }); // Svix retry of an event we already have
    }
    console.error("[webhook:resend] failed to store event", error);
    return new Response("error", { status: 500 });
  }

  const event = parseResendEvent(payload);
  try {
    if (event) {
      const t = TRANSITIONS[event.type];
      await prisma.emailBroadcastRecipient.updateMany({
        where: { organizationId: conn.organizationId, providerMessageId: event.emailId, status: { in: t.from } },
        data: { status: t.to, ...(event.message ? { error: event.message.slice(0, 500) } : {}) },
      });
      const reason = suppressionFor(event);
      if (reason) {
        const r = await prisma.emailBroadcastRecipient.findFirst({
          where: { organizationId: conn.organizationId, providerMessageId: event.emailId },
          select: { id: true, email: true },
        });
        // An email_id from outside this module (same Resend account) matches nothing: ignored.
        if (r) await suppressEmail(conn.organizationId, r.email, reason, r.id);
      }
    }
    // Handled (including events we deliberately ignore): processedAt null means "stored but not applied".
    await prisma.webhookEvent.updateMany({
      where: { dedupeKey, organizationId: conn.organizationId },
      data: { processedAt: new Date() },
    });
  } catch (error) {
    console.error("[webhook:resend] failed to apply event", error);
    // Drop the stored event so the Svix retry is not short-circuited by the dedupe branch and the
    // event is reapplied. Safe: transitions are forward-only and suppression is createMany+skipDuplicates.
    try {
      await prisma.webhookEvent.deleteMany({ where: { dedupeKey, organizationId: conn.organizationId } });
    } catch (cleanupError) {
      console.error("[webhook:resend] failed to drop stored event", cleanupError);
    }
    return new Response("error", { status: 500 });
  }
  return Response.json({ ok: true });
}

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
 * connection row gives the org; every write filters by it. Events that are not
 * about one of this org's broadcast recipients are acknowledged but not stored. Separate from the
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

  // Only events about e-mails THIS module sent are stored (data minimization: the client's Resend
  // account also carries unrelated mail whose to/from/subject must not land here).
  const event = parseResendEvent(payload);
  if (!event) return Response.json({ ok: true, ignored: true });
  const recipient = await prisma.emailBroadcastRecipient.findFirst({
    where: { organizationId: conn.organizationId, providerMessageId: event.emailId },
    select: { id: true, email: true },
  });
  if (!recipient) return Response.json({ ok: true, ignored: true });

  // Per connection: Svix sends the same svix-id to every endpoint, and several companies can share one Resend key.
  const dedupeKey = `RESEND:${conn.id}:${svixId}`;
  try {
    await prisma.webhookEvent.create({
      data: {
        organizationId: conn.organizationId,
        provider: "RESEND",
        eventType: event.type,
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

  try {
    const t = TRANSITIONS[event.type];
    await prisma.emailBroadcastRecipient.updateMany({
      where: { organizationId: conn.organizationId, providerMessageId: event.emailId, status: { in: t.from } },
      data: { status: t.to, ...(event.message ? { error: event.message.slice(0, 500) } : {}) },
    });
    const reason = suppressionFor(event);
    if (reason) await suppressEmail(conn.organizationId, recipient.email, reason, recipient.id);
    // processedAt null means "stored but not applied".
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

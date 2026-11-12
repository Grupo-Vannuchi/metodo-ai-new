import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { parseResendEvent, suppressionFor, TRANSITIONS, verifySvixSignature } from "@/lib/email-broadcast/webhook";
import { suppressEmail } from "@/lib/email-broadcast/suppression";

export const runtime = "nodejs";

/**
 * Delivery events of the PLATFORM's Resend account, configured once in the
 * Resend dashboard (Webhooks → this URL) with its secret in
 * RESEND_WEBHOOK_SECRET. Authorization: the Svix signature, checked before
 * anything is trusted; without the secret every call is 401. The account also
 * carries login/invite/reset mail: events that don't match a mass e-mail
 * recipient are acknowledged and NOT stored. The org comes from the matched
 * recipient row (system context); every write filters by it. Separate from
 * the generic /api/webhooks/[provider] sink (Campaigns), which stays untouched.
 */
export async function POST(req: NextRequest) {
  const secret = env.RESEND_WEBHOOK_SECRET?.trim();
  const body = await req.text();
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

  const event = parseResendEvent(payload);
  if (!event) return Response.json({ ok: true, ignored: true });
  const recipient = await prisma.emailBroadcastRecipient.findFirst({
    where: { providerMessageId: event.emailId },
    select: { id: true, email: true, organizationId: true },
  });
  if (!recipient) return Response.json({ ok: true, ignored: true });
  const org = recipient.organizationId;

  const dedupeKey = `RESEND:email:${svixId}`;
  try {
    await prisma.webhookEvent.create({
      data: {
        organizationId: org,
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
    console.error("[webhook:email] failed to store event", error);
    return new Response("error", { status: 500 });
  }

  try {
    const t = TRANSITIONS[event.type];
    await prisma.emailBroadcastRecipient.updateMany({
      where: { organizationId: org, providerMessageId: event.emailId, status: { in: t.from } },
      data: { status: t.to, ...(event.message ? { error: event.message.slice(0, 500) } : {}) },
    });
    const reason = suppressionFor(event);
    if (reason) await suppressEmail(org, recipient.email, reason, recipient.id);
    // processedAt null means "stored but not applied".
    await prisma.webhookEvent.updateMany({
      where: { dedupeKey, organizationId: org },
      data: { processedAt: new Date() },
    });
  } catch (error) {
    console.error("[webhook:email] failed to apply event", error);
    // Drop the stored event so the Svix retry reapplies it. Safe: transitions are
    // forward-only and suppression is createMany+skipDuplicates.
    try {
      await prisma.webhookEvent.deleteMany({ where: { dedupeKey, organizationId: org } });
    } catch (cleanupError) {
      console.error("[webhook:email] failed to drop stored event", cleanupError);
    }
    return new Response("error", { status: 500 });
  }
  return Response.json({ ok: true });
}

import { env } from "@/lib/env";
import { safeEqualString, verifySignature } from "@/lib/whatsapp-cloud/signature";
import { parseCloudWebhook } from "@/lib/whatsapp-cloud/webhook-parser";
import { ingestCloudEvents } from "@/lib/whatsapp-cloud/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook da WhatsApp Cloud API (Meta → nós). PÚBLICO por necessidade — quem
 * chama é a Meta —, então autentica cada chamada aqui dentro (guia 05):
 *  - GET: aperto de mão da inscrição, só se hub.verify_token bater com
 *    META_WEBHOOK_VERIFY_TOKEN (sem a variável: 403, fail-closed).
 *  - POST: X-Hub-Signature-256 sobre os bytes crus com META_APP_SECRET (sem a
 *    variável: 401). A empresa sai de metadata.phone_number_id.
 * Depois da assinatura válida: 200 quando tudo foi gravado, quando o corpo não é
 * JSON e quando o número é desconhecido (nada a fazer); **500** quando algum
 * evento falhou de verdade (ex.: banco fora) — a Meta reenvia por até 7 dias e a
 * deduplicação pelo wamid torna o reenvio seguro.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && safeEqualString(token, expected)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return Response.json({ ok: true, ignored: true });
  }
  try {
    const { failed } = await ingestCloudEvents(parseCloudWebhook(payload));
    if (failed > 0) {
      console.error(`[wa-cloud] webhook processing failed (${failed} event(s))`);
      return Response.json({ ok: false }, { status: 500 });
    }
  } catch (error) {
    console.error("[wa-cloud] webhook processing failed", error);
    return Response.json({ ok: false }, { status: 500 });
  }
  return Response.json({ ok: true });
}

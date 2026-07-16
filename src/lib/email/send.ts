import "server-only";
import { env } from "@/lib/env";

/**
 * Transactional email via Resend (platform key). Distinct from the campaigns
 * email channel (which is BYO-key per tenant): this is the product's own sender
 * for verification, invites, password reset and welcome mails.
 *
 * Best-effort and self-contained: if the key/sender isn't configured it logs and
 * returns `not_configured` instead of throwing, so a missing env in dev can't
 * break a signup/invite flow. Callers decide whether a failure is fatal.
 */

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  /** Optional plain-text fallback (improves deliverability). */
  text?: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: "not_configured" | string };

export function isEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    console.warn("[email] RESEND_API_KEY / EMAIL_FROM not set — skipping send to", input.to);
    return { ok: false, error: "not_configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      const error = data.message || `Resend ${res.status}`;
      console.error("[email] send failed:", error);
      return { ok: false, error };
    }
    return { ok: true, id: data.id ?? null };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Erro ao enviar e-mail";
    console.error("[email] send threw:", error);
    return { ok: false, error };
  }
}

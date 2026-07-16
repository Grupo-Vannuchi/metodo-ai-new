"use server";

import { getOrgContext, hasRole } from "@/lib/tenant";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { renderTestEmail } from "@/lib/email/templates";

export type TestEmailResult =
  | { ok: true; to: string }
  | { ok: false; error: "unauthorized" | "not_configured" | "send_failed" };

/**
 * Send a transactional test email to the current admin's own address, so they
 * can confirm the domain/DKIM/SPF are working end-to-end before the product
 * relies on it (invites, verification, reset). Admin-only.
 */
export async function sendTestEmail(): Promise<TestEmailResult> {
  const ctx = await getOrgContext();
  if (!ctx || !hasRole(ctx.role, "ADMIN")) return { ok: false, error: "unauthorized" };
  if (!isEmailConfigured()) return { ok: false, error: "not_configured" };

  const { subject, html } = renderTestEmail({
    orgName: ctx.organization.name,
    requestedBy: ctx.user.name,
  });

  const res = await sendEmail({ to: ctx.user.email, subject, html });
  if (!res.ok) return { ok: false, error: "send_failed" };
  return { ok: true, to: ctx.user.email };
}

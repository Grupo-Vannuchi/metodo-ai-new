"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { makeRateLimiter } from "@/lib/ratelimit";
import {
  audienceSelectionSchema,
  broadcastDraftSchema,
  type BroadcastDraftInput,
} from "@/lib/validations/email-broadcast";
import { normalizeEmail } from "@/lib/email-broadcast/normalize";
import { resolveAudience } from "@/lib/email-broadcast/audience";
import { composeEmail } from "@/lib/email-broadcast/compose";
import { formatFrom } from "@/lib/email-broadcast/render";
import { getResendConnection } from "@/lib/email-broadcast/connection";
import { sendOne } from "@/lib/email-broadcast/resend";
import { emailUnsubscribePageUrl } from "@/lib/email-broadcast/unsubscribe";
import { searchEmailTargets as searchTargets } from "@/lib/queries/email-broadcasts";
import type { AudiencePreview, PickedTarget } from "@/lib/email-broadcast/types";

export type EmailActionError =
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "no_connection"
  | "empty"
  | "quota"
  | "provider"
  | "rate_limited"
  | "unknown";

export type EmailActionFail = {
  ok: false;
  error: EmailActionError;
  message?: string;
  remaining?: number;
  total?: number;
};

type Gate = { ok: true; ctx: OrgContext } | EmailActionFail;

/** Session + the "email" screen + the Marketing module — the same gates as
 * the route layout, repeated because server actions are public endpoints. */
async function gate(): Promise<Gate> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: true, ctx };
}

function hasBody(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}

export async function saveEmailDraft(
  id: string | null,
  input: BroadcastDraftInput,
): Promise<{ ok: true; id: string } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = broadcastDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const data = {
    subject: parsed.data.subject,
    html: parsed.data.html,
    fromName: parsed.data.fromName || null,
    replyTo: parsed.data.replyTo ? normalizeEmail(parsed.data.replyTo) : null,
    audience: parsed.data.audience as Prisma.InputJsonValue,
  };
  try {
    const db = tenantDb(g.ctx.organizationId);
    if (!id) {
      const created = await db.emailBroadcast.create({
        data: { organizationId: g.ctx.organizationId, createdById: g.ctx.userId, ...data },
      });
      revalidatePath("/app/email");
      return { ok: true, id: created.id };
    }
    // Only drafts are editable; count 0 = not this org's, or already sending.
    const res = await db.emailBroadcast.updateMany({ where: { id, status: "DRAFT" }, data });
    if (res.count === 0) return { ok: false, error: "not_found" };
    revalidatePath("/app/email");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to save email draft", error);
    return { ok: false, error: "unknown" };
  }
}

/** Only drafts can be deleted: a started send is history and counts in the quota. */
export async function deleteEmailDraft(id: string): Promise<{ ok: boolean }> {
  const g = await gate();
  if (!g.ok) return { ok: false };
  try {
    const res = await tenantDb(g.ctx.organizationId).emailBroadcast.deleteMany({ where: { id, status: "DRAFT" } });
    revalidatePath("/app/email");
    return { ok: res.count > 0 };
  } catch (error) {
    console.error("Failed to delete email draft", error);
    return { ok: false };
  }
}

export async function duplicateEmailBroadcast(id: string): Promise<{ ok: true; id: string } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const db = tenantDb(g.ctx.organizationId);
    const src = await db.emailBroadcast.findFirst({
      where: { id },
      select: { subject: true, html: true, fromName: true, replyTo: true, audience: true },
    });
    if (!src) return { ok: false, error: "not_found" };
    const created = await db.emailBroadcast.create({
      data: {
        organizationId: g.ctx.organizationId,
        createdById: g.ctx.userId,
        subject: src.subject,
        html: src.html,
        fromName: src.fromName,
        replyTo: src.replyTo,
        audience: (src.audience ?? {}) as Prisma.InputJsonValue,
      },
    });
    revalidatePath("/app/email");
    return { ok: true, id: created.id };
  } catch (error) {
    console.error("Failed to duplicate email broadcast", error);
    return { ok: false, error: "unknown" };
  }
}

/** Live summary for the composer: counts + a sample of who will receive it. */
export async function previewEmailAudience(
  selection: unknown,
): Promise<{ ok: true; preview: AudiencePreview } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = audienceSelectionSchema.safeParse(selection);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const { recipients, stats, invalidEmails } = await resolveAudience(g.ctx.organizationId, parsed.data);
    return {
      ok: true,
      preview: {
        stats,
        invalidEmails: invalidEmails.slice(0, 50),
        sample: recipients.slice(0, 100).map((r) => ({ email: r.email, name: r.name, sources: r.sources })),
      },
    };
  } catch (error) {
    console.error("Failed to preview email audience", error);
    return { ok: false, error: "unknown" };
  }
}

export async function searchEmailTargets(q: string): Promise<PickedTarget[]> {
  const g = await gate();
  if (!g.ok) return [];
  try {
    return await searchTargets(g.ctx.organizationId, String(q).slice(0, 100));
  } catch (error) {
    console.error("Failed to search email targets", error);
    return [];
  }
}

/** One copy to the logged-in user, through the client's Resend. Not recorded,
 * not counted in the quota. Surfaces Resend errors (e.g. unverified domain). */
export async function sendEmailTest(input: BroadcastDraftInput): Promise<{ ok: true; to: string } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = broadcastDraftSchema.safeParse(input);
  if (!parsed.success || !parsed.data.subject || !hasBody(parsed.data.html)) return { ok: false, error: "invalid" };

  const limiter = makeRateLimiter("email-test", 10, 60);
  if (limiter && !(await limiter.limit(g.ctx.userId)).success) return { ok: false, error: "rate_limited" };

  const conn = await getResendConnection(g.ctx.organizationId);
  if (!conn) return { ok: false, error: "no_connection" };

  const composed = composeEmail({
    subject: `[Teste] ${parsed.data.subject}`,
    bodyHtml: parsed.data.html,
    vars: { nome: g.ctx.user.name, empresa: g.ctx.organization.name },
    orgName: g.ctx.organization.name,
    // A preview link: the page answers "invalid link", which is right for a test.
    unsubscribeUrl: emailUnsubscribePageUrl("teste"),
  });
  const res = await sendOne(conn.apiKey, {
    from: formatFrom(parsed.data.fromName, conn.fromEmail),
    to: [g.ctx.user.email],
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    ...(parsed.data.replyTo ? { reply_to: normalizeEmail(parsed.data.replyTo) } : {}),
  });
  return res.ok ? { ok: true, to: g.ctx.user.email } : { ok: false, error: "provider", message: res.message };
}

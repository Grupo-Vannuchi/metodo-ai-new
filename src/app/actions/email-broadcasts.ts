"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import {
  audienceSelectionSchema,
  broadcastDraftSchema,
  type BroadcastDraftInput,
  readAudience,
} from "@/lib/validations/email-broadcast";
import { normalizeEmail } from "@/lib/email-broadcast/normalize";
import { resolveAudience } from "@/lib/email-broadcast/audience";
import { hasEmailContent } from "@/lib/email-broadcast/render";
import { platformResendKey } from "@/lib/email-broadcast/platform";
import { isSenderAllowed } from "@/lib/email-broadcast/sender-domain";
import { listSenderDomains } from "@/lib/queries/email-sender-domains";
import { searchEmailTargets as searchTargets, countEmailsSentThisMonth } from "@/lib/queries/email-broadcasts";
import { audit } from "@/lib/audit";
import { LIMITS } from "@/config/limits";
import { BATCH_SIZE, kickEmailBroadcast } from "@/lib/email-broadcast/dispatch";
import type { AudiencePreview, PickedTarget } from "@/lib/email-broadcast/types";

export type EmailActionError =
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "no_connection"
  | "empty"
  | "quota"
  | "domain_not_allowed"
  | "from_required"
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
    fromEmail: parsed.data.fromEmail ? normalizeEmail(parsed.data.fromEmail) : null,
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
      select: { subject: true, html: true, fromName: true, fromEmail: true, replyTo: true, audience: true },
    });
    if (!src) return { ok: false, error: "not_found" };
    const created = await db.emailBroadcast.create({
      data: {
        organizationId: g.ctx.organizationId,
        createdById: g.ctx.userId,
        subject: src.subject,
        html: src.html,
        fromName: src.fromName,
        fromEmail: src.fromEmail,
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

/**
 * DRAFT → SENDING: resolve the audience, check quota, materialize one row per
 * unique address (@@unique([broadcastId, email]) + skipDuplicates), then kick
 * the dispatcher. The DRAFT-only updateMany is the double-submit lock.
 */
export async function startEmailBroadcast(id: string): Promise<{ ok: true } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  const db = tenantDb(orgId);

  const b = await db.emailBroadcast.findFirst({
    where: { id },
    select: { id: true, status: true, subject: true, html: true, audience: true, fromEmail: true },
  });
  if (!b) return { ok: false, error: "not_found" };
  if (b.status !== "DRAFT") return { ok: false, error: "not_found" };
  if (!b.subject.trim() || !hasEmailContent(b.html)) return { ok: false, error: "invalid" };

  if (!platformResendKey()) return { ok: false, error: "no_connection" };
  if (!b.fromEmail) return { ok: false, error: "from_required" };
  // Server-side gate: the composer checks too, but only this decides.
  if (!isSenderAllowed(b.fromEmail, await listSenderDomains(orgId))) {
    return { ok: false, error: "domain_not_allowed" };
  }

  const { recipients, stats } = await resolveAudience(orgId, readAudience(b.audience));
  if (recipients.length === 0) return { ok: false, error: "empty" };

  // Addresses still queued in other in-flight sends count as used: no partial start.
  const queued = await db.emailBroadcastRecipient.count({
    where: { status: "QUEUED", broadcast: { status: { in: ["SENDING", "PAUSED"] } } },
  });
  const remaining = LIMITS.emailBroadcastQuotaPerMonth - ((await countEmailsSentThisMonth(orgId)) + queued);
  if (recipients.length > remaining) {
    return { ok: false, error: "quota", remaining: Math.max(0, remaining), total: recipients.length };
  }

  // Claim: only one request can move this draft forward. The fresh heartbeat
  // keeps a "Resume" click from starting a runner mid-materialization.
  const claimed = await db.emailBroadcast.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      status: "SENDING",
      stats: stats as Prisma.InputJsonValue,
      startedAt: new Date(),
      lastDispatchAt: new Date(),
      pausedReason: null,
      lastError: null,
    },
  });
  if (claimed.count === 0) return { ok: false, error: "not_found" };

  try {
    for (let i = 0; i < recipients.length; i += 1000) {
      await db.emailBroadcastRecipient.createMany({
        data: recipients.slice(i, i + 1000).map((r, j) => ({
          organizationId: orgId,
          broadcastId: id,
          email: r.email,
          name: r.name,
          companyName: r.companyName,
          sources: r.sources,
          contactId: r.contactId,
          companyId: r.companyId,
          batchNo: Math.floor((i + j) / BATCH_SIZE),
        })),
        skipDuplicates: true,
      });
    }
  } catch (error) {
    console.error("Failed to materialize email recipients", error);
    await db.emailBroadcastRecipient.deleteMany({ where: { broadcastId: id } });
    await db.emailBroadcast.updateMany({
      where: { id },
      data: { status: "DRAFT", startedAt: null, lastDispatchAt: null, stats: {} },
    });
    return { ok: false, error: "unknown" };
  }

  // Release the claim heartbeat so the dispatcher's lease can be taken now.
  await db.emailBroadcast.updateMany({ where: { id, status: "SENDING" }, data: { lastDispatchAt: null } });
  await audit(g.ctx, {
    action: "email_broadcast.started",
    entity: "EmailBroadcast",
    entityId: id,
    meta: { recipients: recipients.length },
  });
  await kickEmailBroadcast(id);
  revalidatePath("/app/email");
  revalidatePath(`/app/email/${id}`);
  return { ok: true };
}

/** PAUSED → SENDING (after the cause was fixed), or poke a stalled SENDING.
 * The dispatcher's lease guarantees a single runner either way. */
export async function resumeEmailBroadcast(id: string): Promise<{ ok: true } | EmailActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const db = tenantDb(g.ctx.organizationId);
  const b = await db.emailBroadcast.findFirst({ where: { id }, select: { status: true, fromEmail: true } });
  if (!b) return { ok: false, error: "not_found" };

  if (b.status === "PAUSED") {
    if (!platformResendKey()) return { ok: false, error: "no_connection" };
    if (!b.fromEmail || !isSenderAllowed(b.fromEmail, await listSenderDomains(g.ctx.organizationId))) {
      return { ok: false, error: "domain_not_allowed" };
    }
    const res = await db.emailBroadcast.updateMany({
      where: { id, status: "PAUSED" },
      data: { status: "SENDING", pausedReason: null, lastError: null, lastDispatchAt: null },
    });
    if (res.count === 0) return { ok: false, error: "not_found" };
  } else if (b.status !== "SENDING") {
    return { ok: false, error: "invalid" };
  }

  await kickEmailBroadcast(id);
  revalidatePath(`/app/email/${id}`);
  return { ok: true };
}

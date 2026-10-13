"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { sanitizeHtmlStable } from "@/lib/email-broadcast/compose";
import { emailSignatureSchema, type EmailSignatureInput } from "@/lib/validations/email-signature";
import {
  MAX_SIGNATURES,
  signatureContentFromForm,
  signatureProblem,
  type SignatureProblem,
} from "@/lib/email-broadcast/signature";

export type SignatureActionError =
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "limit"
  | "unknown"
  | SignatureProblem;

type Fail = { ok: false; error: SignatureActionError };
type Gate = { ok: true; ctx: OrgContext } | Fail;

/** Session + the "email" screen + the Marketing module — the same gates as the
 * E-mail route layout, repeated because server actions are public endpoints. */
async function gate(): Promise<Gate> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: true, ctx };
}

/** Make `id` the org's only default signature. */
async function makeDefault(organizationId: string, id: string): Promise<void> {
  const db = tenantDb(organizationId);
  await db.emailSignature.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
  await db.emailSignature.updateMany({ where: { id }, data: { isDefault: true } });
}

export async function saveEmailSignature(
  id: string | null,
  input: EmailSignatureInput,
): Promise<{ ok: true; id: string } | Fail> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = emailSignatureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const f = parsed.data;
  const content = signatureContentFromForm(f);
  // TEXT: validate what will be stored (the sanitized html), so a
  // script-only signature is refused instead of being saved empty.
  const cleanHtml = content.kind === "TEXT" ? sanitizeHtmlStable(content.html) : "";
  const problem =
    content.kind === "TEXT" ? signatureProblem({ kind: "TEXT", html: cleanHtml }) : signatureProblem(content);
  if (problem) return { ok: false, error: problem };

  const orgId = g.ctx.organizationId;
  const db = tenantDb(orgId);
  // Only the chosen kind's fields are kept; TEXT html is stored sanitized.
  const data =
    content.kind === "TEXT"
      ? { name: f.name, kind: "TEXT" as const, html: cleanHtml, imageUrl: null, imageAlt: null, imageHref: null, introText: null }
      : {
          name: f.name,
          kind: "IMAGE" as const,
          html: "",
          imageUrl: content.imageUrl,
          imageAlt: content.imageAlt,
          imageHref: content.imageHref,
          introText: content.introText,
        };
  try {
    let savedId: string;
    if (!id) {
      const count = await db.emailSignature.count({ where: { organizationId: orgId } });
      if (count >= MAX_SIGNATURES) return { ok: false, error: "limit" };
      const created = await db.emailSignature.create({ data: { organizationId: orgId, ...data } });
      savedId = created.id;
    } else {
      const res = await db.emailSignature.updateMany({ where: { id }, data });
      if (res.count === 0) return { ok: false, error: "not_found" };
      savedId = id;
    }
    if (f.isDefault) await makeDefault(orgId, savedId);
    else await db.emailSignature.updateMany({ where: { id: savedId }, data: { isDefault: false } });
    revalidatePath("/app/email/signatures");
    return { ok: true, id: savedId };
  } catch (error) {
    console.error("Failed to save email signature", error);
    return { ok: false, error: "unknown" };
  }
}

/** Drafts that chose it fall back to "no signature" (FK SET NULL); sends that
 * already started keep their frozen copy. */
export async function deleteEmailSignature(id: string): Promise<{ ok: true } | Fail> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const res = await tenantDb(g.ctx.organizationId).emailSignature.deleteMany({ where: { id } });
    if (res.count === 0) return { ok: false, error: "not_found" };
    revalidatePath("/app/email/signatures");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete email signature", error);
    return { ok: false, error: "unknown" };
  }
}

export async function setDefaultEmailSignature(id: string): Promise<{ ok: true } | Fail> {
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    const found = await tenantDb(orgId).emailSignature.findFirst({ where: { id }, select: { id: true } });
    if (!found) return { ok: false, error: "not_found" };
    await makeDefault(orgId, id);
    revalidatePath("/app/email/signatures");
    return { ok: true };
  } catch (error) {
    console.error("Failed to set the default email signature", error);
    return { ok: false, error: "unknown" };
  }
}

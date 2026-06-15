"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { contactSchema, type ContactInput } from "@/lib/validations/contact";
import { parseTags } from "@/lib/contact-form";

export type ContactActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

/**
 * Resolve a companyId, ensuring it belongs to this org (prevents linking a
 * contact to another tenant's company). Returns null when absent/invalid.
 */
async function resolveCompanyId(
  organizationId: string,
  companyId: string | undefined,
): Promise<string | null> {
  if (!companyId) return null;
  const db = tenantDb(organizationId);
  const found = await db.company.findFirst({
    where: { id: companyId },
    select: { id: true },
  });
  return found?.id ?? null;
}

export async function createContact(
  input: ContactInput,
): Promise<ContactActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const companyId = await resolveCompanyId(ctx.organizationId, parsed.data.companyId);
    const contact = await db.contact.create({
      data: {
        organizationId: ctx.organizationId,
        name: parsed.data.name,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        role: parsed.data.role || null,
        companyId,
        tags: parseTags(parsed.data.tags ?? ""),
        optedOut: parsed.data.optedOut ?? false,
        source: "manual",
      },
    });
    revalidatePath("/app/contacts");
    return { ok: true, id: contact.id };
  } catch (error) {
    console.error("Failed to create contact", error);
    return { ok: false, error: "unknown" };
  }
}

export async function updateContact(
  id: string,
  input: ContactInput,
): Promise<ContactActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const companyId = await resolveCompanyId(ctx.organizationId, parsed.data.companyId);
    const res = await db.contact.updateMany({
      where: { id },
      data: {
        name: parsed.data.name,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        role: parsed.data.role || null,
        companyId,
        tags: parseTags(parsed.data.tags ?? ""),
        optedOut: parsed.data.optedOut ?? false,
      },
    });
    if (res.count === 0) return { ok: false, error: "unknown" };
    revalidatePath("/app/contacts");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update contact", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteContact(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    await db.contact.deleteMany({ where: { id } });
    revalidatePath("/app/contacts");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete contact", error);
    return { ok: false };
  }
}

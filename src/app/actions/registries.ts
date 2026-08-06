"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

const KINDS = ["category", "unit", "warehouse"] as const;
type Kind = (typeof KINDS)[number];
function isKind(k: string): k is Kind {
  return (KINDS as readonly string[]).includes(k);
}

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  extra: z.string().trim().max(120).optional().default(""),
  active: z.boolean().default(true),
});

export async function saveRegistry(kind: string, id: string | null, input: unknown): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx || !isKind(kind)) return { ok: false };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false };
  const name = p.data.name.trim();
  const extra = p.data.extra?.trim() || null;
  const active = p.data.active;
  const org = ctx.organizationId;
  const db = tenantDb(org);
  try {
    if (kind === "category") {
      if (id) await db.supplyCategory.updateMany({ where: { id }, data: { name, active } });
      else await db.supplyCategory.create({ data: { organizationId: org, name, active } });
    } else if (kind === "unit") {
      if (id) await db.supplyUnit.updateMany({ where: { id }, data: { name, abbreviation: extra, active } });
      else await db.supplyUnit.create({ data: { organizationId: org, name, abbreviation: extra, active } });
    } else {
      if (id) await db.warehouse.updateMany({ where: { id }, data: { name, location: extra, active } });
      else await db.warehouse.create({ data: { organizationId: org, name, location: extra, active } });
    }
    revalidatePath("/app/supplies/registries");
    return { ok: true };
  } catch (e) {
    console.error("saveRegistry failed", e);
    return { ok: false };
  }
}

export async function deleteRegistry(kind: string, id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx || !isKind(kind)) return { ok: false };
  const db = tenantDb(ctx.organizationId);
  try {
    if (kind === "category") await db.supplyCategory.deleteMany({ where: { id } });
    else if (kind === "unit") await db.supplyUnit.deleteMany({ where: { id } });
    else await db.warehouse.deleteMany({ where: { id } });
    revalidatePath("/app/supplies/registries");
    return { ok: true };
  } catch (e) {
    console.error("deleteRegistry failed", e);
    return { ok: false };
  }
}

import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { listTemplatesPage, type TemplateRow } from "@/lib/whatsapp-cloud/meta-api";

const MAX_PAGES = 20;

/**
 * Espelha os modelos da WABA no banco da empresa. Modelo que sumiu da Meta não é
 * apagado (uma campanha pode apontar para ele): vira status DELETED.
 */
export async function syncTemplates(
  organizationId: string,
  wabaId: string,
  token: string,
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const rows: TemplateRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listTemplatesPage(wabaId, token, after);
    if (!res.ok) return { ok: false, message: res.message };
    rows.push(...(res.data.data ?? []));
    after = res.data.paging?.next ? res.data.paging.cursors?.after : undefined;
    if (!after) break;
  }

  const db = tenantDb(organizationId);
  const now = new Date();
  for (const t of rows) {
    const data = {
      metaId: String(t.id),
      category: t.category ?? "",
      status: t.status ?? "",
      parameterFormat: (t.parameter_format ?? "POSITIONAL").toUpperCase(),
      components: (t.components ?? []) as Prisma.InputJsonValue,
      rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
      syncedAt: now,
    };
    const existing = await db.whatsappCloudTemplate.findFirst({
      where: { wabaId, name: t.name, language: t.language },
      select: { id: true },
    });
    if (existing) {
      await db.whatsappCloudTemplate.updateMany({ where: { id: existing.id }, data });
    } else {
      await db.whatsappCloudTemplate.create({
        data: { organizationId, wabaId, name: t.name, language: t.language, ...data },
      });
    }
  }
  await db.whatsappCloudTemplate.updateMany({
    where: { wabaId, syncedAt: { lt: now } },
    data: { status: "DELETED" },
  });
  return { ok: true, count: rows.length };
}

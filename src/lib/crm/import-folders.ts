import "server-only";
import type { tenantDb } from "@/lib/tenant-db";

/**
 * Auto-filing for bulk imports: every batch brought into the CRM (a prospecting
 * run, a WhatsApp contact export) lands in its own folder, so what just arrived
 * is separable from the rest instead of dissolving into the full list.
 *
 * Folders are found-or-created by name, which makes re-importing the same batch
 * idempotent — a second pass over the same prospecting job files into the folder
 * it already created rather than a duplicate.
 */

type Db = ReturnType<typeof tenantDb>;

/** Collapse whitespace and cap the length so a generated name stays readable. */
function clean(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 80) || "Importação";
}

export async function ensureContactFolder(
  db: Db,
  organizationId: string,
  rawName: string,
): Promise<string> {
  const name = clean(rawName);
  const existing = await db.contactFolder.findFirst({ where: { name }, select: { id: true } });
  if (existing) return existing.id;
  const order = await db.contactFolder.count();
  const folder = await db.contactFolder.create({
    data: { organizationId, name, order },
    select: { id: true },
  });
  return folder.id;
}

export async function ensureCompanyFolder(
  db: Db,
  organizationId: string,
  rawName: string,
): Promise<string> {
  const name = clean(rawName);
  const existing = await db.companyFolder.findFirst({ where: { name }, select: { id: true } });
  if (existing) return existing.id;
  const order = await db.companyFolder.count();
  const folder = await db.companyFolder.create({
    data: { organizationId, name, order },
    select: { id: true },
  });
  return folder.id;
}

/**
 * Defer folder creation until something is actually filed into it, so an import
 * that ends up creating nothing (everything was a duplicate) doesn't leave an
 * empty folder behind. The promise is cached, so concurrent callers within one
 * batch share a single folder.
 */
export function lazyFolder(create: () => Promise<string>): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => (pending ??= create());
}

const dmy = (d: Date) => d.toLocaleDateString("pt-BR");

/** Name for a prospecting job's folder. Derived from the job (its search terms +
 * when it ran), never from "now", so every import of the same job matches. */
export function prospectingFolderName(query: unknown, createdAt: Date): string {
  const q = (query ?? {}) as Record<string, string>;
  const terms = [q.nome, q.segmento, q.localidade, q.cnpj]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  return `Prospecção · ${terms || "Busca"} · ${dmy(createdAt)}`;
}

/** Name for a WhatsApp contact import. Includes the time so separate runs stay
 * separate batches; the group name already distinguishes group imports. */
export function whatsappFolderName(label: string, when: Date): string {
  const time = when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `WhatsApp · ${label} · ${dmy(when)} ${time}`;
}

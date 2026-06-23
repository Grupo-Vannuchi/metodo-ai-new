import "server-only";
import type { TeamChatAttachmentType } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";

export type ResolvedAttachment = { label: string; href: string };

/** Resolve a CRM entity's display label + link from its id (org-scoped via the
 * tenant client). Snapshotted onto messages/posts so they render without N+1
 * lookups and survive the entity changing. Shared by team-chat and the feed. */
export async function resolveAttachment(
  db: TenantDb,
  type: TeamChatAttachmentType,
  id: string,
): Promise<ResolvedAttachment | null> {
  switch (type) {
    case "TASK": {
      const x = await db.task.findFirst({ where: { id }, select: { title: true } });
      return x ? { label: x.title, href: `/app/tasks/${id}` } : null;
    }
    case "CONTACT": {
      const x = await db.contact.findFirst({ where: { id }, select: { name: true } });
      return x ? { label: x.name, href: `/app/contacts/${id}` } : null;
    }
    case "COMPANY": {
      const x = await db.company.findFirst({ where: { id }, select: { name: true } });
      return x ? { label: x.name, href: `/app/companies/${id}` } : null;
    }
    case "OPP": {
      const x = await db.opportunity.findFirst({ where: { id }, select: { title: true, code: true } });
      return x ? { label: x.code ? `${x.code} · ${x.title}` : x.title, href: `/app/crm/${id}` } : null;
    }
    case "LEAD": {
      const x = await db.extractedLead.findFirst({ where: { id }, select: { name: true, phone: true, jobId: true } });
      return x ? { label: x.name || x.phone || "Lead", href: `/app/prospecting/${x.jobId}` } : null;
    }
    default:
      return null;
  }
}

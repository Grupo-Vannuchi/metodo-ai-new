import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/**
 * "Enviar ao funil" of the contacts screen (src/app/actions/bulk.ts): each picked contact becomes an opportunity in the
 * chosen stage. Made for the members of a WhatsApp group, which "Adicionar aos contatos" files in a folder named after the
 * group (request of 05/06: group leads go to the funnel), but it takes any selection. Kept out of the "use server" file so it
 * never becomes a public server action and a local check can run it.
 *
 * - A contact that already has an OPEN opportunity (any funnel) is skipped: sending a folder twice opens nothing twice.
 * - The opportunity takes the contact's name as title, its company, the product (and its price as value) when one is
 *   picked, and the sender as owner and creator.
 * - No automation runs: one rule of "opportunity created" that sends WhatsApp would message a whole group at once.
 */

/** At most this many contacts per send (one WhatsApp group has up to 1024 members). */
export const FUNNEL_SEND_MAX = 1000;

export type FunnelSendInput = { contactIds: string[]; stageId: string; productServiceId?: string | null };

/** `null` when the stage or the product is not of this organization. */
export type FunnelSendResult = { created: number; skipped: number } | null;

export async function sendContactsToFunnel(
  organizationId: string,
  userId: string,
  input: FunnelSendInput,
): Promise<FunnelSendResult> {
  const db = tenantDb(organizationId);
  const ids = [...new Set(input.contactIds)];

  const stage = await db.stage.findFirst({ where: { id: input.stageId }, select: { id: true, pipelineId: true } });
  if (!stage) return null;

  let productServiceId: string | null = null;
  let value = 0;
  if (input.productServiceId) {
    const product = await db.productService.findFirst({
      where: { id: input.productServiceId },
      select: { id: true, price: true },
    });
    if (!product) return null;
    productServiceId = product.id;
    value = Number(product.price ?? 0);
  }

  // Only this organization's contacts (a forged or deleted id is simply not found), in the order they were picked.
  const found = await db.contact.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, companyId: true } });
  const byId = new Map(found.map((c) => [c.id, c]));
  const open = await db.opportunity.findMany({
    where: { contactId: { in: found.map((c) => c.id) }, status: "OPEN" },
    select: { contactId: true },
  });
  const withOpen = new Set(open.map((o) => o.contactId));
  const picked = ids.flatMap((id) => {
    const c = byId.get(id);
    return c && !withOpen.has(c.id) ? [c] : [];
  });
  if (picked.length === 0) return { created: 0, skipped: ids.length };

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  // Same numbering as createOpportunity (per org and year), taken and used in one transaction; the cards go to the end of
  // the stage, in the order picked. organizationId by hand, as in every write here.
  const created = await db.$transaction(async (tx) => {
    const order = await tx.opportunity.count({ where: { organizationId, stageId: stage.id } });
    const last = await tx.opportunity.findFirst({
      where: { organizationId, seqYear: year },
      orderBy: { seqNumber: "desc" },
      select: { seqNumber: true },
    });
    const first = (last?.seqNumber ?? 0) + 1;
    const res = await tx.opportunity.createMany({
      data: picked.map((c, i) => ({
        organizationId,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        title: c.name,
        value,
        contactId: c.id,
        companyId: c.companyId,
        productServiceId,
        ownerId: userId,
        createdById: userId,
        order: order + i,
        seqYear: year,
        seqNumber: first + i,
        code: `${String(first + i).padStart(4, "0")}/${yy}`,
      })),
    });
    return res.count;
  });

  return { created, skipped: ids.length - created };
}

"use server";

import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeSig } from "@/lib/unsubscribe";

/**
 * Public opt-out. No session: the HMAC signature authorizes the change, so we
 * can update the contact by id directly.
 */
export async function unsubscribeContact(
  contactId: string,
  sig: string,
): Promise<{ ok: boolean }> {
  if (!verifyUnsubscribeSig(contactId, sig)) return { ok: false };
  try {
    await prisma.contact.update({
      where: { id: contactId },
      data: { optedOut: true },
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

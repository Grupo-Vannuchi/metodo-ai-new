"use server";

import { verifyEmailUnsubscribeSig } from "@/lib/email-broadcast/unsubscribe";
import { unsubscribeRecipient } from "@/lib/email-broadcast/suppression";

/**
 * Public on purpose (no session): the HMAC in the link authorizes blocking
 * that one recipient's address for the org that sent it.
 */
export async function confirmEmailUnsubscribe(recipientId: string, sig: string): Promise<{ ok: boolean }> {
  if (!verifyEmailUnsubscribeSig(String(recipientId), String(sig))) return { ok: false };
  try {
    return await unsubscribeRecipient(recipientId);
  } catch (error) {
    console.error("Failed to unsubscribe email recipient", error);
    return { ok: false };
  }
}

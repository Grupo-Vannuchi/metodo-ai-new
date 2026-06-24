import "server-only";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { loadEvoCredsById } from "@/lib/integrations/evolution-creds";
import { fetchProfilePictureUrl } from "@/lib/integrations/evolution-client";

/** Refresh a conversation's avatar at most once a week. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolve a conversation's WhatsApp profile picture on demand, triggered by the
 * inbox when it renders a conversation we haven't checked recently. Cached for a
 * week (avatarCheckedAt) so we don't hammer Evolution; stores just the URL (no
 * download) to stay light. Org-scoped ownership; never throws.
 */
export async function syncConversationAvatar(
  organizationId: string,
  conversationId: string,
  now: Date,
  force = false,
): Promise<{ avatarUrl: string | null }> {
  const db = tenantDb(organizationId);
  const conv = await db.conversation.findFirst({
    where: { id: conversationId },
    select: { remoteJid: true, connectionId: true, avatarUrl: true, avatarCheckedAt: true },
  });
  if (!conv) return { avatarUrl: null };

  const fresh = conv.avatarCheckedAt && now.getTime() - conv.avatarCheckedAt.getTime() < TTL_MS;
  if (fresh && !force) return { avatarUrl: conv.avatarUrl };

  try {
    const creds = await loadEvoCredsById(conv.connectionId);
    const number = conv.remoteJid.split("@")[0] ?? "";
    const url = creds && number ? await fetchProfilePictureUrl(creds, number) : null;
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { avatarUrl: url, avatarCheckedAt: now },
    });
    return { avatarUrl: url };
  } catch (error) {
    console.error(`[avatar:${conversationId}] failed`, error);
    // Stamp the check so a transient failure doesn't cause a fetch storm.
    await prisma.conversation
      .update({ where: { id: conversationId }, data: { avatarCheckedAt: now } })
      .catch(() => {});
    return { avatarUrl: conv.avatarUrl };
  }
}

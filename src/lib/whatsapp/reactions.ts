import "server-only";

/** One emoji reaction on a message. WhatsApp allows a single reaction per
 * participant, so entries are keyed by (fromMe, senderName). */
export type Reaction = { emoji: string; fromMe: boolean; senderName?: string | null };

const reactionKey = (r: { fromMe: boolean; senderName?: string | null }) => `${r.fromMe}:${r.senderName ?? ""}`;

/** Apply a participant's reaction to the stored list: replaces their previous
 * reaction, or removes it when the emoji is empty (WhatsApp "un-react"). */
export function applyReaction(
  current: unknown,
  next: { emoji: string; fromMe: boolean; senderName?: string | null },
): Reaction[] {
  const list: Reaction[] = Array.isArray(current)
    ? (current.filter(
        (r) => r && typeof r === "object" && typeof (r as Reaction).emoji === "string",
      ) as Reaction[])
    : [];
  const filtered = list.filter((r) => reactionKey(r) !== reactionKey(next));
  if (next.emoji && next.emoji.trim()) {
    filtered.push({ emoji: next.emoji, fromMe: next.fromMe, senderName: next.senderName ?? null });
  }
  return filtered;
}

/** The current user's own reaction emoji on a message, if any. */
export function myReaction(current: unknown): string | null {
  if (!Array.isArray(current)) return null;
  const mine = (current as Reaction[]).find((r) => r && r.fromMe && typeof r.emoji === "string");
  return mine?.emoji ?? null;
}

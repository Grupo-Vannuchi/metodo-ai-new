/** Quick-reaction emoji set for the team feed (client + server). Reactions are
 * validated against this allow-list so arbitrary input can't be stored. */
export const FEED_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "👏"] as const;
export type FeedEmoji = (typeof FEED_EMOJIS)[number];

/** Posts live for 24h (ephemeral feed — LGPD-friendly, auto-cleaned). */
export const FEED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Formas que a tela oficial recebe do servidor. Datas chegam como Date na
 * primeira renderização (RSC) e como string no polling (JSON) — por isso
 * `string | Date`.
 */
export type ConversationItem = {
  id: string;
  waId: string | null;
  bsuid: string | null;
  username: string | null;
  profileName: string | null;
  contactId: string | null;
  contactName: string | null;
  lastInboundAt: string | Date | null;
  lastMessageAt: string | Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
};

export type MessageItem = {
  id: string;
  wamid: string | null;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  templateName: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  mediaStatus: string | null;
  status: string | null;
  errorMessage: string | null;
  reactions: unknown;
  quotedWamid: string | null;
  quotedBody: string | null;
  timestamp: string | Date;
};

export type Reaction = { emoji: string; fromMe: boolean };

export function displayName(c: ConversationItem): string {
  return c.contactName || c.profileName || (c.username ? `@${c.username}` : "") || (c.waId ? `+${c.waId}` : "") || "—";
}

export function initials(name: string): string {
  const parts = name.replace(/[@+]/g, "").trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function reactionsOf(v: unknown): Reaction[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (r): r is Reaction => !!r && typeof r === "object" && typeof (r as Reaction).emoji === "string",
  );
}

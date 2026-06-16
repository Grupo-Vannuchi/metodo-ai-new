import type { IntegrationProvider } from "@prisma/client";

/**
 * Delivery-status mapping for inbound provider webhooks (P6 refinement).
 *
 * Providers report message acknowledgements asynchronously: Evolution/Baileys
 * via MESSAGES_UPDATE acks, Meta Cloud via the `statuses[]` array. This module
 * is the PURE translation layer — it parses a raw webhook payload into a flat
 * list of {providerMessageId, status} updates, and decides the forward-only
 * transition for a recipient. No DB / `server-only` so it stays unit-testable;
 * the route does the actual CampaignRecipient writes.
 */

export type DeliveryStatus = "DELIVERED" | "READ" | "FAILED";

export type DeliveryUpdate = {
  providerMessageId: string;
  status: DeliveryStatus;
  error?: string;
};

type Json = Record<string, unknown>;

function asArray(value: unknown): Json[] {
  if (Array.isArray(value)) return value as Json[];
  if (value && typeof value === "object") return [value as Json];
  return [];
}

/**
 * Baileys ack → our status. Evolution may send the ack as a number (2/3/4/5),
 * the Baileys enum name (SERVER_ACK/DELIVERY_ACK/READ/PLAYED) or a plain word.
 * SERVER_ACK (2) means "reached the server" — that's our existing SENT, so it
 * maps to null (no advance).
 */
function evolutionStatus(raw: unknown): DeliveryStatus | null {
  const s = String(raw ?? "").toUpperCase();
  if (s === "3" || s === "DELIVERY_ACK" || s === "DELIVERED") return "DELIVERED";
  if (s === "4" || s === "5" || s === "READ" || s === "PLAYED") return "READ";
  if (s === "0" || s === "ERROR") return "FAILED";
  return null;
}

function parseEvolution(payload: Json): DeliveryUpdate[] {
  const out: DeliveryUpdate[] = [];
  for (const row of asArray(payload.data)) {
    const key = row.key as Json | undefined;
    const update = row.update as Json | undefined;
    const id =
      (row.keyId as string | undefined) ??
      (key?.id as string | undefined) ??
      (row.id as string | undefined);
    const status = evolutionStatus(row.status ?? update?.status);
    if (id && status) out.push({ providerMessageId: id, status });
  }
  return out;
}

function metaStatus(raw: unknown): DeliveryStatus | null {
  switch (String(raw ?? "").toLowerCase()) {
    case "delivered":
      return "DELIVERED";
    case "read":
      return "READ";
    case "failed":
      return "FAILED";
    default:
      return null; // "sent" → already SENT
  }
}

function parseMetaCloud(payload: Json): DeliveryUpdate[] {
  const out: DeliveryUpdate[] = [];
  for (const entry of asArray(payload.entry)) {
    for (const change of asArray(entry.changes)) {
      const value = change.value as Json | undefined;
      for (const st of asArray(value?.statuses)) {
        const id = st.id as string | undefined;
        const status = metaStatus(st.status);
        if (!id || !status) continue;
        const firstError = asArray(st.errors)[0];
        const error = firstError
          ? String(firstError.title ?? firstError.message ?? "")
          : undefined;
        out.push({ providerMessageId: id, status, error });
      }
    }
  }
  return out;
}

/** Parse a raw webhook payload into delivery-status updates for our provider. */
export function parseDeliveryUpdates(
  provider: IntegrationProvider,
  payload: Json,
): DeliveryUpdate[] {
  if (provider === "EVOLUTION") return parseEvolution(payload);
  if (provider === "META_CLOUD") return parseMetaCloud(payload);
  return [];
}

export type RecipientStatusName =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED";

const RANK: Record<RecipientStatusName, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: -1,
};

/**
 * Decide the recipient's next status given an incoming event, or null to ignore
 * it. Transitions are forward-only (a late DELIVERED can't undo a READ), a sent
 * message that already reached DELIVERED/READ is never retroactively FAILED, and
 * a FAILED recipient is never resurrected by a stray ack.
 */
export function resolveTransition(
  current: RecipientStatusName,
  update: DeliveryStatus,
): RecipientStatusName | null {
  if (update === "FAILED") {
    return current === "PENDING" || current === "SENT" ? "FAILED" : null;
  }
  if (current === "FAILED") return null;
  return RANK[update] > RANK[current] ? update : null;
}

/**
 * Status das NOSSAS mensagens (puro). Webhooks de status chegam fora de ordem e
 * repetidos; só avançamos (um `delivered` atrasado não desfaz um `read`), uma
 * mensagem já entregue nunca vira falha e uma falha nunca ressuscita.
 */
export type CloudMessageStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

const RANK = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 } as const;

export function nextMessageStatus(
  current: CloudMessageStatus | null,
  incoming: CloudMessageStatus,
): CloudMessageStatus | null {
  const cur = current ?? "PENDING";
  if (incoming === "PENDING") return null;
  if (incoming === "FAILED") return cur === "PENDING" || cur === "SENT" ? "FAILED" : null;
  if (cur === "FAILED") return null;
  return RANK[incoming] > RANK[cur] ? incoming : null;
}

/**
 * Janela de atendimento de 24h (puro — roda no servidor e no navegador). A Meta
 * só aceita mensagem livre até 24h depois da última mensagem do cliente; fora
 * dela, só modelo aprovado passa (erro 131047).
 */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowClosesAt(lastInboundAt: Date | string | null | undefined): Date | null {
  if (!lastInboundAt) return null;
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + WINDOW_MS);
}

export function isWindowOpen(
  lastInboundAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  const closes = windowClosesAt(lastInboundAt);
  return closes !== null && now.getTime() < closes.getTime();
}

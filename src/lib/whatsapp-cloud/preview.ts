/**
 * Textos curtos da lista de conversas e da citação (puro). Em pt, gravados no
 * banco — mesma convenção do inbox atual.
 */
const LABEL: Record<string, string> = {
  IMAGE: "📷 Imagem",
  VIDEO: "🎬 Vídeo",
  AUDIO: "🎧 Áudio",
  DOCUMENT: "📄 Documento",
  STICKER: "Figurinha",
  LOCATION: "📍 Localização",
  TEMPLATE: "📋 Modelo",
  UNSUPPORTED: "Mensagem não suportada",
};

export function previewFor(type: string, body: string | null | undefined): string {
  const text = (body ?? "").trim();
  if (type === "TEXT" || type === "TEMPLATE") return (text || LABEL[type] || "").slice(0, 200);
  const label = LABEL[type] ?? "Mensagem";
  return (text ? `${label}: ${text}` : label).slice(0, 200);
}

export function quotedLabel(type: string, body: string | null | undefined): string {
  return ((body ?? "").trim() || LABEL[type] || "[mensagem]").slice(0, 300);
}

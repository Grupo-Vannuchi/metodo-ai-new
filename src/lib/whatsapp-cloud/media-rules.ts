/**
 * Mídia aceita pela WhatsApp Cloud API (puro). Tabela oficial (set/2026):
 * imagem JPEG/PNG ≤ 5 MB; vídeo MP4/3GP ≤ 16 MB; áudio AAC/AMR/MP3/M4A/OGG-Opus
 * ≤ 16 MB; documento PDF/Office/TXT ≤ 100 MB. GIF não é aceito.
 * O tipo real vem dos bytes (sniffMime), não da extensão que o navegador mandou.
 */
export type OutboundKind = "image" | "video" | "audio" | "document";

const MB = 1024 * 1024;

const OOXML = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
const OLE = ["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"];

export const OUTBOUND_RULES: Record<OutboundKind, { mimes: readonly string[]; maxBytes: number }> = {
  image: { mimes: ["image/jpeg", "image/png"], maxBytes: 5 * MB },
  video: { mimes: ["video/mp4", "video/3gpp"], maxBytes: 16 * MB },
  audio: { mimes: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"], maxBytes: 16 * MB },
  document: { mimes: ["application/pdf", "text/plain", ...OOXML, ...OLE], maxBytes: 100 * MB },
};

/** Teto de leitura do upload (o maior limite da tabela). */
export const MAX_UPLOAD_BYTES = 100 * MB;

const baseMime = (mime: string | null | undefined) => (mime ?? "").split(";")[0].trim().toLowerCase();

export function kindForMime(mime: string): OutboundKind | null {
  const m = baseMime(mime);
  for (const kind of Object.keys(OUTBOUND_RULES) as OutboundKind[]) {
    if (OUTBOUND_RULES[kind].mimes.includes(m)) return kind;
  }
  return null;
}

export type MediaCheck =
  | { ok: true; kind: OutboundKind; mime: string }
  | { ok: false; reason: "unsupported_type" | "too_large" | "file_empty" };

export function checkOutboundMedia(mime: string | null, size: number): MediaCheck {
  if (size <= 0) return { ok: false, reason: "file_empty" };
  const m = baseMime(mime);
  const kind = m ? kindForMime(m) : null;
  if (!kind) return { ok: false, reason: "unsupported_type" };
  if (size > OUTBOUND_RULES[kind].maxBytes) return { ok: false, reason: "too_large" };
  return { ok: true, kind, mime: m };
}

/**
 * Tipo real pelos primeiros bytes. Contêineres ambíguos (ZIP do Office, OLE do
 * Office antigo) e texto puro dependem do tipo declarado para desempatar.
 */
export function sniffMime(bytes: Uint8Array, declared: string): string | null {
  const b = bytes;
  const d = baseMime(declared);
  const starts = (sig: number[], off = 0) => sig.every((x, i) => b[off + i] === x);
  const ascii = (s: string, off = 0) => starts([...s].map((c) => c.charCodeAt(0)), off);

  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (ascii("GIF8")) return "image/gif";
  if (ascii("%PDF")) return "application/pdf";
  if (ascii("OggS")) return "audio/ogg";
  if (ascii("#!AMR")) return "audio/amr";
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "audio/aac";
  if (ascii("ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii("ftyp", 4)) {
    const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
    if (brand.startsWith("3gp")) return "video/3gpp";
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
    return d === "audio/mp4" ? "audio/mp4" : "video/mp4";
  }
  if (starts([0x50, 0x4b, 0x03, 0x04])) return OOXML.includes(d) ? d : null;
  if (starts([0xd0, 0xcf, 0x11, 0xe0])) return OLE.includes(d) ? d : null;
  if (d === "text/plain" && !b.subarray(0, 1024).includes(0)) return "text/plain";
  return null;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export function extensionFor(mime: string | null): string {
  return EXT[baseMime(mime)] ?? "bin";
}

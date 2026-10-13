/**
 * Attachment rules of the mass e-mail (spec 2026-10-09). Pure and free of
 * `server-only`: the composer, the upload route, the actions, the dispatcher
 * and scripts/check-email-broadcast.ts all use it.
 */

export const MAX_ATTACHMENTS = 10;
/** Total of all attachments of one send (also the cap for a single file). */
export const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
const MAX_NAME = 150;
const MAX_STEM = 60;
/** One e-mail per call at PACE_MS (dispatch.ts) = ~2 e-mails/s. */
const SECONDS_PER_EMAIL = 0.5;

/** Allowed extensions → the content type sent to Resend. Never the browser's MIME. */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/** `accept` attribute of the composer's file input. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export type EmailAttachment = { key: string; filename: string; size: number };

export type AttachmentProblem = "count" | "type" | "total" | "key";

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_TAIL_RE = new RegExp(`^${UUID_RE}-[A-Za-z0-9._-]{1,${MAX_STEM}}\\.[a-z0-9]{1,5}$`);

/** Allowed extension of `filename` in lowercase, or null. Needs a name before the dot. */
export function attachmentExtension(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, ext) ? ext : null;
}

export function attachmentContentType(filename: string): string | null {
  const ext = attachmentExtension(filename);
  return ext ? ATTACHMENT_TYPES[ext] : null;
}

/** Display/e-mail name: last path segment, whitespace collapsed, control chars
 * dropped, capped at 150 keeping the extension. Null when nothing valid is left. */
export function cleanAttachmentName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // Control chars go first (whitespace ones like tab stay for the collapse), so
  // cleaning an already clean name returns it unchanged.
  const name = Array.from(base)
    .filter((c) => {
      const code = c.charCodeAt(0);
      return /\s/.test(c) || (code > 31 && code !== 127);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!attachmentExtension(name)) return null;
  if (name.length <= MAX_NAME) return name;
  // Cut at a code-point boundary (never inside a surrogate pair); the limit is in UTF-16 units.
  const suffix = name.slice(name.lastIndexOf("."));
  const room = MAX_NAME - suffix.length;
  let kept = "";
  for (const cp of Array.from(name.slice(0, name.length - suffix.length))) {
    if (kept.length + cp.length > room) break;
    kept += cp;
  }
  return `${kept.trimEnd()}${suffix}`;
}

/** Storage key of an uploaded attachment: ASCII-only, inside the org's folder. */
export function attachmentStorageKey(orgId: string, uuid: string, filename: string): string {
  const ext = attachmentExtension(filename) ?? "bin";
  const dot = filename.lastIndexOf(".");
  const stem =
    filename
      .slice(0, dot > 0 ? dot : filename.length)
      .normalize("NFD")
      .split("")
      .filter((c) => {
        const n = c.charCodeAt(0); // drop combining marks U+0300-U+036F
        return n < 0x300 || n > 0x36f;
      })
      .join("")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, MAX_STEM) || "arquivo";
  return `email-attachments/${orgId}/${uuid}-${stem}.${ext}`;
}

/** The isolation lock: a key is only usable by the org whose folder it is in,
 * in exactly the format the upload route generates. */
export function isAttachmentKeyOf(orgId: string, key: string): boolean {
  const prefix = `email-attachments/${orgId}/`;
  if (!orgId || !key.startsWith(prefix)) return false;
  const tail = key.slice(prefix.length);
  return KEY_TAIL_RE.test(tail) && attachmentExtension(tail) !== null;
}

/** First problem of a send's attachment list, or null when it is valid. */
export function checkAttachments(orgId: string, list: readonly EmailAttachment[]): AttachmentProblem | null {
  if (list.length > MAX_ATTACHMENTS) return "count";
  let total = 0;
  for (const a of list) {
    if (cleanAttachmentName(a.filename) !== a.filename) return "type";
    if (!isAttachmentKeyOf(orgId, a.key)) return "key";
    total += a.size;
  }
  return total > MAX_ATTACHMENTS_BYTES ? "total" : null;
}

/** Composer pre-check before uploading `file` next to `current` (the server checks again). */
export function attachmentAddProblem(
  current: readonly EmailAttachment[],
  file: { name: string; size: number },
): "count" | "type" | "total" | null {
  if (current.length >= MAX_ATTACHMENTS) return "count";
  if (!cleanAttachmentName(file.name)) return "type";
  const used = current.reduce((n, a) => n + a.size, 0);
  return used + file.size > MAX_ATTACHMENTS_BYTES ? "total" : null;
}

/** Stored `attachments` JSON back into a list; null when it is broken. The
 * dispatcher treats null as invalid: a send must never go out without its files. */
export function parseAttachments(value: unknown): EmailAttachment[] | null {
  if (!Array.isArray(value)) return null;
  const out: EmailAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { key, filename, size } = item as Record<string, unknown>;
    if (typeof key !== "string" || typeof filename !== "string") return null;
    if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return null;
    out.push({ key, filename, size });
  }
  return out;
}

/** For screens: a broken value shows as no attachments. */
export function readAttachments(value: unknown): EmailAttachment[] {
  return parseAttachments(value) ?? [];
}

/** Rough send time with attachments, in whole minutes; 0 = under a minute. */
export function estimateAttachmentSendMinutes(total: number): number {
  const seconds = total * SECONDS_PER_EMAIL;
  return seconds < 60 ? 0 : Math.max(1, Math.round(seconds / 60));
}

/** Size split for display: KB under 1 MB, MB (one decimal) above. */
export function attachmentSizeParts(bytes: number): { value: number; unit: "KB" | "MB" } {
  if (bytes < 1024 * 1024) return { value: bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024)), unit: "KB" };
  return { value: Math.round((bytes / (1024 * 1024)) * 10) / 10, unit: "MB" };
}

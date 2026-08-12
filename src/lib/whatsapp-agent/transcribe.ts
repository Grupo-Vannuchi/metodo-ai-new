import "server-only";
import { env } from "@/lib/env";

/** Cheap, fast speech-to-text — good enough for WhatsApp voice notes. */
const MODEL = "gpt-4o-mini-transcribe";
/** OpenAI hard limit is ~25MB; WhatsApp voice notes are a fraction of this. */
const MAX_BYTES = 24 * 1024 * 1024;
const TIMEOUT_MS = 45_000;

export type TranscriptResult =
  | { ok: true; text: string }
  | { ok: false; error: "not_configured" | "unsupported" | "empty" | "too_large" | "unauthorized" | "billing" | "failed" };

/** Only offer transcription when a key is configured (mirrors image-gen). */
export function isTranscriptionConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

const AUDIO_EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/oga": "oga",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

/** Filename extension OpenAI uses to detect the format (ignores codec params). */
function audioExt(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  return AUDIO_EXT[base] ?? base.split("/")[1] ?? "ogg";
}

/**
 * Transcribe an audio buffer (a WhatsApp voice note) to text via OpenAI. Never
 * throws — returns a discriminated result the caller degrades on (silence /
 * ask-for-text). Follows the repo's raw-fetch OpenAI pattern (no `openai` SDK).
 */
export async function transcribeAudio(buffer: Buffer, mimetype: string): Promise<TranscriptResult> {
  if (!env.OPENAI_API_KEY) return { ok: false, error: "not_configured" };
  const base = mimetype.split(";")[0]!.trim().toLowerCase();
  if (!base.startsWith("audio/")) return { ok: false, error: "unsupported" };
  if (buffer.byteLength === 0) return { ok: false, error: "empty" };
  if (buffer.byteLength > MAX_BYTES) return { ok: false, error: "too_large" };

  try {
    const form = new FormData();
    // multipart sets its own Content-Type/boundary — do NOT set it by hand.
    form.append("file", new Blob([new Uint8Array(buffer)], { type: base }), `audio.${audioExt(base)}`);
    form.append("model", MODEL);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[whatsapp-agent] transcription failed", res.status, t.slice(0, 300));
      if (res.status === 401) return { ok: false, error: "unauthorized" };
      if (/billing|quota|insufficient|hard_limit/i.test(t)) return { ok: false, error: "billing" };
      return { ok: false, error: "failed" };
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    if (!text) return { ok: false, error: "empty" };
    return { ok: true, text };
  } catch (e) {
    console.error("[whatsapp-agent] transcription error", e);
    return { ok: false, error: "failed" };
  }
}

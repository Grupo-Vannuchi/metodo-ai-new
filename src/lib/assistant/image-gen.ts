import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

export const IMAGE_TOOL_NAME = "generate_image";

/** Only offer image generation when a key is configured. */
export function isImageGenConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

const SIZES: Record<string, string> = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
};

export const imageGenTool: Anthropic.Tool = {
  name: IMAGE_TOOL_NAME,
  description:
    "Gera uma imagem a partir de uma descrição (para propostas, logos, cabeçalhos, rodapés, ilustrações). A imagem aparece no chat para o usuário baixar. Escreva um prompt visual detalhado (estilo, cores, elementos, texto).",
  input_schema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Descrição visual detalhada da imagem." },
      shape: {
        type: "string",
        enum: ["square", "landscape", "portrait"],
        description: "Formato: square (quadrada), landscape (horizontal, ex.: cabeçalho), portrait (vertical). Padrão square.",
      },
    },
    required: ["prompt"],
  },
};

export type ImageResult = { ok: true; b64: string; mediaType: string } | { ok: false; error: string };

/** Generate one image via OpenAI gpt-image-1 (returns base64 PNG). */
export async function generateImage(prompt: string, shape?: string): Promise<ImageResult> {
  if (!env.OPENAI_API_KEY) return { ok: false, error: "not_configured" };
  const size = SIZES[shape ?? "square"] ?? "1024x1024";
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: prompt.slice(0, 4000),
        size,
        quality: "medium",
        n: 1,
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[assistant] image gen failed", res.status, t.slice(0, 300));
      if (res.status === 401) return { ok: false, error: "unauthorized" };
      if (/billing|quota|insufficient|hard_limit/i.test(t)) return { ok: false, error: "billing" };
      return { ok: false, error: "failed" };
    }
    const data = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = data?.data?.[0]?.b64_json;
    if (typeof b64 !== "string") return { ok: false, error: "failed" };
    return { ok: true, b64, mediaType: "image/png" };
  } catch (e) {
    console.error("[assistant] image gen error", e);
    return { ok: false, error: "failed" };
  }
}

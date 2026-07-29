import "server-only";
import { env } from "@/lib/env";

/**
 * Assistant model. Defaults to a strong Opus model; override with
 * ASSISTANT_MODEL (e.g. claude-sonnet-5) to trade quality for cost/latency on a
 * high-volume chat copilot.
 */
export const ASSISTANT_MODEL = env.ASSISTANT_MODEL || "claude-opus-5";

/** The AI key is optional — the widget stays dormant until it's set. */
export function isAssistantConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

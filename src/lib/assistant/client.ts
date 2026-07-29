import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

let cached: Anthropic | null = null;

/** The Anthropic client, or null when no key is configured (graceful no-op). */
export function getAnthropic(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  if (!cached) cached = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cached;
}

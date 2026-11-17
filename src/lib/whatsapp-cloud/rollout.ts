import "server-only";
import { env } from "@/lib/env";

/** Chave da tela oficial em GATEABLE_SCREENS / app.nav. */
export const CLOUD_SCREEN = "inboxOficial";

/**
 * Liberação gradual da tela oficial (piloto). ÚNICO lugar que lê
 * WHATSAPP_CLOUD_ORG_IDS — menu, página, rotas e actions perguntam aqui.
 * Sai quando a migração terminar (spec §5.3).
 */
export function isWhatsappCloudEnabled(organizationId: string): boolean {
  const ids = (env.WHATSAPP_CLOUD_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(organizationId);
}

/** Tira a tela oficial de uma lista de telas quando a empresa não está liberada. */
export function filterRolloutScreens<T extends string>(organizationId: string, screens: T[]): T[] {
  return isWhatsappCloudEnabled(organizationId) ? screens : screens.filter((s) => s !== CLOUD_SCREEN);
}

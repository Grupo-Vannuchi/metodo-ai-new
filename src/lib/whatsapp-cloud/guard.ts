import "server-only";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { isWhatsappCloudEnabled } from "@/lib/whatsapp-cloud/rollout";

export type CloudGuard = { ok: true; ctx: OrgContext } | { ok: false; error: "unauthorized" | "not_enabled" };

/** Sessão + liberação: primeira linha de toda action e rota da tela oficial (guia 05). */
export async function cloudGuard(): Promise<CloudGuard> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!isWhatsappCloudEnabled(ctx.organizationId)) return { ok: false, error: "not_enabled" };
  return { ok: true, ctx };
}

/** Resposta de rota quando o guard falha. Empresa fora da lista recebe 404 (a tela "não existe"). */
export function guardResponse(error: "unauthorized" | "not_enabled"): Response {
  return error === "unauthorized"
    ? new Response("Unauthorized", { status: 401 })
    : new Response("Not found", { status: 404 });
}

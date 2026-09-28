"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { LIMITS } from "@/config/limits";
import { audit } from "@/lib/audit";
import { countWhatsappConnections } from "@/lib/queries/connections";
import { cloudGuard } from "@/lib/whatsapp-cloud/guard";
import { getPhoneNumber, registerNumber, subscribeApp } from "@/lib/whatsapp-cloud/meta-api";
import { encryptToken, loadNumber, purgeNumberMedia } from "@/lib/whatsapp-cloud/numbers";
import { syncTemplates } from "@/lib/whatsapp-cloud/templates";
import { isUniqueViolation } from "@/lib/whatsapp-cloud/prisma-errors";

export type NumberActionError =
  | "unauthorized"
  | "not_enabled"
  | "invalid"
  | "number_exists"
  | "phone_in_use"
  | "limit"
  | "not_found"
  | "meta_error"
  | "unknown";

export type NumberActionResult = { ok: true; count?: number } | { ok: false; error: NumberActionError; detail?: string };

const PATH = "/app/inbox-oficial";
const metaId = z.string().trim().regex(/^\d{5,30}$/);
const token = z.string().trim().min(20).max(2000);
const connectSchema = z.object({
  phoneNumberId: metaId,
  wabaId: metaId,
  accessToken: token,
  pin: z.string().trim().regex(/^\d{6}$/).optional().or(z.literal("")),
});

/** Conecta (ou reconecta) o número oficial do próprio usuário. */
export async function connectCloudNumber(input: {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  pin?: string;
}): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { phoneNumberId, wabaId, accessToken, pin } = parsed.data;

  try {
    const db = tenantDb(ctx.organizationId);
    const mine = await db.whatsappCloudNumber.findFirst({
      where: { ownerId: ctx.userId },
      select: { id: true, phoneNumberId: true },
    });
    if (mine && mine.phoneNumberId !== phoneNumberId) return { ok: false, error: "number_exists" };
    // phoneNumberId é único no sistema: um número da Meta só pode estar ligado
    // uma vez. Busca entre empresas de propósito — devolve só o id.
    const taken = await prisma.whatsappCloudNumber.findFirst({ where: { phoneNumberId }, select: { id: true } });
    if (taken && taken.id !== mine?.id) return { ok: false, error: "phone_in_use" };
    if (
      !mine &&
      LIMITS.whatsappNumbersLimit !== null &&
      (await countWhatsappConnections(ctx.organizationId)) >= LIMITS.whatsappNumbersLimit
    ) {
      return { ok: false, error: "limit" };
    }

    const info = await getPhoneNumber(phoneNumberId, accessToken);
    if (!info.ok) return { ok: false, error: "meta_error", detail: info.message };
    const sub = await subscribeApp(wabaId, accessToken);
    if (!sub.ok) return { ok: false, error: "meta_error", detail: sub.message };
    if (pin) {
      const reg = await registerNumber(phoneNumberId, accessToken, pin);
      if (!reg.ok) return { ok: false, error: "meta_error", detail: reg.message };
    }

    const data = {
      phoneNumberId,
      wabaId,
      displayPhoneNumber: info.data.display_phone_number ?? null,
      verifiedName: info.data.verified_name ?? null,
      qualityRating: info.data.quality_rating ?? null,
      accessTokenEnc: encryptToken(accessToken),
      status: "ACTIVE" as const,
      lastError: null,
      checkedAt: new Date(),
    };
    let numberId: string;
    if (mine) {
      await db.whatsappCloudNumber.updateMany({ where: { id: mine.id }, data });
      numberId = mine.id;
    } else {
      const created = await db.whatsappCloudNumber.create({
        data: { organizationId: ctx.organizationId, ownerId: ctx.userId, ...data },
        select: { id: true },
      });
      numberId = created.id;
    }

    const synced = await syncTemplates(ctx.organizationId, wabaId, accessToken);
    if (!synced.ok) console.warn(`[wa-cloud] template sync on connect failed: ${synced.message}`);
    await audit(ctx, {
      action: "whatsapp_cloud.connected",
      entity: "WhatsappCloudNumber",
      entityId: numberId,
      meta: { phoneNumberId },
    });
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "phone_in_use" };
    console.error("[wa-cloud] connect failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Troca o token (procedimento de rotação). Revalida na Meta antes de gravar. */
export async function updateCloudNumberToken(accessToken: string): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const parsed = token.safeParse(accessToken);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const mine = await db.whatsappCloudNumber.findFirst({
      where: { ownerId: ctx.userId },
      select: { id: true, phoneNumberId: true },
    });
    if (!mine) return { ok: false, error: "not_found" };
    const info = await getPhoneNumber(mine.phoneNumberId, parsed.data);
    if (!info.ok) return { ok: false, error: "meta_error", detail: info.message };
    await db.whatsappCloudNumber.updateMany({
      where: { id: mine.id },
      data: {
        accessTokenEnc: encryptToken(parsed.data),
        status: "ACTIVE",
        lastError: null,
        checkedAt: new Date(),
        displayPhoneNumber: info.data.display_phone_number ?? null,
        verifiedName: info.data.verified_name ?? null,
        qualityRating: info.data.quality_rating ?? null,
      },
    });
    await audit(ctx, { action: "whatsapp_cloud.token_updated", entity: "WhatsappCloudNumber", entityId: mine.id });
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    console.error("[wa-cloud] token update failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Relê os dados do número e refaz a inscrição do app na WABA. */
export async function refreshCloudNumber(): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  try {
    const db = tenantDb(ctx.organizationId);
    const mine = await db.whatsappCloudNumber.findFirst({ where: { ownerId: ctx.userId }, select: { id: true } });
    const number = mine ? await loadNumber(ctx.organizationId, mine.id) : null;
    if (!number) return { ok: false, error: "not_found" };
    const info = await getPhoneNumber(number.phoneNumberId, number.token);
    const sub = info.ok ? await subscribeApp(number.wabaId, number.token) : null;
    if (!info.ok || (sub && !sub.ok)) {
      const detail = !info.ok ? info.message : sub && !sub.ok ? sub.message : "";
      await db.whatsappCloudNumber.updateMany({
        where: { id: number.id },
        data: { status: "ERROR", lastError: detail.slice(0, 500), checkedAt: new Date() },
      });
      revalidatePath(PATH);
      return { ok: false, error: "meta_error", detail };
    }
    await db.whatsappCloudNumber.updateMany({
      where: { id: number.id },
      data: {
        status: number.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        lastError: null,
        checkedAt: new Date(),
        displayPhoneNumber: info.data.display_phone_number ?? null,
        verifiedName: info.data.verified_name ?? null,
        qualityRating: info.data.quality_rating ?? null,
      },
    });
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    console.error("[wa-cloud] refresh failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Desconecta: para de enviar e de receber, mas mantém as conversas. */
export async function disconnectCloudNumber(): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const res = await tenantDb(ctx.organizationId).whatsappCloudNumber.updateMany({
    where: { ownerId: ctx.userId },
    data: { status: "INACTIVE" },
  });
  if (res.count === 0) return { ok: false, error: "not_found" };
  await audit(ctx, { action: "whatsapp_cloud.disconnected", entity: "WhatsappCloudNumber" });
  revalidatePath(PATH);
  return { ok: true };
}

/** Remove o número: apaga conversas, mensagens (cascade) e as mídias guardadas (LGPD). */
export async function removeCloudNumber(): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  try {
    const db = tenantDb(ctx.organizationId);
    const mine = await db.whatsappCloudNumber.findFirst({ where: { ownerId: ctx.userId }, select: { id: true } });
    if (!mine) return { ok: false, error: "not_found" };
    await purgeNumberMedia(ctx.organizationId, mine.id).catch(() => {});
    await db.whatsappCloudNumber.deleteMany({ where: { id: mine.id } });
    await audit(ctx, { action: "whatsapp_cloud.removed", entity: "WhatsappCloudNumber", entityId: mine.id });
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    console.error("[wa-cloud] remove failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Sincroniza os modelos da WABA do número do usuário. */
export async function syncCloudTemplates(): Promise<NumberActionResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const { ctx } = g;
  const mine = await tenantDb(ctx.organizationId).whatsappCloudNumber.findFirst({
    where: { ownerId: ctx.userId },
    select: { id: true },
  });
  const number = mine ? await loadNumber(ctx.organizationId, mine.id) : null;
  if (!number) return { ok: false, error: "not_found" };
  const res = await syncTemplates(ctx.organizationId, number.wabaId, number.token);
  if (!res.ok) return { ok: false, error: "meta_error", detail: res.message };
  revalidatePath(PATH);
  return { ok: true, count: res.count };
}

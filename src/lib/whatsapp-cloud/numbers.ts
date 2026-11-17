import "server-only";
import type { ConnectionStatus } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";
import { deleteMedia } from "@/lib/storage/blob";

/** Número com o token decifrado — só para chamar a Meta, nunca para o navegador. */
export type NumberWithToken = {
  id: string;
  organizationId: string;
  ownerId: string;
  phoneNumberId: string;
  wabaId: string;
  status: ConnectionStatus;
  token: string;
};

export function encryptToken(accessToken: string): string {
  return encryptCredentials({ accessToken });
}

export async function loadNumber(organizationId: string, numberId: string): Promise<NumberWithToken | null> {
  const n = await tenantDb(organizationId).whatsappCloudNumber.findFirst({
    where: { id: numberId },
    select: {
      id: true,
      organizationId: true,
      ownerId: true,
      phoneNumberId: true,
      wabaId: true,
      status: true,
      accessTokenEnc: true,
    },
  });
  if (!n) return null;
  let token = "";
  try {
    token = decryptCredentials(n.accessTokenEnc).accessToken ?? "";
  } catch {
    return null;
  }
  if (!token) return null;
  return {
    id: n.id,
    organizationId: n.organizationId,
    ownerId: n.ownerId,
    phoneNumberId: n.phoneNumberId,
    wabaId: n.wabaId,
    status: n.status,
    token,
  };
}

/** Token inválido, número não registrado ou conta restrita: o número vai para ERROR. */
export async function markNumberError(organizationId: string, numberId: string, message: string): Promise<void> {
  await tenantDb(organizationId).whatsappCloudNumber.updateMany({
    where: { id: numberId },
    data: { status: "ERROR", lastError: message.slice(0, 500), checkedAt: new Date() },
  });
}

/** LGPD: apaga do armazenamento as mídias das conversas de um número (antes de remover). */
export async function purgeNumberMedia(organizationId: string, numberId: string): Promise<void> {
  const rows = await tenantDb(organizationId).whatsappCloudMessage.findMany({
    where: { mediaUrl: { not: null }, conversation: { numberId } },
    select: { mediaUrl: true },
  });
  await Promise.all(rows.map((r) => (r.mediaUrl ? deleteMedia(r.mediaUrl) : Promise.resolve())));
}

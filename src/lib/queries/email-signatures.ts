import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { composeSignature } from "@/lib/email-broadcast/compose";
import { signatureContentOf } from "@/lib/email-broadcast/signature";
import type { SignatureOption } from "@/lib/email-broadcast/types";

const SIGNATURE_SELECT = {
  id: true,
  name: true,
  kind: true,
  html: true,
  imageUrl: true,
  imageAlt: true,
  imageHref: true,
  isDefault: true,
  updatedAt: true,
} as const;

/** The org's signatures, the default first, then by name. */
export function listEmailSignatures(organizationId: string) {
  return tenantDb(organizationId).emailSignature.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: SIGNATURE_SELECT,
  });
}

export function getEmailSignature(organizationId: string, id: string) {
  return tenantDb(organizationId).emailSignature.findFirst({ where: { id }, select: SIGNATURE_SELECT });
}

/** Signatures with their sent-as preview (sanitized here, on the server). */
export async function listSignatureOptions(organizationId: string): Promise<SignatureOption[]> {
  const rows = await listEmailSignatures(organizationId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    isDefault: r.isDefault,
    updatedAt: r.updatedAt.toISOString(),
    previewHtml: composeSignature(signatureContentOf(r)).html,
  }));
}

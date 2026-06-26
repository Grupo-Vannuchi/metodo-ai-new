"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { companySchema, type CompanyInput } from "@/lib/validations/company";
import { onlyDigits, formatCep, formatPhoneBR } from "@/lib/cnpj";

export type CompanyActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

function toData(input: CompanyInput) {
  return {
    name: input.name,
    cnpj: input.cnpj || null,
    email: input.email || null,
    phone: input.phone || null,
    website: input.website || null,
    notes: input.notes || null,
    address: {
      street: input.street || "",
      city: input.city || "",
      uf: input.uf || "",
      zip: input.zip || "",
    },
  };
}

export async function createCompany(
  input: CompanyInput,
): Promise<CompanyActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const company = await db.company.create({
      // organizationId is also enforced by the tenant extension; passed here
      // because Prisma's create input type requires it statically.
      data: { ...toData(parsed.data), source: "manual", organizationId: ctx.organizationId },
    });
    revalidatePath("/app/companies");
    return { ok: true, id: company.id };
  } catch (error) {
    console.error("Failed to create company", error);
    return { ok: false, error: "unknown" };
  }
}

export async function updateCompany(
  id: string,
  input: CompanyInput,
): Promise<CompanyActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    // updateMany so the tenant filter (org injected by the extension) applies;
    // count === 0 means the row isn't in this org.
    const res = await db.company.updateMany({
      where: { id },
      data: toData(parsed.data),
    });
    if (res.count === 0) return { ok: false, error: "unknown" };
    revalidatePath("/app/companies");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update company", error);
    return { ok: false, error: "unknown" };
  }
}

// ── CNPJ auto-fill ─────────────────────────────────────────────────────────

/** Company fields we can derive from a CNPJ (subset of the form values). */
export type CnpjCompanyData = {
  name: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  uf: string;
  zip: string;
  situacao: string;
};

export type CnpjLookupResult =
  | { ok: true; data: CnpjCompanyData }
  | { ok: false; error: "unauthorized" | "invalid" | "notFound" | "unavailable" };

type BrasilApiCnpj = {
  razao_social?: string;
  nome_fantasia?: string;
  email?: string;
  ddd_telefone_1?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  descricao_situacao_cadastral?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Look up a company's public registry data by CNPJ (Receita Federal, via the
 * free BrasilAPI — no key needed). Returns normalized form fields; the client
 * fills the blanks. Auth-gated so it isn't an open proxy.
 */
export async function lookupCnpj(cnpj: string): Promise<CnpjLookupResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const digits = onlyDigits(cnpj);
  if (digits.length !== 14) return { ok: false, error: "invalid" };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      signal: controller.signal,
      // BrasilAPI's edge (Cloudflare) rejects requests without a User-Agent.
      headers: { Accept: "application/json", "User-Agent": "MetodoAI-CRM/1.0" },
      cache: "no-store",
    }).finally(() => clearTimeout(timer));

    if (res.status === 404) return { ok: false, error: "notFound" };
    if (!res.ok) return { ok: false, error: "unavailable" };

    const j = (await res.json()) as BrasilApiCnpj;
    const email = (j.email ?? "").trim().toLowerCase();
    const street = [[j.logradouro, j.numero].filter(Boolean).join(", "), j.bairro]
      .filter(Boolean)
      .join(" - ")
      .trim();

    return {
      ok: true,
      data: {
        name: (j.nome_fantasia || j.razao_social || "").trim(),
        email: EMAIL_RE.test(email) ? email : "",
        phone: formatPhoneBR(j.ddd_telefone_1 ?? ""),
        street,
        city: (j.municipio ?? "").trim(),
        uf: (j.uf ?? "").trim(),
        zip: formatCep(j.cep ?? ""),
        situacao: (j.descricao_situacao_cadastral ?? "").trim(),
      },
    };
  } catch (error) {
    console.error("CNPJ lookup failed", error);
    return { ok: false, error: "unavailable" };
  }
}

export async function deleteCompany(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    await db.company.deleteMany({ where: { id } });
    revalidatePath("/app/companies");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete company", error);
    return { ok: false };
  }
}

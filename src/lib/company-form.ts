import type { CompanyInput } from "@/lib/validations/company";

/**
 * Bridge between the company form (flat string values) and the validated
 * `CompanyInput`. Kept free of "use client" / "server-only" so both the client
 * form and the server action can import it.
 */
export type CompanyFormValues = {
  name: string;
  cnpj: string;
  email: string;
  phone: string;
  website: string;
  street: string;
  city: string;
  uf: string;
  zip: string;
  notes: string;
};

export function emptyCompanyForm(): CompanyFormValues {
  return {
    name: "",
    cnpj: "",
    email: "",
    phone: "",
    website: "",
    street: "",
    city: "",
    uf: "",
    zip: "",
    notes: "",
  };
}

type Addr = { street?: string; city?: string; uf?: string; zip?: string };

export type CompanyRow = {
  name: string;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: unknown;
  notes: string | null;
};

export function companyToForm(row: CompanyRow): CompanyFormValues {
  const addr = (row.address ?? {}) as Addr;
  return {
    name: row.name,
    cnpj: row.cnpj ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    website: row.website ?? "",
    street: addr.street ?? "",
    city: addr.city ?? "",
    uf: addr.uf ?? "",
    zip: addr.zip ?? "",
    notes: row.notes ?? "",
  };
}

export function formToCompanyInput(values: CompanyFormValues): CompanyInput {
  return {
    name: values.name.trim(),
    cnpj: values.cnpj.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    website: values.website.trim(),
    street: values.street.trim(),
    city: values.city.trim(),
    uf: values.uf.trim(),
    zip: values.zip.trim(),
    notes: values.notes.trim(),
  };
}

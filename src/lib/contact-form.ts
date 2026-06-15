import type { ContactInput } from "@/lib/validations/contact";

export type ContactFormValues = {
  name: string;
  email: string;
  phone: string;
  role: string;
  companyId: string;
  tags: string;
  optedOut: boolean;
};

export function emptyContactForm(): ContactFormValues {
  return { name: "", email: "", phone: "", role: "", companyId: "", tags: "", optedOut: false };
}

export type ContactRow = {
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  companyId: string | null;
  tags: string[];
  optedOut: boolean;
};

export function contactToForm(row: ContactRow): ContactFormValues {
  return {
    name: row.name,
    email: row.email ?? "",
    phone: row.phone ?? "",
    role: row.role ?? "",
    companyId: row.companyId ?? "",
    tags: row.tags.join(", "),
    optedOut: row.optedOut,
  };
}

export function formToContactInput(values: ContactFormValues): ContactInput {
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    role: values.role.trim(),
    companyId: values.companyId.trim(),
    tags: values.tags.trim(),
    optedOut: values.optedOut,
  };
}

/** Split the comma-separated tags field into a clean string array. */
export function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

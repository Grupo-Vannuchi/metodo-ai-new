/**
 * CNPJ / Brazilian document helpers. Pure (no "use client" / "server-only") so
 * both the company form (client) and the lookup action (server) can import it.
 */

export function onlyDigits(value: string): string {
  return (value || "").replace(/\D+/g, "");
}

/** 00.000.000/0000-00 — returns the input unchanged unless it has 14 digits. */
export function formatCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length !== 14) return value;
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/** 00000-000 — returns the input unchanged unless it has 8 digits. */
export function formatCep(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  if (d.length !== 8) return value;
  return d.replace(/^(\d{5})(\d{3})$/, "$1-$2");
}

/** (11) 91234-5678 / (11) 1234-5678 — returns the input unchanged otherwise. */
export function formatPhoneBR(value: string): string {
  const d = onlyDigits(value);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return value;
}

export function isCnpjComplete(value: string): boolean {
  return onlyDigits(value).length === 14;
}

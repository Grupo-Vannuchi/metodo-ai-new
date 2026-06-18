/**
 * Brazilian document helpers — CPF (individuals) and CNPJ (companies).
 *
 * Validation checks the verifier digits (not just the length/mask), so invalid
 * numbers like "111.111.111-11" are rejected. Used on the client (input mask +
 * react-hook-form) and re-run on the server (zod), per PLANO.md §11 rule 3.
 */

export type DocumentType = "CPF" | "CNPJ";

/** Strip everything but digits. */
export function onlyDigits(raw: string): string {
  return (raw ?? "").replace(/\D/g, "");
}

/** Validate CPF verifier digits. Expects 11 digits (mask is stripped). */
export function isValidCPF(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // all-equal digits

  const calc = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** Validate CNPJ verifier digits. Expects 14 digits (mask is stripped). */
export function isValidCNPJ(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calc = (len: number): number => {
    const weights =
      len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * weights[i];
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Validate a document against the given type. */
export function isValidDocument(type: DocumentType, raw: string): boolean {
  return type === "CPF" ? isValidCPF(raw) : isValidCNPJ(raw);
}

/** Format digits as a masked CPF (000.000.000-00) or CNPJ (00.000.000/0000-00).
 * Progressive: formats whatever is typed so far, capped at the type's length. */
export function formatDocument(type: DocumentType, raw: string): string {
  const d = onlyDigits(raw).slice(0, type === "CPF" ? 11 : 14);
  if (type === "CPF") {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/**
 * Normalize a phone number to the digits-with-country-code form that WhatsApp
 * APIs expect (e.g. "5511999999999"). Heuristic: strips non-digits and prepends
 * Brazil's country code (55) when the number looks like a local 10/11-digit one.
 */
export function normalizeWhatsappNumber(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  // Local BR number (DDD + number) without country code → prepend 55.
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/**
 * Progressively mask a BR phone as the user types: "(11) 91234-5678" (mobile,
 * 11 digits) or "(11) 1234-5678" (landline, 10). Non-digits are dropped, so the
 * field only ever holds a phone number. A pasted WhatsApp-style number with the
 * 55 country code (12–13 digits) has it stripped to the local form.
 */
export function formatBrPhone(raw: string): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** True when empty or a plausible BR phone (10 digits landline / 11 mobile). */
export function isValidBrPhone(raw: string): boolean {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length === 0 || d.length === 10 || d.length === 11;
}

/** Comparable key for matching phones across formats: the local digits without
 * the BR country code (last 11), so "(13) 99188-6920" and "5513991886920" match. */
export function brPhoneKey(raw: string): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.slice(-11);
}

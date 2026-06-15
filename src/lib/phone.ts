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

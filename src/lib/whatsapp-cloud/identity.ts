/**
 * Identidade do cliente pelo telefone (puro). O `wa_id` de um celular brasileiro
 * pode chegar com ou sem o 9º dígito (contas antigas do WhatsApp continuam no
 * formato de 12 dígitos), e o telefone salvo no CRM costuma ter o 9. Sem tratar
 * isso, a resposta do cliente a uma campanha abriria uma segunda conversa.
 */

/** 55 + DDD + 9 + 8 dígitos (13 no total). */
const BR_MOBILE_13 = /^55\d{2}9\d{8}$/;
/** 55 + DDD + 8 dígitos começando em 6–9 (celular sem o 9; 2–5 é fixo). */
const BR_MOBILE_12 = /^55\d{2}[6-9]\d{7}$/;

/**
 * As formas equivalentes de um `wa_id`: ele mesmo e, para celular brasileiro, a
 * forma com/sem o 9º dígito. Qualquer outro formato devolve só ele mesmo.
 */
export function brPhoneVariants(waId: string): string[] {
  if (BR_MOBILE_13.test(waId)) return [waId, waId.slice(0, 4) + waId.slice(5)];
  if (BR_MOBILE_12.test(waId)) return [waId, `${waId.slice(0, 4)}9${waId.slice(4)}`];
  return [waId];
}

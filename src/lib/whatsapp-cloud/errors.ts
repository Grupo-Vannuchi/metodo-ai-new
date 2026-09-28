/**
 * Erros da WhatsApp Cloud API (puro). Traduz o código numérico da Meta numa
 * categoria que o produto entende e guarda os textos (pt) gravados em
 * CampaignRecipient.error / WhatsappCloudCampaign.pausedReason — mesma
 * convenção do disparo antigo, que também grava texto em pt.
 * Códigos: developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 */
export type MetaErrorCategory =
  | "window_closed"
  | "undeliverable"
  | "rate_limited"
  | "pair_rate_limited"
  | "marketing_opt_out"
  | "marketing_limited"
  | "template_paused"
  | "template_disabled"
  | "token_invalid"
  | "not_registered"
  | "account_restricted"
  | "invalid_params"
  | "unknown";

const BY_CODE: Record<number, MetaErrorCategory> = {
  131047: "window_closed",
  131026: "undeliverable",
  130429: "rate_limited",
  131056: "pair_rate_limited",
  131050: "marketing_opt_out",
  131049: "marketing_limited",
  132015: "template_paused",
  132016: "template_disabled",
  190: "token_invalid",
  10: "token_invalid",
  200: "token_invalid",
  133010: "not_registered",
  131031: "account_restricted",
  100: "invalid_params",
  131008: "invalid_params",
  131009: "invalid_params",
  132000: "invalid_params",
  132001: "invalid_params",
};

export function categorizeMetaError(code: number | null | undefined): MetaErrorCategory {
  if (code === null || code === undefined) return "unknown";
  return BY_CODE[code] ?? "unknown";
}

/** Problemas do número inteiro (não da mensagem): o número vai para ERROR. */
export function isNumberLevelError(c: MetaErrorCategory): boolean {
  return c === "token_invalid" || c === "not_registered" || c === "account_restricted";
}

/** Erros que param a campanha inteira em vez de só falhar um destinatário. */
export function isCampaignStopper(c: MetaErrorCategory): boolean {
  return c === "template_paused" || c === "template_disabled" || isNumberLevelError(c);
}

export type GraphError = { code: number | null; message: string };

/** Extrai código + mensagem do corpo de erro da Graph API. */
export function graphErrorFromBody(status: number, body: unknown): GraphError {
  const err =
    body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; error_data?: { details?: unknown } };
    const code = typeof e.code === "number" ? e.code : null;
    const details = typeof e.error_data?.details === "string" ? e.error_data.details : "";
    const message = typeof e.message === "string" ? e.message : "";
    return { code, message: details || message || `Meta ${status}` };
  }
  return { code: null, message: `Meta ${status}` };
}

const RECIPIENT_TEXT: Partial<Record<MetaErrorCategory, string>> = {
  undeliverable: "Número não recebe WhatsApp.",
  marketing_opt_out: "Contato optou por não receber marketing.",
  marketing_limited: "A Meta limitou mensagens de marketing para este contato.",
  window_closed: "Fora da janela de 24h.",
};

/** Texto gravado no destinatário de campanha que falhou. */
export function recipientErrorText(c: MetaErrorCategory, detail: string | null | undefined): string {
  return RECIPIENT_TEXT[c] ?? (detail?.trim() || "Falha no envio.");
}

const PAUSE_TEXT: Partial<Record<MetaErrorCategory, string>> = {
  template_paused: "A Meta pausou o modelo desta campanha.",
  template_disabled: "A Meta desativou o modelo desta campanha.",
  token_invalid: "O token do número oficial é inválido ou perdeu permissão.",
  not_registered: "O número oficial não está registrado na Meta.",
  account_restricted: "A conta do WhatsApp está restrita pela Meta.",
};

/** Motivo gravado quando uma campanha é pausada por erro da Meta. */
export function pauseReasonText(c: MetaErrorCategory): string {
  return PAUSE_TEXT[c] ?? "Campanha pausada por erro da Meta.";
}

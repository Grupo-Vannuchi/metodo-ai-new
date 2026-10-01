import "server-only";
import { graphRequest, type GraphResult } from "@/lib/whatsapp-cloud/graph";

/** Endpoints da WhatsApp Cloud API usados pela tela oficial (spec §4). */

export type PhoneNumberInfo = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
};

export function getPhoneNumber(phoneNumberId: string, token: string): Promise<GraphResult<PhoneNumberInfo>> {
  return graphRequest<PhoneNumberInfo>(phoneNumberId, token, {
    query: { fields: "display_phone_number,verified_name,quality_rating" },
  });
}

/** Sem esta inscrição, nenhum webhook da WABA chega ao app. Idempotente. */
export function subscribeApp(wabaId: string, token: string): Promise<GraphResult<{ success?: boolean }>> {
  return graphRequest<{ success?: boolean }>(`${wabaId}/subscribed_apps`, token, { method: "POST" });
}

/** Registra um número incluído pela API (PIN de 6 dígitos; 10 tentativas/72h). */
export function registerNumber(
  phoneNumberId: string,
  token: string,
  pin: string,
): Promise<GraphResult<{ success?: boolean }>> {
  return graphRequest<{ success?: boolean }>(`${phoneNumberId}/register`, token, {
    json: { messaging_product: "whatsapp", pin },
  });
}

export type SendResponse = {
  messages?: { id?: string; message_status?: string }[];
  contacts?: { input?: string; wa_id?: string; user_id?: string }[];
};

export function postMessage(
  phoneNumberId: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<GraphResult<SendResponse>> {
  return graphRequest<SendResponse>(`${phoneNumberId}/messages`, token, { json: payload });
}

export function uploadMedia(
  phoneNumberId: string,
  token: string,
  bytes: Buffer,
  mime: string,
  filename: string,
): Promise<GraphResult<{ id?: string }>> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
  return graphRequest<{ id?: string }>(`${phoneNumberId}/media`, token, { form });
}

export type MediaInfo = { url?: string; mime_type?: string; file_size?: number };

export function getMediaInfo(mediaId: string, token: string): Promise<GraphResult<MediaInfo>> {
  return graphRequest<MediaInfo>(mediaId, token);
}

export type TemplateRow = {
  id: string;
  name: string;
  language: string;
  status?: string;
  category?: string;
  components?: unknown[];
  parameter_format?: string;
  rejected_reason?: string;
};

export type TemplatePage = { data?: TemplateRow[]; paging?: { cursors?: { after?: string }; next?: string } };

export function listTemplatesPage(wabaId: string, token: string, after?: string): Promise<GraphResult<TemplatePage>> {
  return graphRequest<TemplatePage>(`${wabaId}/message_templates`, token, {
    query: {
      fields: "id,name,language,status,category,components,parameter_format,rejected_reason",
      limit: "100",
      ...(after ? { after } : {}),
    },
  });
}

/**
 * Limite atual de mensagens (contatos novos por 24h) do portfólio, para o aviso
 * do formulário de campanha. O formato do campo não está documentado com
 * precisão: aceita "TIER_250" ou número; qualquer outra coisa vira null.
 */
export async function getMessagingLimit(phoneNumberId: string, token: string): Promise<string | null> {
  const res = await graphRequest<{ whatsapp_business_manager_messaging_limit?: unknown }>(phoneNumberId, token, {
    query: { fields: "whatsapp_business_manager_messaging_limit" },
  });
  if (!res.ok) return null;
  const raw = res.data.whatsapp_business_manager_messaging_limit;
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string") return raw.replace(/^TIER_/, "");
  return null;
}

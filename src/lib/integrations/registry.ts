/**
 * Integration provider registry — the single source of truth for which
 * providers exist and what credential fields each needs. The Connections form
 * renders fields from here, and adapters (P5/P6) look up the spec to interpret
 * stored credentials. Kept free of "server-only" so the client form can read
 * the field metadata (labels/types only — never values).
 */
export type IntegrationProviderKey =
  | "EVOLUTION"
  | "META_CLOUD"
  | "GOOGLE"
  | "RESEND"
  | "SMTP"
  | "N8N";

export type CredentialField = {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  required?: boolean;
  placeholder?: string;
};

export type ProviderSpec = {
  provider: IntegrationProviderKey;
  label: string;
  /** Short hint shown under the provider name. */
  description: string;
  fields: CredentialField[];
};

export const PROVIDERS: Record<IntegrationProviderKey, ProviderSpec> = {
  EVOLUTION: {
    provider: "EVOLUTION",
    label: "WhatsApp (Evolution API)",
    description: "Disparo e CRM de WhatsApp via Evolution API.",
    fields: [
      { key: "baseUrl", label: "URL base", type: "url", required: true, placeholder: "https://evo.suaempresa.com" },
      { key: "apiKey", label: "API Key (global)", type: "password", required: true },
      { key: "instance", label: "Instância (opcional)", type: "text", placeholder: "deixe em branco para gerar" },
    ],
  },
  META_CLOUD: {
    provider: "META_CLOUD",
    label: "WhatsApp Cloud API (Meta)",
    description: "Disparo oficial pela API da Meta.",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID", type: "text", required: true },
      { key: "accessToken", label: "Access Token", type: "password", required: true },
      { key: "wabaId", label: "WABA ID", type: "text" },
    ],
  },
  GOOGLE: {
    provider: "GOOGLE",
    label: "Google (Maps / Custom Search)",
    description: "Extração de empresas via Google.",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "cseCx", label: "Custom Search CX", type: "text" },
    ],
  },
  RESEND: {
    provider: "RESEND",
    label: "Resend (E-mail)",
    description: "Envio de e-mail transacional e campanhas.",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "fromEmail", label: "Remetente", type: "text", required: true, placeholder: "contato@suaempresa.com" },
    ],
  },
  SMTP: {
    provider: "SMTP",
    label: "SMTP",
    description: "Servidor SMTP genérico.",
    fields: [
      { key: "host", label: "Host", type: "text", required: true },
      { key: "port", label: "Porta", type: "text", required: true, placeholder: "587" },
      { key: "user", label: "Usuário", type: "text", required: true },
      { key: "password", label: "Senha", type: "password", required: true },
    ],
  },
  N8N: {
    provider: "N8N",
    label: "n8n",
    description: "Automação de fluxos via webhook do n8n.",
    fields: [
      { key: "webhookUrl", label: "Webhook URL", type: "url", required: true },
      { key: "secret", label: "Secret", type: "password" },
    ],
  },
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS) as IntegrationProviderKey[];

export function providerSpec(provider: IntegrationProviderKey): ProviderSpec {
  return PROVIDERS[provider];
}

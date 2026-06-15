import { z } from "zod";
import { CHANNEL_KEYS } from "@/lib/integrations/channels/meta";

const channel = z.string().refine((v) => CHANNEL_KEYS.includes(v as never), {
  message: "Canal inválido.",
});

export const templateSchema = z.object({
  channel,
  name: z.string().trim().min(1, "Informe um nome.").max(120),
  subject: z.string().trim().max(200).optional().or(z.literal("")),
  body: z.string().trim().min(1, "Escreva a mensagem.").max(5000),
});

export type TemplateInput = z.infer<typeof templateSchema>;

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome.").max(120),
  channel,
  templateId: z.string().trim().min(1, "Selecione um template."),
  /** Optional tag filter for the target audience. */
  tag: z.string().trim().max(60).optional().or(z.literal("")),
});

export type CampaignInput = z.infer<typeof campaignSchema>;

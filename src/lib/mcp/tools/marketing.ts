import "server-only";
import { z } from "zod";
import { listResult, page, resolveRange } from "@/lib/mcp/core";
import { pageShape, periodShape } from "@/lib/mcp/inputs";
import { orgTool, type McpToolDef } from "@/lib/mcp/tool";
import { searchCampaigns, searchEmailBroadcasts } from "@/lib/queries/mcp/marketing";

export const marketingTools: McpToolDef[] = [
  orgTool({
    name: "buscar_campanhas",
    description:
      "Campanhas de disparo (WhatsApp ou e-mail) com canal, status, modelo usado, datas e quantos " +
      "destinatários estão em cada status. O texto das mensagens não é exposto.",
    input: {
      status: z
        .enum(["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "DONE", "CANCELED"])
        .optional()
        .describe("DRAFT, SCHEDULED, RUNNING, PAUSED, DONE ou CANCELED"),
      channel: z
        .enum(["WHATSAPP_EVOLUTION", "WHATSAPP_CLOUD", "EMAIL"])
        .optional()
        .describe("WHATSAPP_EVOLUTION, WHATSAPP_CLOUD ou EMAIL"),
      ...pageShape,
    },
    run: async ({ status, channel, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchCampaigns(org.id, { status, channel, page: p });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "buscar_disparos_email",
    description:
      "Envios de e-mail em massa com assunto, canal (plataforma ou conta da empresa), status, remetente, " +
      "datas e quantos destinatários estão em cada status (entregue, devolvido, reclamação…). O corpo do " +
      "e-mail, a assinatura e a lista de destinatários não são expostos. Período aplicado à criação.",
    input: {
      status: z.enum(["DRAFT", "SENDING", "PAUSED", "DONE"]).optional().describe("DRAFT, SENDING, PAUSED ou DONE"),
      channel: z
        .enum(["PLATFORM", "MICROSOFT", "GOOGLE", "SMTP"])
        .optional()
        .describe("PLATFORM, MICROSOFT, GOOGLE ou SMTP"),
      ...periodShape,
      ...pageShape,
    },
    run: async ({ status, channel, from, to, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchEmailBroadcasts(org.id, {
        status,
        channel,
        range: resolveRange(from, to),
        page: p,
      });
      return listResult(total, p, items);
    },
  }),
];

/**
 * Simulador de webhook da Meta para desenvolvimento: assina com META_APP_SECRET e
 * manda para /api/webhooks/whatsapp-cloud do app local — exercita a tela oficial
 * sem Meta e sem túnel. Não roda em CI.
 *
 *   npx tsx --env-file=.env scripts/wa-cloud-webhook.ts seed <email-do-usuario>
 *   npx tsx --env-file=.env scripts/wa-cloud-webhook.ts sql "<SELECT ...>"
 *   npx tsx --env-file=.env scripts/wa-cloud-webhook.ts move-owner to=<email|id>
 *   npx tsx --env-file=.env scripts/wa-cloud-webhook.ts seed-campaign wamid=<id> [waId=...]
 *   npx tsx --env-file=.env scripts/wa-cloud-webhook.ts <tipo> [chave=valor ...]
 *
 * tipos:  text | image | audio | document | location | reaction | status | template | user-id
 * chaves: phone, wamid, waId (waId=none = sem telefone), bsuid (bsuid=none), name, username,
 *         body, caption, place, context, target, emoji (emoji=none remove), status, code,
 *         details, pricing, template, event, language, previous, current, url, ts (segundos)
 * `sql` existe porque o Postgres portátil do ambiente local não traz o psql.
 */
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as f from "../src/lib/whatsapp-cloud/__tests__/fixtures";

const [kind, ...rest] = process.argv.slice(2);
const args: Record<string, string> = Object.fromEntries(
  rest.map((a) => {
    const i = a.indexOf("=");
    return i === -1 ? [a, ""] : [a.slice(0, i), a.slice(i + 1)];
  }),
);
const opt = (k: string): string | null | undefined =>
  args[k] === undefined ? undefined : args[k] === "none" ? null : args[k];
const str = (k: string): string | undefined => opt(k) ?? undefined;

function client(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Consulta de verificação (só leitura, uso local). */
async function sql(query: string) {
  if (!/^\s*select\b/i.test(query)) throw new Error("Só SELECT.");
  const prisma = client();
  try {
    console.table(await prisma.$queryRawUnsafe(query));
  } finally {
    await prisma.$disconnect();
  }
}

async function seed(email: string) {
  const prisma = client();
  try {
    const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });
    if (!user) throw new Error(`Usuário ${email} não encontrado`);
    const m = await prisma.membership.findFirst({ where: { userId: user.id }, select: { organizationId: true } });
    if (!m) throw new Error("Usuário sem empresa");
    const phoneNumberId = str("phone") ?? f.PHONE_NUMBER_ID;
    const data = {
      phoneNumberId,
      wabaId: f.WABA_ID,
      displayPhoneNumber: "+1 555 078 3881",
      verifiedName: "Número simulado",
      status: "ACTIVE" as const,
      // Token falso de propósito: recebimento funciona; envio falha com "no_number".
      accessTokenEnc: "dev-fake-token",
    };
    const existing = await prisma.whatsappCloudNumber.findFirst({
      where: { organizationId: m.organizationId, ownerId: user.id },
      select: { id: true },
    });
    if (existing) {
      await prisma.whatsappCloudNumber.updateMany({ where: { id: existing.id, organizationId: m.organizationId }, data });
    } else {
      await prisma.whatsappCloudNumber.create({ data: { organizationId: m.organizationId, ownerId: user.id, ...data } });
    }
    console.log(`Número simulado pronto (phone_number_id=${phoneNumberId}).`);
    console.log(`Libere a empresa no .env: WHATSAPP_CLOUD_ORG_IDS=${m.organizationId}`);
  } finally {
    await prisma.$disconnect();
  }
}

function build(): Record<string, unknown> {
  // `ts` em segundos; padrão = agora (janela de 24h aberta). ts=1790000000 = 21/09/2026.
  const timestamp = str("ts") ? Number(str("ts")) : Math.floor(Date.now() / 1000);
  const who = {
    phoneNumberId: str("phone"),
    wamid: str("wamid"),
    waId: opt("waId"),
    bsuid: opt("bsuid"),
    name: str("name"),
    username: str("username"),
    contextId: str("context"),
    timestamp,
  };
  switch (kind) {
    case "text":
      return f.inboundText({ ...who, body: str("body") });
    case "image":
    case "audio":
    case "document":
      return f.inboundMedia(kind, { ...who, caption: str("caption") });
    case "location":
      return f.inboundLocation({ ...who, name: str("place") });
    case "reaction":
      return f.inboundReaction({ ...who, targetWamid: str("target") ?? "", emoji: opt("emoji") });
    case "status":
      return f.statusUpdate({
        wamid: str("wamid") ?? "",
        status: (str("status") ?? "delivered") as "sent" | "delivered" | "read" | "failed",
        phoneNumberId: who.phoneNumberId,
        waId: who.waId,
        bsuid: who.bsuid,
        errorCode: str("code") ? Number(str("code")) : undefined,
        errorDetails: str("details"),
        pricingCategory: str("pricing"),
        timestamp,
      });
    case "template":
      return f.templateStatusUpdate({ name: str("template") ?? "", event: str("event") ?? "APPROVED", language: str("language") });
    case "user-id":
      return f.userIdUpdate({ previous: str("previous") ?? "", current: str("current") ?? "", phoneNumberId: who.phoneNumberId });
    default:
      throw new Error(`Tipo desconhecido: ${kind}`);
  }
}

/** Troca o dono do número simulado (teste de privacidade entre vendedores). */
async function moveOwner(to: string) {
  const prisma = client();
  try {
    const phoneNumberId = str("phone") ?? f.PHONE_NUMBER_ID;
    const user = to.includes("@") ? await prisma.user.findFirst({ where: { email: to }, select: { id: true } }) : null;
    const ownerId = user?.id ?? to;
    const n = await prisma.whatsappCloudNumber.findFirst({
      where: { phoneNumberId },
      select: { id: true, organizationId: true },
    });
    if (!n || !ownerId) throw new Error("Número simulado ou dono não encontrado");
    await prisma.whatsappCloudNumber.updateMany({ where: { id: n.id, organizationId: n.organizationId }, data: { ownerId } });
    console.log(`Dono do número agora: ${ownerId}`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Campanha oficial fictícia, RUNNING, com UM destinatário já "enviado" (wamid
 * conhecido) — testa status e pausa pelo webhook sem precisar da Meta.
 */
async function seedCampaign() {
  const prisma = client();
  try {
    const phoneNumberId = str("phone") ?? f.PHONE_NUMBER_ID;
    const n = await prisma.whatsappCloudNumber.findFirst({
      where: { phoneNumberId },
      select: { id: true, organizationId: true, ownerId: true },
    });
    if (!n) throw new Error("Rode o seed antes");
    const orgId = n.organizationId;
    const wamid = str("wamid") ?? `wamid.CAMP.${Date.now()}`;
    const waId = str("waId") ?? "5511955550001";

    let template = await prisma.whatsappCloudTemplate.findFirst({
      where: { organizationId: orgId, wabaId: f.WABA_ID, name: "simulado", language: "pt_BR" },
      select: { id: true },
    });
    if (!template) {
      template = await prisma.whatsappCloudTemplate.create({
        data: {
          organizationId: orgId,
          wabaId: f.WABA_ID,
          metaId: "0",
          name: "simulado",
          language: "pt_BR",
          category: "MARKETING",
          status: "APPROVED",
          parameterFormat: "POSITIONAL",
          components: [{ type: "BODY", text: "Olá {{1}}, esta é uma campanha simulada." }],
          syncedAt: new Date(),
        },
        select: { id: true },
      });
    }
    const contact = await prisma.contact.create({
      data: { organizationId: orgId, name: `Contato ${wamid}`, phone: waId.slice(2), tags: ["simulado"], source: "simulador" },
      select: { id: true },
    });
    const campaign = await prisma.campaign.create({
      data: { organizationId: orgId, name: `Simulada ${wamid}`, channel: "WHATSAPP_CLOUD", status: "RUNNING", createdById: n.ownerId },
      select: { id: true },
    });
    await prisma.campaignRecipient.create({
      data: { organizationId: orgId, campaignId: campaign.id, contactId: contact.id, status: "SENT", providerMessageId: wamid, sentAt: new Date() },
    });
    await prisma.whatsappCloudCampaign.create({
      data: { organizationId: orgId, campaignId: campaign.id, numberId: n.id, templateId: template.id, params: {} },
    });
    const convo =
      (await prisma.whatsappCloudConversation.findFirst({
        where: { organizationId: orgId, numberId: n.id, waId },
        select: { id: true },
      })) ??
      (await prisma.whatsappCloudConversation.create({
        data: { organizationId: orgId, numberId: n.id, waId, contactId: contact.id },
        select: { id: true },
      }));
    await prisma.whatsappCloudMessage.create({
      data: {
        organizationId: orgId,
        conversationId: convo.id,
        wamid,
        direction: "OUTBOUND",
        type: "TEMPLATE",
        body: "Olá, esta é uma campanha simulada.",
        status: "SENT",
        campaignId: campaign.id,
        timestamp: new Date(),
      },
    });
    console.log(`Campanha ${campaign.id} (RUNNING) com a mensagem ${wamid} para ${waId}.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (kind === "seed") return seed(rest[0] ?? "");
  if (kind === "sql") return sql(rest.join(" "));
  if (kind === "move-owner") return moveOwner(str("to") ?? "");
  if (kind === "seed-campaign") return seedCampaign();
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error("META_APP_SECRET não está no .env");
  const body = JSON.stringify(build());
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const url = str("url") ?? "http://localhost:3000/api/webhooks/whatsapp-cloud";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
    body,
  });
  console.log(`${res.status} ${await res.text()}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

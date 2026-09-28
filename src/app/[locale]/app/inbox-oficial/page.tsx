import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { BadgeCheck, MessageCircle, Settings } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { requireModule, requireScreen } from "@/lib/access";
import { resolveLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { isWhatsappCloudEnabled } from "@/lib/whatsapp-cloud/rollout";
import { toTemplateOption } from "@/lib/whatsapp-cloud/template-params";
import { getMyCloudNumber, listCloudConversations, listCloudTemplates } from "@/lib/queries/inbox-oficial";
import { NumberSettings } from "@/components/inbox-oficial/number-settings";
import { CloudInbox } from "@/components/inbox-oficial/cloud-inbox";

export const dynamic = "force-dynamic";

/**
 * "Conversas (Oficial)" — WhatsApp pela Cloud API direto na Meta. Piloto:
 * empresa fora de WHATSAPP_CLOUD_ORG_IDS recebe 404 (spec §5.3). Por vendedor:
 * cada usuário vê só o próprio número oficial.
 */
export default async function InboxOficialPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string; config?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "inboxOficial", locale);
  await requireModule(ctx, "inbox", locale);
  if (!isWhatsappCloudEnabled(ctx.organizationId)) notFound();
  const t = await getTranslations("inboxOficial");
  const { c, config } = await searchParams;

  const number = await getMyCloudNumber(ctx.organizationId, ctx.userId);
  const templates = number ? await listCloudTemplates(ctx.organizationId, number.wabaId) : [];
  const configView = !number || config === "1";

  const header = (
    <div className="glass relative overflow-hidden rounded-2xl border border-border p-4 shadow-sm sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(110% 110% at 100% 0%, color-mix(in srgb, var(--brand) 13%, transparent), transparent 55%)",
        }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <BadgeCheck className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("title")}</h1>
            <p className="truncate text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        {number ? (
          <Link
            href={configView ? "/app/inbox-oficial" : "/app/inbox-oficial?config=1"}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors",
              configView ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {configView ? <MessageCircle className="size-4" /> : <Settings className="size-4" />}
            <span className="hidden sm:inline">{configView ? t("backToConversations") : t("manageNumber")}</span>
          </Link>
        ) : null}
      </div>
    </div>
  );

  if (configView || !number) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <NumberSettings
          number={number}
          templates={templates.map((tpl) => ({
            id: tpl.id,
            name: tpl.name,
            language: tpl.language,
            category: tpl.category,
            status: tpl.status,
            rejectedReason: tpl.rejectedReason,
          }))}
        />
      </div>
    );
  }

  const conversations = await listCloudConversations(ctx.organizationId, ctx.userId);
  const approved = templates.filter((tpl) => tpl.status === "APPROVED").map((tpl) => toTemplateOption(tpl));

  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="h-[calc(100dvh-14rem)]">
        <CloudInbox
          initial={conversations}
          initialSelectedId={c ?? null}
          templates={approved}
          numberProblem={number.status === "ACTIVE" ? null : { status: number.status, error: number.lastError }}
        />
      </div>
    </div>
  );
}

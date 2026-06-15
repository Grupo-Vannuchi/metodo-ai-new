import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("app.dashboard");

  const cards = [
    { label: t("org"), value: ctx.organization.name },
    { label: t("plan"), value: ctx.organization.plan },
    { label: t("role"), value: ctx.role },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("welcome", { name: ctx.user.name })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-border bg-card p-5"
          >
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="mt-1 text-lg font-semibold">{card.value}</p>
          </div>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">{t("comingSoon")}</p>
    </div>
  );
}

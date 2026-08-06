import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listRegistries } from "@/lib/queries/registries";
import { RegistriesTabs } from "@/components/supplies/registries-tabs";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function RegistriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.registries");
  const data = await listRegistries(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <RegistriesTabs data={data} />
    </div>
  );
}

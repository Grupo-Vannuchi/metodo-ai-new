import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listRegistries } from "@/lib/queries/registries";
import { RegistriesTabs } from "@/components/supplies/registries-tabs";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

type Kind = "category" | "unit" | "warehouse";
const KINDS: Kind[] = ["category", "unit", "warehouse"];

export default async function RegistriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.registries");
  const sp = await searchParams;
  const activeKind: Kind = KINDS.includes(sp?.tab as Kind) ? (sp!.tab as Kind) : "category";
  const data = await listRegistries(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <RegistriesTabs data={data} activeKind={activeKind} />
    </div>
  );
}

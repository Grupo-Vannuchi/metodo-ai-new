import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { ConnectionForm } from "@/components/integrations/connection-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewConnectionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  await requireOrgContext(locale);
  const t = await getTranslations("connections");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
      <ConnectionForm />
    </div>
  );
}

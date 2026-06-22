import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { listPipelinesWithStages } from "@/lib/queries/pipelines";
import { productServiceOptions } from "@/lib/queries/crm";
import { resolveLocale } from "@/i18n/routing";
import { ImportForm } from "@/components/prospecting/import-form";

export const dynamic = "force-dynamic";

export default async function ImportProspectingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "prospecting", locale);

  const [pipelines, productServices] = await Promise.all([
    listPipelinesWithStages(ctx.organizationId),
    productServiceOptions(ctx.organizationId),
  ]);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <ImportForm jobId={id} pipelines={pipelines} productServices={productServices} />
    </div>
  );
}

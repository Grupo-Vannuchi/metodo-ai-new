import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getConnectionForEdit } from "@/lib/queries/connections";
import { ConnectionEditForm } from "@/components/integrations/connection-edit-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditConnectionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("connections");

  const conn = await getConnectionForEdit(ctx.organizationId, id);
  if (!conn) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href={`/app/connections/${id}`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("editTitle")}</h1>
      </div>

      <ConnectionEditForm
        id={conn.id}
        provider={conn.provider}
        label={conn.label}
        credentials={conn.credentials}
      />
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listDepartments, listJobRoles } from "@/lib/queries/hr";
import { HrCatalog } from "@/components/hr/hr-catalog";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** Org catalogs used by the employee record: departments and job roles. */
export default async function HrCatalogsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  const [departments, jobRoles] = await Promise.all([
    listDepartments(ctx.organizationId),
    listJobRoles(ctx.organizationId),
  ]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <HrCatalog
        model="department"
        title={t("catalog.departments")}
        hint={t("catalog.departmentsHint")}
        items={departments}
      />
      <HrCatalog
        model="jobRole"
        title={t("catalog.jobRoles")}
        hint={t("catalog.jobRolesHint")}
        items={jobRoles}
      />
    </div>
  );
}

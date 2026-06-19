import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getCompany } from "@/lib/queries/companies";
import { getEntityFinance } from "@/lib/queries/finance";
import { hasFeature, type PlanKey } from "@/config/plans";
import { StartChatButton } from "@/components/inbox/start-chat-button";
import { EntityFinanceCard } from "@/components/finance/entity-finance-card";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

type Addr = { street?: string; number?: string; district?: string; city?: string; uf?: string; zip?: string; country?: string };

export default async function CompanyViewPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.companies");

  const canFinance = hasFeature(ctx.organization.plan as PlanKey, "finance");
  const [company, finance] = await Promise.all([
    getCompany(ctx.organizationId, id),
    canFinance ? getEntityFinance(ctx.organizationId, { companyId: id }) : Promise.resolve(null),
  ]);
  if (!company) notFound();

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
  const addr = (company.address ?? {}) as Addr;
  const addressLine = [addr.street, addr.city, addr.uf, addr.zip].filter(Boolean).join(", ");

  const fields: { label: string; value: string }[] = [
    { label: t("cnpj"), value: company.cnpj || "—" },
    { label: t("email"), value: company.email || "—" },
    { label: t("phone"), value: company.phone || "—" },
    { label: t("street"), value: addr.street || "—" },
    { label: t("city"), value: addr.city || "—" },
    { label: t("uf"), value: addr.uf || "—" },
    { label: t("zip"), value: addr.zip || "—" },
    { label: t("source"), value: company.source || "—" },
    { label: t("createdAt"), value: fmtDate(company.createdAt) },
  ];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>
          {addressLine ? <p className="mt-1 text-sm text-muted-foreground">{addressLine}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {company.phone ? <StartChatButton phone={company.phone} name={company.name} /> : null}
          <Link href={`/app/companies/${company.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Pencil className="size-4" />
            {t("edit")}
          </Link>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
        {company.website ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("website")}</dt>
            <dd className="mt-0.5 text-sm">
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                {company.website}
              </a>
            </dd>
          </div>
        ) : null}
        {fields.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="mt-0.5 text-sm">{f.value}</dd>
          </div>
        ))}
        {company.notes ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("notes")}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm">{company.notes}</dd>
          </div>
        ) : null}
      </dl>

      {finance ? <EntityFinanceCard data={finance} /> : null}
    </div>
  );
}

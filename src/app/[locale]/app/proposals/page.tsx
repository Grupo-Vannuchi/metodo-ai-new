import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import {
  listProposals,
  PROPOSAL_STATUS_FILTERS,
  PROPOSAL_PERIOD_FILTERS,
  type ProposalStatusFilter,
  type ProposalPeriodFilter,
} from "@/lib/queries/proposals";
import { ProposalsToolbar } from "@/components/proposals/proposals-toolbar";
import { OpenRow } from "@/components/ui/open-row";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SENT: "bg-brand/10 text-brand",
  ACCEPTED: "bg-green-500/10 text-green-600",
  REJECTED: "bg-red-500/10 text-red-600",
  EXPIRED: "bg-amber-500/10 text-amber-600",
};

export default async function ProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; period?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("proposals");

  const sp = await searchParams;
  const status = (PROPOSAL_STATUS_FILTERS.includes(sp?.status as ProposalStatusFilter) ? sp!.status : "ALL") as ProposalStatusFilter;
  const period = (PROPOSAL_PERIOD_FILTERS.includes(sp?.period as ProposalPeriodFilter) ? sp!.period : "ALL") as ProposalPeriodFilter;

  const proposals = await listProposals(ctx.organizationId, { status, period });

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/app/proposals/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("new")}
        </Link>
      </div>

      <ProposalsToolbar status={status} period={period} />

      {proposals.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("colProposal")}</th>
                <th className="px-5 py-3 font-medium">{t("colClient")}</th>
                <th className="px-5 py-3 font-medium">{t("colStatus")}</th>
                <th className="px-5 py-3 font-medium">{t("colTotal")}</th>
                <th className="px-5 py-3 font-medium">{t("colCreatedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <OpenRow
                  key={p.id}
                  href={`/app/proposals/${p.id}`}
                  title={t("openHint")}
                  className="border-b border-border align-top last:border-0 hover:bg-muted/40"
                >
                  <td className="px-5 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {p.code ? <span className="mr-2 text-xs tabular-nums text-muted-foreground">{p.code}</span> : null}
                        {p.title}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-col">
                      <span>{p.clientCompany || p.clientName || "—"}</span>
                      {p.clientCompany && p.clientName ? (
                        <span className="text-xs text-muted-foreground">{p.clientName}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[p.status])}>
                      {t(`status.${p.status}`)}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-semibold tabular-nums text-brand">{formatBRL(p.total)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{fmtDate(p.createdAt)}</td>
                </OpenRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

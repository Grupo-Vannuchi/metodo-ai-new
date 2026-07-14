import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Pencil, Wallet, LayoutTemplate } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getProposal, listProposalAttachments } from "@/lib/queries/proposals";
import { hasFeature, type PlanKey } from "@/config/plans";
import { ProposalStatusBar } from "@/components/proposals/proposal-status-bar";
import { ProposalAttachments } from "@/components/proposals/proposal-attachments";
import { ProposalExportMenu } from "@/components/proposals/proposal-export-menu";
import { DeleteProposalButton } from "@/components/proposals/delete-proposal-button";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatBRL } from "@/lib/money";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("proposals");
  const canFinance = hasFeature(ctx.organization.plan as PlanKey, "finance");

  const [proposal, attachments] = await Promise.all([
    getProposal(ctx.organizationId, id),
    listProposalAttachments(ctx.organizationId, id),
  ]);
  if (!proposal) notFound();

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

  const clientRows: [string, string | null][] = [
    [t("form.clientCompany"), proposal.clientCompany],
    [t("form.clientName"), proposal.clientName],
    [t("form.clientEmail"), proposal.clientEmail],
    [t("form.clientPhone"), proposal.clientPhone],
    [t("form.clientAddress"), proposal.clientAddress],
  ];

  const financeHref = (() => {
    const desc = `${proposal.code ? `${proposal.code} - ` : ""}${proposal.title}`;
    const today = new Date().toISOString().slice(0, 10);
    const p = new URLSearchParams({
      type: "INCOME",
      description: desc,
      amount: String(proposal.total),
      dueDate: today,
    });
    if (proposal.contactId) p.set("contactId", proposal.contactId);
    if (proposal.companyId) p.set("companyId", proposal.companyId);
    // Link the entry back to the opportunity too, closing the loop
    // (opportunity → proposal → finance) so it shows under the opportunity.
    if (proposal.opportunityId) p.set("opportunityId", proposal.opportunityId);
    return `/app/finance/entries/new?${p.toString()}`;
  })();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {proposal.code ? (
            <p className="text-sm font-medium tabular-nums text-muted-foreground">{proposal.code}</p>
          ) : null}
          <h1 className="text-2xl font-bold tracking-tight">{proposal.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProposalExportMenu proposalId={proposal.id} />
          <Link href={`/app/proposals/${proposal.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Pencil className="size-4" />
            {t("edit")}
          </Link>
          <DeleteProposalButton id={proposal.id} />
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <ProposalStatusBar id={proposal.id} status={proposal.status} />
      </section>

      {proposal.status === "ACCEPTED" && canFinance ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-500/40 bg-green-500/5 p-4">
          <div>
            <p className="text-sm font-medium">{t("acceptedTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("acceptedHint")}</p>
          </div>
          <Link href={financeHref} className={buttonVariants({ size: "sm" })}>
            <Wallet className="size-4" />
            {t("generateEntry")}
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">{t("form.sectionClient")}</h2>
          <dl className="flex flex-col gap-1.5 text-sm">
            {clientRows.filter(([, v]) => v).length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              clientRows
                .filter(([, v]) => v)
                .map(([label, v]) => (
                  <div key={label} className="flex gap-2">
                    <dt className="min-w-24 text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))
            )}
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">{t("detail.info")}</h2>
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="min-w-24 text-muted-foreground">{t("form.validUntil")}</dt>
              <dd className="font-medium">{fmtDate(proposal.validUntil)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="min-w-24 text-muted-foreground">{t("detail.createdAt")}</dt>
              <dd className="font-medium">{fmtDate(proposal.createdAt)}</dd>
            </div>
            {proposal.opportunity ? (
              <div className="flex gap-2">
                <dt className="min-w-24 text-muted-foreground">{t("detail.opportunity")}</dt>
                <dd className="font-medium">
                  <Link href={`/app/crm/${proposal.opportunity.id}`} className="text-brand hover:underline">
                    {proposal.opportunity.code ? `${proposal.opportunity.code} · ` : ""}
                    {proposal.opportunity.title}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">{t("form.itemName")}</th>
              <th className="px-5 py-3 text-right font-medium">{t("form.qty")}</th>
              <th className="px-5 py-3 text-right font-medium">{t("form.unitPrice")}</th>
              <th className="px-5 py-3 text-right font-medium">{t("form.lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {proposal.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">{t("form.noItems")}</td>
              </tr>
            ) : (
              proposal.items.map((it) => (
                <tr key={it.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-5 py-3">
                    <div className="font-medium">{it.name}</div>
                    {it.description ? <div className="text-xs text-muted-foreground">{it.description}</div> : null}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{it.quantity}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatBRL(it.unitPrice)}</td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">{formatBRL(it.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="flex justify-end px-5 py-4">
          <dl className="w-full max-w-xs text-sm">
            <div className="flex justify-between py-1 text-muted-foreground">
              <dt>{t("form.subtotal")}</dt>
              <dd className="tabular-nums">{formatBRL(proposal.subtotal)}</dd>
            </div>
            {proposal.discount > 0 ? (
              <div className="flex justify-between py-1 text-muted-foreground">
                <dt>{t("form.discount")}</dt>
                <dd className="tabular-nums">− {formatBRL(proposal.discount)}</dd>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-bold text-brand">
              <dt>{t("form.total")}</dt>
              <dd className="tabular-nums">{formatBRL(proposal.total)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {proposal.document.sections.length > 0 ? (
        <section className="rounded-xl border border-brand/30 bg-brand/5 p-5">
          <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
            <LayoutTemplate className="size-4 text-brand" />
            {t("documentTitle")}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("documentHint")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {proposal.document.sections.map((s, i) => (
              <li key={i} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs">
                {s.title || t("documentUntitled")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {proposal.intro ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold">{t("form.intro")}</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.intro}</p>
        </section>
      ) : null}

      {proposal.notes ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold">{t("form.notes")}</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.notes}</p>
        </section>
      ) : null}

      <ProposalAttachments proposalId={proposal.id} attachments={attachments} />
    </div>
  );
}

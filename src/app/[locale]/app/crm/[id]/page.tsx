import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Pencil, Wallet } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getOpportunity } from "@/lib/queries/crm";
import { listMembers } from "@/lib/queries/organizations";
import { listTasks } from "@/lib/queries/tasks";
import { entriesForOpportunity } from "@/lib/queries/finance";
import { hasFeature, type PlanKey } from "@/config/plans";
import { TasksManager } from "@/components/tasks/tasks-manager";
import { StartChatButton } from "@/components/inbox/start-chat-button";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-brand/10 text-brand",
  WON: "bg-green-500/10 text-green-600",
  LOST: "bg-red-500/10 text-red-600",
  CANCELED: "bg-amber-500/10 text-amber-600",
};

export default async function OpportunityViewPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.opportunity");
  const tf = await getTranslations("finance");
  const canFinance = hasFeature(ctx.organization.plan as PlanKey, "finance");

  const [opp, rawMembers, tasks, entries] = await Promise.all([
    getOpportunity(ctx.organizationId, id),
    listMembers(ctx.organizationId),
    listTasks(ctx.organizationId, { opportunityId: id }),
    canFinance ? entriesForOpportunity(ctx.organizationId, id) : Promise.resolve([]),
  ]);
  const members = ctx.role === "MEMBER" ? rawMembers.filter(m => m.userId === ctx.userId) : rawMembers;
  if (!opp) notFound();

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

  const fields: { label: string; value: string }[] = [
    { label: t("value"), value: formatBRL(opp.value) },
    { label: t("stage"), value: opp.stageName ?? "—" },
    { label: t("owner"), value: opp.ownerName ?? "—" },
    { label: t("company"), value: opp.companyName ?? "—" },
    { label: t("contact"), value: opp.contactName ?? "—" },
    { label: t("productService"), value: opp.productServiceName ?? "—" },
    { label: t("expectedCloseDate"), value: fmtDate(opp.expectedCloseDate) },
    { label: t("createdAt"), value: fmtDate(opp.createdAt) },
  ];
  if (opp.closedAt) fields.push({ label: t("closedAt"), value: fmtDate(opp.closedAt) });

  const financeHref = (() => {
    const today = new Date().toISOString().slice(0, 10);
    const desc = `${opp.code ? `${opp.code} - ` : ""}${opp.title}`;
    const p = new URLSearchParams({
      type: "INCOME",
      description: desc,
      amount: String(opp.value),
      opportunityId: opp.id,
      dueDate: today,
    });
    if (opp.contactId) p.set("contactId", opp.contactId);
    if (opp.companyId) p.set("companyId", opp.companyId);
    return `/app/finance/entries/new?${p.toString()}`;
  })();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {opp.code ? <p className="text-sm font-medium tabular-nums text-muted-foreground">{opp.code}</p> : null}
          <h1 className="text-2xl font-bold tracking-tight">{opp.title}</h1>
          <span className={cn("mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLE[opp.status])}>
            {t(`status${opp.status}`)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {opp.contactPhone ? (
            <StartChatButton phone={opp.contactPhone} name={opp.contactName ?? undefined} contactId={opp.contactId ?? undefined} />
          ) : null}
          <Link href={`/app/crm/${opp.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Pencil className="size-4" />
            {t("edit")}
          </Link>
        </div>
      </div>

      {opp.status === "WON" && canFinance ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-500/40 bg-green-500/5 p-4">
          <div>
            <p className="text-sm font-medium">{t("wonTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("wonHint")}</p>
          </div>
          <Link href={financeHref} className={buttonVariants({ size: "sm" })}>
            <Wallet className="size-4" />
            {t("generateEntry")}
          </Link>
        </div>
      ) : null}

      {canFinance && entries.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">{tf("linkedEntries")}</h2>
          <ul className="divide-y divide-border">
            {entries.map((e) => {
              const overdue = e.overdue;
              return (
                <li key={e.id}>
                  <Link
                    href={`/app/finance/entries/${e.id}`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">
                      {e.description}
                      <span className="ml-2 text-xs text-muted-foreground">{fmtDate(e.dueDate)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cn("tabular-nums", e.type === "INCOME" ? "text-green-600" : "text-red-600")}>
                        {formatBRL(e.amount)}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs",
                          e.status === "SETTLED"
                            ? "bg-green-500/10 text-green-600"
                            : overdue
                              ? "bg-red-500/10 text-red-600"
                              : "bg-amber-500/10 text-amber-600",
                        )}
                      >
                        {tf(`status.${e.status}.${e.type}`)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="mt-0.5 text-sm">{f.value}</dd>
          </div>
        ))}
        {(opp.status === "LOST" || opp.status === "CANCELED") && opp.outcomeReason ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("outcomeReason")}</dt>
            <dd className="mt-0.5 text-sm">{opp.outcomeReason}</dd>
          </div>
        ) : null}
        {opp.notes ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("notes")}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm">{opp.notes}</dd>
          </div>
        ) : null}
      </dl>

      <section className="rounded-xl border border-border bg-card p-5">
        <TasksManager
          tasks={tasks}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          fixed={{ opportunityId: opp.id, contactId: opp.contactId ?? undefined, companyId: opp.companyId ?? undefined }}
          currentUserId={ctx.userId}
        />
      </section>
    </div>
  );
}

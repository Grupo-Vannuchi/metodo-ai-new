import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listTasks } from "@/lib/queries/tasks";
import { listMyOpportunities, opportunityOptions } from "@/lib/queries/crm";
import { listMembers } from "@/lib/queries/organizations";
import { contactOptions } from "@/lib/queries/contacts";
import { TasksManager } from "@/components/tasks/tasks-manager";
import { Link } from "@/i18n/navigation";
import { formatBRL } from "@/lib/money";
import { resolveLocale } from "@/i18n/routing";
import { Pagination } from "@/components/ui/pagination";

export const dynamic = "force-dynamic";

export default async function MyItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("my");
  const page = parseInt((await searchParams)?.page || "1", 10);
  const pageSize = 10;

  const [tasks, myOpps, members, contacts, oppOptions] = await Promise.all([
    listTasks(ctx.organizationId, { assignedToId: ctx.userId }),
    listMyOpportunities(ctx.organizationId, ctx.userId, page, pageSize),
    listMembers(ctx.organizationId),
    contactOptions(ctx.organizationId),
    opportunityOptions(ctx.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("opportunities")}</h2>
        {myOpps.data.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("noOpps")}
          </p>
        ) : (
          <div className="flex flex-col rounded-xl border border-border bg-card">
            <ul className="overflow-hidden">
              {myOpps.data.map((o) => (
                <li key={o.id} className="border-b border-border last:border-0">
                  <Link href={`/app/crm/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted">
                    <span className="min-w-0">
                      {o.code ? <span className="mr-2 text-xs tabular-nums text-muted-foreground">{o.code}</span> : null}
                      <span className="font-medium">{o.title}</span>
                      {o.stageName ? <span className="ml-2 text-xs text-muted-foreground">· {o.stageName}</span> : null}
                    </span>
                    <span className="shrink-0 font-semibold text-brand tabular-nums">{formatBRL(o.value)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination total={myOpps.total} pageSize={pageSize} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("tasks")}</h2>
        <TasksManager
          tasks={tasks}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          contacts={contacts}
          opportunities={oppOptions}
          currentUserId={ctx.userId}
          showTabs
        />
      </section>
    </div>
  );
}

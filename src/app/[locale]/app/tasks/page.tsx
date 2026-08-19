import { getTranslations } from "next-intl/server";
import { LayoutGrid, List } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { hasModule } from "@/config/modules";
import { listTasks } from "@/lib/queries/tasks";
import { listMembers } from "@/lib/queries/organizations";
import { contactOptions } from "@/lib/queries/contacts";
import { opportunityOptions } from "@/lib/queries/crm";
import { TasksManager } from "@/components/tasks/tasks-manager";
import { TasksBoard } from "@/components/tasks/tasks-board";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const segBase = "rounded-md px-2 py-1 transition-colors";
const segActive = "bg-muted text-foreground";
const segIdle = "text-muted-foreground hover:text-foreground";

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("tasks");
  const view = (await searchParams)?.view === "kanban" ? "kanban" : "list";

  const hasCrm = hasModule(ctx.modules, "crm");
  const [tasks, rawMembers, contacts, opportunities] = await Promise.all([
    listTasks(ctx.organizationId, { scope: "all" }),
    listMembers(ctx.organizationId),
    hasCrm ? contactOptions(ctx.organizationId) : Promise.resolve([]),
    hasCrm ? opportunityOptions(ctx.organizationId) : Promise.resolve([]),
  ]);

  // Anyone can assign a task to any member (users hand tasks to each other).
  const members = rawMembers;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
        <p className="mt-1 text-muted-foreground">{t("pageSubtitle")}</p>
      </div>
      <div className="flex items-center rounded-lg border border-border p-0.5">
        <Link href="/app/tasks" aria-label={t("viewList")} title={t("viewList")} className={cn(segBase, view === "list" ? segActive : segIdle)}>
          <List className="size-4" />
        </Link>
        <Link
          href="/app/tasks?view=kanban"
          aria-label={t("viewKanban")}
          title={t("viewKanban")}
          className={cn(segBase, view === "kanban" ? segActive : segIdle)}
        >
          <LayoutGrid className="size-4" />
        </Link>
      </div>
    </div>
  );

  if (view === "kanban") {
    return (
      <div className="flex h-[calc(100dvh-7rem)] flex-col gap-6 md:h-[calc(100dvh-4.5rem)]">
        {header}
        <TasksBoard tasks={tasks} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <TasksManager
        tasks={tasks}
        members={members.map((m) => ({ id: m.userId, name: m.name }))}
        contacts={contacts}
        opportunities={opportunities}
        currentUserId={ctx.userId}
        showTabs
        hasCrm={hasCrm}
      />
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listTasks } from "@/lib/queries/tasks";
import { listMembers } from "@/lib/queries/organizations";
import { contactOptions } from "@/lib/queries/contacts";
import { opportunityOptions } from "@/lib/queries/crm";
import { TasksManager } from "@/components/tasks/tasks-manager";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("tasks");

  const [tasks, rawMembers, contacts, opportunities] = await Promise.all([
    listTasks(ctx.organizationId, { scope: "all" }),
    listMembers(ctx.organizationId),
    contactOptions(ctx.organizationId),
    opportunityOptions(ctx.organizationId),
  ]);

  const members = ctx.role === "MEMBER" ? rawMembers.filter(m => m.userId === ctx.userId) : rawMembers;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
        <p className="mt-1 text-muted-foreground">{t("pageSubtitle")}</p>
      </div>
      <TasksManager
        tasks={tasks}
        members={members.map((m) => ({ id: m.userId, name: m.name }))}
        contacts={contacts}
        opportunities={opportunities}
        currentUserId={ctx.userId}
        showTabs
      />
    </div>
  );
}

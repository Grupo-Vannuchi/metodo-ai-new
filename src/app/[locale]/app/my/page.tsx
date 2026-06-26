import { requireOrgContext } from "@/lib/tenant";
import { listTasks } from "@/lib/queries/tasks";
import { opportunityOptions } from "@/lib/queries/crm";
import { myOpportunities, recentNotifications, listPinned } from "@/lib/queries/hub";
import { listMembers } from "@/lib/queries/organizations";
import { contactOptions } from "@/lib/queries/contacts";
import { MyHub } from "@/components/hub/my-hub";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function MyItemsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);

  const [tasks, opps, notifications, pins, rawMembers, contacts, opportunities] = await Promise.all([
    listTasks(ctx.organizationId, { assignedToId: ctx.userId, scope: "all" }),
    myOpportunities(ctx.organizationId, ctx.userId),
    recentNotifications(ctx.organizationId, ctx.userId),
    listPinned(ctx.organizationId, ctx.userId),
    listMembers(ctx.organizationId),
    contactOptions(ctx.organizationId),
    opportunityOptions(ctx.organizationId),
  ]);

  // MEMBERs can only assign tasks to themselves.
  const members = ctx.role === "MEMBER" ? rawMembers.filter((m) => m.userId === ctx.userId) : rawMembers;

  return (
    <MyHub
      userName={ctx.user.name.split(/\s+/)[0]}
      currentUserId={ctx.userId}
      todayISO={new Date().toISOString()}
      tasks={tasks}
      opps={opps}
      notifications={notifications}
      pins={pins}
      members={members.map((m) => ({ id: m.userId, name: m.name }))}
      contacts={contacts}
      opportunities={opportunities}
    />
  );
}

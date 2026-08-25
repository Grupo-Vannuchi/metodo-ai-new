import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { tenantDb } from "@/lib/tenant-db";
import { listFeed } from "@/lib/queries/feed";
import { listTeamMembers, type AttachKind } from "@/lib/queries/team-chat";
import { getMyProfile } from "@/lib/queries/profile";
import { FeedClient } from "@/components/feed/feed-client";
import { FeedHero } from "@/components/feed/feed-hero";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function FeedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "feed", locale);
  const t = await getTranslations("feed");
  const db = tenantDb(ctx.organizationId);

  // Cross-module features in the wall are gated by installed modules: the hero
  // stats and the attach picker only expose entities from modules the org has.
  const hasTasks = hasModule(ctx.modules, "tasks");
  const hasCrm = hasModule(ctx.modules, "crm");
  const hasMarketing = hasModule(ctx.modules, "marketing");

  const [posts, members, profile, taskCount, oppCount] = await Promise.all([
    listFeed(ctx.organizationId, ctx.userId),
    listTeamMembers(ctx.organizationId),
    getMyProfile(ctx.userId),
    hasTasks ? db.task.count({ where: { assignedToId: ctx.userId, doneAt: null } }) : Promise.resolve(0),
    hasCrm ? db.opportunity.count({ where: { ownerId: ctx.userId, status: "OPEN" } }) : Promise.resolve(0),
  ]);

  const attachKinds: AttachKind[] = [];
  if (hasTasks) attachKinds.push("TASK");
  if (hasCrm) attachKinds.push("OPP", "CONTACT", "COMPANY");
  if (hasMarketing) attachKinds.push("LEAD");

  const canPost = ctx.role === "OWNER" || ctx.role === "ADMIN";
  const location = [profile?.addressCity, profile?.addressState].filter(Boolean).join(", ") || null;

  return (
    <div className="flex flex-col gap-6">
      <FeedHero
        title={t("title")}
        subtitle={t("subtitle")}
        name={profile?.name ?? ctx.user.name}
        avatarUrl={profile?.avatarUrl ?? null}
        position={profile?.position ?? null}
        location={location}
        taskStat={hasTasks ? t("statTasks", { count: taskCount }) : null}
        oppStat={hasCrm ? t("statOpps", { count: oppCount }) : null}
      />

      <FeedClient
        initialPosts={posts}
        members={members.map((m) => ({ userId: m.userId, name: m.name, avatarUrl: m.avatarUrl }))}
        currentUserId={ctx.userId}
        canPost={canPost}
        attachKinds={attachKinds}
      />
    </div>
  );
}

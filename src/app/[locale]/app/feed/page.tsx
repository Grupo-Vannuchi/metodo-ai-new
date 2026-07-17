import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { tenantDb } from "@/lib/tenant-db";
import { listFeed } from "@/lib/queries/feed";
import { listTeamMembers } from "@/lib/queries/team-chat";
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

  const [posts, members, profile, taskCount, oppCount] = await Promise.all([
    listFeed(ctx.organizationId, ctx.userId),
    listTeamMembers(ctx.organizationId),
    getMyProfile(ctx.userId),
    db.task.count({ where: { assignedToId: ctx.userId, doneAt: null } }),
    db.opportunity.count({ where: { ownerId: ctx.userId, status: "OPEN" } }),
  ]);

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
        taskStat={t("statTasks", { count: taskCount })}
        oppStat={t("statOpps", { count: oppCount })}
      />

      <FeedClient
        initialPosts={posts}
        members={members.map((m) => ({ userId: m.userId, name: m.name, avatarUrl: m.avatarUrl }))}
        currentUserId={ctx.userId}
        canPost={canPost}
      />
    </div>
  );
}

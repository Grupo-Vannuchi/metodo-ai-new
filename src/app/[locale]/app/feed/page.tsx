import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listFeed } from "@/lib/queries/feed";
import { listTeamMembers } from "@/lib/queries/team-chat";
import { FeedClient } from "@/components/feed/feed-client";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function FeedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("feed");

  const [posts, members] = await Promise.all([
    listFeed(ctx.organizationId, ctx.userId),
    listTeamMembers(ctx.organizationId),
  ]);
  const canPost = ctx.role === "OWNER" || ctx.role === "ADMIN";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <FeedClient
        initialPosts={posts}
        members={members.map((m) => ({ userId: m.userId, name: m.name, avatarUrl: m.avatarUrl }))}
        currentUserId={ctx.userId}
        canPost={canPost}
      />
    </div>
  );
}

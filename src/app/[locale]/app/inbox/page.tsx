import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { listConversations, listConversationFolders } from "@/lib/queries/inbox";
import { InboxClient } from "@/components/inbox/inbox-client";
import { TeamChatClient } from "@/components/inbox/team-chat-client";
import { resolveLocale } from "@/i18n/routing";
import { listMembers } from "@/lib/queries/organizations";
import { listTeamChats } from "@/lib/queries/team-chat";
import { Link } from "@/i18n/navigation";
import { MessageCircle, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string; chat?: string; mode?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "inbox", locale);
  const t = await getTranslations("teamChat");

  const { c, chat, mode = "whatsapp" } = await searchParams;

  const [conversations, folders, members, teamChats] = await Promise.all([
    mode === "whatsapp" ? listConversations(ctx.organizationId) : Promise.resolve([]),
    mode === "whatsapp" ? listConversationFolders(ctx.organizationId) : Promise.resolve([]),
    mode === "team" ? listMembers(ctx.organizationId) : Promise.resolve([]),
    mode === "team" ? listTeamChats(ctx.organizationId, ctx.userId) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-1 shadow-sm w-fit">
        <Link
          href="/app/inbox?mode=whatsapp"
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            mode === "whatsapp" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          <MessageCircle className="size-4" />
          WhatsApp
        </Link>
        <Link
          href="/app/inbox?mode=team"
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            mode === "team" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          <Users className="size-4" />
          {t("tab")}
        </Link>
      </div>

      <div className="h-[calc(100dvh-11rem)]">
        {mode === "whatsapp" ? (
          <InboxClient
            initial={conversations}
            initialFolders={folders}
            initialSelectedId={c ?? null}
          />
        ) : (
          <TeamChatClient
            members={members}
            initialChats={teamChats}
            initialSelectedId={chat ?? null}
            currentUserId={ctx.userId}
          />
        )}
      </div>
    </div>
  );
}

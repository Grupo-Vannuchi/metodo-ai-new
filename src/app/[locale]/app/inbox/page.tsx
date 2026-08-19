import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { requireScreen, requireModule } from "@/lib/access";
import { hasFeatureByModules, hasModule } from "@/config/modules";
import { prisma } from "@/lib/prisma";
import { listConversations, listConversationFolders } from "@/lib/queries/inbox";
import { listQuickReplies } from "@/lib/queries/quick-replies";
import { getWhatsappAgent } from "@/lib/queries/whatsapp-agent";
import { InboxClient } from "@/components/inbox/inbox-client";
import { TeamChatClient } from "@/components/inbox/team-chat-client";
import { ExportMenu } from "@/components/inbox/export-menu";
import { WhatsappQuickConnect } from "@/components/integrations/whatsapp-quick-connect";
import { EvolutionConnect } from "@/components/integrations/evolution-connect";
import { WhatsappAgentConfig } from "@/components/integrations/whatsapp-agent-config";
import { resolveLocale } from "@/i18n/routing";
import { listTeamChats, listTeamMembers, listTeamChatFolders } from "@/lib/queries/team-chat";
import { Link } from "@/i18n/navigation";
import { MessageCircle, Users, MessagesSquare, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string; chat?: string; mode?: string; config?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "inbox", locale);
  await requireModule(ctx, "inbox", locale);
  const t = await getTranslations("teamChat");
  const ti = await getTranslations("inbox");

  const { c, chat, mode = "whatsapp", config } = await searchParams;

  const [conversations, folders, teamMembers, teamChats, teamFolders, quickReplies] = await Promise.all([
    mode === "whatsapp"
      ? listConversations(ctx.organizationId, { userId: ctx.userId, role: ctx.role })
      : Promise.resolve([]),
    mode === "whatsapp" ? listConversationFolders(ctx.organizationId) : Promise.resolve([]),
    mode === "team" ? listTeamMembers(ctx.organizationId) : Promise.resolve([]),
    mode === "team" ? listTeamChats(ctx.organizationId, ctx.userId) : Promise.resolve([]),
    mode === "team" ? listTeamChatFolders(ctx.organizationId) : Promise.resolve([]),
    mode === "whatsapp" ? listQuickReplies(ctx.organizationId) : Promise.resolve([]),
  ]);

  const exportGroups = conversations
    .filter((c) => c.isGroup)
    .map((c) => ({ id: c.id, name: c.customName || c.name || "Grupo" }));

  // One-click WhatsApp lives here in Conversas. Show the connect card when the
  // caller hasn't linked their own number yet (platform Evolution configured).
  const platformWhatsapp = Boolean(env.EVOLUTION_API_URL && env.EVOLUTION_API_KEY);
  // The caller's own WhatsApp number — connect/disconnect + agent config now live
  // here in Conversas (via the gear), so there's no separate Conexões tab.
  const myConn =
    mode === "whatsapp" && platformWhatsapp
      ? await prisma.integrationConnection.findFirst({
          where: { organizationId: ctx.organizationId, provider: "EVOLUTION", ownerId: ctx.userId },
          orderBy: { createdAt: "asc" },
          select: { id: true, status: true },
        })
      : null;
  const configView = mode === "whatsapp" && config === "1" && !!myConn;
  const showConnect = mode === "whatsapp" && platformWhatsapp && myConn?.status !== "ACTIVE" && !configView;
  const agent =
    configView && hasFeatureByModules(ctx.modules, "whatsapp_agent")
      ? await getWhatsappAgent(ctx.organizationId, myConn!.id)
      : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Glass header — same language as Settings / dashboard. */}
      <div className="glass relative overflow-hidden rounded-2xl border border-border p-4 shadow-sm sm:p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(110% 110% at 100% 0%, color-mix(in srgb, var(--brand) 13%, transparent), transparent 55%)",
          }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <MessagesSquare className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("inboxTitle")}</h1>
              <p className="truncate text-sm text-muted-foreground">{t("inboxSubtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
              <Link
                href="/app/inbox?mode=whatsapp"
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === "whatsapp" ? "bg-brand text-brand-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <MessageCircle className="size-4" />
                WhatsApp
              </Link>
              <Link
                href="/app/inbox?mode=team"
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === "team" ? "bg-brand text-brand-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Users className="size-4" />
                {t("tab")}
              </Link>
            </div>
            {mode === "whatsapp" ? <ExportMenu groups={exportGroups} /> : null}
            {mode === "whatsapp" && myConn ? (
              <Link
                href={configView ? "/app/inbox?mode=whatsapp" : "/app/inbox?mode=whatsapp&config=1"}
                title={configView ? ti("backToConversations") : ti("manageNumber")}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors",
                  configView ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {configView ? <MessageCircle className="size-4" /> : <Settings className="size-4" />}
                <span className="hidden sm:inline">
                  {configView ? ti("backToConversations") : ti("manageNumber")}
                </span>
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {configView && myConn ? (
        <div className="flex w-full flex-col gap-6">
          <EvolutionConnect id={myConn.id} initialActive={myConn.status === "ACTIVE"} />
          {hasFeatureByModules(ctx.modules, "whatsapp_agent") ? (
            <WhatsappAgentConfig connectionId={myConn.id} initial={agent} />
          ) : null}
        </div>
      ) : showConnect ? (
        <WhatsappQuickConnect initialActive={false} />
      ) : (
        <div className="h-[calc(100dvh-14rem)]">
          {mode === "whatsapp" ? (
            <InboxClient
              initial={conversations}
              initialFolders={folders}
              initialSelectedId={c ?? null}
              quickReplies={quickReplies}
              hasCrm={hasModule(ctx.modules, "crm")}
            />
          ) : (
            <TeamChatClient
              members={teamMembers}
              folders={teamFolders}
              initialChats={teamChats}
              initialSelectedId={chat ?? null}
              currentUserId={ctx.userId}
            />
          )}
        </div>
      )}
    </div>
  );
}

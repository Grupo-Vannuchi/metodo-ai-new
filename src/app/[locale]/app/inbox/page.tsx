import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { listConversations, listConversationFolders } from "@/lib/queries/inbox";
import { InboxClient } from "@/components/inbox/inbox-client";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "inbox", locale);

  const [conversations, folders] = await Promise.all([
    listConversations(ctx.organizationId),
    listConversationFolders(ctx.organizationId),
  ]);
  const { c } = await searchParams;

  return (
    <InboxClient
      initial={conversations}
      initialFolders={folders}
      initialSelectedId={c ?? null}
    />
  );
}

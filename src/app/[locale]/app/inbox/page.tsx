import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { listConversations } from "@/lib/queries/inbox";
import { listMembers } from "@/lib/queries/organizations";
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

  const [conversations, members] = await Promise.all([
    listConversations(ctx.organizationId),
    listMembers(ctx.organizationId),
  ]);
  const { c } = await searchParams;

  return (
    <InboxClient
      initial={conversations}
      members={members.map((m) => ({ userId: m.userId, name: m.name }))}
      initialSelectedId={c ?? null}
    />
  );
}

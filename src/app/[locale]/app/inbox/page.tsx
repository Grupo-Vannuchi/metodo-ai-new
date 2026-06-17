import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { listConversations } from "@/lib/queries/inbox";
import { InboxClient } from "@/components/inbox/inbox-client";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "inbox", locale);

  const conversations = await listConversations(ctx.organizationId);
  return <InboxClient initial={conversations} />;
}

import { getTranslations } from "next-intl/server";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { listMembers, listPendingInvitations } from "@/lib/queries/organizations";
import { accessTemplateOptions } from "@/lib/queries/access-templates";
import { InviteForm } from "@/components/app/invite-form";
import { PendingInvitations } from "@/components/app/pending-invitations";
import { MembersAdmin } from "@/components/app/members-admin";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("app.team");
  const isAdmin = hasRole(ctx.role, "ADMIN");

  const [members, templates, pendingInvites] = await Promise.all([
    listMembers(ctx.organizationId),
    isAdmin ? accessTemplateOptions(ctx.organizationId) : Promise.resolve([]),
    isAdmin ? listPendingInvitations(ctx.organizationId) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8">
      {isAdmin ? (
        <section className="glass rounded-xl border border-border p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold">{t("inviteTitle")}</h2>
          <InviteForm />
        </section>
      ) : null}

      {isAdmin ? <PendingInvitations invitations={pendingInvites} /> : null}

      {isAdmin ? (
        <MembersAdmin
          members={members}
          templates={templates}
          currentUserId={ctx.userId}
          currentRole={ctx.role}
        />
      ) : (
        <section className="glass overflow-x-auto rounded-xl border border-border shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("colName")}</th>
                <th className="px-5 py-3 font-medium">{t("colEmail")}</th>
                <th className="px-5 py-3 font-medium">{t("colRole")}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.membershipId} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium">{m.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{m.email}</td>
                  <td className="px-5 py-3">{t(`role.${m.role}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { listMembers } from "@/lib/queries/organizations";
import { accessTemplateOptions } from "@/lib/queries/access-templates";
import { InviteForm } from "@/components/app/invite-form";
import { MembersAdmin } from "@/components/app/members-admin";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
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

  const [members, templates] = await Promise.all([
    listMembers(ctx.organizationId),
    isAdmin ? accessTemplateOptions(ctx.organizationId) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        {isAdmin ? (
          <Link href="/app/settings/access" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ShieldCheck className="size-4" />
            {t("manageTemplates")}
          </Link>
        ) : null}
      </div>

      {isAdmin ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">{t("inviteTitle")}</h2>
          <InviteForm />
        </section>
      ) : null}

      {isAdmin ? (
        <MembersAdmin
          members={members}
          templates={templates}
          currentUserId={ctx.userId}
          currentRole={ctx.role}
        />
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
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

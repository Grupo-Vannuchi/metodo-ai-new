import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { listAuditLogs } from "@/lib/queries/audit";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  if (!hasRole(ctx.role, "ADMIN")) redirect({ href: "/app/settings", locale });

  const t = await getTranslations("audit");
  const logs = await listAuditLogs(ctx.organizationId);
  const df = new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/app/settings"
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      {logs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("when")}</th>
                <th className="px-5 py-3 font-medium">{t("who")}</th>
                <th className="px-5 py-3 font-medium">{t("action")}</th>
                <th className="px-5 py-3 font-medium">{t("entity")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 text-muted-foreground">{df.format(l.createdAt)}</td>
                  <td className="px-5 py-3">{l.userName}</td>
                  <td className="px-5 py-3 font-mono text-xs">{l.action}</td>
                  <td className="px-5 py-3 text-muted-foreground">{l.entity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { listAuditLogs } from "@/lib/queries/audit";
import { toAuditAction, toAuditEntity } from "@/config/audit";
import { AuditTable } from "@/components/app/audit-table";
import { redirect } from "@/i18n/navigation";
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

  const rows = logs.map((l) => {
    // Historical rows may carry a code we no longer know — fall back to showing
    // it raw (in mono) instead of a broken label.
    const action = toAuditAction(l.action);
    const entity = toAuditEntity(l.entity);
    return {
      id: l.id,
      when: df.format(l.createdAt),
      who: l.userName,
      action: action ? t(`actions.${action}`) : null,
      actionRaw: l.action,
      entity: entity ? t(`entities.${entity}`) : l.entity,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <AuditTable
          rows={rows}
          labels={{ when: t("when"), who: t("who"), action: t("action"), entity: t("entity") }}
        />
      )}
    </div>
  );
}

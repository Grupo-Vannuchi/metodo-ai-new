import { getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { SettingsNav } from "@/components/app/settings-nav";
import { resolveLocale } from "@/i18n/routing";

/** Shared shell for all Settings screens: a glass header with the section tabs.
 * The active tab identifies the section, so subpages render content only. */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("settings");

  return (
    <div className="flex flex-col gap-6">
      <div className="glass relative overflow-hidden rounded-2xl border border-border p-5 shadow-sm sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(110% 110% at 100% 0%, color-mix(in srgb, var(--brand) 14%, transparent), transparent 55%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Settings className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <div className="relative mt-4">
          <SettingsNav canAdmin={hasRole(ctx.role, "ADMIN")} />
        </div>
      </div>
      {children}
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "sends", href: "/app/email" },
  { key: "signatures", href: "/app/email/signatures" },
] as const;

/** Envios | Assinaturas navigation of the E-mail screen (spec 2026-10-13 §4.1). */
export async function EmailTabs({ active }: { active: "sends" | "signatures" }) {
  const t = await getTranslations("emailBroadcast.tabs");
  return (
    <nav aria-label={t("label")} className="flex gap-1 border-b border-border">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            active === tab.key
              ? "border-brand text-brand"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}

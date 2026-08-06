"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Href = React.ComponentProps<typeof Link>["href"];

// Section roots that render the workspace nav. Anything deeper (forms, detail)
// is a focused drill-in screen that shows its own heading instead.
const SECTION_ROOTS = new Set([
  "/app/supplies",
  "/app/supplies/items",
  "/app/supplies/purchases",
  "/app/supplies/stock",
  "/app/supplies/assets",
  "/app/supplies/maintenance",
  "/app/supplies/client-equipment",
  "/app/supplies/suppliers",
  "/app/supplies/registries",
]);

const ASSET_PATHS = ["/app/supplies/assets", "/app/supplies/maintenance", "/app/supplies/client-equipment"];

/** Single-workspace tab bar for the Supplies module (mirrors FinanceNav). */
export function SuppliesNav() {
  const t = useTranslations("supplies");
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!SECTION_ROOTS.has(pathname)) return null;

  const inAssets = ASSET_PATHS.some((p) => pathname.startsWith(p));
  const inRegistries =
    pathname.startsWith("/app/supplies/suppliers") || pathname.startsWith("/app/supplies/registries");

  const top: { key: string; href: Href; label: string; active: boolean }[] = [
    { key: "overview", href: "/app/supplies", label: t("tabs.overview"), active: pathname === "/app/supplies" },
    { key: "items", href: "/app/supplies/items", label: t("nav.items"), active: pathname.startsWith("/app/supplies/items") },
    { key: "purchases", href: "/app/supplies/purchases", label: t("nav.purchases"), active: pathname.startsWith("/app/supplies/purchases") },
    { key: "stock", href: "/app/supplies/stock", label: t("nav.stock"), active: pathname.startsWith("/app/supplies/stock") },
    { key: "assets", href: "/app/supplies/assets", label: t("nav.assets"), active: inAssets },
    { key: "registries", href: "/app/supplies/suppliers", label: t("nav.registries"), active: inRegistries },
  ];

  const regTab = searchParams.get("tab") ?? "category";
  const onReg = pathname.startsWith("/app/supplies/registries");

  let subs: { href: Href; label: string; active: boolean }[] = [];
  if (inAssets) {
    subs = [
      { href: "/app/supplies/assets", label: t("tabs.assets"), active: pathname.startsWith("/app/supplies/assets") },
      { href: "/app/supplies/maintenance", label: t("nav.maintenance"), active: pathname.startsWith("/app/supplies/maintenance") },
      { href: "/app/supplies/client-equipment", label: t("nav.clientEquipment"), active: pathname.startsWith("/app/supplies/client-equipment") },
    ];
  } else if (inRegistries) {
    subs = [
      { href: "/app/supplies/suppliers", label: t("nav.suppliers"), active: pathname.startsWith("/app/supplies/suppliers") },
      { href: { pathname: "/app/supplies/registries", query: { tab: "category" } }, label: t("registries.tab.category"), active: onReg && regTab === "category" },
      { href: { pathname: "/app/supplies/registries", query: { tab: "unit" } }, label: t("registries.tab.unit"), active: onReg && regTab === "unit" },
      { href: { pathname: "/app/supplies/registries", query: { tab: "warehouse" } }, label: t("registries.tab.warehouse"), active: onReg && regTab === "warehouse" },
    ];
  }

  return (
    <div>
      <nav className="flex gap-1 overflow-x-auto border-b border-border">
        {top.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
              tab.active
                ? "border-brand font-medium text-brand"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {subs.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {subs.map((s, i) => (
            <Link
              key={i}
              href={s.href}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                s.active ? "bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {s.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

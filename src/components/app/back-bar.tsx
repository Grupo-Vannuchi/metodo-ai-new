"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Top-level app screens reachable from the nav — no back button on these. Any
 * other /app/* route is a screen you "entered into", so it gets a Back control.
 */
const TOP_LEVEL = new Set([
  "/app",
  "/app/contacts",
  "/app/companies",
  "/app/crm",
  "/app/campaigns",
  "/app/prospecting",
  "/app/connections",
  "/app/inbox",
  "/app/settings",
]);

/**
 * A back control shown automatically on inner screens (detail/new/edit/nested
 * settings). Goes to the previous screen via history, falling back to the
 * parent route when there is no history (e.g. opened via a direct link).
 */
export function BackBar() {
  const t = useTranslations("app.nav");
  const pathname = usePathname();
  const router = useRouter();

  if (!pathname.startsWith("/app") || TOP_LEVEL.has(pathname)) return null;

  const parent = pathname.split("/").slice(0, -1).join("/") || "/app";

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(parent);
      }}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t("back")}
    </button>
  );
}

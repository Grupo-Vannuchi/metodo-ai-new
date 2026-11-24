"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";

/** Funnel picker for the dashboard's funnel chart. Writes `?funnel=` (keeping the period) so the server
 * component re-reads on navigation. */
export function DashboardFunnelSelect({
  value,
  pipelines,
}: {
  value: string;
  pipelines: { id: string; name: string }[];
}) {
  const t = useTranslations("app.dashboard");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function set(id: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("funnel", id);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      aria-label={t("funnelPick")}
      value={value}
      onChange={(e) => set(e.target.value)}
      className="h-8 max-w-48 truncate rounded-lg border border-input bg-background px-2 text-xs"
    >
      {pipelines.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

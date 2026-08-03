"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const PERIODS = ["30D", "MONTH", "YEAR", "ALL"] as const;

/** Period toggle for the dashboard's sales widgets. Writes `?period=` so the
 * server component re-reads on navigation. */
export function DashboardPeriod({ value }: { value: string }) {
  const t = useTranslations("app.dashboard");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function set(p: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("period", p);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-1">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => set(p)}
          className={cn(
            "rounded-lg px-2.5 py-1 text-xs transition-colors",
            value === p ? "bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {t(`period.${p}`)}
        </button>
      ))}
    </div>
  );
}

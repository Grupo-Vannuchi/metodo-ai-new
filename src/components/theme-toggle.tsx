"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Light/dark switch. Toggles the `.dark` class on <html> and persists the choice
 * in localStorage; the no-flash script in <head> applies it on next load. The
 * icon reflects the current theme purely via the `.dark` CSS variant — no React
 * state, so there's no hydration mismatch.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignore storage failures */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("toggle")}
      title={t("toggle")}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Moon className="size-4 dark:hidden" />
      <Sun className="hidden size-4 dark:block" />
    </button>
  );
}

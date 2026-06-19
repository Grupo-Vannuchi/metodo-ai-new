"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Opens the command palette (the CommandPalette listens for `cmdk:open`). */
export function SearchTrigger({ variant = "box", className }: { variant?: "box" | "icon"; className?: string }) {
  const t = useTranslations("search");
  const open = () => window.dispatchEvent(new Event("cmdk:open"));

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={open}
        aria-label={t("placeholder")}
        className={cn("rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
      >
        <Search className="size-5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted",
        className,
      )}
    >
      <Search className="size-4 shrink-0" />
      <span className="flex-1 text-left">{t("placeholder")}</span>
      <kbd className="rounded border border-border px-1.5 text-[10px] font-medium">⌘K</kbd>
    </button>
  );
}

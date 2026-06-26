"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/layout/logo";
import { AppNav } from "@/components/app/app-nav";

/** Hamburger + slide-in drawer with the app navigation, for small screens. */
export function MobileNav({ allowedScreens }: { allowedScreens: string[] }) {
  const t = useTranslations("app.nav");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("menu")}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        <Menu className="size-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 animate-fade-in"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="sidebar-brand absolute left-0 top-0 flex h-full w-64 flex-col gap-4 border-r border-border bg-card p-4 shadow-xl">
            <div className="flex items-center justify-between px-1">
              <Logo onDark />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("close")}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            {/* Tapping any link navigates and closes the drawer. */}
            <div onClick={() => setOpen(false)}>
              <AppNav allowedScreens={allowedScreens} />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

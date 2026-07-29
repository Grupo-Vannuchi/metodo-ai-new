"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppNav } from "@/components/app/app-nav";
import { NotificationBell } from "@/components/app/notification-bell";
import { SearchTrigger } from "@/components/app/search-trigger";
import { cn } from "@/lib/utils";

/**
 * The desktop sidebar. Collapsible to an icon rail — the main content is
 * `flex-1`, so it reclaims the space automatically. The collapsed state is
 * mirrored into a cookie so the server renders the right width on the next load
 * (no width flash on navigation).
 */
export function Sidebar({
  orgName,
  plan,
  userName,
  userEmail,
  navScreens,
  logoutAction,
  initialCollapsed,
}: {
  orgName: string;
  plan: string;
  userName: string;
  userEmail: string;
  navScreens: string[];
  logoutAction: (formData: FormData) => void | Promise<void>;
  initialCollapsed: boolean;
}) {
  const t = useTranslations("app.nav");
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `sidebar_collapsed=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      className={cn(
        "sidebar-brand relative z-30 hidden shrink-0 flex-col border-r border-border bg-card p-4 transition-[width] duration-200 md:flex",
        collapsed ? "w-[4.75rem] items-center px-2" : "w-64",
      )}
    >
      {/* Header: logo (expanded) + collapse toggle. */}
      <div className={cn("flex w-full items-center gap-2 py-2", collapsed ? "justify-center" : "justify-between px-1")}>
        {collapsed ? null : <Logo onDark className="text-xl" />}
        <div className="flex items-center gap-1">
          {collapsed ? null : <NotificationBell align="left" />}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
            title={collapsed ? t("expandSidebar") : t("collapseSidebar")}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>
      </div>

      {/* Bell gets its own row when collapsed (no header space for it). */}
      {collapsed ? (
        <div className="mt-1 flex w-full justify-center">
          {/* Anchor the dropdown to open toward the right — otherwise it opens
              left off the narrow rail and gets clipped. */}
          <NotificationBell align="left" />
        </div>
      ) : (
        <div className="mt-4 w-full rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="truncate text-sm font-medium">{orgName}</p>
          <p className="text-xs text-muted-foreground">{plan}</p>
        </div>
      )}

      <div className={cn("w-full", collapsed ? "mt-2 flex justify-center" : "mt-4")}>
        <SearchTrigger variant={collapsed ? "icon" : "box"} />
      </div>

      {/* When collapsed, hide the scrollbar so it doesn't steal width on the
          right and push the icon rail off-center. */}
      <div
        className={cn(
          "mt-4 min-h-0 w-full flex-1 overflow-y-auto",
          collapsed && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        <AppNav allowedScreens={navScreens} collapsed={collapsed} />
      </div>

      <div className="flex w-full flex-col gap-2 border-t border-border pt-3">
        {collapsed ? (
          <div className="flex w-full justify-center">
            <ThemeToggle />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-3 py-1">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
            </div>
            <ThemeToggle className="shrink-0" />
          </div>
        )}
        <form action={logoutAction}>
          <button
            type="submit"
            aria-label={t("signOut")}
            title={collapsed ? t("signOut") : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              collapsed ? "justify-center px-0" : "px-3",
            )}
          >
            <LogOut className="size-4 shrink-0" />
            {collapsed ? null : t("signOut")}
          </button>
        </form>
      </div>
    </aside>
  );
}

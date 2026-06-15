import { createNavigation } from "next-intl/navigation";
import { routing } from "@/i18n/routing";

/**
 * Locale-aware navigation primitives. Always import `Link`, `redirect`,
 * `usePathname`, `useRouter` and `getPathname` from here rather than `next/*`
 * so the active locale prefix is preserved automatically.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

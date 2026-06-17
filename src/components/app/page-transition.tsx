"use client";

import { usePathname } from "next/navigation";

/**
 * Subtle screen-enter animation. Keyed by pathname so it remounts (and replays
 * the fade-in) on every in-app navigation. Honors prefers-reduced-motion via
 * the global CSS reset.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-fade-in-up">
      {children}
    </div>
  );
}

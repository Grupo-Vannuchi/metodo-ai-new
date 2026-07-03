"use client";

import type { ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * A table row (`<tr>`) that opens `href` on double-click. Double-clicks landing
 * on an interactive element inside the row (buttons/links/inputs) are ignored,
 * so row actions keep working.
 */
export function OpenRow({
  href,
  title,
  className,
  children,
}: {
  href: string;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      title={title}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, input, [role='button']")) return;
        router.push(href);
      }}
      className={cn("cursor-pointer select-none", className)}
    >
      {children}
    </tr>
  );
}

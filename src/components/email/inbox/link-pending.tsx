"use client";

import { useLinkStatus } from "next/link";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Spinner for the inside of a `Link` (ours renders `next/link`): visible only while that link's
 * navigation is pending. The box is always rendered so nothing shifts, and it fades in after
 * 150 ms so fast navigations don't flash. Decorative — any text here would join the link's name.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 opacity-0",
        pending && "opacity-100 transition-opacity delay-150 duration-200",
        className,
      )}
    >
      {pending && <Spinner className="size-full" />}
    </span>
  );
}

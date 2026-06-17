import { cn } from "@/lib/utils";

/** Rotating ring spinner. Size/colour via `className` (defaults to size-5). */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={cn(
        "inline-block size-5 animate-spin rounded-full border-2 border-current/25 border-t-current",
        className,
      )}
    />
  );
}

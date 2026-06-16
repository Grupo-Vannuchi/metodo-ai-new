import Image from "next/image";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/config/site";

/**
 * The MÉTODO wordmark. Two assets ship — dark text for light backgrounds, white
 * text for dark — swapped by the `.dark` class so the logo always reads. Height
 * is controlled via `className` (defaults to h-7).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className="inline-flex items-center">
      <Image
        src="/logo.png"
        alt={siteConfig.name}
        width={2052}
        height={722}
        priority
        className={cn("h-7 w-auto dark:hidden", className)}
      />
      <Image
        src="/logo-white.png"
        alt={siteConfig.name}
        width={1473}
        height={493}
        priority
        className={cn("hidden h-7 w-auto dark:block", className)}
      />
    </span>
  );
}

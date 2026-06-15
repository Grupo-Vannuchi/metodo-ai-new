import { cn } from "@/lib/utils";
import { siteConfig } from "@/config/site";

/**
 * The wordmark. The only place the brand name is rendered as a logo — swap the
 * text for an <Image> here to use a logo file.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold tracking-tight", className)}>
      {siteConfig.name}
    </span>
  );
}

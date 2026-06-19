import { cn } from "@/lib/utils";

/**
 * Decorative full-bleed background: a corporate stock photo (self-hosted,
 * Unsplash License) heavily blurred and washed with a theme-tinted overlay so
 * it stays subtle and keeps text readable in light/dark mode. Fixed behind the
 * page content (`-z-10`).
 */
export function BackgroundImage({
  src = "/backgrounds/office-1.jpg",
  className,
}: {
  src?: string;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative, self-hosted background */}
      <img src={src} alt="" className="size-full scale-110 object-cover blur-2xl" />
      <div className="absolute inset-0 bg-background/75" />
    </div>
  );
}

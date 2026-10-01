"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";

/** Round avatar: shows the image when present, otherwise the name's initials
 * (or a group icon when `group` is set and there's no image). An image that
 * fails to load (e.g. an expired WhatsApp CDN link) falls back to the same
 * placeholder and calls `onError`, so the owner can fetch a fresh URL.
 * Size is controlled via `className` (e.g. "size-10"). */
export function Avatar({
  name,
  src,
  group = false,
  className,
  onError,
}: {
  name: string;
  src?: string | null;
  group?: boolean;
  className?: string;
  onError?: () => void;
}) {
  // The src that failed to load. A different src (e.g. a refreshed URL) gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const base = cn(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-sm font-medium text-brand",
    className,
  );

  if (src && src !== failedSrc) {
    const fail = () => {
      setFailedSrc(src);
      onError?.();
    };
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL; next/image would need per-host config
      <img
        src={src}
        alt={name}
        className={cn(base, "object-cover")}
        onError={fail}
        // A server-rendered <img> can fail before hydration, while React isn't
        // listening yet; that error event is lost, so also check on mount.
        ref={(img) => {
          if (img?.complete && img.naturalWidth === 0) fail();
        }}
      />
    );
  }
  return (
    <span className={base} aria-hidden>
      {group ? <Users className="size-[55%]" /> : initials}
    </span>
  );
}

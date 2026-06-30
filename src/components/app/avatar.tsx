import { Users } from "lucide-react";
import { cn } from "@/lib/utils";

/** Round avatar: shows the image when present, otherwise the name's initials
 * (or a group icon when `group` is set and there's no image).
 * Size is controlled via `className` (e.g. "size-10"). */
export function Avatar({
  name,
  src,
  group = false,
  className,
}: {
  name: string;
  src?: string | null;
  group?: boolean;
  className?: string;
}) {
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

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL; next/image would need per-host config
    return <img src={src} alt={name} className={cn(base, "object-cover")} />;
  }
  return (
    <span className={base} aria-hidden>
      {group ? <Users className="size-[55%]" /> : initials}
    </span>
  );
}

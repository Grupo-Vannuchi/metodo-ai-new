"use client";

import { useEffect, useState } from "react";
import { Briefcase, MapPin, CheckSquare, KanbanSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/app/avatar";

const IMAGES = [
  "/backgrounds/office-1.jpg",
  "/backgrounds/office-2.jpg",
  "/backgrounds/office-3.jpg",
  "/backgrounds/office-4.jpg",
  "/backgrounds/office-5.jpg",
  "/backgrounds/office-6.jpg",
];
const INTERVAL_MS = 6000;

/** Inviting feed header: corporate stock photos cross-fading in a blurred,
 * brand-tinted banner, with the wall title + the signed-in user's card. The
 * personal greeting lives on the dashboard, so it isn't repeated here. */
export function FeedHero({
  title,
  subtitle,
  name,
  avatarUrl,
  position,
  location,
  taskStat,
  oppStat,
}: {
  title: string;
  subtitle: string;
  name: string;
  avatarUrl: string | null;
  position: string | null;
  location: string | null;
  /** Null when the Tarefas module isn't installed. */
  taskStat: string | null;
  /** Null when the CRM module isn't installed. */
  oppStat: string | null;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % IMAGES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border shadow-sm">
      <div aria-hidden className="absolute inset-0">
        {IMAGES.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- decorative, self-hosted background
          <img
            key={src}
            src={src}
            alt=""
            className={cn(
              "bg-crossfade absolute inset-0 size-full scale-110 object-cover blur-[2px]",
              i === index ? "opacity-100" : "opacity-0",
            )}
          />
        ))}
        {/* Dark scrim (theme-independent) — matches the dashboard hero, keeps the
            photo visible and the text white in both light and dark. */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/60 to-slate-950/30" />
      </div>

      <div className="relative flex items-center justify-between gap-4 p-6 text-white">
        <div className="min-w-0">
          <p className="text-xl font-bold tracking-tight sm:text-2xl">{title}</p>
          <p className="mt-1 max-w-md text-sm text-white/75">{subtitle}</p>
          {taskStat || oppStat ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {taskStat ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm">
                  <CheckSquare className="size-3.5" />
                  {taskStat}
                </span>
              ) : null}
              {oppStat ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm">
                  <KanbanSquare className="size-3.5" />
                  {oppStat}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="hidden shrink-0 flex-col items-center gap-1.5 rounded-xl bg-white/10 p-3 text-center backdrop-blur-sm sm:flex">
          <Avatar name={name} src={avatarUrl} className="size-16 border-2 border-white/40 text-lg" />
          <div className="min-w-0 max-w-36">
            <p className="truncate text-sm font-semibold">{name}</p>
            {position ? (
              <p className="flex items-center justify-center gap-1 truncate text-xs text-white/75">
                <Briefcase className="size-3 shrink-0" />
                <span className="truncate">{position}</span>
              </p>
            ) : null}
            {location ? (
              <p className="flex items-center justify-center gap-1 truncate text-xs text-white/75">
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{location}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

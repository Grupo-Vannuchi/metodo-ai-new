"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Internal audio player for WhatsApp voice notes / audio. `preload="none"` so
 * the bytes are only fetched when the user hits play — opening a conversation
 * never downloads audio. Custom controls keep it on-brand inside the bubble.
 */
export function AudioPlayer({
  src,
  durationSec,
  out,
}: {
  src: string;
  durationSec?: number | null;
  out: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationSec ?? 0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setDuration(el.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, []);

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrent(el.currentTime);
  }

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const remaining = duration > 0 ? duration - current : durationSec ?? 0;

  return (
    <div className="flex w-56 max-w-full items-center gap-2.5 py-0.5">
      <audio ref={ref} src={src} preload="none" />
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-90",
          out ? "bg-brand-foreground/20 text-brand-foreground" : "bg-brand text-brand-foreground",
        )}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          onClick={seek}
          className={cn(
            "h-1.5 cursor-pointer rounded-full",
            out ? "bg-brand-foreground/25" : "bg-muted",
          )}
        >
          <div
            className={cn("h-full rounded-full", out ? "bg-brand-foreground" : "bg-brand")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className={cn(
            "text-[10px] tabular-nums",
            out ? "text-brand-foreground/70" : "text-muted-foreground",
          )}
        >
          {fmt(playing || current > 0 ? current : remaining)}
        </span>
      </div>
    </div>
  );
}

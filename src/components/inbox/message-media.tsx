"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Download, Loader2, ImageOff, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "@/components/inbox/audio-player";

export type MessageMediaData = {
  type: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  mediaStatus?: string | null;
  mediaName?: string | null;
  mediaDurationSec?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
};

/** Media types that render as visual content (drive bubble chrome decisions). */
export const MEDIA_TYPES = new Set(["IMAGE", "AUDIO", "VIDEO", "DOCUMENT", "STICKER"]);

function aspectStyle(w: number | null | undefined, h: number | null | undefined, max: number): React.CSSProperties {
  if (!w || !h) return { width: max * 0.7, height: max * 0.7 };
  const scale = Math.min(max / w, max / h, 1);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export function MessageMedia({ m, out }: { m: MessageMediaData; out: boolean }) {
  const t = useTranslations("inbox");
  const [zoom, setZoom] = useState(false);

  // Not yet stored: show a sized placeholder (PENDING) or a failure note.
  if (!m.mediaUrl) {
    if (m.mediaStatus === "FAILED") {
      return (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <ImageOff className="size-4" /> {t("mediaFailed")}
        </div>
      );
    }
    if (m.type === "AUDIO") {
      return (
        <div className="flex w-56 max-w-full items-center gap-2.5 py-1 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-xs">{t("mediaLoading")}</span>
        </div>
      );
    }
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-muted/60"
        style={aspectStyle(m.mediaWidth, m.mediaHeight, 260)}
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (m.type === "AUDIO") {
    return <AudioPlayer src={m.mediaUrl} durationSec={m.mediaDurationSec} out={out} />;
  }

  if (m.type === "STICKER") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={m.mediaUrl} alt="sticker" loading="lazy" className="size-32 object-contain" />;
  }

  if (m.type === "VIDEO") {
    return (
      <video
        src={m.mediaUrl}
        controls
        preload="metadata"
        className="max-h-80 max-w-[260px] rounded-lg"
        style={aspectStyle(m.mediaWidth, m.mediaHeight, 260)}
      />
    );
  }

  if (m.type === "DOCUMENT") {
    return (
      <a
        href={m.mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        download={m.mediaName ?? undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-1 py-1 text-sm hover:underline",
          out ? "text-brand-foreground" : "text-foreground",
        )}
      >
        <FileText className="size-7 shrink-0 opacity-80" />
        <span className="min-w-0 flex-1 truncate">{m.mediaName ?? t("mediaDocument")}</span>
        <Download className="size-4 shrink-0 opacity-70" />
      </a>
    );
  }

  // IMAGE — lazy thumbnail that opens a lightbox.
  return (
    <>
      <button type="button" onClick={() => setZoom(true)} className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={m.mediaUrl}
          alt={m.mediaName ?? "image"}
          loading="lazy"
          className="cursor-zoom-in rounded-lg object-cover"
          style={aspectStyle(m.mediaWidth, m.mediaHeight, 260)}
        />
      </button>
      {zoom && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
              onClick={() => setZoom(false)}
            >
              <button
                type="button"
                className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.mediaUrl}
                alt={m.mediaName ?? "image"}
                className="max-h-full max-w-full rounded-lg object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

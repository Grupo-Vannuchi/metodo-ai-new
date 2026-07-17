"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Trash2, ZoomIn } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Avatar } from "@/components/app/avatar";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { removeAvatar } from "@/app/actions/profile";

const VIEW = 288; // crop viewport, in css px (drag maps 1:1 to these units)
const OUT = 512; // exported square size, in px
const MAX_UPLOAD = 8 * 1024 * 1024; // pre-crop file cap

/**
 * Self-contained profile-photo widget: shows the current avatar and, on pick,
 * opens a circular crop modal (pan + zoom on a canvas) that uploads a square
 * WebP to `/api/profile/avatar`. Replaces the old paste-a-link field entirely.
 */
export function AvatarUploader({ name, initialUrl }: { name: string; initialUrl: string | null }) {
  const t = useTranslations("profile");
  const router = useRouter();
  const confirm = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);

  const [url, setUrl] = useState<string | null>(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Crop-modal state.
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offset = useRef({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const draw = useCallback(
    (canvas: HTMLCanvasElement, size: number, image: HTMLImageElement, z: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const nW = image.naturalWidth;
      const nH = image.naturalHeight;
      const baseScale = size / Math.min(nW, nH); // "cover" the square
      const dispW = nW * baseScale * z;
      const dispH = nH * baseScale * z;
      const k = size / VIEW;
      const dx = (size - dispW) / 2 + offset.current.x * k;
      const dy = (size - dispH) / 2 + offset.current.y * k;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(image, dx, dy, dispW, dispH);
    },
    [],
  );

  const clampOffset = useCallback((image: HTMLImageElement, z: number) => {
    const baseScale = VIEW / Math.min(image.naturalWidth, image.naturalHeight);
    const dispW = image.naturalWidth * baseScale * z;
    const dispH = image.naturalHeight * baseScale * z;
    const maxX = Math.max(0, (dispW - VIEW) / 2);
    const maxY = Math.max(0, (dispH - VIEW) / 2);
    offset.current.x = Math.min(maxX, Math.max(-maxX, offset.current.x));
    offset.current.y = Math.min(maxY, Math.max(-maxY, offset.current.y));
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas && img) {
      clampOffset(img, zoom);
      draw(canvas, VIEW, img, zoom);
    }
  }, [img, zoom, draw, clampOffset]);

  useEffect(() => {
    render();
  }, [render]);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (file.size > MAX_UPLOAD) return setError(t("photo.errorSize"));
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return setError(t("photo.errorType"));

    const image = new Image();
    image.onload = () => {
      offset.current = { x: 0, y: 0 };
      setZoom(1);
      setImg(image);
    };
    image.onerror = () => setError(t("photo.errorType"));
    image.src = URL.createObjectURL(file);
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current || !img) return;
    offset.current.x += e.clientX - drag.current.x;
    offset.current.y += e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    render();
  }
  function onPointerUp() {
    drag.current = null;
  }

  function closeCrop() {
    if (img) URL.revokeObjectURL(img.src);
    setImg(null);
  }

  async function save() {
    if (!img) return;
    setBusy(true);
    setError(null);
    try {
      const out = document.createElement("canvas");
      out.width = OUT;
      out.height = OUT;
      draw(out, OUT, img, zoom);
      const blob: Blob | null = await new Promise((resolve) =>
        out.toBlob((b) => resolve(b), "image/webp", 0.9),
      );
      if (!blob) throw new Error("toBlob failed");

      const fd = new FormData();
      fd.append("file", blob, "avatar.webp");
      const res = await fetch("/api/profile/avatar", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (!res.ok || !data?.ok || !data.url) {
        setError(t(`photo.error${data?.error === "size" ? "Size" : data?.error === "type" ? "Type" : "Unknown"}`));
        return;
      }
      setUrl(data.url);
      closeCrop();
      router.refresh();
    } catch (err) {
      console.error("avatar upload failed", err);
      setError(t("photo.errorUnknown"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      description: t("photo.removeConfirm"),
      confirmLabel: t("photo.remove"),
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    const r = await removeAvatar();
    setBusy(false);
    if (r.ok) {
      setUrl(null);
      router.refresh();
    } else {
      setError(t("photo.errorUnknown"));
    }
  }

  return (
    <div className="flex items-center gap-5">
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        aria-label={t("photo.change")}
        className="group relative rounded-full outline-none"
      >
        <Avatar name={name} src={url} className="size-24 text-2xl ring-2 ring-white/60 dark:ring-white/10" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover:opacity-100">
          <Camera className="size-6" />
        </span>
      </button>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Camera className="size-4" />
            {url ? t("photo.change") : t("photo.add")}
          </Button>
          {url ? (
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
              <Trash2 className="size-4" />
              {t("photo.remove")}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("photo.hint")}</p>
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={pickFile}
      />

      {img ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("photo.cancel")}
            onClick={() => (busy ? null : closeCrop())}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm motion-safe:animate-overlay-in"
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/15 bg-card/95 p-6 shadow-2xl backdrop-blur-xl motion-safe:animate-dialog-in">
            <h2 className="text-base font-semibold">{t("photo.cropTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("photo.cropHint")}</p>

            <div className="mx-auto mt-4 select-none" style={{ width: VIEW, maxWidth: "100%" }}>
              <div className="relative overflow-hidden rounded-xl bg-black/80" style={{ width: VIEW, height: VIEW }}>
                <canvas
                  ref={canvasRef}
                  width={VIEW}
                  height={VIEW}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  className="cursor-grab touch-none active:cursor-grabbing"
                  style={{ width: VIEW, height: VIEW }}
                />
                {/* Circular crop guide (darkens outside, ring inside). */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/80"
                  style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)" }}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <ZoomIn className="size-4 shrink-0 text-muted-foreground" />
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-[var(--brand)]"
                aria-label={t("photo.zoom")}
              />
            </div>

            {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={closeCrop} disabled={busy}>
                {t("photo.cancel")}
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={busy}>
                {busy ? t("photo.saving") : t("photo.save")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Download, Loader2, Link2, Youtube, Instagram, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { resolveDownload } from "@/app/actions/downloader";
import type { MediaInfo, MediaSource } from "@/lib/downloader";

const SOURCE_META: Record<MediaSource, { icon: typeof Youtube; className: string }> = {
  youtube: { icon: Youtube, className: "bg-red-500/10 text-red-600" },
  instagram: { icon: Instagram, className: "bg-pink-500/10 text-pink-600" },
  twitter: { icon: Link2, className: "bg-sky-500/10 text-sky-600" },
};

function slug(s: string): string {
  return s.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50) || "video";
}

export function DownloaderClient() {
  const t = useTranslations("downloader");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MediaInfo | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const link = url.trim();
    if (!link || pending) return;
    setPending(true);
    setError(null);
    setResult(null);
    const r = await resolveDownload(link);
    setPending(false);
    if (r.ok) setResult(r.data);
    else setError(t(`error.${r.error}`));
  }

  const proxyHref = (fileUrl: string, name: string) =>
    `/api/downloader/fetch?u=${encodeURIComponent(fileUrl)}&name=${encodeURIComponent(name)}`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-rose-600 text-white">
            <Download className="size-5" />
          </span>
          {t("title")}
        </h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <form onSubmit={onSubmit} className="glass flex flex-col gap-3 rounded-2xl border border-border p-5 shadow-sm">
        <label htmlFor="dl-url" className="text-sm font-medium">{t("linkLabel")}</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="dl-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("placeholder")}
              className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm focus-visible:border-brand focus-visible:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pending || !url.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            {pending ? t("fetching") : t("fetch")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("supported")}</p>
      </form>

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-600">{error}</p>
      ) : null}

      {result ? (
        <div className="glass overflow-hidden rounded-2xl border border-border shadow-sm">
          <div className="flex gap-4 p-4">
            {result.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote thumbnail, arbitrary host
              <img
                src={result.thumbnail}
                alt=""
                className="h-24 w-40 shrink-0 rounded-lg border border-border object-cover"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  SOURCE_META[result.source].className,
                )}
              >
                {(() => {
                  const Icon = SOURCE_META[result.source].icon;
                  return <Icon className="size-3" />;
                })()}
                {t(`source.${result.source}`)}
              </span>
              <p className="mt-1.5 line-clamp-2 font-semibold">{result.title}</p>
              {result.author ? <p className="text-sm text-muted-foreground">{t("by", { author: result.author })}</p> : null}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("downloads")}</p>
            <div className="flex flex-wrap gap-2">
              {result.formats.map((f, i) => (
                <a
                  key={`${f.label}-${i}`}
                  href={proxyHref(f.url, `${slug(result.title)}-${f.label}.${f.ext}`)}
                  download
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:border-brand/50 hover:text-brand"
                >
                  <Download className="size-4" />
                  {f.label}
                  <span className="text-xs uppercase text-muted-foreground">{f.ext}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
    </div>
  );
}

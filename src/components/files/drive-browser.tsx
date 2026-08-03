"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Folder,
  FileText,
  Image as ImageIcon,
  ExternalLink,
  Search,
  ChevronRight,
  Loader2,
  RefreshCw,
  HardDrive,
} from "lucide-react";
import { cn } from "@/lib/utils";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  modifiedTime: string | null;
  size: number | null;
  isFolder: boolean;
};
type Crumb = { id: string; name: string };

function humanSize(bytes: number | null): string {
  if (!bytes) return "";
  const u = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function DriveBrowser({ label }: { label: string }) {
  const t = useTranslations("files");
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [reconnect, setReconnect] = useState(false);

  const currentFolder = crumbs.length ? crumbs[crumbs.length - 1].id : "root";

  const load = useCallback(async (folderId: string, q: string) => {
    setLoading(true);
    setReconnect(false);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      else params.set("folderId", folderId);
      const res = await fetch(`/api/integrations/google-drive/files?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (data?.needsReconnect) {
        setReconnect(true);
        setFiles([]);
        return;
      }
      setFiles(Array.isArray(data?.files) ? data.files : []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — inline (no synchronous setState in the effect); the spinner
  // shows because `loading` starts true. Navigation uses `load` from handlers.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/integrations/google-drive/files?folderId=root", {
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (!active) return;
        if (data?.needsReconnect) {
          setReconnect(true);
          setFiles([]);
        } else {
          setFiles(Array.isArray(data?.files) ? data.files : []);
        }
      } catch {
        if (active) setFiles([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function openFolder(f: DriveFile) {
    const next = [...crumbs, { id: f.id, name: f.name }];
    setCrumbs(next);
    setSearch("");
    void load(f.id, "");
  }

  function goCrumb(index: number) {
    const next = index < 0 ? [] : crumbs.slice(0, index + 1);
    setCrumbs(next);
    setSearch("");
    void load(next.length ? next[next.length - 1].id : "root", "");
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    void load(currentFolder, search);
  }

  const iconFor = (f: DriveFile) =>
    f.isFolder ? Folder : f.mimeType.startsWith("image/") ? ImageIcon : FileText;

  return (
    <div className="glass flex flex-col rounded-2xl border border-border shadow-sm">
      {/* Toolbar: breadcrumb + search */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => goCrumb(-1)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted",
              crumbs.length === 0 ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            <HardDrive className="size-4" />
            {t("root")}
          </button>
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <button
                type="button"
                onClick={() => goCrumb(i)}
                className={cn(
                  "max-w-40 truncate rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted",
                  i === crumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <form onSubmit={submitSearch} className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-48 rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand"
            />
          </form>
          <button
            type="button"
            onClick={() => load(currentFolder, search)}
            aria-label={t("refresh")}
            title={t("refresh")}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-[16rem] p-2">
        {reconnect ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <p className="text-sm text-muted-foreground">{t("reconnect")}</p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/integrations/google-drive/connect"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90"
            >
              {t("reconnectCta")}
            </a>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : files.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">
            {search.trim() ? t("noResults") : t("empty")}
          </p>
        ) : (
          <ul className="flex flex-col">
            {files.map((f) => {
              const Icon = iconFor(f);
              const body = (
                <>
                  <Icon className={cn("size-5 shrink-0", f.isFolder ? "text-brand" : "text-muted-foreground")} />
                  <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                  {f.size ? (
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{humanSize(f.size)}</span>
                  ) : null}
                  {!f.isFolder ? <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                </>
              );
              return (
                <li key={f.id}>
                  {f.isFolder ? (
                    <button
                      type="button"
                      onClick={() => openFolder(f)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
                    >
                      {body}
                    </button>
                  ) : (
                    <a
                      href={f.webViewLink ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t("open")}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted"
                    >
                      {body}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

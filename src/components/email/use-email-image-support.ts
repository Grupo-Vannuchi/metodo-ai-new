"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import type { EditorImageSupport } from "@/components/proposals/rich-text-editor";
import { safeClickHref, safeImageSrc } from "@/lib/email-broadcast/image-links";

/**
 * Image support for the E-mail editors (body and signatures): upload goes to
 * /api/email/image (same gates as the E-mail screen); pasted links are
 * validated client-side and again by the server sanitizer.
 */
export function useEmailImageSupport(): EditorImageSupport {
  const t = useTranslations("emailBroadcast");
  const toast = useToast();
  return useMemo<EditorImageSupport>(
    () => ({
      upload: async (file) => {
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch("/api/email/image", { method: "POST", body: form });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
          if (res.ok && data.ok && data.url) return data.url;
          const key = data.error === "size" ? "image.tooLarge" : data.error === "type" ? "image.badType" : "image.uploadError";
          toast(t(key), { variant: "error" });
        } catch (error) {
          console.error("[email-image] upload failed", error);
          toast(t("image.uploadError"), { variant: "error" });
        }
        return null;
      },
      validateSrc: safeImageSrc,
      validateHref: safeClickHref,
      labels: {
        button: t("image.button"),
        title: t("image.title"),
        upload: t("image.upload"),
        uploading: t("image.uploading"),
        uploaded: t("image.uploaded"),
        orLink: t("image.orLink"),
        linkPlaceholder: t("image.linkPlaceholder"),
        href: t("image.href"),
        hrefPlaceholder: t("image.hrefPlaceholder"),
        alt: t("image.alt"),
        altPlaceholder: t("image.altPlaceholder"),
        insert: t("image.insert"),
        cancel: t("image.cancel"),
        invalidSrc: t("image.invalidSrc"),
        invalidHref: t("image.invalidHref"),
      },
    }),
    [t, toast],
  );
}

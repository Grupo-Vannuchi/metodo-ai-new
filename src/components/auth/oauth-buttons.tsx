import { getTranslations } from "next-intl/server";
import { configuredProviders } from "@/lib/oauth/providers";
import { OAUTH_LABELS } from "@/lib/oauth/shared";
import { ProviderMark } from "@/components/auth/provider-mark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Sign-in buttons for every provider that has credentials configured — a Server
 * Component, so unconfigured providers never even reach the page. Laid out in a
 * single row, icon-only: the brand marks carry the meaning, and the label moves
 * to `aria-label`/`title` so it stays announced to screen readers and on hover.
 *
 * Each is a plain anchor to the (non-localized) API route that starts the OAuth
 * flow: next-intl's Link would locale-prefix it, and a client-side Link can't
 * drive the server redirect.
 */
export async function OAuthButtons() {
  const t = await getTranslations("auth");
  const providers = configuredProviders();
  if (providers.length === 0) return null;

  return (
    <div className="flex items-center gap-3">
      {providers.map((provider) => {
        const label = t("continueWith", { provider: OAUTH_LABELS[provider] });
        return (
          <a
            key={provider}
            href={`/api/auth/${provider}`}
            aria-label={label}
            title={label}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "flex-1 px-0")}
          >
            <ProviderMark provider={provider} className="size-5" />
          </a>
        );
      })}
    </div>
  );
}

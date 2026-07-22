import { getTranslations } from "next-intl/server";
import { configuredProviders } from "@/lib/oauth/providers";
import { OAUTH_LABELS } from "@/lib/oauth/shared";
import { ProviderMark } from "@/components/auth/provider-mark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Entrar com …" for every provider that has credentials configured — a Server
 * Component, so unconfigured providers never even reach the page. Each is a
 * plain anchor to the (non-localized) API route that starts the OAuth flow:
 * next-intl's Link would locale-prefix it, and a client-side Link can't drive
 * the server redirect.
 */
export async function OAuthButtons() {
  const t = await getTranslations("auth");
  const providers = configuredProviders();
  if (providers.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {providers.map((provider) => (
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a
          key={provider}
          href={`/api/auth/${provider}`}
          className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full gap-3")}
        >
          <ProviderMark provider={provider} />
          {t("continueWith", { provider: OAUTH_LABELS[provider] })}
        </a>
      ))}
    </div>
  );
}

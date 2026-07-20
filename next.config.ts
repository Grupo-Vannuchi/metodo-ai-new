import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Origins allowed to reach the dev server's /_next/* assets and to invoke Server
 * Actions. Needed when the app is reached through a tunnel/proxy (ngrok,
 * cloudflared) instead of localhost — otherwise Next blocks those requests and
 * the client never hydrates (dead theme toggle, full-reload "white flash"
 * navigations) and Server Actions are rejected (e.g. saving connections).
 */
const tunnelHosts: string[] = [];
try {
  const u = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  if (u.hostname && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
    tunnelHosts.push(u.hostname);
  }
} catch {
  /* NEXT_PUBLIC_SITE_URL not a URL — ignore */
}

const allowedOrigins = [
  ...tunnelHosts,
  "*.ngrok-free.dev",
  "*.ngrok-free.app",
  "*.ngrok.app",
  "*.ngrok.io",
  "*.trycloudflare.com",
];

const nextConfig: NextConfig = {
  allowedDevOrigins: allowedOrigins,
  experimental: {
    serverActions: { allowedOrigins },
  },
  images: {
    // Remote image sources. Add a tenant's CDN / avatar host here as needed.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  /**
   * Cache policy — fixes the "broken landing on some devices after a deploy".
   *
   * Next already serves the hashed build assets under `/_next/*` immutably, so we
   * leave those alone. Everything else (HTML documents, RSC payloads, public
   * files) is served with `no-cache`, so the browser / LiteSpeed proxy MUST
   * revalidate before reuse — this way a stale HTML page can never keep pointing
   * at a CSS/font chunk that a newer build already removed (which is what left
   * the page unstyled: generic font, loose images, broken layout). `no-cache`
   * still allows cheap 304s for unchanged files, so repeat visits aren't slower.
   */
  async headers() {
    return [
      {
        // Everything except Next's own (already immutably-cached) build assets.
        source: "/((?!_next/).*)",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);

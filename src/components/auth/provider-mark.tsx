import type { OAuthProvider } from "@/lib/oauth/shared";

/**
 * Official brand marks for the sign-in providers. Pure SVG with no hooks, so it
 * renders from both Server and Client Components.
 */

function GoogleG({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function MicrosoftSquares({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className={className}>
      <path fill="#F25022" d="M0 0h8.5v8.5H0z" />
      <path fill="#7FBA00" d="M9.5 0H18v8.5H9.5z" />
      <path fill="#00A4EF" d="M0 9.5h8.5V18H0z" />
      <path fill="#FFB900" d="M9.5 9.5H18V18H9.5z" />
    </svg>
  );
}

function LinkedInIn({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#0A66C2"
        d="M22.22 0H1.78C.8 0 0 .78 0 1.73v20.54C0 23.22.8 24 1.78 24h20.44c.98 0 1.78-.78 1.78-1.73V1.73C24 .78 23.2 0 22.22 0ZM7.12 20.45H3.56V9h3.56v11.45ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13Zm15.11 13.02h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.44-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29Z"
      />
    </svg>
  );
}

const MARKS: Record<OAuthProvider, (p: { className?: string }) => React.ReactElement> = {
  google: GoogleG,
  microsoft: MicrosoftSquares,
  linkedin: LinkedInIn,
};

export function ProviderMark({
  provider,
  className,
}: {
  provider: OAuthProvider;
  className?: string;
}) {
  const Mark = MARKS[provider];
  return <Mark className={className} />;
}

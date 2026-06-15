import { ChevronsUpDown, Check } from "lucide-react";
import { switchOrganization } from "@/app/actions/organizations";
import type { UserOrganization } from "@/lib/queries/organizations";
import type { Locale } from "@/i18n/routing";

/**
 * Active-organization picker. Server component: each option is a tiny form that
 * posts to `switchOrganization` (which re-issues the session) — no client JS.
 */
export function OrgSwitcher({
  organizations,
  currentOrganizationId,
  locale,
}: {
  organizations: UserOrganization[];
  currentOrganizationId: string;
  locale: Locale;
}) {
  const current =
    organizations.find((o) => o.id === currentOrganizationId) ?? organizations[0];

  if (organizations.length <= 1) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
        <p className="truncate text-sm font-medium">{current?.name}</p>
        <p className="text-xs text-muted-foreground">{current?.plan}</p>
      </div>
    );
  }

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{current?.name}</span>
          <span className="block text-xs text-muted-foreground">{current?.plan}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </summary>
      <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-md">
        {organizations.map((org) => (
          <form key={org.id} action={switchOrganization}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="organizationId" value={org.id} />
            <button
              type="submit"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="block truncate">{org.name}</span>
                <span className="block text-xs text-muted-foreground">{org.role}</span>
              </span>
              {org.id === currentOrganizationId ? (
                <Check className="size-4 shrink-0 text-brand" />
              ) : null}
            </button>
          </form>
        ))}
      </div>
    </details>
  );
}

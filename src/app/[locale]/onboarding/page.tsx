import { setRequestLocale } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { OnboardingWizard } from "@/components/modules/onboarding-wizard";

export const dynamic = "force-dynamic";

/** "Monte seu Método" — first-run module picker for a new org's owner. Lives
 *  outside /app so the app layout's onboarding redirect can't loop. */
export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requireOrgContext(locale);
  // Already set up, or not the owner → straight into the app.
  if (ctx.onboarded || ctx.role !== "OWNER") redirect({ href: "/app", locale });
  return <OnboardingWizard orgName={ctx.organization.name} />;
}

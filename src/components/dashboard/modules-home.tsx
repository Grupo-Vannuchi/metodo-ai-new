import { getTranslations } from "next-intl/server";
import {
  Target,
  Wallet,
  Users,
  Package,
  Megaphone,
  MessageCircle,
  Sparkles,
  CheckSquare,
  Boxes,
  Store,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { MODULES } from "@/config/modules";

const ICONS: Record<string, LucideIcon> = {
  Target,
  Wallet,
  Users,
  Package,
  Megaphone,
  MessageCircle,
  Sparkles,
  CheckSquare,
};

/** Dashboard shown when the org hasn't installed the CRM module — the default
 *  sales dashboard doesn't apply. Surfaces the installed modules as quick links
 *  and points to the Loja to add more (or install the first one when "cru"). */
export async function ModulesHome({ installed, userName }: { installed: string[]; userName: string }) {
  const t = await getTranslations("app.dashboard");
  const mods = MODULES.filter((m) => installed.includes(m.id));

  return (
    <div className="flex flex-col gap-8">
      {/* Welcome banner (same language as the sales dashboard). */}
      <div className="relative overflow-hidden rounded-2xl border border-border p-6 shadow-sm sm:p-8">
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative, self-hosted */}
        <img
          aria-hidden
          alt=""
          src="/backgrounds/office-2.jpg"
          className="pointer-events-none absolute inset-0 size-full scale-110 object-cover blur-[2px]"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/60 to-slate-950/25" />
        <div className="relative">
          <h1 className="text-2xl font-bold tracking-tight text-white">{t("title")}</h1>
          <p className="mt-1 text-white/75">{t("welcome", { name: userName })}</p>
        </div>
      </div>

      {mods.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">{t("myModules")}</h2>
            <Link href="/app/loja" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              {t("addModules")}
              <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mods.map((m) => {
              const Icon = ICONS[m.icon] ?? Boxes;
              const href = m.screens[0] ? `/app/${m.screens[0]}` : "/app/loja";
              return (
                <Link
                  key={m.id}
                  href={href}
                  className="hover-lift glass flex items-start gap-3 rounded-xl border border-border p-5 shadow-sm hover:border-brand/40"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{m.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{m.tagline}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <Store className="size-6" />
          </span>
          <p className="max-w-md text-muted-foreground">{t("installFirst")}</p>
          <Link href="/app/loja" className={buttonVariants({ size: "lg" })}>
            {t("goToStore")}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

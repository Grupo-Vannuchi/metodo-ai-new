import { getTranslations } from "next-intl/server";
import { Truck } from "lucide-react";
import { Link } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

/** Supplies module home. Cards link to each section as it's built. */
export default async function SuppliesPage() {
  const t = await getTranslations("supplies");

  const cards = [
    { href: "/app/supplies/suppliers", icon: Truck, label: t("nav.suppliers"), desc: t("suppliers.subtitle") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="stagger-children grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="hover-lift glass group flex items-start gap-3 rounded-xl border border-border p-5 shadow-sm hover:border-brand/40"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <c.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{c.label}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{c.desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

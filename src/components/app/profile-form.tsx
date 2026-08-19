"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { User, MapPin, Shield, ShieldCheck, ShieldAlert, Mail } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { ProfileCoreFields } from "@/components/auth/profile-core-fields";
import { AvatarUploader } from "@/components/app/profile/avatar-uploader";
import { ChangePasswordCard } from "@/components/app/profile/change-password-card";
import { ChangeEmailCard } from "@/components/app/profile/change-email-card";
import { ConnectedAccountsCard } from "@/components/app/profile/connected-accounts-card";
import { updateProfile } from "@/app/actions/profile";
import type { ProfileView } from "@/lib/queries/profile";
import type { AccountSecurity } from "@/lib/queries/profile";

type Tab = "personal" | "address" | "security";

/**
 * The signed-in user's profile, organized into tabs (Pessoal · Endereço ·
 * Segurança). Personal + Address share one form (a single save writes both);
 * Security hosts its own self-contained cards (photo lives in the header).
 */
export function ProfileClient({ profile, security }: { profile: ProfileView; security: AccountSecurity }) {
  const t = useTranslations("profile");
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("personal");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(profile.name);

  const birthDefault = profile.birthDate ? new Date(profile.birthDate).toISOString().slice(0, 10) : "";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await updateProfile(fd);
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(t(`error.${r.error}`));
      }
    });
  }

  const tabs: { key: Tab; label: string; icon: typeof User }[] = [
    { key: "personal", label: t("tabs.personal"), icon: User },
    { key: "address", label: t("tabs.address"), icon: MapPin },
    { key: "security", label: t("tabs.security"), icon: Shield },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header card — avatar + identity, on a soft brand-glass surface. */}
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card/60 p-6 backdrop-blur-md">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 55%)",
          }}
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <AvatarUploader name={name} initialUrl={profile.avatarUrl} />
          <div className="min-w-0 sm:border-l sm:border-border sm:pl-5">
            <p className="truncate text-lg font-semibold">{name || t("name")}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Mail className="size-3.5" />
              <span className="truncate">{profile.email}</span>
            </p>
            <span
              className={cn(
                "mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                security.emailVerified
                  ? "bg-green-500/10 text-green-600"
                  : "bg-amber-500/10 text-amber-600",
              )}
            >
              {security.emailVerified ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
              {security.emailVerified ? t("verified") : t("unverified")}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all",
              tab === key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Personal + Address share one form; kept mounted so a save writes both. */}
      <form onSubmit={onSubmit} className={cn("flex flex-col gap-5", tab === "security" && "hidden")}>
        <div className={cn("flex flex-col gap-5", tab !== "personal" && "hidden")}>
          <div>
            <Label htmlFor="name">{t("name")}</Label>
            <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <ProfileCoreFields
            defaults={{
              phone: profile.phone ?? "",
              documentType: profile.documentType ?? "CPF",
              document: profile.document ?? "",
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="position">{t("position")}</Label>
              <Input id="position" name="position" defaultValue={profile.position ?? ""} />
            </div>
            <div>
              <Label htmlFor="birthDate">{t("birthDate")}</Label>
              <Input id="birthDate" name="birthDate" type="date" defaultValue={birthDefault} />
            </div>
          </div>
        </div>

        <div className={cn(tab !== "address" && "hidden")}>
          <fieldset className="flex flex-col gap-4 rounded-2xl border border-border bg-card/40 p-4 backdrop-blur-sm">
            <legend className="px-1 text-sm font-medium">{t("address")}</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="addressZip">{t("addressZip")}</Label>
                <Input id="addressZip" name="addressZip" defaultValue={profile.addressZip ?? ""} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="addressStreet">{t("addressStreet")}</Label>
                <Input id="addressStreet" name="addressStreet" defaultValue={profile.addressStreet ?? ""} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="addressNumber">{t("addressNumber")}</Label>
                <Input id="addressNumber" name="addressNumber" defaultValue={profile.addressNumber ?? ""} />
              </div>
              <div>
                <Label htmlFor="addressCity">{t("addressCity")}</Label>
                <Input id="addressCity" name="addressCity" defaultValue={profile.addressCity ?? ""} />
              </div>
              <div>
                <Label htmlFor="addressState">{t("addressState")}</Label>
                <Input
                  id="addressState"
                  name="addressState"
                  maxLength={2}
                  defaultValue={profile.addressState ?? ""}
                  className="uppercase"
                />
              </div>
            </div>
          </fieldset>
        </div>

        {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
        {saved ? <p className="text-sm text-green-600">{t("saved")}</p> : null}

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>

      {/* Security: photo lives in the header; here go e-mail, password + accounts. */}
      <div className={cn("grid items-start gap-5 lg:grid-cols-2", tab !== "security" && "hidden")}>
        <ChangeEmailCard
          currentEmail={profile.email}
          hasPassword={security.hasPassword}
          pendingEmail={security.pendingEmail}
        />
        <ChangePasswordCard hasPassword={security.hasPassword} />
        <ConnectedAccountsCard
          email={profile.email}
          emailVerified={security.emailVerified}
          hasPassword={security.hasPassword}
          accounts={security.accounts}
          providers={security.providers}
        />
      </div>
    </div>
  );
}

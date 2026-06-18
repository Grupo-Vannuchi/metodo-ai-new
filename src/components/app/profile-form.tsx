"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Avatar } from "@/components/app/avatar";
import { ProfileCoreFields } from "@/components/auth/profile-core-fields";
import { updateProfile } from "@/app/actions/profile";
import type { ProfileView } from "@/lib/queries/profile";

export function ProfileForm({ profile }: { profile: ProfileView }) {
  const t = useTranslations("profile");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatarUrl ?? "");

  const birthDefault = profile.birthDate
    ? new Date(profile.birthDate).toISOString().slice(0, 10)
    : "";

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

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <Avatar name={name} src={avatar || null} className="size-16 text-lg" />
        <div className="flex-1">
          <Label htmlFor="avatarUrl">{t("avatarUrl")}</Label>
          <Input
            id="avatarUrl"
            name="avatarUrl"
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("avatarHint")}</p>
        </div>
      </div>

      <div>
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          id="name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
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

      <fieldset className="flex flex-col gap-4 rounded-xl border border-border p-4">
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

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
      {saved ? <p className="text-sm text-green-600">{t("saved")}</p> : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}

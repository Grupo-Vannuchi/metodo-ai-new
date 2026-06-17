"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { removeMember, changeMemberRole } from "@/app/actions/organizations";
import { setMemberTemplate } from "@/app/actions/access";

type Member = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  accessTemplateId: string | null;
};

type TemplateOpt = { id: string; name: string };

export function MembersAdmin({
  members,
  templates,
  currentUserId,
  currentRole,
}: {
  members: Member[];
  templates: TemplateOpt[];
  currentUserId: string;
  currentRole: "OWNER" | "ADMIN" | "MEMBER";
}) {
  const t = useTranslations("app.team");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(t(`error.${r.error ?? "unknown"}`));
      router.refresh();
    });
  }

  const selectCls = cn(
    "rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm",
    "focus-visible:border-brand focus-visible:outline-none disabled:opacity-50",
  );

  return (
    <div className="flex flex-col gap-3">
      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">{t("colName")}</th>
              <th className="px-5 py-3 font-medium">{t("colRole")}</th>
              <th className="px-5 py-3 font-medium">{t("colTemplate")}</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.userId === currentUserId;
              const isOwner = m.role === "OWNER";
              const editable = !isSelf && !isOwner;
              // Only an OWNER can change roles touching ADMIN.
              const canRole = editable && (currentRole === "OWNER" || m.role === "MEMBER");

              return (
                <tr key={m.membershipId} className="border-b border-border last:border-0">
                  <td className="px-5 py-3">
                    <p className="font-medium">{m.name}{isSelf ? ` (${t("you")})` : ""}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </td>
                  <td className="px-5 py-3">
                    {canRole ? (
                      <select
                        className={selectCls}
                        defaultValue={m.role}
                        disabled={pending}
                        onChange={(e) => run(() => changeMemberRole(m.membershipId, e.target.value))}
                      >
                        <option value="MEMBER">{t("role.MEMBER")}</option>
                        <option value="ADMIN">{t("role.ADMIN")}</option>
                      </select>
                    ) : (
                      <span className="text-muted-foreground">{t(`role.${m.role}`)}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {m.role === "MEMBER" ? (
                      <select
                        className={selectCls}
                        defaultValue={m.accessTemplateId ?? ""}
                        disabled={pending}
                        onChange={(e) =>
                          run(() => setMemberTemplate(m.membershipId, e.target.value || null))
                        }
                      >
                        <option value="">{t("fullAccess")}</option>
                        {templates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-muted-foreground">{t("fullAccess")}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {editable ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(t("confirmRemove", { name: m.name }))) {
                            run(() => removeMember(m.membershipId));
                          }
                        }}
                        aria-label={t("remove")}
                        className="inline-flex items-center rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

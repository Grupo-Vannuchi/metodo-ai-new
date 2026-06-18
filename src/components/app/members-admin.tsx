"use client";

import { useState, useTransition } from "react";
import { Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { Avatar } from "@/components/app/avatar";
import { formatBrPhone } from "@/lib/phone";
import { formatDocument } from "@/lib/document";
import { removeMember, changeMemberRole } from "@/app/actions/organizations";
import { setMemberTemplate } from "@/app/actions/access";

type MemberProfile = {
  phone: string | null;
  documentType: "CPF" | "CNPJ" | null;
  document: string | null;
  position: string | null;
  birthDate: Date | string | null;
  avatarUrl: string | null;
  addressZip: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressCity: string | null;
  addressState: string | null;
};

type Member = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  accessTemplateId: string | null;
  profile: MemberProfile | null;
};

type TemplateOpt = { id: string; name: string };

function ProfileDetail({ member }: { member: Member }) {
  const t = useTranslations("profile");
  const p = member.profile;
  const dash = "—";

  const phone = p?.phone ? formatBrPhone(p.phone) : dash;
  const doc =
    p?.documentType && p?.document
      ? `${p.documentType}: ${formatDocument(p.documentType, p.document)}`
      : dash;
  const birth = p?.birthDate ? new Date(p.birthDate).toLocaleDateString() : dash;
  const address =
    p && (p.addressStreet || p.addressCity)
      ? [
          [p.addressStreet, p.addressNumber].filter(Boolean).join(", "),
          [p.addressCity, p.addressState].filter(Boolean).join(" - "),
          p.addressZip,
        ]
          .filter(Boolean)
          .join(" · ")
      : dash;

  const fields: { label: string; value: string }[] = [
    { label: t("phone"), value: phone },
    { label: t("document"), value: doc },
    { label: t("position"), value: p?.position || dash },
    { label: t("birthDate"), value: birth },
    { label: t("address"), value: address },
  ];

  return (
    <div className="flex items-start gap-4 bg-muted/20 px-5 py-4">
      <Avatar name={member.name} src={p?.avatarUrl ?? null} className="size-12" />
      <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <div key={f.label} className="flex flex-col">
            <span className="text-xs text-muted-foreground">{f.label}</span>
            <span className="text-sm">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(t(`error.${r.error ?? "unknown"}`));
      router.refresh();
    });
  }

  function toggle(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
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
          {members.map((m) => {
              const isSelf = m.userId === currentUserId;
              const isOwner = m.role === "OWNER";
              const editable = !isSelf && !isOwner;
              const canRole = editable && (currentRole === "OWNER" || m.role === "MEMBER");
              const isOpen = expanded.has(m.membershipId);

              return (
                <tbody key={m.membershipId}>
                  <tr className="border-b border-border last:border-0">
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        onClick={() => toggle(m.membershipId)}
                        className="flex items-center gap-3 text-left"
                        aria-expanded={isOpen}
                        title={t("viewProfile")}
                      >
                        {isOpen ? (
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <Avatar name={m.name} src={m.profile?.avatarUrl ?? null} className="size-8" />
                        <span className="min-w-0">
                          <span className="block font-medium">
                            {m.name}{isSelf ? ` (${t("you")})` : ""}
                          </span>
                          <span className="block text-xs text-muted-foreground">{m.email}</span>
                        </span>
                      </button>
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
                          onClick={async () => {
                            if (
                              await confirm({
                                description: t("confirmRemove", { name: m.name }),
                                confirmLabel: t("remove"),
                                variant: "danger",
                              })
                            ) {
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
                  {isOpen ? (
                    <tr className="border-b border-border last:border-0">
                      <td colSpan={4} className="p-0">
                        <ProfileDetail member={m} />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
        </table>
      </div>
    </div>
  );
}

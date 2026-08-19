"use client";

import { useMemo, useState, useTransition } from "react";
import { Trash2, ChevronDown, ChevronRight, Search, Crown, ShieldCheck, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { Avatar } from "@/components/app/avatar";
import { Input } from "@/components/ui/field";
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

const ROLE_ICON = { OWNER: Crown, ADMIN: ShieldCheck, MEMBER: UserRound } as const;
const ROLE_STYLE = {
  OWNER: "bg-amber-500/10 text-amber-600",
  ADMIN: "bg-brand/10 text-brand",
  MEMBER: "bg-muted text-muted-foreground",
} as const;

function RoleBadge({ role, label }: { role: Member["role"]; label: string }) {
  const Icon = ROLE_ICON[role];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", ROLE_STYLE[role])}>
      <Icon className="size-3" />
      {label}
    </span>
  );
}

function ProfileDetail({ member }: { member: Member }) {
  const t = useTranslations("profile");
  const p = member.profile;
  const dash = "—";

  const phone = p?.phone ? formatBrPhone(p.phone) : dash;
  const doc =
    p?.documentType && p?.document ? `${p.documentType}: ${formatDocument(p.documentType, p.document)}` : dash;
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
    <div className="grid gap-3 rounded-lg bg-muted/30 p-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.label} className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</span>
          <span className="text-sm">{f.value}</span>
        </div>
      ))}
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
  const [query, setQuery] = useState("");
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [members, query]);

  const selectCls = cn(
    "rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm",
    "focus-visible:border-brand focus-visible:outline-none disabled:opacity-50",
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: search + count */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <p className="text-sm text-muted-foreground">{t("memberCount", { count: members.length })}</p>
      </div>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t("noResults")}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((m) => {
            const isSelf = m.userId === currentUserId;
            const isOwner = m.role === "OWNER";
            const editable = !isSelf && !isOwner;
            const canRole = editable && (currentRole === "OWNER" || m.role === "MEMBER");
            const isOpen = expanded.has(m.membershipId);

            return (
              <div key={m.membershipId} className="glass flex flex-col gap-3 rounded-xl border border-border p-4 shadow-sm">
                {/* Identity row */}
                <div className="flex items-start gap-3">
                  <Avatar name={m.name} src={m.profile?.avatarUrl ?? null} className="size-11" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{m.name}</span>
                      {isSelf ? <span className="text-xs text-muted-foreground">({t("you")})</span> : null}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{m.email}</p>
                  </div>
                  <RoleBadge role={m.role} label={t(`role.${m.role}`)} />
                </div>

                {/* Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  {canRole ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {t("colRole")}
                      <select
                        className={selectCls}
                        defaultValue={m.role}
                        disabled={pending}
                        onChange={(e) => run(() => changeMemberRole(m.membershipId, e.target.value))}
                      >
                        <option value="MEMBER">{t("role.MEMBER")}</option>
                        <option value="ADMIN">{t("role.ADMIN")}</option>
                      </select>
                    </label>
                  ) : null}
                  {m.role === "MEMBER" ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {t("colTemplate")}
                      <select
                        className={selectCls}
                        defaultValue={m.accessTemplateId ?? ""}
                        disabled={pending}
                        onChange={(e) => run(() => setMemberTemplate(m.membershipId, e.target.value || null))}
                      >
                        <option value="">{t("fullAccess")}</option>
                        {templates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("fullAccess")}</span>
                  )}
                </div>

                {/* Footer: expand + remove */}
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <button
                    type="button"
                    onClick={() => toggle(m.membershipId)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    {isOpen ? t("hideProfile") : t("viewProfile")}
                  </button>
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
                      title={t("remove")}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                      {t("remove")}
                    </button>
                  ) : null}
                </div>

                {isOpen ? <ProfileDetail member={m} /> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

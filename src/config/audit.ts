/**
 * ─────────────────────────────────────────────────────────────────────────
 *  AUDIT TRAIL — the actions and entities we record
 * ─────────────────────────────────────────────────────────────────────────
 * Single source of truth. `audit()` only accepts these keys, and each one has a
 * human label under `audit.actions.*` / `audit.entities.*` in the messages — so
 * a new action can't ship without a label (the typecheck fails first).
 *
 * The stored rows are historical: a log written before a key was renamed may no
 * longer be in these lists. The screen falls back to showing the raw code, which
 * is why the narrowing helpers below return null instead of throwing.
 */

export const AUDIT_ACTIONS = [
  "access_template.created",
  "access_template.updated",
  "access_template.deleted",
  "campaign.created",
  "campaign.updated",
  "campaign.started",
  "connection.created",
  "connection.updated",
  "connection.deleted",
  "extraction.started",
  "extraction.imported",
  "extraction.toFunnel",
  "finance.entry.created",
  "finance.entry.updated",
  "finance.entry.deleted",
  "finance.entry.settled",
  "finance.entry.reopened",
  "member.invited",
  "member.invite_revoked",
  "member.removed",
  "member.left",
  "member.role_changed",
  "member.template_set",
  "task.created",
  "task.updated",
  "task.deleted",
] as const;

export const AUDIT_ENTITIES = [
  "AccessTemplate",
  "Campaign",
  "ExtractionJob",
  "FinanceEntry",
  "IntegrationConnection",
  "Invitation",
  "Membership",
  "Task",
  "companies",
  "contacts",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** Narrow a stored action to a known key (null = legacy/unknown code). */
export function toAuditAction(value: string): AuditAction | null {
  return (AUDIT_ACTIONS as readonly string[]).includes(value) ? (value as AuditAction) : null;
}

/** Narrow a stored entity to a known key (null = legacy/unknown code). */
export function toAuditEntity(value: string): AuditEntity | null {
  return (AUDIT_ENTITIES as readonly string[]).includes(value) ? (value as AuditEntity) : null;
}

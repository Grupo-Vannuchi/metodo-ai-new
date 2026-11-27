/**
 * Role rules inside the HR screen. Reaching the screen (module + access
 * template) is `canUseScreen(ctx, "hr")`; these decide who may take the steps
 * that commit the company. The actions enforce them and the pages read the same
 * functions to show or hide the buttons, so the two can't drift.
 */

type Actor = { role: string; userId: string };

const isManager = (role: string) => role === "OWNER" || role === "ADMIN";

/**
 * Approve or reject a time-off request: OWNER/ADMIN only, and never on their
 * own request (the employee record linked to their login). The OWNER is the
 * exception: nobody sits above them to decide in their place.
 */
export function canDecideTimeOff(actor: Actor, row: { employeeUserId: string | null }): boolean {
  if (actor.role === "OWNER") return true;
  if (actor.role !== "ADMIN") return false;
  return row.employeeUserId !== actor.userId;
}

/** Whether this actor may link employee records to logins at all (the form shows the field). */
export function canLinkEmployeeLogins(actor: Actor): boolean {
  return isManager(actor.role);
}

/**
 * Link, unlink or swap the login of an employee record. The link decides whose
 * time off the person may not decide (`canDecideTimeOff`) and who is told of the
 * decision, so changing it is OWNER/ADMIN only, and nobody but the OWNER links
 * or unlinks their own login: otherwise an admin could unlink their own record,
 * file and approve their own time off, and link it back. Saving the record with
 * the link unchanged is always allowed.
 */
export function canChangeEmployeeLogin(
  actor: Actor,
  change: { from: string | null; to: string | null },
): boolean {
  if (change.from === change.to) return true;
  if (actor.role === "OWNER") return true;
  if (actor.role !== "ADMIN") return false;
  return change.from !== actor.userId && change.to !== actor.userId;
}

/** Delete a PENDING time-off request: whoever filed it, or OWNER/ADMIN. */
export function canDeleteTimeOff(actor: Actor, row: { requestedById: string | null }): boolean {
  return isManager(actor.role) || (row.requestedById !== null && row.requestedById === actor.userId);
}

/**
 * Approve, reopen or pay a payroll run, and delete an APPROVED one: OWNER/ADMIN
 * only. Paying posts one expense per employee into the finance ledger. Anyone
 * with the HR screen may still prepare a DRAFT (create, edit lines, delete it).
 */
export function canApprovePayroll(actor: Actor): boolean {
  return isManager(actor.role);
}

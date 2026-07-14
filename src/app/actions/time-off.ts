"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import {
  timeOffSchema,
  timeOffDecisionSchema,
  daysBetween,
  type TimeOffInput,
  type TimeOffDecisionInput,
} from "@/lib/validations/time-off";

export type TimeOffActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "locked" | "unknown" };

/** Notify the org's managers (they are the ones who decide requests). */
async function notifyManagers(
  organizationId: string,
  type: "HR_TIMEOFF_REQUEST",
  data: Record<string, string>,
  link: string,
  exceptUserId?: string,
) {
  const managers = await prisma.membership.findMany({
    where: { organizationId, role: { in: ["OWNER", "ADMIN"] } },
    select: { userId: true },
  });
  const targets = managers.map((m) => m.userId).filter((id) => id !== exceptUserId);
  if (targets.length === 0) return;
  await prisma.notification.createMany({
    data: targets.map((userId) => ({ organizationId, userId, type, data, link })),
  });
}

/** Create a time-off request (PENDING) and alert the managers. */
export async function requestTimeOff(input: TimeOffInput): Promise<TimeOffActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = timeOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);
    const employee = await db.employee.findFirst({
      where: { id: parsed.data.employeeId },
      select: { id: true, name: true },
    });
    if (!employee) return { ok: false, error: "invalid" };

    const startDate = new Date(parsed.data.startDate);
    const endDate = new Date(parsed.data.endDate);

    const row = await prisma.timeOff.create({
      data: {
        organizationId: org,
        employeeId: employee.id,
        type: parsed.data.type,
        status: "PENDING",
        startDate,
        endDate,
        days: daysBetween(startDate, endDate),
        reason: parsed.data.reason || null,
        requestedById: ctx.userId,
      },
      select: { id: true },
    });

    await notifyManagers(
      org,
      "HR_TIMEOFF_REQUEST",
      { actor: ctx.user.name, name: employee.name },
      "/app/hr/timeoff",
      ctx.userId,
    );

    revalidatePath("/app/hr/timeoff");
    revalidatePath("/app/hr");
    return { ok: true, id: row.id };
  } catch (error) {
    console.error("Failed to request time off", error);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Approve or reject a pending request. The employee's linked system user (if
 * any) is notified of the decision.
 */
export async function decideTimeOff(
  id: string,
  input: TimeOffDecisionInput,
): Promise<TimeOffActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = timeOffDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);
    const row = await db.timeOff.findFirst({
      where: { id },
      select: {
        id: true,
        status: true,
        requestedById: true,
        employee: { select: { name: true, userId: true } },
      },
    });
    if (!row) return { ok: false, error: "unknown" };
    if (row.status !== "PENDING") return { ok: false, error: "locked" };

    await db.timeOff.updateMany({
      where: { id },
      data: {
        status: parsed.data.status,
        decisionNote: parsed.data.decisionNote || null,
        decidedById: ctx.userId,
        decidedAt: new Date(),
      },
    });

    // Tell whoever is waiting on it: the employee's own login, else the requester.
    const target = row.employee.userId ?? row.requestedById;
    if (target && target !== ctx.userId) {
      await prisma.notification.create({
        data: {
          organizationId: org,
          userId: target,
          type: "HR_TIMEOFF_DECIDED",
          data: { actor: ctx.user.name, decision: parsed.data.status },
          link: "/app/hr/timeoff",
        },
      });
    }

    revalidatePath("/app/hr/timeoff");
    revalidatePath("/app/hr");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to decide time off", error);
    return { ok: false, error: "unknown" };
  }
}

/** Delete a request. Only a PENDING one can be removed. */
export async function deleteTimeOff(id: string): Promise<{ ok: boolean; error?: "locked" }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    const row = await db.timeOff.findFirst({ where: { id }, select: { status: true } });
    if (!row) return { ok: false };
    if (row.status !== "PENDING") return { ok: false, error: "locked" };

    await db.timeOff.deleteMany({ where: { id } });
    revalidatePath("/app/hr/timeoff");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete time off", error);
    return { ok: false };
  }
}

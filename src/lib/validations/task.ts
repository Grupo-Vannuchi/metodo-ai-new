import { z } from "zod";

const optionalId = z.string().trim().max(40).optional().or(z.literal(""));

export const taskTypeEnum = z.enum(["CALL", "MEETING", "EMAIL", "WHATSAPP", "FOLLOWUP", "OTHER"]);
export const taskPriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const taskStatusEnum = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
export const taskRecurrenceEnum = z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

const optionalDate = z.string().max(40).optional().or(z.literal("")); // datetime-local / date

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(200),
  // Free-form notes for the task (shown on the task view). Generous cap for
  // long annotations.
  description: z.string().trim().max(20000).optional().or(z.literal("")),
  type: taskTypeEnum.default("OTHER"),
  priority: taskPriorityEnum.default("MEDIUM"),
  status: taskStatusEnum.default("TODO"),
  recurrence: taskRecurrenceEnum.default("NONE"),
  progress: z.coerce.number().int().min(0).max(100).optional(),
  startDate: optionalDate,
  dueDate: optionalDate,
  reminderAt: optionalDate,
  assignedToId: optionalId,
  contactId: optionalId,
  companyId: optionalId,
  opportunityId: optionalId,
});

export type TaskInput = z.infer<typeof taskSchema>;

/** A checklist item's text (subtask). */
export const checklistTextSchema = z.string().trim().min(1, "Informe o item.").max(300);

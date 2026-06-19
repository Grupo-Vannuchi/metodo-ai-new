import { z } from "zod";

const optionalId = z.string().trim().max(40).optional().or(z.literal(""));

export const taskTypeEnum = z.enum(["CALL", "MEETING", "EMAIL", "WHATSAPP", "FOLLOWUP", "OTHER"]);
export const taskPriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  type: taskTypeEnum.default("OTHER"),
  priority: taskPriorityEnum.default("MEDIUM"),
  dueDate: z.string().max(40).optional().or(z.literal("")), // datetime-local / date
  assignedToId: optionalId,
  contactId: optionalId,
  companyId: optionalId,
  opportunityId: optionalId,
});

export type TaskInput = z.infer<typeof taskSchema>;

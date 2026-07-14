import { z } from "zod";

/** Validation for the HR employee record (and its org catalogs). */

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const optionalId = z.string().trim().max(40).optional().or(z.literal(""));
const optionalDate = z.string().trim().max(10).optional().or(z.literal("")); // yyyy-mm-dd

export const EMPLOYEE_STATUSES = ["ACTIVE", "ON_LEAVE", "TERMINATED"] as const;
export const CONTRACT_TYPES = ["CLT", "PJ", "INTERN", "TEMPORARY", "FREELANCER"] as const;

export type EmployeeStatusKey = (typeof EMPLOYEE_STATUSES)[number];
export type ContractTypeKey = (typeof CONTRACT_TYPES)[number];

/** Status filter for the employees list. Lives here (not in the server-only
 * queries module) so the client toolbar can import it. */
export type EmployeeStatusFilter = "ALL" | EmployeeStatusKey;
export const EMPLOYEE_STATUS_FILTERS: EmployeeStatusFilter[] = ["ALL", ...EMPLOYEE_STATUSES];

export const employeeSchema = z.object({
  // Personal
  name: z.string().trim().min(1, "Informe o nome.").max(200),
  email: optionalText(200),
  phone: optionalText(60),
  documentType: z.enum(["CPF", "CNPJ"]).optional().or(z.literal("")),
  document: optionalText(20),
  birthDate: optionalDate,
  /// Optional link to a system user (membership). Empty = no login.
  userId: optionalId,
  addressZip: optionalText(20),
  addressStreet: optionalText(200),
  addressNumber: optionalText(20),
  addressCity: optionalText(120),
  addressState: optionalText(2),

  // Contract
  jobRoleId: optionalId,
  departmentId: optionalId,
  contractType: z.enum(CONTRACT_TYPES).default("CLT"),
  status: z.enum(EMPLOYEE_STATUSES).default("ACTIVE"),
  hiredAt: z.string().trim().min(1, "Informe a data de admissão.").max(10),
  probationEndsAt: optionalDate,
  terminatedAt: optionalDate,
  terminationReason: optionalText(300),
  baseSalary: z.coerce.number().min(0).max(1_000_000_000).default(0),
  weeklyHours: z.coerce.number().int().min(0).max(80).optional().nullable(),

  // Payment
  bankName: optionalText(120),
  bankBranch: optionalText(20),
  bankAccount: optionalText(30),
  pixKey: optionalText(140),

  notes: optionalText(4000),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;

/** Department / job role catalogs — a name is all they carry. */
export const catalogSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120),
});
export type CatalogInput = z.infer<typeof catalogSchema>;

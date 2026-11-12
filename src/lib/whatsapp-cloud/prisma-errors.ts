import { Prisma } from "@prisma/client";

/** Violação de índice único (P2002) — reenvio do webhook ou corrida de criação. */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

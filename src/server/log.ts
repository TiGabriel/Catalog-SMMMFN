import "server-only";
import { Prisma } from "@/generated/prisma/client";

/**
 * Server logs must not contain personal data or secrets. Prisma errors can embed
 * the full query arguments (e.g. a password hash), so only their type/code is logged.
 */
export function safeErrorForLog(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return `PrismaKnownError ${err.code} ${JSON.stringify(err.meta?.modelName ?? "")}`;
  if (err instanceof Prisma.PrismaClientValidationError) return "PrismaValidationError";
  if (err instanceof Prisma.PrismaClientUnknownRequestError) return "PrismaUnknownRequestError";
  if (err instanceof Error) return `${err.name}: ${err.message.split("\n")[0]?.slice(0, 300)}\n${(err.stack ?? "").split("\n").slice(1, 6).join("\n")}`;
  return "Unknown error";
}

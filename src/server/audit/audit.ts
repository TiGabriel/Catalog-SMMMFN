import "server-only";
import type { AuditOutcome } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { db, type DbOrTx } from "@/server/db/client";
import type { Actor } from "@/server/authz/actor";
import type { RequestMeta } from "@/server/http/request-meta";

export const AuditAction = {
  LOGIN: "LOGIN",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGIN_BLOCKED: "LOGIN_BLOCKED",
  LOGOUT: "LOGOUT",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  PASSWORD_CHANGE: "PASSWORD_CHANGE",
  PASSWORD_CHANGE_FAILED: "PASSWORD_CHANGE_FAILED",
  PASSWORD_RESET: "PASSWORD_RESET",
  USER_CREATE: "USER_CREATE",
  USER_UPDATE: "USER_UPDATE",
  USER_STATUS_CHANGE: "USER_STATUS_CHANGE",
  ACADEMIC_YEAR_CREATE: "ACADEMIC_YEAR_CREATE",
  ACADEMIC_YEAR_UPDATE: "ACADEMIC_YEAR_UPDATE",
  CLASS_CREATE: "CLASS_CREATE",
  CLASS_UPDATE: "CLASS_UPDATE",
  SUBJECT_CREATE: "SUBJECT_CREATE",
  SUBJECT_UPDATE: "SUBJECT_UPDATE",
  MODULE_CREATE: "MODULE_CREATE",
  MODULE_UPDATE: "MODULE_UPDATE",
  STUDENT_CREATE: "STUDENT_CREATE",
  ENROLLMENT_CREATE: "ENROLLMENT_CREATE",
  ASSIGNMENT_CREATE: "ASSIGNMENT_CREATE",
  ASSIGNMENT_END: "ASSIGNMENT_END",
  HOMEROOM_CREATE: "HOMEROOM_CREATE",
  HOMEROOM_END: "HOMEROOM_END",
  GRADE_CREATE: "GRADE_CREATE",
  GRADE_UPDATE: "GRADE_UPDATE",
  GRADE_DELETE: "GRADE_DELETE",
  CORRECTION_REQUEST_CREATE: "CORRECTION_REQUEST_CREATE",
  CORRECTION_REQUEST_APPROVE: "CORRECTION_REQUEST_APPROVE",
  CORRECTION_REQUEST_REJECT: "CORRECTION_REQUEST_REJECT",
  CORRECTION_REQUEST_CANCEL: "CORRECTION_REQUEST_CANCEL",
  MODULE_SUBJECT_ADD: "MODULE_SUBJECT_ADD",
  MODULE_SUBJECT_UPDATE: "MODULE_SUBJECT_UPDATE",
  MODULE_SUBJECT_REMOVE: "MODULE_SUBJECT_REMOVE",
  MODULE_CLOSE: "MODULE_CLOSE",
  RULESET_CREATE: "RULESET_CREATE",
  RULESET_ACTIVATE: "RULESET_ACTIVATE",
  STUDENT_UPDATE: "STUDENT_UPDATE",
  GRADE_REASON_CREATE: "GRADE_REASON_CREATE",
  GRADE_REASON_UPDATE: "GRADE_REASON_UPDATE",
  CONFIG_UPDATE: "CONFIG_UPDATE",
  YEAR_ROLLOVER: "YEAR_ROLLOVER",
  TIMETABLE_IMPORT: "TIMETABLE_IMPORT",
  TIMETABLE_PUBLISH: "TIMETABLE_PUBLISH",
  TIMETABLE_ARCHIVE: "TIMETABLE_ARCHIVE",
  REPORT_EXPORT: "REPORT_EXPORT",
  ACCESS_DENIED: "ACCESS_DENIED",
  AUDIT_VIEW: "AUDIT_VIEW",
  AUDIT_VERIFY: "AUDIT_VERIFY",
  SYSTEM_SEED: "SYSTEM_SEED",
  ADMIN_BOOTSTRAP: "ADMIN_BOOTSTRAP",
} as const;
export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction];

export type AuditEntry = {
  action: AuditActionName;
  outcome?: AuditOutcome;
  entityType?: string;
  entityId?: string;
  studentId?: string;
  classSectionId?: string;
  subjectId?: string;
  academicYearId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
};

type AuditActor = Pick<Actor, "userId" | "role" | "firstName" | "lastName" | "rankLabel" | "sessionId">;

function json(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === undefined || v === null) return Prisma.DbNull;
  // Normalise Decimal/Date/BigInt into plain JSON.
  return JSON.parse(
    JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)),
  ) as Prisma.InputJsonValue;
}

/**
 * Appends an audit entry. Pass the transaction client so the entry commits
 * atomically with the change it describes. Hash/timestamp are set by the DB.
 */
export async function recordAudit(
  client: DbOrTx,
  actor: AuditActor | null,
  meta: RequestMeta | null,
  entry: AuditEntry,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: actor?.userId ?? null,
      actorSnapshot: actor
        ? json({ firstName: actor.firstName, lastName: actor.lastName, rank: actor.rankLabel, role: actor.role })
        : Prisma.DbNull,
      action: entry.action,
      outcome: entry.outcome ?? "SUCCESS",
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      studentId: entry.studentId ?? null,
      classSectionId: entry.classSectionId ?? null,
      subjectId: entry.subjectId ?? null,
      academicYearId: entry.academicYearId ?? null,
      before: json(entry.before),
      after: json(entry.after),
      reason: entry.reason ?? null,
      metadata: json(entry.metadata),
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
      sessionRef: actor?.sessionId ? actor.sessionId.slice(0, 16) : null,
      requestId: meta?.requestId ?? null,
    },
  });
}

/** Best-effort audit outside a business transaction (e.g. access denials); never throws. */
export async function recordAuditSafe(actor: AuditActor | null, meta: RequestMeta | null, entry: AuditEntry) {
  try {
    await recordAudit(db, actor, meta, entry);
  } catch (err) {
    console.error("[audit] failed to record entry", entry.action, meta?.requestId, err instanceof Error ? err.name : "error");
  }
}

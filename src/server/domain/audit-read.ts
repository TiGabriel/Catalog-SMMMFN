import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db/client";
import { assertPermission, hasPermission } from "@/server/authz/policy";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import type { Actor } from "@/server/authz/actor";
import type { auditQuerySchema } from "@/lib/validation/schemas";

/**
 * Audit trail access:
 * - ADMINISTRATOR (`audit.read.system`): complete system audit, incl. technical fields;
 * - COMANDANT UNITATE (`audit.read`): academic audit only (grades, correction requests,
 *   approvals/rejections, module closing, year transition), without IP/device/session data;
 * - everybody else: no access (403).
 * Every read is itself audited.
 */
export const ACADEMIC_AUDIT_ACTIONS = [
  AuditAction.GRADE_CREATE,
  AuditAction.GRADE_UPDATE,
  AuditAction.GRADE_DELETE,
  AuditAction.CORRECTION_REQUEST_CREATE,
  AuditAction.CORRECTION_REQUEST_APPROVE,
  AuditAction.CORRECTION_REQUEST_REJECT,
  AuditAction.CORRECTION_REQUEST_CANCEL,
  AuditAction.MODULE_CLOSE,
  AuditAction.YEAR_ROLLOVER,
] as string[];

export function allowedAuditActions(actor: Actor): string[] | "ALL" {
  return hasPermission(actor, "audit.read.system") ? "ALL" : ACADEMIC_AUDIT_ACTIONS;
}

export async function listAuditEntries(actor: Actor, query: z.infer<typeof auditQuerySchema>) {
  await assertPermission(actor, "audit.read");
  const allowed = allowedAuditActions(actor);
  const full = allowed === "ALL";
  const actionFilter: Prisma.StringFilter | string | undefined =
    query.action !== undefined ? (full || allowed.includes(query.action) ? query.action : "__NONE__") : full ? undefined : { in: allowed };
  const where: Prisma.AuditLogWhereInput = {
    action: actionFilter,
    actorId: query.actorId,
    studentId: query.studentId,
    classSectionId: query.classSectionId,
    subjectId: query.subjectId,
    academicYearId: query.academicYearId,
    occurredAt: { gte: query.from, lt: query.to ? new Date(query.to.getTime() + 86_400_000) : undefined },
  };
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);

  // Readable names for the referenced entities of this page.
  const ids = <K extends keyof (typeof rows)[number]>(k: K) => [...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])];
  const [students, classes, subjects] = await Promise.all([
    db.student.findMany({ where: { id: { in: ids("studentId") } }, select: { id: true, firstName: true, lastName: true } }),
    db.classSection.findMany({ where: { id: { in: ids("classSectionId") } }, select: { id: true, code: true, academicYear: { select: { name: true } } } }),
    db.subject.findMany({ where: { id: { in: ids("subjectId") } }, select: { id: true, name: true } }),
  ]);
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const sMap = byId(students);
  const cMap = byId(classes);
  const subjMap = byId(subjects);

  await recordAudit(db, actor, actor.meta, {
    action: AuditAction.AUDIT_VIEW,
    metadata: { scope: full ? "system" : "academic", filter: { ...query, from: query.from?.toISOString(), to: query.to?.toISOString() } },
  });
  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    scope: full ? "system" : "academic",
    entries: rows.map((r) => {
      const snap = r.actorSnapshot as { firstName?: string; lastName?: string; rank?: string | null; role?: string } | null;
      const st = r.studentId ? sMap.get(r.studentId) : undefined;
      const cl = r.classSectionId ? cMap.get(r.classSectionId) : undefined;
      return {
        id: r.id.toString(),
        occurredAt: r.occurredAt,
        action: r.action,
        outcome: r.outcome,
        actor: snap ? { name: [snap.rank, snap.lastName, snap.firstName].filter(Boolean).join(" "), ...(full ? { role: snap.role } : {}) } : null,
        actorId: r.actorId,
        entityType: r.entityType,
        entityId: r.entityId,
        student: st ? `${st.lastName} ${st.firstName}` : null,
        classSection: cl ? `${cl.code} (${cl.academicYear.name})` : null,
        subject: r.subjectId ? (subjMap.get(r.subjectId)?.name ?? null) : null,
        before: r.before,
        after: r.after,
        reason: r.reason,
        metadata: full ? r.metadata : null,
        // Technical data only for the administrator.
        ...(full ? { ip: r.ip, userAgent: r.userAgent, sessionRef: r.sessionRef, requestId: r.requestId, hash: r.hash } : {}),
      };
    }),
  };
}

export async function verifyAuditChain(actor: Actor) {
  await assertPermission(actor, "audit.read");
  const [row] = await db.$queryRaw<{ checked: bigint; first_invalid_id: bigint | null }[]>`
    SELECT checked, first_invalid_id FROM audit_log_verify_chain()`;
  await recordAudit(db, actor, actor.meta, { action: AuditAction.AUDIT_VERIFY });
  return {
    checked: Number(row?.checked ?? 0),
    intact: row?.first_invalid_id == null,
    firstInvalidId: row?.first_invalid_id?.toString() ?? null,
  };
}

/** People selectable in the audit "user" filter: all users (admin) or academic staff (commander). */
export async function listAuditActors(actor: Actor) {
  await assertPermission(actor, "audit.read");
  return db.user.findMany({
    where: hasPermission(actor, "audit.read.system") ? {} : { role: { in: ["PROFESOR", "COMANDANT_UNITATE"] } },
    select: { id: true, firstName: true, lastName: true, rank: { select: { label: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

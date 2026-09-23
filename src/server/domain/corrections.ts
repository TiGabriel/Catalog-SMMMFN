import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertClassSubjectReadable, assertPermission, denyWith, findGradeGrant, hasPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import { getSetting } from "@/server/domain/settings";
import { applyGradeChange, applyGradeDeletion, assertGradeValueAllowed } from "@/server/domain/grades";
import type { createCorrectionSchema, reviewCorrectionSchema } from "@/lib/validation/schemas";

/**
 * Special correction workflow:
 * 1. A PROFESOR who currently holds the grant for the grade's class/subject/kind
 *    (or the diriginte, for conduct) files a MODIFY/DELETE request with a justification.
 * 2. The COMANDANT UNITATE approves or rejects it. The commander cannot choose
 *    another value: approval applies exactly the teacher's proposal, atomically,
 *    through the same revision/audit path as a normal change.
 * 3. The administrator has no part in the workflow and no way to alter grades.
 * Every step (create, approve, reject, cancel, resulting change) is audited.
 */

const personSelect = { id: true, firstName: true, lastName: true, rank: { select: { label: true } } } as const;

const requestSelect = {
  id: true,
  type: true,
  status: true,
  proposedValue: true,
  justification: true,
  reviewComment: true,
  createdAt: true,
  reviewedAt: true,
  appliedAt: true,
  gradeId: true,
  proposedReason: { select: { id: true, label: true } },
  requestedBy: { select: personSelect },
  reviewedBy: { select: personSelect },
  student: { select: { id: true, firstName: true, lastName: true } },
  classSection: { select: { id: true, code: true } },
  subject: { select: { id: true, name: true } },
  module: { select: { id: true, name: true } },
  grade: { select: { id: true, value: true, kind: true, status: true, gradeDate: true, reason: { select: { label: true } } } },
} satisfies Prisma.GradeCorrectionRequestSelect;

function serialize<T extends { proposedValue: unknown; grade: { value: unknown } | null }>(r: T) {
  return {
    ...r,
    proposedValue: r.proposedValue === null ? null : Number(r.proposedValue),
    grade: r.grade ? { ...r.grade, value: Number(r.grade.value) } : null,
  };
}

export async function createCorrectionRequest(actor: Actor, input: z.infer<typeof createCorrectionSchema>) {
  await assertPermission(actor, "corrections.request");
  const grade = await db.grade.findUnique({ where: { id: input.gradeId }, include: { subject: { select: { type: true } } } });
  if (!grade) return denyWith(actor, "notFound", { resource: "Grade", id: input.gradeId });
  await assertClassSubjectReadable(actor, grade.classSectionId, grade.subjectId);
  const grant = await findGradeGrant(actor, {
    classSectionId: grade.classSectionId,
    subjectId: grade.subjectId,
    subjectType: grade.subject.type,
    kind: grade.kind,
    moduleId: grade.moduleId,
  });
  if (!grant) return denyWith(actor, "forbidden", { resource: "CorrectionRequest", gradeId: grade.id, reason: "NO_ACTIVE_ASSIGNMENT" });
  if (grade.status !== "ACTIVE") throw Errors.conflict("Nota a fost deja ștearsă.");

  if (input.type === "MODIFY") {
    assertGradeValueAllowed(input.proposedValue!, await getSetting("grades.allowDecimals"), "proposedValue");
    if (input.proposedReasonId) {
      const reason = await db.gradeReason.findUnique({ where: { id: input.proposedReasonId } });
      if (!reason || !reason.active || !reason.appliesTo.includes(grade.kind)) {
        throw Errors.validation({ proposedReasonId: ["Motiv invalid pentru acest tip de notă."] });
      }
    }
    if (input.proposedValue === Number(grade.value) && !input.proposedReasonId) {
      throw Errors.validation({ proposedValue: ["Nota propusă este identică cu cea existentă."] });
    }
  }
  const pending = await db.gradeCorrectionRequest.findFirst({ where: { gradeId: grade.id, status: "PENDING" }, select: { id: true } });
  if (pending) throw Errors.conflict("Există deja o cerere în așteptare pentru această notă.");

  return db.$transaction(async (tx) => {
    const req = await tx.gradeCorrectionRequest.create({
      data: {
        type: input.type,
        gradeId: grade.id,
        studentId: grade.studentId,
        classSectionId: grade.classSectionId,
        subjectId: grade.subjectId,
        moduleId: grade.moduleId,
        proposedValue: input.type === "MODIFY" ? input.proposedValue : null,
        proposedReasonId: input.type === "MODIFY" ? (input.proposedReasonId ?? null) : null,
        justification: input.justification,
        requestedById: actor.userId,
      },
      select: requestSelect,
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.CORRECTION_REQUEST_CREATE,
      entityType: "GradeCorrectionRequest",
      entityId: req.id,
      studentId: grade.studentId,
      classSectionId: grade.classSectionId,
      subjectId: grade.subjectId,
      academicYearId: grade.academicYearId,
      before: { gradeId: grade.id, value: Number(grade.value), version: grade.version },
      after: { type: input.type, proposedValue: input.proposedValue ?? null },
      reason: input.justification,
      metadata: { moduleId: grade.moduleId },
    });
    return serialize(req);
  });
}

/** Commander: all requests. PROFESOR: only own requests. Others: 403. */
export async function listCorrectionRequests(actor: Actor, filter: { status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" } = {}) {
  let where: Prisma.GradeCorrectionRequestWhereInput;
  if (hasPermission(actor, "corrections.review")) where = { status: filter.status };
  else {
    await assertPermission(actor, "corrections.request");
    where = { status: filter.status, requestedById: actor.userId };
  }
  const rows = await db.gradeCorrectionRequest.findMany({ where, select: requestSelect, orderBy: { createdAt: "desc" }, take: 500 });
  return rows.map(serialize);
}

export async function getCorrectionRequest(actor: Actor, id: string) {
  const req = await db.gradeCorrectionRequest.findUnique({ where: { id }, select: { ...requestSelect, requestedById: true } });
  if (!req) return denyWith(actor, "notFound", { resource: "CorrectionRequest", id });
  const visible = hasPermission(actor, "corrections.review") || (hasPermission(actor, "corrections.request") && req.requestedById === actor.userId);
  if (!visible) return denyWith(actor, "notFound", { resource: "CorrectionRequest", id });
  return serialize(req);
}

export async function reviewCorrectionRequest(actor: Actor, id: string, input: z.infer<typeof reviewCorrectionSchema>) {
  await assertPermission(actor, "corrections.review");
  const req = await db.gradeCorrectionRequest.findUnique({ where: { id } });
  if (!req) throw Errors.notFound();
  if (req.status !== "PENDING") throw Errors.conflict("Cererea a fost deja soluționată.");

  return db.$transaction(async (tx) => {
    // Claim the request atomically (a concurrent review cannot apply it twice).
    const claimed = await tx.gradeCorrectionRequest.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        reviewComment: input.comment || null,
      },
    });
    if (claimed.count !== 1) throw Errors.conflict("Cererea a fost deja soluționată.");

    const auditBase = {
      entityType: "GradeCorrectionRequest",
      entityId: id,
      studentId: req.studentId,
      classSectionId: req.classSectionId,
      subjectId: req.subjectId,
      reason: input.comment || undefined,
      metadata: { gradeId: req.gradeId, requestedById: req.requestedById, type: req.type },
    };

    if (input.decision === "REJECT") {
      await recordAudit(tx, actor, actor.meta, { ...auditBase, action: AuditAction.CORRECTION_REQUEST_REJECT, after: { status: "REJECTED" } });
      return { id, status: "REJECTED" as const };
    }

    const grade = req.gradeId ? await tx.grade.findUnique({ where: { id: req.gradeId } }) : null;
    if (!grade || grade.status !== "ACTIVE") throw Errors.conflict("Nota nu mai există sau a fost deja ștearsă.");
    await recordAudit(tx, actor, actor.meta, {
      ...auditBase,
      academicYearId: grade.academicYearId,
      action: AuditAction.CORRECTION_REQUEST_APPROVE,
      after: { status: "APPROVED", proposedValue: req.proposedValue === null ? null : Number(req.proposedValue) },
    });
    if (req.type === "DELETE") {
      await applyGradeDeletion(tx, actor, grade, {
        reason: req.justification,
        deletedById: req.requestedById,
        correctionRequestId: id,
        approvedById: actor.userId,
      });
    } else {
      await applyGradeChange(tx, actor, grade, {
        value: Number(req.proposedValue),
        reasonId: req.proposedReasonId ?? grade.reasonId,
        gradeDate: grade.gradeDate,
        note: grade.note,
        changeReason: req.justification,
        changedById: req.requestedById,
        correctionRequestId: id,
        approvedById: actor.userId,
      });
    }
    await tx.gradeCorrectionRequest.update({ where: { id }, data: { appliedAt: new Date() } });
    return { id, status: "APPROVED" as const };
  });
}

export async function cancelCorrectionRequest(actor: Actor, id: string) {
  await assertPermission(actor, "corrections.request");
  const req = await db.gradeCorrectionRequest.findUnique({ where: { id } });
  if (!req || req.requestedById !== actor.userId) return denyWith(actor, "notFound", { resource: "CorrectionRequest", id });
  if (req.status !== "PENDING") throw Errors.conflict("Doar cererile în așteptare pot fi anulate.");
  return db.$transaction(async (tx) => {
    await tx.gradeCorrectionRequest.update({ where: { id }, data: { status: "CANCELLED" } });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.CORRECTION_REQUEST_CANCEL,
      entityType: "GradeCorrectionRequest",
      entityId: id,
      studentId: req.studentId,
      classSectionId: req.classSectionId,
      subjectId: req.subjectId,
      after: { status: "CANCELLED" },
    });
    return { id, status: "CANCELLED" as const };
  });
}

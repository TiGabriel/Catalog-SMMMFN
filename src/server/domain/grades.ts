import "server-only";
import type { z } from "zod";
import type { GradeKind, SubjectType } from "@/generated/prisma/enums";
import { db, type DbOrTx, type Tx } from "@/server/db/client";
import { AppError, Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertCanCreateGrade, assertClassSubjectReadable, assertPermission, denyWith, findGradeGrant } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import { todayUtc } from "@/server/authz/scope";
import { getSetting } from "@/server/domain/settings";
import type { createGradeSchema, deleteGradeSchema, updateGradeSchema } from "@/lib/validation/schemas";

/**
 * Grade lifecycle.
 * - Create: only with an active grant (teaching / practical / examiner / homeroom for
 *   conduct) for exactly this class, subject and module; the subject must belong to
 *   the module's curriculum; the student must be actively enrolled in the class.
 * - Modify / delete: only by the original author, while still assigned, while the
 *   module is open and within the configurable edit window; always with a reason.
 *   Deletion is a soft delete. Every change writes an immutable revision + audit.
 * - Anything else goes through a correction request (see corrections.ts).
 */

export const correctionRequired = (message: string) => new AppError(409, "CORECTIE_NECESARA", message);

const personSelect = { id: true, firstName: true, lastName: true, rank: { select: { label: true } } } as const;

export function assertGradeValueAllowed(value: number, allowDecimals: boolean, field = "value") {
  if (!Number.isInteger(value) && !allowDecimals) {
    throw Errors.validation({ [field]: ["Nota trebuie să fie un număr întreg între 1 și 10."] });
  }
  if (Math.round(value * 100) !== value * 100) {
    throw Errors.validation({ [field]: ["Nota poate avea cel mult două zecimale."] });
  }
}

async function assertReasonValid(client: DbOrTx, reasonId: string, kind: GradeKind, field = "reasonId") {
  const reason = await client.gradeReason.findUnique({ where: { id: reasonId } });
  if (!reason || !reason.active || !reason.appliesTo.includes(kind)) {
    throw Errors.validation({ [field]: ["Motivul/tipul notei nu este valid pentru acest tip de notă."] });
  }
  return reason;
}

/** The module must belong to the class's year and year of study, and (except conduct) include the subject. */
async function assertModuleSubject(
  client: DbOrTx,
  input: { moduleId: string; subjectId: string; subjectType: SubjectType; kind: GradeKind },
  cls: { academicYearId: string; yearOfStudy: number; specializationId: string | null },
  requireOpen: boolean,
) {
  const mod = await client.module.findUnique({ where: { id: input.moduleId } });
  if (!mod || mod.academicYearId !== cls.academicYearId || mod.yearOfStudy !== cls.yearOfStudy) {
    throw Errors.validation({ moduleId: ["Modul invalid pentru această clasă."] });
  }
  if (requireOpen && mod.status !== "OPEN") throw correctionRequired("Modulul nu este deschis pentru notare.");
  if (input.subjectType === "CONDUCT") return mod;
  const ms = await client.moduleSubject.findFirst({
    where: {
      moduleId: mod.id,
      subjectId: input.subjectId,
      OR: [{ specializationId: null }, ...(cls.specializationId ? [{ specializationId: cls.specializationId }] : [])],
    },
  });
  if (!ms) throw Errors.validation({ subjectId: ["Materia nu face parte din planul acestui modul."] });
  if (input.kind === "MODULE_EXAM" && !ms.hasFinalExam) {
    throw Errors.validation({ kind: ["Materia nu are examen final în acest modul."] });
  }
  return mod;
}

function gradeSnapshot(g: { value: unknown; reasonId: string | null; gradeDate: Date; note: string | null; status: string; version: number }) {
  return {
    value: Number(g.value),
    reasonId: g.reasonId,
    gradeDate: g.gradeDate.toISOString().slice(0, 10),
    note: g.note,
    status: g.status,
    version: g.version,
  };
}

export async function createGrade(actor: Actor, input: z.infer<typeof createGradeSchema>) {
  const subject = await db.subject.findUnique({ where: { id: input.subjectId }, select: { id: true, type: true, active: true } });
  if (!subject) return denyWith(actor, "notFound", { resource: "Subject", id: input.subjectId });

  const grant = await assertCanCreateGrade(actor, {
    classSectionId: input.classSectionId,
    subjectId: subject.id,
    subjectType: subject.type,
    kind: input.kind,
    moduleId: input.moduleId,
  });

  // The actor is authorized for the (class, subject, kind, module) target; validate the rest.
  const enrollment = await db.enrollment.findFirst({
    where: { studentId: input.studentId, classSectionId: input.classSectionId, status: "ACTIVE", academicYear: { status: "ACTIVE" } },
    select: {
      id: true,
      academicYearId: true,
      academicYear: { select: { startDate: true, endDate: true } },
      classSection: { select: { yearOfStudy: true, specializationId: true, academicYearId: true } },
    },
  });
  if (!enrollment) return denyWith(actor, "notFound", { resource: "Enrollment", studentId: input.studentId, classSectionId: input.classSectionId });
  if (!subject.active) throw Errors.conflict("Materia nu este activă.");

  assertGradeValueAllowed(input.value, await getSetting("grades.allowDecimals"));
  if (input.gradeDate > todayUtc()) throw Errors.validation({ gradeDate: ["Data notei nu poate fi în viitor."] });
  if (input.gradeDate < enrollment.academicYear.startDate || input.gradeDate > enrollment.academicYear.endDate) {
    throw Errors.validation({ gradeDate: ["Data notei trebuie să fie în anul școlar curent."] });
  }
  const reason = await assertReasonValid(db, input.reasonId, input.kind);
  await assertModuleSubject(db, { ...input, subjectType: subject.type }, enrollment.classSection, true);

  // Conduct and the module exam are single grades per module (changes go through modification).
  if (input.kind !== "CURRENT") {
    const existing = await db.grade.findFirst({
      where: { studentId: input.studentId, subjectId: subject.id, moduleId: input.moduleId, kind: input.kind, status: "ACTIVE" },
      select: { id: true },
    });
    if (existing) throw Errors.conflict("Elevul are deja această notă în modul. Folosiți modificarea notei.");
  }

  return db.$transaction(async (tx) => {
    if (input.kind !== "CURRENT") {
      // Serialize concurrent requests and re-check inside the transaction (no duplicate conduct/exam grade).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`grade-single:${input.studentId}:${subject.id}:${input.moduleId}:${input.kind}`}))`;
      const dup = await tx.grade.findFirst({
        where: { studentId: input.studentId, subjectId: subject.id, moduleId: input.moduleId, kind: input.kind, status: "ACTIVE" },
        select: { id: true },
      });
      if (dup) throw Errors.conflict("Elevul are deja această notă în modul. Folosiți modificarea notei.");
    }
    const grade = await tx.grade.create({
      data: {
        studentId: input.studentId,
        enrollmentId: enrollment.id,
        classSectionId: input.classSectionId,
        subjectId: subject.id,
        moduleId: input.moduleId,
        academicYearId: enrollment.academicYearId,
        kind: input.kind,
        value: input.value,
        reasonId: reason.id,
        note: input.note || null,
        gradeDate: input.gradeDate,
        authorId: actor.userId,
        teachingAssignmentId: grant.teachingAssignmentId,
      },
    });
    await tx.gradeRevision.create({
      data: {
        gradeId: grade.id,
        revisionNo: 1,
        action: "CREATE",
        value: grade.value,
        reasonId: grade.reasonId,
        gradeDate: grade.gradeDate,
        note: grade.note,
        status: grade.status,
        changedById: actor.userId,
      },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.GRADE_CREATE,
      entityType: "Grade",
      entityId: grade.id,
      studentId: grade.studentId,
      classSectionId: grade.classSectionId,
      subjectId: grade.subjectId,
      academicYearId: grade.academicYearId,
      after: { ...gradeSnapshot(grade), kind: grade.kind, reason: reason.label, moduleId: grade.moduleId },
      metadata: { moduleId: grade.moduleId },
    });
    return { id: grade.id, value: Number(grade.value), kind: grade.kind, gradeDate: grade.gradeDate, version: grade.version };
  });
}

/** Loads a grade the actor may see (404 otherwise). */
async function loadVisibleGrade(actor: Actor, gradeId: string) {
  const grade = await db.grade.findUnique({
    where: { id: gradeId },
    include: {
      subject: { select: { id: true, name: true, type: true } },
      module: { select: { id: true, name: true, status: true } },
      academicYear: { select: { id: true, status: true } },
      classSection: { select: { id: true, code: true, academicYearId: true, yearOfStudy: true, specializationId: true } },
    },
  });
  if (!grade) return denyWith(actor, "notFound", { resource: "Grade", id: gradeId });
  await assertClassSubjectReadable(actor, grade.classSectionId, grade.subjectId);
  return grade;
}

type VisibleGrade = Awaited<ReturnType<typeof loadVisibleGrade>>;

/**
 * Checks the normal (non-correction) change path for the grade's author.
 * Throws 403 for non-authors and 409 CORECTIE_NECESARA when only the special
 * correction workflow can change the grade any more.
 */
async function assertAuthorMayChange(actor: Actor, grade: VisibleGrade, version: number) {
  if (!actor || grade.authorId !== actor.userId) {
    return denyWith(actor, "forbidden", { resource: "Grade", id: grade.id, reason: "NOT_AUTHOR" });
  }
  if (grade.status !== "ACTIVE") throw Errors.conflict("Nota a fost ștearsă.");
  const grant = await findGradeGrant(actor, {
    classSectionId: grade.classSectionId,
    subjectId: grade.subjectId,
    subjectType: grade.subject.type,
    kind: grade.kind,
    moduleId: grade.moduleId,
  });
  if (!grant) return denyWith(actor, "forbidden", { resource: "Grade", id: grade.id, reason: "NO_ACTIVE_ASSIGNMENT" });
  if (grade.academicYear.status !== "ACTIVE") throw correctionRequired("Anul școlar este închis. Folosiți o cerere de corecție.");
  if (grade.module && grade.module.status !== "OPEN") throw correctionRequired("Modulul este închis. Folosiți o cerere de corecție.");
  const days = await getSetting("grades.editWindowDays");
  if (Date.now() - grade.createdAt.getTime() > days * 86_400_000) {
    throw correctionRequired(`Termenul de ${days} zile pentru modificare a expirat. Folosiți o cerere de corecție.`);
  }
  if (grade.version !== version) throw Errors.conflict("Nota a fost modificată între timp. Reîncărcați pagina.");
}

export async function updateGrade(actor: Actor, gradeId: string, input: z.infer<typeof updateGradeSchema>) {
  await assertPermission(actor, "grades.create.scoped");
  const grade = await loadVisibleGrade(actor, gradeId);
  await assertAuthorMayChange(actor, grade, input.version);

  const newValue = input.value ?? Number(grade.value);
  assertGradeValueAllowed(newValue, await getSetting("grades.allowDecimals"));
  if (input.reasonId) await assertReasonValid(db, input.reasonId, grade.kind);
  if (input.gradeDate) {
    const year = await db.academicYear.findUniqueOrThrow({ where: { id: grade.academicYearId } });
    if (input.gradeDate > todayUtc() || input.gradeDate < year.startDate || input.gradeDate > year.endDate) {
      throw Errors.validation({ gradeDate: ["Data notei trebuie să fie în anul școlar curent și nu în viitor."] });
    }
  }
  return db.$transaction((tx) => applyGradeChange(tx, actor, grade, {
    value: newValue,
    reasonId: input.reasonId ?? grade.reasonId,
    gradeDate: input.gradeDate ?? grade.gradeDate,
    note: input.note === undefined ? grade.note : input.note,
    changeReason: input.changeReason,
    changedById: actor.userId,
  }));
}

export async function deleteGrade(actor: Actor, gradeId: string, input: z.infer<typeof deleteGradeSchema>) {
  await assertPermission(actor, "grades.create.scoped");
  const grade = await loadVisibleGrade(actor, gradeId);
  await assertAuthorMayChange(actor, grade, input.version);
  return db.$transaction((tx) => applyGradeDeletion(tx, actor, grade, { reason: input.reason, deletedById: actor.userId }));
}

type ChangeTarget = Pick<VisibleGrade, "id" | "value" | "reasonId" | "gradeDate" | "note" | "status" | "version" | "studentId" | "classSectionId" | "subjectId" | "academicYearId" | "moduleId">;

/** Shared by the author path and the approved-correction path. Must run inside a transaction. */
export async function applyGradeChange(
  tx: Tx,
  actor: Actor,
  grade: ChangeTarget,
  change: { value: number; reasonId: string | null; gradeDate: Date; note: string | null; changeReason: string; changedById: string; correctionRequestId?: string; approvedById?: string },
) {
  {
    // Optimistic lock: the update only succeeds on the version we checked.
    const res = await tx.grade.updateMany({
      where: { id: grade.id, version: grade.version, status: "ACTIVE" },
      data: { value: change.value, reasonId: change.reasonId, gradeDate: change.gradeDate, note: change.note, version: { increment: 1 } },
    });
    if (res.count !== 1) throw Errors.conflict("Nota a fost modificată între timp. Reîncărcați pagina.");
    const updated = await tx.grade.findUniqueOrThrow({ where: { id: grade.id } });
    const revisionNo = (await tx.gradeRevision.count({ where: { gradeId: grade.id } })) + 1;
    await tx.gradeRevision.create({
      data: {
        gradeId: grade.id,
        revisionNo,
        action: "UPDATE",
        value: updated.value,
        reasonId: updated.reasonId,
        gradeDate: updated.gradeDate,
        note: updated.note,
        status: updated.status,
        changedById: change.changedById,
        changeReason: change.changeReason,
        correctionRequestId: change.correctionRequestId ?? null,
      },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.GRADE_UPDATE,
      entityType: "Grade",
      entityId: grade.id,
      studentId: grade.studentId,
      classSectionId: grade.classSectionId,
      subjectId: grade.subjectId,
      academicYearId: grade.academicYearId,
      before: gradeSnapshot(grade),
      after: gradeSnapshot(updated),
      reason: change.changeReason,
      metadata: {
        moduleId: grade.moduleId,
        revisionNo,
        ...(change.correctionRequestId
          ? { via: "CORRECTION_REQUEST", correctionRequestId: change.correctionRequestId, requestedById: change.changedById, approvedById: change.approvedById }
          : {}),
      },
    });
    return { id: updated.id, value: Number(updated.value), version: updated.version };
  }
}

export async function applyGradeDeletion(
  tx: Tx,
  actor: Actor,
  grade: ChangeTarget,
  change: { reason: string; deletedById: string; correctionRequestId?: string; approvedById?: string },
) {
  {
    const res = await tx.grade.updateMany({
      where: { id: grade.id, version: grade.version, status: "ACTIVE" },
      data: {
        status: "DELETED",
        deletedAt: new Date(),
        deletedById: change.deletedById,
        deletionReason: change.reason,
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) throw Errors.conflict("Nota a fost modificată între timp. Reîncărcați pagina.");
    const revisionNo = (await tx.gradeRevision.count({ where: { gradeId: grade.id } })) + 1;
    await tx.gradeRevision.create({
      data: {
        gradeId: grade.id,
        revisionNo,
        action: "DELETE",
        value: grade.value as never,
        reasonId: grade.reasonId,
        gradeDate: grade.gradeDate,
        note: grade.note,
        status: "DELETED",
        changedById: change.deletedById,
        changeReason: change.reason,
        correctionRequestId: change.correctionRequestId ?? null,
      },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.GRADE_DELETE,
      entityType: "Grade",
      entityId: grade.id,
      studentId: grade.studentId,
      classSectionId: grade.classSectionId,
      subjectId: grade.subjectId,
      academicYearId: grade.academicYearId,
      before: gradeSnapshot(grade),
      after: { status: "DELETED" },
      reason: change.reason,
      metadata: {
        moduleId: grade.moduleId,
        revisionNo,
        deletedById: change.deletedById,
        ...(change.correctionRequestId ? { via: "CORRECTION_REQUEST", correctionRequestId: change.correctionRequestId, approvedById: change.approvedById } : {}),
      },
    });
    return { id: grade.id, status: "DELETED" as const };
  }
}

/** A grade with its full revision history (visible to whoever may read the class+subject). */
export async function getGradeWithHistory(actor: Actor, gradeId: string) {
  const grade = await loadVisibleGrade(actor, gradeId);
  const [student, author, deletedBy, reason, revisions, requests] = await Promise.all([
    db.student.findUniqueOrThrow({ where: { id: grade.studentId }, select: { id: true, firstName: true, lastName: true } }),
    db.user.findUniqueOrThrow({ where: { id: grade.authorId }, select: personSelect }),
    grade.deletedById ? db.user.findUnique({ where: { id: grade.deletedById }, select: personSelect }) : null,
    grade.reasonId ? db.gradeReason.findUnique({ where: { id: grade.reasonId }, select: { id: true, label: true } }) : null,
    db.gradeRevision.findMany({
      where: { gradeId },
      orderBy: { revisionNo: "asc" },
      select: {
        revisionNo: true,
        action: true,
        value: true,
        gradeDate: true,
        note: true,
        status: true,
        changeReason: true,
        changedAt: true,
        correctionRequestId: true,
        reason: { select: { label: true } },
        changedBy: { select: personSelect },
      },
    }),
    db.gradeCorrectionRequest.findMany({
      where: { gradeId },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, status: true, proposedValue: true, justification: true, createdAt: true, reviewedAt: true, reviewComment: true },
    }),
  ]);
  const canChange =
    grade.authorId === actor.userId && grade.status === "ACTIVE"
      ? await assertAuthorMayChange(actor, grade, grade.version).then(
          () => true,
          () => false,
        )
      : false;
  return {
    grade: {
      id: grade.id,
      value: Number(grade.value),
      kind: grade.kind,
      status: grade.status,
      version: grade.version,
      gradeDate: grade.gradeDate,
      note: grade.note,
      createdAt: grade.createdAt,
      updatedAt: grade.updatedAt,
      deletedAt: grade.deletedAt,
      deletionReason: grade.deletionReason,
      subject: grade.subject,
      module: grade.module,
      classSection: { id: grade.classSection.id, code: grade.classSection.code },
      reason,
      student,
      author,
      deletedBy,
    },
    revisions: revisions.map((r) => ({ ...r, value: Number(r.value) })),
    correctionRequests: requests.map((r) => ({ ...r, proposedValue: r.proposedValue === null ? null : Number(r.proposedValue) })),
    permissions: { canModify: canChange, isAuthor: grade.authorId === actor.userId },
  };
}

/** Grades authored by the actor (teacher's own grade history), newest first. */
export async function listOwnGrades(actor: Actor, opts: { includeDeleted?: boolean; take?: number } = {}) {
  await assertPermission(actor, "grades.create.scoped");
  const grades = await db.grade.findMany({
    where: { authorId: actor.userId, ...(opts.includeDeleted ? {} : { status: "ACTIVE" }) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 200, 500),
    select: {
      id: true,
      value: true,
      kind: true,
      status: true,
      gradeDate: true,
      createdAt: true,
      updatedAt: true,
      version: true,
      student: { select: { id: true, firstName: true, lastName: true } },
      subject: { select: { id: true, name: true } },
      classSection: { select: { id: true, code: true } },
      module: { select: { id: true, name: true } },
      reason: { select: { label: true } },
    },
  });
  return grades.map((g) => ({ ...g, value: Number(g.value) }));
}

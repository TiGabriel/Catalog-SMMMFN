import "server-only";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertCanCreateGrade } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import { todayUtc } from "@/server/authz/scope";
import { getSetting } from "@/server/domain/settings";
import type { createGradeSchema } from "@/lib/validation/schemas";

/**
 * Creates a grade. Authorization is resolved from the database:
 * - regular subject → active SUBJECT_TEACHING assignment for (class, subject);
 * - practical training → PRACTICAL_TRAINING assignment;
 * - module exam → MODULE_EXAM assignment for that module;
 * - conduct ("Purtare", kind FINAL) → active homeroom assignment (diriginte).
 * The student must be actively enrolled in that class in the active year.
 * Grade + first revision + audit entry are written in one transaction.
 * (Modification/deletion with mandatory reason: phase 3.)
 */
export async function createGrade(actor: Actor, input: z.infer<typeof createGradeSchema>) {
  const subject = await db.subject.findUnique({ where: { id: input.subjectId }, select: { id: true, type: true, active: true } });
  if (!subject) throw Errors.notFound();

  const moduleId = input.moduleId ?? null;
  const grant = await assertCanCreateGrade(actor, {
    classSectionId: input.classSectionId,
    subjectId: subject.id,
    subjectType: subject.type,
    kind: input.kind,
    moduleId,
  });

  // From here the actor is authorized for the (class, subject) pair; validate the rest.
  const enrollment = await db.enrollment.findFirst({
    where: {
      studentId: input.studentId,
      classSectionId: input.classSectionId,
      status: "ACTIVE",
      academicYear: { status: "ACTIVE" },
    },
    select: { id: true, academicYearId: true, academicYear: { select: { startDate: true, endDate: true } }, classSection: { select: { yearOfStudy: true } } },
  });
  if (!enrollment) throw Errors.notFound();
  if (!subject.active) throw Errors.conflict("Materia nu este activă.");

  if (!Number.isInteger(input.value) && !(await getSetting("grades.allowDecimals"))) {
    throw Errors.validation({ value: ["Nota trebuie să fie un număr întreg între 1 și 10."] });
  }
  if (Math.round(input.value * 100) !== input.value * 100) {
    throw Errors.validation({ value: ["Nota poate avea cel mult două zecimale."] });
  }
  const today = todayUtc();
  if (input.gradeDate > today) throw Errors.validation({ gradeDate: ["Data notei nu poate fi în viitor."] });
  if (input.gradeDate < enrollment.academicYear.startDate || input.gradeDate > enrollment.academicYear.endDate) {
    throw Errors.validation({ gradeDate: ["Data notei trebuie să fie în anul școlar curent."] });
  }

  const reason = await db.gradeReason.findUnique({ where: { id: input.reasonId } });
  if (!reason || !reason.active || !reason.appliesTo.includes(input.kind)) {
    throw Errors.validation({ reasonId: ["Motivul/tipul notei nu este valid pentru acest tip de notă."] });
  }

  if (moduleId) {
    const mod = await db.module.findUnique({ where: { id: moduleId } });
    if (!mod || mod.academicYearId !== enrollment.academicYearId || mod.yearOfStudy !== enrollment.classSection.yearOfStudy) {
      throw Errors.validation({ moduleId: ["Modul invalid pentru această clasă."] });
    }
    if (mod.status !== "OPEN") throw Errors.conflict("Modulul nu este deschis pentru notare.");
  } else if (input.kind === "MODULE_EXAM") {
    throw Errors.validation({ moduleId: ["Selectați modulul."] });
  }

  return db.$transaction(async (tx) => {
    const grade = await tx.grade.create({
      data: {
        studentId: input.studentId,
        enrollmentId: enrollment.id,
        classSectionId: input.classSectionId,
        subjectId: subject.id,
        moduleId,
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
      after: { value: Number(grade.value), kind: grade.kind, reason: reason.label, gradeDate: grade.gradeDate, moduleId },
    });
    return { id: grade.id, value: Number(grade.value), kind: grade.kind, gradeDate: grade.gradeDate };
  });
}

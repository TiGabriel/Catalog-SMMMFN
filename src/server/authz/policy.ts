import "server-only";
import type { AssignmentKind, GradeKind, SubjectType } from "@/generated/prisma/enums";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAuditSafe, AuditAction } from "@/server/audit/audit";
import type { Actor } from "@/server/authz/actor";
import { roleHas, type Permission } from "@/server/authz/permissions";
import { loadScope } from "@/server/authz/scope";

/**
 * Central authorization entry points. Every service calls these before
 * touching data. Out-of-scope resources raise 404 (not 403) so identifiers
 * cannot be probed; every denial is written to the audit log.
 */

async function deny(actor: Actor, kind: "forbidden" | "notFound", detail: Record<string, unknown>): Promise<never> {
  await recordAuditSafe(actor, actor.meta, {
    action: AuditAction.ACCESS_DENIED,
    outcome: "DENIED",
    metadata: detail,
  });
  throw kind === "forbidden" ? Errors.forbidden() : Errors.notFound();
}

export function hasPermission(actor: Actor, permission: Permission): boolean {
  return roleHas(actor.role, permission);
}

export async function assertPermission(actor: Actor, permission: Permission): Promise<void> {
  if (!hasPermission(actor, permission)) await deny(actor, "forbidden", { permission });
}

/** "ALL" = every subject of the class; otherwise the explicit set of visible subjects. */
export type SubjectVisibility = "ALL" | Set<string>;

export type ClassAccess = {
  classSectionId: string;
  academicYearId: string;
  /** Can see the class roster (students list). */
  roster: boolean;
  /** Which subjects' grades are visible; empty set = none. */
  gradeSubjects: SubjectVisibility;
  isHomeroom: boolean;
};

/**
 * Resolves what the actor may see in a class, or denies with 404.
 * - COMANDANT UNITATE: everything (read-only).
 * - ADMINISTRATOR: roster only (structure management), no grades.
 * - PROFESOR: only classes with an active teaching or homeroom assignment;
 *   a diriginte sees all subjects of the own class, otherwise only assigned subjects.
 * - ELEV: no class-level access (own data only, via self endpoints).
 */
export async function getClassAccess(actor: Actor, classSectionId: string): Promise<ClassAccess> {
  const cls = await db.classSection.findUnique({
    where: { id: classSectionId },
    select: { id: true, academicYearId: true },
  });
  if (!cls) return deny(actor, "notFound", { resource: "ClassSection", id: classSectionId });

  if (hasPermission(actor, "academic.read.all")) {
    return { classSectionId, academicYearId: cls.academicYearId, roster: true, gradeSubjects: "ALL", isHomeroom: false };
  }
  if (hasPermission(actor, "structure.read")) {
    return { classSectionId, academicYearId: cls.academicYearId, roster: true, gradeSubjects: new Set(), isHomeroom: false };
  }
  if (hasPermission(actor, "academic.read.scoped")) {
    const scope = await loadScope(actor);
    if (scope.homeroomClassIds.has(classSectionId)) {
      return { classSectionId, academicYearId: cls.academicYearId, roster: true, gradeSubjects: "ALL", isHomeroom: true };
    }
    if (scope.teachingClassIds.has(classSectionId)) {
      const subjects = new Set(scope.teaching.filter((t) => t.classSectionId === classSectionId).map((t) => t.subjectId));
      return { classSectionId, academicYearId: cls.academicYearId, roster: true, gradeSubjects: subjects, isHomeroom: false };
    }
  }
  return deny(actor, "notFound", { resource: "ClassSection", id: classSectionId });
}

export function subjectVisible(access: { gradeSubjects: SubjectVisibility }, subjectId: string): boolean {
  return access.gradeSubjects === "ALL" || access.gradeSubjects.has(subjectId);
}

/** Grade visibility for a (class, subject) pair; 404 when not visible. */
export async function assertClassSubjectReadable(actor: Actor, classSectionId: string, subjectId: string) {
  const access = await getClassAccess(actor, classSectionId);
  if (!subjectVisible(access, subjectId)) {
    return deny(actor, "notFound", { resource: "ClassSubject", classSectionId, subjectId });
  }
  return access;
}

export type StudentAccess = {
  studentId: string;
  /** Classes (current enrollments) through which the actor sees this student. */
  classSectionIds: string[];
  gradeSubjects: SubjectVisibility;
  isSelf: boolean;
};

/**
 * Resolves access to one student. A teacher sees a student only while the
 * student is actively enrolled in one of the teacher's classes.
 */
export async function getStudentAccess(actor: Actor, studentId: string): Promise<StudentAccess> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      enrollments: {
        where: { status: "ACTIVE", academicYear: { status: "ACTIVE" } },
        select: { classSectionId: true },
      },
    },
  });
  if (!student) return deny(actor, "notFound", { resource: "Student", id: studentId });
  const currentClasses = student.enrollments.map((e) => e.classSectionId);

  if (hasPermission(actor, "academic.read.all")) {
    return { studentId, classSectionIds: currentClasses, gradeSubjects: "ALL", isSelf: false };
  }
  if (hasPermission(actor, "structure.read")) {
    return { studentId, classSectionIds: currentClasses, gradeSubjects: new Set(), isSelf: false };
  }
  if (hasPermission(actor, "self.academic.read")) {
    const scope = await loadScope(actor);
    if (scope.studentId === studentId) {
      return { studentId, classSectionIds: currentClasses, gradeSubjects: "ALL", isSelf: true };
    }
    return deny(actor, "notFound", { resource: "Student", id: studentId });
  }
  if (hasPermission(actor, "academic.read.scoped")) {
    const scope = await loadScope(actor);
    const viaHomeroom = currentClasses.filter((c) => scope.homeroomClassIds.has(c));
    const viaTeaching = currentClasses.filter((c) => scope.teachingClassIds.has(c));
    if (viaHomeroom.length > 0) {
      return { studentId, classSectionIds: [...new Set([...viaHomeroom, ...viaTeaching])], gradeSubjects: "ALL", isSelf: false };
    }
    if (viaTeaching.length > 0) {
      const subjects = new Set(
        scope.teaching.filter((t) => viaTeaching.includes(t.classSectionId)).map((t) => t.subjectId),
      );
      return { studentId, classSectionIds: viaTeaching, gradeSubjects: subjects, isSelf: false };
    }
  }
  return deny(actor, "notFound", { resource: "Student", id: studentId });
}

/** Which assignment kind is required to enter a grade of `kind` for a subject of `subjectType`. */
export function requiredAssignmentKind(subjectType: SubjectType, kind: GradeKind): AssignmentKind | "HOMEROOM" | null {
  if (subjectType === "CONDUCT") return kind === "FINAL" ? "HOMEROOM" : null;
  if (kind === "MODULE_EXAM") return "MODULE_EXAM";
  if (kind === "FINAL") return null; // direct final grades only for conduct in this phase
  return subjectType === "PRACTICAL_TRAINING" ? "PRACTICAL_TRAINING" : "SUBJECT_TEACHING";
}

/**
 * Asserts the actor may create a grade for (class, subject, kind[, module]).
 * Returns the teaching assignment that grants it (null for homeroom/conduct).
 * Only PROFESOR accounts can ever pass: administrators and the commander have
 * no grade-creation permission at all.
 */
export async function assertCanCreateGrade(
  actor: Actor,
  input: { classSectionId: string; subjectId: string; subjectType: SubjectType; kind: GradeKind; moduleId: string | null },
): Promise<{ teachingAssignmentId: string | null }> {
  if (!hasPermission(actor, "grades.create.scoped")) {
    return deny(actor, "forbidden", { permission: "grades.create.scoped", ...input });
  }
  const required = requiredAssignmentKind(input.subjectType, input.kind);
  const scope = await loadScope(actor);
  if (required === "HOMEROOM") {
    if (hasPermission(actor, "grades.conduct.scoped") && scope.homeroomClassIds.has(input.classSectionId)) {
      return { teachingAssignmentId: null };
    }
  } else if (required) {
    const grant = scope.teaching.find(
      (t) =>
        t.classSectionId === input.classSectionId &&
        t.subjectId === input.subjectId &&
        t.kind === required &&
        (required !== "MODULE_EXAM" || t.moduleId === input.moduleId),
    );
    if (grant) return { teachingAssignmentId: grant.assignmentId };
  }
  return deny(actor, "notFound", { resource: "GradeEntry", ...input });
}

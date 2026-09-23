import "server-only";
import type { AssignmentKind } from "@/generated/prisma/enums";
import { db } from "@/server/db/client";
import type { Actor } from "@/server/authz/actor";
import { schoolDate } from "@/server/time";

export type TeachingGrant = {
  assignmentId: string;
  classSectionId: string;
  subjectId: string;
  kind: AssignmentKind;
  moduleId: string | null;
};

/** Relationship scope of an actor, always loaded from the database. */
export type AccessScope = {
  activeYearId: string | null;
  teaching: TeachingGrant[];
  homeroomClassIds: Set<string>;
  /** Classes where the actor has any teaching grant. */
  teachingClassIds: Set<string>;
  /** ELEV only: own student record and the class of the active enrollment. */
  studentId: string | null;
  studentClassIds: Set<string>;
};

/** Today's date in the school's timezone, as a UTC-midnight Date (like DATE columns). */
export function todayUtc(): Date {
  return schoolDate();
}

/** SQL-level definition of "active assignment" (shared by teaching and homeroom). */
export function activeAssignmentWhere(today = todayUtc()) {
  return {
    endedAt: null,
    validFrom: { lte: today },
    OR: [{ validTo: null }, { validTo: { gte: today } }],
    academicYear: { status: "ACTIVE" as const },
    classSection: { active: true },
  };
}

const cache = new WeakMap<Actor, Promise<AccessScope>>();

/** Loads the scope once per actor object (i.e. once per request). */
export function loadScope(actor: Actor): Promise<AccessScope> {
  let p = cache.get(actor);
  if (!p) {
    p = computeScope(actor);
    cache.set(actor, p);
  }
  return p;
}

async function computeScope(actor: Actor): Promise<AccessScope> {
  const activeYear = await db.academicYear.findFirst({ where: { status: "ACTIVE" }, select: { id: true } });
  const scope: AccessScope = {
    activeYearId: activeYear?.id ?? null,
    teaching: [],
    homeroomClassIds: new Set(),
    teachingClassIds: new Set(),
    studentId: null,
    studentClassIds: new Set(),
  };

  if (actor.role === "PROFESOR") {
    const where = { teacherId: actor.userId, ...activeAssignmentWhere() };
    const [teaching, homeroom] = await Promise.all([
      db.teachingAssignment.findMany({
        where,
        select: { id: true, classSectionId: true, subjectId: true, kind: true, moduleId: true },
      }),
      db.homeroomAssignment.findMany({ where, select: { classSectionId: true } }),
    ]);
    scope.teaching = teaching.map((t) => ({
      assignmentId: t.id,
      classSectionId: t.classSectionId,
      subjectId: t.subjectId,
      kind: t.kind,
      moduleId: t.moduleId,
    }));
    for (const t of teaching) scope.teachingClassIds.add(t.classSectionId);
    for (const h of homeroom) scope.homeroomClassIds.add(h.classSectionId);
  }

  if (actor.role === "ELEV") {
    const student = await db.student.findUnique({
      where: { userId: actor.userId },
      select: {
        id: true,
        status: true,
        enrollments: {
          where: { status: "ACTIVE", academicYear: { status: "ACTIVE" } },
          select: { classSectionId: true },
        },
      },
    });
    if (student) {
      scope.studentId = student.id;
      for (const e of student.enrollments) scope.studentClassIds.add(e.classSectionId);
    }
  }
  return scope;
}

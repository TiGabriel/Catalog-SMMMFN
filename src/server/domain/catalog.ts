import "server-only";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import {
  assertClassSubjectReadable,
  assertPermission,
  getClassAccess,
  getStudentAccess,
  hasPermission,
  subjectVisible,
} from "@/server/authz/policy";
import { loadScope } from "@/server/authz/scope";
import type { Actor } from "@/server/authz/actor";

/**
 * Scoped academic reads. Every query is constrained by the actor's access
 * (resolved on the server) – IDs from the request only select within that scope.
 */

const personSelect = { id: true, firstName: true, lastName: true, rank: { select: { label: true } } } as const;

const gradeSelect = {
  id: true,
  studentId: true,
  subjectId: true,
  kind: true,
  value: true,
  gradeDate: true,
  note: true,
  createdAt: true,
  reason: { select: { id: true, label: true } },
  author: { select: personSelect },
  module: { select: { id: true, name: true } },
} as const;

type GradeRow = {
  value: { toString(): string };
} & Record<string, unknown>;

function serializeGrade<T extends GradeRow>(g: T) {
  return { ...g, value: Number(g.value.toString()) };
}

export type MyClass = {
  id: string;
  code: string;
  yearOfStudy: number;
  company: string;
  isHomeroom: boolean;
  subjects: { id: string; name: string; kinds: string[] }[];
};

/** Classes visible to the actor: all (commander) or those with an active teaching/homeroom assignment. */
export async function listMyClasses(actor: Actor): Promise<MyClass[]> {
  if (hasPermission(actor, "academic.read.all")) {
    const classes = await db.classSection.findMany({
      where: { academicYear: { status: "ACTIVE" } },
      select: { id: true, code: true, yearOfStudy: true, company: { select: { name: true } } },
      orderBy: [{ yearOfStudy: "desc" }, { code: "asc" }],
    });
    return classes.map((c) => ({ id: c.id, code: c.code, yearOfStudy: c.yearOfStudy, company: c.company.name, isHomeroom: false, subjects: [] }));
  }
  await assertPermission(actor, "academic.read.scoped");
  const scope = await loadScope(actor);
  const ids = [...new Set([...scope.teachingClassIds, ...scope.homeroomClassIds])];
  if (ids.length === 0) return [];
  const [classes, subjects] = await Promise.all([
    db.classSection.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, yearOfStudy: true, company: { select: { name: true } } },
      orderBy: [{ yearOfStudy: "desc" }, { code: "asc" }],
    }),
    db.subject.findMany({
      where: { id: { in: [...new Set(scope.teaching.map((t) => t.subjectId))] } },
      select: { id: true, name: true },
    }),
  ]);
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  return classes.map((c) => {
    const bySubject = new Map<string, Set<string>>();
    for (const t of scope.teaching.filter((t) => t.classSectionId === c.id)) {
      (bySubject.get(t.subjectId) ?? bySubject.set(t.subjectId, new Set()).get(t.subjectId)!).add(t.kind);
    }
    return {
      id: c.id,
      code: c.code,
      yearOfStudy: c.yearOfStudy,
      company: c.company.name,
      isHomeroom: scope.homeroomClassIds.has(c.id),
      subjects: [...bySubject].map(([id, kinds]) => ({ id, name: subjectName.get(id) ?? "", kinds: [...kinds] })),
    };
  });
}

/** Class page: roster plus the subjects whose grades the actor may see. */
export async function getClassOverview(actor: Actor, classSectionId: string) {
  const access = await getClassAccess(actor, classSectionId);
  const scope = hasPermission(actor, "academic.read.scoped") ? await loadScope(actor) : null;

  const cls = await db.classSection.findUniqueOrThrow({
    where: { id: classSectionId },
    select: {
      id: true,
      code: true,
      yearOfStudy: true,
      company: { select: { name: true } },
      academicYear: { select: { id: true, name: true, status: true } },
      homeroomAssignments: { where: { endedAt: null }, select: { teacher: { select: personSelect } } },
    },
  });

  const students = access.roster
    ? await db.enrollment.findMany({
        where: { classSectionId, status: "ACTIVE" },
        select: { student: { select: { id: true, firstName: true, lastName: true, registryNumber: true, rank: { select: { label: true } } } } },
        orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
      })
    : [];

  // Subjects taught in the class (from assignments), plus "Purtare" – filtered by visibility.
  const taught = await db.teachingAssignment.findMany({
    where: { classSectionId, endedAt: null },
    select: { subject: { select: { id: true, name: true, type: true } }, teacher: { select: personSelect } },
  });
  const conduct = await db.subject.findFirst({ where: { type: "CONDUCT", isSystem: true }, select: { id: true, name: true, type: true } });
  const subjectMap = new Map<string, { id: string; name: string; type: string; teachers: string[] }>();
  for (const t of taught) {
    const entry = subjectMap.get(t.subject.id) ?? { ...t.subject, teachers: [] };
    entry.teachers.push([t.teacher.rank?.label, t.teacher.lastName, t.teacher.firstName].filter(Boolean).join(" "));
    subjectMap.set(t.subject.id, entry);
  }
  if (conduct && !subjectMap.has(conduct.id)) subjectMap.set(conduct.id, { ...conduct, teachers: [] });
  const subjects = [...subjectMap.values()]
    .filter((s) => subjectVisible(access, s.id))
    .map((s) => ({
      ...s,
      canEnterGrades:
        !!scope &&
        (s.type === "CONDUCT"
          ? access.isHomeroom
          : scope.teaching.some((t) => t.classSectionId === classSectionId && t.subjectId === s.id)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ro"));

  return {
    class: {
      id: cls.id,
      code: cls.code,
      yearOfStudy: cls.yearOfStudy,
      company: cls.company.name,
      academicYear: cls.academicYear,
      homeroomTeacher: cls.homeroomAssignments[0]?.teacher ?? null,
    },
    isHomeroom: access.isHomeroom,
    students: students.map((e) => e.student),
    subjects,
  };
}

/** Grades of one subject in one class (only if that pair is visible to the actor). */
export async function getClassSubjectGrades(actor: Actor, classSectionId: string, subjectId: string) {
  await assertClassSubjectReadable(actor, classSectionId, subjectId);
  const subject = await db.subject.findUnique({ where: { id: subjectId }, select: { id: true, name: true, type: true } });
  if (!subject) throw Errors.notFound();
  const [students, grades] = await Promise.all([
    db.enrollment.findMany({
      where: { classSectionId, status: "ACTIVE" },
      select: { student: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
    }),
    db.grade.findMany({
      where: { classSectionId, subjectId, status: "ACTIVE" },
      select: gradeSelect,
      orderBy: [{ gradeDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  return {
    subject,
    students: students.map((e) => ({
      ...e.student,
      grades: grades.filter((g) => g.studentId === e.student.id).map(serializeGrade),
    })),
  };
}

/** One student: identity + grades of the current year limited to the subjects visible to the actor. */
export async function getStudentOverview(actor: Actor, studentId: string) {
  const access = await getStudentAccess(actor, studentId);
  const student = await db.student.findUniqueOrThrow({
    where: { id: studentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      registryNumber: true,
      status: true,
      rank: { select: { label: true } },
      enrollments: {
        where: { status: "ACTIVE", academicYear: { status: "ACTIVE" } },
        select: { classSection: { select: { id: true, code: true } } },
      },
    },
  });
  const canSeeGrades = access.gradeSubjects === "ALL" || access.gradeSubjects.size > 0;
  const grades = canSeeGrades
    ? await db.grade.findMany({
        where: {
          studentId,
          status: "ACTIVE",
          academicYear: { status: "ACTIVE" },
          ...(access.gradeSubjects === "ALL" ? {} : { subjectId: { in: [...access.gradeSubjects] } }),
          // Teachers/diriginți see grades only for the classes that give them access.
          ...(access.isSelf || hasPermission(actor, "academic.read.all") ? {} : { classSectionId: { in: access.classSectionIds } }),
        },
        select: { ...gradeSelect, subject: { select: { id: true, name: true } } },
        orderBy: [{ subject: { name: "asc" } }, { gradeDate: "asc" }],
      })
    : [];
  return { student, grades: grades.map(serializeGrade), gradesVisible: canSeeGrades };
}

/** ELEV: own grades of the current academic year. */
export async function getOwnGrades(actor: Actor) {
  await assertPermission(actor, "self.academic.read");
  const scope = await loadScope(actor);
  if (!scope.studentId) throw Errors.notFound();
  return getStudentOverview(actor, scope.studentId);
}

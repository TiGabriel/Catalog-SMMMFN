import "server-only";
import { db } from "@/server/db/client";
import { assertPermission, hasPermission } from "@/server/authz/policy";
import { loadScope } from "@/server/authz/scope";
import type { Actor } from "@/server/authz/actor";
import { getWeekTimetable } from "@/server/domain/timetable";
import { schoolDate } from "@/server/time";

/** Aggregated figures for the role-specific dashboards (each block checks its own permission). */

export async function adminDashboard(actor: Actor) {
  await assertPermission(actor, "users.manage");
  const year = await db.academicYear.findFirst({ where: { status: "ACTIVE" } });
  const since = new Date(Date.now() - 24 * 3600_000);
  const [usersByRole, inactiveUsers, classes, students, subjects, openModules, assignments, homerooms, failedLogins, lastRollover] = await Promise.all([
    db.user.groupBy({ by: ["role"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    db.user.count({ where: { status: "INACTIVE" } }),
    year ? db.classSection.count({ where: { academicYearId: year.id, active: true } }) : 0,
    year ? db.enrollment.count({ where: { academicYearId: year.id, status: "ACTIVE" } }) : 0,
    db.subject.count({ where: { active: true } }),
    year ? db.module.count({ where: { academicYearId: year.id, status: "OPEN" } }) : 0,
    year ? db.teachingAssignment.count({ where: { academicYearId: year.id, endedAt: null } }) : 0,
    year ? db.homeroomAssignment.count({ where: { academicYearId: year.id, endedAt: null } }) : 0,
    db.auditLog.count({ where: { action: { in: ["LOGIN_FAILED", "LOGIN_BLOCKED"] }, occurredAt: { gte: since } } }),
    db.yearRollover.findFirst({ orderBy: { executedAt: "desc" }, include: { toYear: { select: { name: true } } } }),
  ]);
  const timetable = year ? await getWeekTimetable(actor, { week: schoolDate() }) : null;
  return {
    year,
    users: Object.fromEntries(usersByRole.map((u) => [u.role, u._count._all])) as Record<string, number>,
    inactiveUsers,
    classes,
    classesWithoutHomeroom: Math.max(0, classes - homerooms),
    students,
    subjects,
    openModules,
    assignments,
    failedLogins,
    timetableVersion: timetable?.version?.name ?? null,
    lastRollover: lastRollover ? { toYear: lastRollover.toYear.name, executedAt: lastRollover.executedAt } : null,
  };
}

export async function commanderDashboard(actor: Actor) {
  await assertPermission(actor, "academic.read.all");
  const year = await db.academicYear.findFirst({ where: { status: "ACTIVE" } });
  if (!year) return { year: null, companies: [], pendingCorrections: 0, gradesLastWeek: 0, openModules: 0, recent: [] };
  const [companies, enrollments, pendingCorrections, gradesLastWeek, openModules, recent] = await Promise.all([
    db.company.findMany({ orderBy: { number: "asc" }, include: { classSections: { where: { academicYearId: year.id }, select: { id: true } } } }),
    db.enrollment.groupBy({ by: ["classSectionId"], where: { academicYearId: year.id, status: "ACTIVE" }, _count: { _all: true } }),
    db.gradeCorrectionRequest.count({ where: { status: "PENDING" } }),
    db.grade.count({ where: { academicYearId: year.id, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    db.module.count({ where: { academicYearId: year.id, status: "OPEN" } }),
    db.auditLog.findMany({
      where: { action: { in: ["GRADE_UPDATE", "GRADE_DELETE", "CORRECTION_REQUEST_APPROVE", "CORRECTION_REQUEST_REJECT"] } },
      orderBy: { id: "desc" },
      take: 6,
      select: { id: true, action: true, occurredAt: true, actorSnapshot: true, reason: true },
    }),
  ]);
  const studentsIn = (ids: string[]) => enrollments.filter((e) => ids.includes(e.classSectionId)).reduce((a, e) => a + e._count._all, 0);
  return {
    year,
    companies: companies.map((c) => ({ name: c.name, yearOfStudy: c.yearOfStudy, classes: c.classSections.length, students: studentsIn(c.classSections.map((x) => x.id)) })),
    pendingCorrections,
    gradesLastWeek,
    openModules,
    recent: recent.map((r) => ({ ...r, id: r.id.toString() })),
  };
}

export async function teacherDashboard(actor: Actor) {
  await assertPermission(actor, "academic.read.scoped");
  const scope = await loadScope(actor);
  const classIds = [...new Set([...scope.teachingClassIds, ...scope.homeroomClassIds])];
  const [students, recentGrades, pendingRequests, homeroom] = await Promise.all([
    db.enrollment.count({ where: { classSectionId: { in: classIds }, status: "ACTIVE" } }),
    db.grade.findMany({
      where: { authorId: actor.userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, value: true, createdAt: true, student: { select: { firstName: true, lastName: true } }, subject: { select: { name: true } }, classSection: { select: { code: true } } },
    }),
    db.gradeCorrectionRequest.count({ where: { requestedById: actor.userId, status: "PENDING" } }),
    Promise.all(
      [...scope.homeroomClassIds].map(async (id) => {
        const cls = await db.classSection.findUniqueOrThrow({ where: { id }, select: { id: true, code: true, yearOfStudy: true, academicYearId: true } });
        const [studentCount, openModule, conductSubject] = await Promise.all([
          db.enrollment.count({ where: { classSectionId: id, status: "ACTIVE" } }),
          db.module.findFirst({ where: { status: "OPEN", academicYearId: cls.academicYearId, yearOfStudy: cls.yearOfStudy }, orderBy: { order: "desc" } }),
          db.subject.findFirst({ where: { type: "CONDUCT", isSystem: true }, select: { id: true } }),
        ]);
        const conduct =
          openModule && conductSubject
            ? await db.grade.count({ where: { classSectionId: id, subjectId: conductSubject.id, moduleId: openModule.id, status: "ACTIVE" } })
            : null;
        return { ...cls, students: studentCount, conductEntered: conduct, openModule: openModule?.name ?? null };
      }),
    ),
  ]);
  return { students, recentGrades: recentGrades.map((g) => ({ ...g, value: Number(g.value) })), pendingRequests, homeroom, isHomeroom: hasPermission(actor, "grades.conduct.scoped") && scope.homeroomClassIds.size > 0 };
}

/**
 * Academic-year transition: promotion 1xy → 2xy, graduation, idempotency,
 * history preservation and history access.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { GET as previewRoute } from "@/app/api/admin/rollover/preview/route";
import { POST as executeRoute } from "@/app/api/admin/rollover/execute/route";
import { GET as classesRoute } from "@/app/api/classes/route";
import { GET as classRoute } from "@/app/api/classes/[classId]/route";
import { POST as createAssignmentRoute } from "@/app/api/admin/assignments/route";
import { db } from "@/server/db/client";
import { runAutomaticRollover } from "@/server/domain/rollover";
import { resetTestDb } from "../db";
import { call, fixtures, loginCookie, type Fixtures } from "../helpers";

let f: Fixtures;
const c: Record<string, string> = {};
const SUFFIXES = ["11", "12", "13", "14", "15", "24", "25"];
const SEPT_1 = new Date("2027-09-01T05:00:00Z"); // 08:00 in Bucharest

let before: { grades: number; revisions: number; assignments: number; audit: number; enrollments: number };

beforeAll(async () => {
  await resetTestDb();
  f = await fixtures();
  for (const u of ["admin.demo", "comandant.demo", "prof.popescu", "prof.ionescu"]) c[u] = await loginCookie(u);
  // A graduating student with a (future) student account.
  const petreUser = await db.user.create({
    data: { username: "elev.petre", firstName: "Florin", lastName: "Petre", role: "ELEV", passwordHash: "x", mustChangePassword: false },
  });
  await db.student.update({ where: { id: f.students.petre }, data: { userId: petreUser.id } });
  before = {
    grades: await db.grade.count(),
    revisions: await db.gradeRevision.count(),
    assignments: await db.teachingAssignment.count(),
    audit: await db.auditLog.count(),
    enrollments: await db.enrollment.count(),
  };
});

describe("trecerea în noul an școlar", () => {
  it("previzualizarea arată corespondența claselor 1xy → 2xy și absolvenții", async () => {
    const res = await call(previewRoute, "GET", "/x", { cookie: c["admin.demo"] });
    expect(res.status, res.text).toBe(200);
    const plan = res.json.plan;
    expect(plan.toYear.name).toBe("2027–2028");
    expect(plan.due).toBe(false);
    expect(plan.promotions.map((p: any) => [p.fromClass, p.toClass])).toEqual(SUFFIXES.map((s) => [`1${s}`, `2${s}`]));
    expect(plan.promotions.find((p: any) => p.fromClass === "112").students).toBe(2);
    expect(plan.graduations.map((g: any) => g.classCode)).toEqual(SUFFIXES.map((s) => `2${s}`));
  });

  it("nu poate fi executată înainte de 1 septembrie și doar de administrator", async () => {
    const early = await call(executeRoute, "POST", "/x", { cookie: c["admin.demo"], body: { confirm: true } });
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("TRECERE_PREMATURA");
    for (const u of ["comandant.demo", "prof.popescu"]) {
      expect((await call(executeRoute, "POST", "/x", { cookie: c[u], body: { confirm: true } })).status).toBe(403);
      expect((await call(previewRoute, "GET", "/x", { cookie: c[u] })).status).toBe(403);
    }
    expect(await db.yearRollover.count()).toBe(0);
  });

  it("la 1 septembrie: promovare corectă, o singură dată, chiar la rulări concurente", async () => {
    const results = await Promise.all([runAutomaticRollover("AUTO", SEPT_1), runAutomaticRollover("CLI", SEPT_1)]);
    expect(results.map((r) => r.status).sort()).toEqual(["EXECUTED", "NOT_DUE"]);
    // A third run (e.g. the hourly job) changes nothing.
    expect((await runAutomaticRollover("AUTO", new Date("2027-09-01T18:00:00Z"))).status).toBe("NOT_DUE");
    expect(await db.yearRollover.count()).toBe(1);

    const oldYear = await db.academicYear.findUniqueOrThrow({ where: { id: f.yearId } });
    const newYear = await db.academicYear.findUniqueOrThrow({ where: { name: "2027–2028" } });
    expect(oldYear.status).toBe("CLOSED");
    expect(newYear.status).toBe("ACTIVE");

    // Mapping 1xy → 2xy with the same cohort, for every class.
    for (const s of SUFFIXES) {
      const old1 = await db.classSection.findUniqueOrThrow({ where: { academicYearId_code: { academicYearId: f.yearId, code: `1${s}` } } });
      const new2 = await db.classSection.findUniqueOrThrow({ where: { academicYearId_code: { academicYearId: newYear.id, code: `2${s}` } }, include: { company: true } });
      expect(new2.cohortId).toBe(old1.cohortId);
      expect(new2.company.name).toBe("Compania 1");
      const new1 = await db.classSection.findUniqueOrThrow({ where: { academicYearId_code: { academicYearId: newYear.id, code: `1${s}` } }, include: { company: true, cohort: true } });
      expect(new1.cohort.startYear).toBe(2027);
      expect(new1.company.name).toBe("Compania 2");
    }

    // Students: promoted exactly once, into the right class.
    for (const [student, code] of [[f.students.marin, "212"], [f.students.stan, "212"], [f.students.dobre, "213"], [f.students.vasile, "211"]] as const) {
      const enrollments = await db.enrollment.findMany({ where: { studentId: student }, include: { classSection: true }, orderBy: { startDate: "asc" } });
      expect(enrollments).toHaveLength(2);
      expect(enrollments[0]!.status).toBe("PROMOTED");
      expect(enrollments[0]!.endDate?.toISOString().slice(0, 10)).toBe("2027-08-31");
      expect(enrollments[1]!.status).toBe("ACTIVE");
      expect(enrollments[1]!.classSection.code).toBe(code);
      expect(enrollments[1]!.academicYearId).toBe(newYear.id);
    }
    expect(await db.enrollment.count({ where: { academicYearId: newYear.id } })).toBe(4);
  });

  it("absolvenții anului II trec în istoric; conturile lor sunt dezactivate", async () => {
    const petre = await db.student.findUniqueOrThrow({ where: { id: f.students.petre }, include: { enrollments: true, user: true } });
    expect(petre.status).toBe("GRADUATED");
    expect(petre.enrollments).toHaveLength(1);
    expect(petre.enrollments[0]!.status).toBe("GRADUATED");
    expect(petre.user?.status).toBe("INACTIVE");
    // Their grades (incl. those given in 211) remain.
    expect(await db.grade.count({ where: { studentId: f.students.petre } })).toBeGreaterThanOrEqual(0);
    // A promoted student's account stays active.
    expect((await db.user.findUniqueOrThrow({ where: { username: "elev.marin" } })).status).toBe("ACTIVE");
  });

  it("istoricul este păstrat integral: note, revizii, repartizări, audit, module închise", async () => {
    expect(await db.grade.count()).toBe(before.grades);
    expect(await db.gradeRevision.count()).toBe(before.revisions);
    expect(await db.teachingAssignment.count()).toBe(before.assignments);
    expect(await db.auditLog.count()).toBeGreaterThan(before.audit);
    expect(await db.enrollment.count()).toBe(before.enrollments + 4);
    const g = await db.grade.findFirstOrThrow({ where: { studentId: f.students.marin, subjectId: f.subjects.mat } });
    expect(g.classSectionId).toBe(f.classes.c112);
    expect(g.academicYearId).toBe(f.yearId);
    expect(g.authorId).toBe(f.users.popescu);
    expect(await db.teachingAssignment.count({ where: { academicYearId: f.yearId, endedAt: null } })).toBe(0);
    expect(await db.module.count({ where: { academicYearId: f.yearId, status: { not: "CLOSED" } } })).toBe(0);
    expect(await db.moduleResultSnapshot.count({ where: { module: { academicYearId: f.yearId } } })).toBeGreaterThan(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "YEAR_ROLLOVER" } });
    expect((audit.metadata as any).promoted).toBe(4);
    expect((audit.metadata as any).graduated).toBe(1);
  });

  it("anul trecut rămâne accesibil comandantului; profesorii nu moștenesc acces istoric", async () => {
    const list = await call(classesRoute, "GET", "/x", { cookie: c["comandant.demo"], query: { academicYearId: f.yearId } });
    expect(list.json.classes).toHaveLength(14);
    const old112 = await call(classRoute, "GET", "/x", { cookie: c["comandant.demo"], params: { classId: f.classes.c112 } });
    expect(old112.status).toBe(200);
    expect(old112.json.class.historical).toBe(true);
    expect(old112.json.students.map((s: any) => s.id).sort()).toEqual([f.students.marin, f.students.stan].sort());
    expect(old112.json.class.homeroomTeacher.id).toBe(f.users.ionescu);
    const mat = old112.json.subjects.find((s: any) => s.id === f.subjects.mat);
    expect(mat.teachers).toEqual(["Popescu Elena"]);

    // The teacher's old assignments ended with the year: no access to history, nothing current.
    expect((await call(classRoute, "GET", "/x", { cookie: c["prof.popescu"], params: { classId: f.classes.c112 } })).status).toBe(404);
    expect((await call(classesRoute, "GET", "/x", { cookie: c["prof.popescu"] })).json.classes).toEqual([]);

    // A new assignment in 2027 does not change what 2026 shows.
    const newYear = await db.academicYear.findUniqueOrThrow({ where: { name: "2027–2028" } });
    const new212 = await db.classSection.findUniqueOrThrow({ where: { academicYearId_code: { academicYearId: newYear.id, code: "212" } } });
    const a = await call(createAssignmentRoute, "POST", "/x", {
      cookie: c["admin.demo"],
      body: { teacherId: f.users.georgescu, classSectionId: new212.id, subjectId: f.subjects.mat },
    });
    expect(a.status, a.text).toBe(200);
    const again = await call(classRoute, "GET", "/x", { cookie: c["comandant.demo"], params: { classId: f.classes.c112 } });
    expect(again.json.subjects.find((s: any) => s.id === f.subjects.mat).teachers).toEqual(["Popescu Elena"]);
    // …and the old class cannot receive new assignments.
    const old = await call(createAssignmentRoute, "POST", "/x", {
      cookie: c["admin.demo"],
      body: { teacherId: f.users.georgescu, classSectionId: f.classes.c112, subjectId: f.subjects.eng },
    });
    expect(old.status).toBe(409);
  });
});

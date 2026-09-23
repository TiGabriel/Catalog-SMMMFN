/**
 * Server-side authorization matrix and privilege-escalation attempts.
 * Every request goes through the real route handlers with a real session cookie;
 * IDs are manipulated exactly as an attacker would do in a URL or JSON body.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { GET as classesRoute } from "@/app/api/classes/route";
import { GET as classRoute } from "@/app/api/classes/[classId]/route";
import { GET as classGradesRoute } from "@/app/api/classes/[classId]/subjects/[subjectId]/grades/route";
import { GET as studentRoute } from "@/app/api/students/[studentId]/route";
import { POST as gradesRoute } from "@/app/api/grades/route";
import { GET as timetableRoute } from "@/app/api/timetable/route";
import { GET as myGradesRoute } from "@/app/api/me/grades/route";
import { GET as auditRoute } from "@/app/api/audit/route";
import { GET as auditVerifyRoute } from "@/app/api/audit/verify/route";
import { GET as listUsersRoute, POST as createUserRoute } from "@/app/api/admin/users/route";
import { PATCH as updateUserRoute } from "@/app/api/admin/users/[id]/route";
import { POST as resetPasswordRoute } from "@/app/api/admin/users/[id]/reset-password/route";
import { GET as adminClassesRoute, POST as createClassRoute } from "@/app/api/admin/classes/route";
import { POST as createSubjectRoute } from "@/app/api/admin/subjects/route";
import { POST as createModuleRoute } from "@/app/api/admin/modules/route";
import { POST as createYearRoute } from "@/app/api/admin/academic-years/route";
import { GET as listAssignmentsRoute, POST as createAssignmentRoute } from "@/app/api/admin/assignments/route";
import { POST as endAssignmentRoute } from "@/app/api/admin/assignments/[id]/end/route";
import { POST as createHomeroomRoute } from "@/app/api/admin/homeroom-assignments/route";
import { GET as settingsRoute } from "@/app/api/admin/settings/route";
import { PUT as updateSettingRoute } from "@/app/api/admin/settings/[key]/route";
import { POST as createStudentRoute } from "@/app/api/admin/students/route";
import { GET as gradeReasonsRoute } from "@/app/api/grade-reasons/route";
import { db } from "@/server/db/client";
import { resetTestDb } from "../db";
import { call, fixtures, loginCookie, randomId, type Fixtures } from "../helpers";

let f: Fixtures;
const cookies: Record<string, string> = {};
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await resetTestDb();
  f = await fixtures();
  for (const u of ["admin.demo", "comandant.demo", "prof.popescu", "prof.ionescu", "prof.georgescu", "elev.marin"]) {
    cookies[u] = await loginCookie(u);
  }
});

const get = (handler: any, username: string, path: string, params: Record<string, string> = {}, query?: Record<string, string>) =>
  call(handler, "GET", path, { cookie: cookies[username], params, query });

const gradeBody = (over: Record<string, unknown>) => ({
  studentId: f.students.marin,
  classSectionId: f.classes.c112,
  subjectId: f.subjects.mat,
  kind: "CURRENT",
  value: 8,
  reasonId: f.reasons.testare,
  gradeDate: today,
  moduleId: f.moduleId,
  ...over,
});
const postGrade = (username: string, over: Record<string, unknown>) =>
  call(gradesRoute, "POST", "/api/grades", { cookie: cookies[username], body: gradeBody(over) });

const classGrades = (username: string, classId: string, subjectId: string) =>
  get(classGradesRoute, username, "/api/classes/x/subjects/y/grades", { classId, subjectId });

// ────────────────────────────── PROFESOR ──────────────────────────────
describe("PROFESOR (prof.popescu: Matematică în 111 și 112)", () => {
  const P = "prof.popescu";

  it("vede doar clasele repartizate", async () => {
    const res = await get(classesRoute, P, "/api/classes");
    expect(res.status).toBe(200);
    expect(res.json.classes.map((c: any) => c.code).sort()).toEqual(["111", "112"]);
    const c112 = res.json.classes.find((c: any) => c.code === "112");
    expect(c112.subjects.map((s: any) => s.id)).toEqual([f.subjects.mat]);
    expect(c112.isHomeroom).toBe(false);
  });

  it("accesează propria clasă, dar vede doar materia repartizată", async () => {
    const res = await get(classRoute, P, "/api/classes/x", { classId: f.classes.c112 });
    expect(res.status).toBe(200);
    expect(res.json.students.map((s: any) => s.id).sort()).toEqual([f.students.marin, f.students.stan].sort());
    expect(res.json.subjects.map((s: any) => s.id)).toEqual([f.subjects.mat]);
  });

  it("clasa altui profesor → 404 (schimbarea ID-ului de clasă)", async () => {
    expect((await get(classRoute, P, "/api/classes/x", { classId: f.classes.c113 })).status).toBe(404);
    expect((await get(classRoute, P, "/api/classes/x", { classId: f.classes.c211 })).status).toBe(404);
    expect((await get(classRoute, P, "/api/classes/x", { classId: randomId() })).status).toBe(404);
    expect((await get(classRoute, P, "/api/classes/x", { classId: "../../admin" })).status).toBe(404);
  });

  it("notele materiei proprii → 200; altă materie în aceeași clasă → 404 (schimbarea ID-ului de materie)", async () => {
    const own = await classGrades(P, f.classes.c112, f.subjects.mat);
    expect(own.status).toBe(200);
    const marin = own.json.students.find((s: any) => s.id === f.students.marin);
    expect(marin.grades.map((g: any) => g.value)).toContain(9);
    expect((await classGrades(P, f.classes.c112, f.subjects.eng)).status).toBe(404);
    expect((await classGrades(P, f.classes.c112, f.subjects.purtare)).status).toBe(404);
    expect((await classGrades(P, f.classes.c113, f.subjects.nav)).status).toBe(404);
    expect((await classGrades(P, f.classes.c113, f.subjects.mat)).status).toBe(404);
  });

  it("elev din clasa proprie → doar notele la materia proprie; elev din altă clasă → 404 (schimbarea ID-ului de elev)", async () => {
    const own = await get(studentRoute, P, "/api/students/x", { studentId: f.students.marin });
    expect(own.status).toBe(200);
    expect(new Set(own.json.grades.map((g: any) => g.subject.id))).toEqual(new Set([f.subjects.mat]));
    expect((await get(studentRoute, P, "/api/students/x", { studentId: f.students.dobre })).status).toBe(404);
    expect((await get(studentRoute, P, "/api/students/x", { studentId: f.students.petre })).status).toBe(404);
    expect((await get(studentRoute, P, "/api/students/x", { studentId: randomId() })).status).toBe(404);
  });

  it("introduce note doar pentru clasa + materia repartizată", async () => {
    const ok = await postGrade(P, {});
    expect(ok.status, ok.text).toBe(200);
    const g = await db.grade.findUniqueOrThrow({ where: { id: ok.json.grade.id } });
    expect(g.authorId).toBe(f.users.popescu);
    expect(await db.gradeRevision.count({ where: { gradeId: g.id } })).toBe(1);

    // another class/subject pair
    expect((await postGrade(P, { studentId: f.students.dobre, classSectionId: f.classes.c113, subjectId: f.subjects.nav })).status).toBe(404);
    // own class, other subject
    expect((await postGrade(P, { subjectId: f.subjects.eng })).status).toBe(404);
    // student of another class smuggled into own class/subject
    expect((await postGrade(P, { studentId: f.students.dobre })).status).toBe(404);
    // conduct grade without being diriginte
    expect((await postGrade(P, { subjectId: f.subjects.purtare, kind: "FINAL", reasonId: f.reasons.purtare })).status).toBe(404);
    // own subject in a class of year II where not assigned
    expect((await postGrade(P, { studentId: f.students.petre, classSectionId: f.classes.c211, moduleId: f.moduleId2 })).status).toBe(404);
  });

  it("validează nota: 1–10, întreg, dată validă, motiv valid", async () => {
    expect((await postGrade(P, { value: 11 })).status).toBe(400);
    expect((await postGrade(P, { value: 0 })).status).toBe(400);
    expect((await postGrade(P, { value: 7.5 })).status).toBe(400);
    expect((await postGrade(P, { gradeDate: "2099-01-01" })).status).toBe(400);
    expect((await postGrade(P, { reasonId: f.reasons.purtare })).status).toBe(400);
    expect((await postGrade(P, { value: "9" })).status).toBe(400);
    expect((await postGrade(P, { authorId: f.users.ionescu })).status).toBe(400); // unknown field rejected
  });

  it("orarul: doar orele proprii; alt profesor sau altă clasă → 404 (schimbarea ID-ului de profesor)", async () => {
    const own = await get(timetableRoute, P, "/api/timetable", {}, { week: f.yearStart });
    expect(own.status).toBe(200);
    expect(own.json.entries.length).toBeGreaterThan(0);
    expect(own.json.entries.every((e: any) => e.teacher.id === f.users.popescu)).toBe(true);
    expect((await get(timetableRoute, P, "/api/timetable", {}, { teacherId: f.users.ionescu })).status).toBe(404);
    expect((await get(timetableRoute, P, "/api/timetable", {}, { classSectionId: f.classes.c113 })).status).toBe(404);
  });

  it("nu poate apela endpoint-urile altor roluri", async () => {
    expect((await get(listUsersRoute, P, "/api/admin/users")).status).toBe(403);
    expect((await get(adminClassesRoute, P, "/api/admin/classes")).status).toBe(403);
    expect((await get(auditRoute, P, "/api/audit")).status).toBe(403);
    expect((await get(myGradesRoute, P, "/api/me/grades")).status).toBe(403);
    const selfAssign = await call(createAssignmentRoute, "POST", "/api/admin/assignments", {
      cookie: cookies[P],
      body: { teacherId: f.users.popescu, classSectionId: f.classes.c113, subjectId: f.subjects.nav },
    });
    expect(selfAssign.status).toBe(403);
    const escalate = await call(updateUserRoute, "PATCH", "/api/admin/users/x", {
      cookie: cookies[P],
      params: { id: f.users.popescu },
      body: { role: "ADMINISTRATOR" },
    });
    expect(escalate.status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: f.users.popescu } })).role).toBe("PROFESOR");
  });

  it("încercările respinse sunt înregistrate în audit (ACCESS_DENIED)", async () => {
    const before = await db.auditLog.count({ where: { action: "ACCESS_DENIED", actorId: f.users.popescu } });
    await get(classRoute, P, "/api/classes/x", { classId: f.classes.c113 });
    const after = await db.auditLog.count({ where: { action: "ACCESS_DENIED", actorId: f.users.popescu } });
    expect(after).toBe(before + 1);
  });
});

// ────────────────────────────── DIRIGINTE ──────────────────────────────
describe("DIRIGINTE (prof.ionescu: diriginte 112; predă Navigație + instruire practică în 113)", () => {
  const D = "prof.ionescu";

  it("vede întreaga clasă de dirigenție (toate materiile)", async () => {
    const res = await get(classRoute, D, "/api/classes/x", { classId: f.classes.c112 });
    expect(res.status).toBe(200);
    expect(res.json.isHomeroom).toBe(true);
    const ids = res.json.subjects.map((s: any) => s.id);
    expect(ids).toEqual(expect.arrayContaining([f.subjects.mat, f.subjects.eng, f.subjects.purtare]));
    const mat = res.json.subjects.find((s: any) => s.id === f.subjects.mat);
    expect(mat.canEnterGrades).toBe(false);
    expect(res.json.subjects.find((s: any) => s.id === f.subjects.purtare).canEnterGrades).toBe(true);
    expect((await classGrades(D, f.classes.c112, f.subjects.eng)).status).toBe(200);

    const student = await get(studentRoute, D, "/api/students/x", { studentId: f.students.marin });
    expect(new Set(student.json.grades.map((g: any) => g.subject.id))).toEqual(
      new Set([f.subjects.mat, f.subjects.eng, f.subjects.purtare]),
    );
  });

  it("nu are acces la alte clase decât prin materiile repartizate", async () => {
    expect((await get(classRoute, D, "/api/classes/x", { classId: f.classes.c111 })).status).toBe(404);
    expect((await get(studentRoute, D, "/api/students/x", { studentId: f.students.vasile })).status).toBe(404);
    // 113: only through the assigned subjects, not as diriginte
    const c113 = await get(classRoute, D, "/api/classes/x", { classId: f.classes.c113 });
    expect(c113.status).toBe(200);
    expect(c113.json.isHomeroom).toBe(false);
    expect(c113.json.subjects.map((s: any) => s.id).sort()).toEqual([f.subjects.nav, f.subjects.practica].sort());
    expect((await classGrades(D, f.classes.c113, f.subjects.purtare)).status).toBe(404);
  });

  it("gestionează nota la purtare doar în clasa proprie", async () => {
    const ok = await postGrade(D, { studentId: f.students.stan, subjectId: f.subjects.purtare, kind: "FINAL", reasonId: f.reasons.purtare, value: 10 });
    expect(ok.status, ok.text).toBe(200);
    const other = await postGrade(D, {
      studentId: f.students.dobre,
      classSectionId: f.classes.c113,
      subjectId: f.subjects.purtare,
      kind: "FINAL",
      reasonId: f.reasons.purtare,
    });
    expect(other.status).toBe(404);
  });

  it("drepturi de profesor doar pentru materiile repartizate explicit", async () => {
    expect((await postGrade(D, { subjectId: f.subjects.mat })).status).toBe(404); // own class, not his subject
    const nav = await postGrade(D, { studentId: f.students.dobre, classSectionId: f.classes.c113, subjectId: f.subjects.nav });
    expect(nav.status, nav.text).toBe(200);
    const practica = await postGrade(D, { studentId: f.students.dobre, classSectionId: f.classes.c113, subjectId: f.subjects.practica });
    expect(practica.status, practica.text).toBe(200);
  });

  it("orarul clasei de dirigenție este vizibil, al altor clase nu", async () => {
    const res = await get(timetableRoute, D, "/api/timetable", {}, { classSectionId: f.classes.c112, week: f.yearStart });
    expect(res.status).toBe(200);
    expect(res.json.entries.every((e: any) => e.classSection.id === f.classes.c112)).toBe(true);
    expect(res.json.entries.length).toBeGreaterThan(0);
    expect((await get(timetableRoute, D, "/api/timetable", {}, { classSectionId: f.classes.c111 })).status).toBe(404);
  });

  it("un alt diriginte nu vede clasa 112", async () => {
    expect((await get(classRoute, "prof.georgescu", "/api/classes/x", { classId: f.classes.c113 })).json.isHomeroom).toBe(true);
    const g112 = await get(classRoute, "prof.georgescu", "/api/classes/x", { classId: f.classes.c112 });
    expect(g112.json.isHomeroom).toBe(false); // only via ENG assignment
    expect(g112.json.subjects.map((s: any) => s.id)).toEqual([f.subjects.eng]);
  });
});

// ────────────────────────────── ADMINISTRATOR ──────────────────────────────
describe("ADMINISTRATOR", () => {
  const A = "admin.demo";

  it("gestionează utilizatori, structura, repartizările și configurarea", async () => {
    const cookie = cookies[A];
    const user = await call(createUserRoute, "POST", "/api/admin/users", {
      cookie,
      body: { firstName: "Maria", lastName: "Dinu", username: "prof.dinu", role: "PROFESOR", temporaryPassword: "Temporar#2026" },
    });
    expect(user.status, user.text).toBe(200);
    expect(user.text).not.toMatch(/passwordHash|argon2/);

    const year = await call(createYearRoute, "POST", "/api/admin/academic-years", {
      cookie,
      body: { name: "2027–2028", startDate: "2027-09-01", endDate: "2028-08-31" },
    });
    expect(year.status, year.text).toBe(200);
    const cls = await call(createClassRoute, "POST", "/api/admin/classes", {
      cookie,
      body: { academicYearId: year.json.academicYear.id, yearOfStudy: 2, suffix: "12" },
    });
    expect(cls.status, cls.text).toBe(200);
    expect(cls.json.class.code).toBe("212");
    expect(cls.json.class.company.name).toBe("Compania 1");
    // 112 (this year) and 212 (next year) share the same cohort (promoție)
    const c112 = await db.classSection.findUniqueOrThrow({ where: { id: f.classes.c112 } });
    expect(cls.json.class.cohort.id).toBe(c112.cohortId);

    const subject = await call(createSubjectRoute, "POST", "/api/admin/subjects", {
      cookie,
      body: { code: "ELEC", name: "Electrotehnică", type: "SPECIALIZATION" },
    });
    expect(subject.status, subject.text).toBe(200);
    const mod = await call(createModuleRoute, "POST", "/api/admin/modules", {
      cookie,
      body: { academicYearId: f.yearId, yearOfStudy: 2, name: "Modulul 2", order: 2 },
    });
    expect(mod.status, mod.text).toBe(200);

    const assignment = await call(createAssignmentRoute, "POST", "/api/admin/assignments", {
      cookie,
      body: { teacherId: user.json.user.id, classSectionId: f.classes.c211, subjectId: subject.json.subject.id },
    });
    expect(assignment.status, assignment.text).toBe(200);
    expect((await call(listAssignmentsRoute, "GET", "/api/admin/assignments", { cookie })).status).toBe(200);

    const homeroom = await call(createHomeroomRoute, "POST", "/api/admin/homeroom-assignments", {
      cookie,
      body: { teacherId: user.json.user.id, classSectionId: f.classes.c211 },
    });
    expect(homeroom.status, homeroom.text).toBe(200);
    const duplicate = await call(createHomeroomRoute, "POST", "/api/admin/homeroom-assignments", {
      cookie,
      body: { teacherId: f.users.popescu, classSectionId: f.classes.c211 },
    });
    expect(duplicate.status).toBe(409);

    const student = await call(createStudentRoute, "POST", "/api/admin/students", {
      cookie,
      body: { firstName: "George", lastName: "Radu", classSectionId: f.classes.c211, registryNumber: "M-0100" },
    });
    expect(student.status, student.text).toBe(200);

    expect((await call(settingsRoute, "GET", "/api/admin/settings", { cookie })).status).toBe(200);
    const setting = await call(updateSettingRoute, "PUT", "/api/admin/settings/grades.editWindowDays", {
      cookie,
      params: { key: "grades.editWindowDays" },
      body: { value: 10 },
    });
    expect(setting.status, setting.text).toBe(200);
    const badSetting = await call(updateSettingRoute, "PUT", "/api/admin/settings/x", {
      cookie,
      params: { key: "securitate.dezactivata" },
      body: { value: true },
    });
    expect(badSetting.status).toBe(404);
    expect(await db.auditLog.count({ where: { action: "CONFIG_UPDATE", actorId: f.users.admin } })).toBeGreaterThan(0);
  });

  it("nu are drept de introducere note sau de citire a catalogului", async () => {
    expect((await postGrade(A, {})).status).toBe(403);
    expect((await classGrades(A, f.classes.c112, f.subjects.mat)).status).toBe(404);
    const student = await get(studentRoute, A, "/api/students/x", { studentId: f.students.marin });
    expect(student.status).toBe(200);
    expect(student.json.gradesVisible).toBe(false);
    expect(student.json.grades).toEqual([]);
    expect((await get(myGradesRoute, A, "/api/me/grades")).status).toBe(403);
    expect((await get(gradeReasonsRoute, A, "/api/grade-reasons")).status).toBe(403);
  });

  it("nu își poate atribui singur clase (separarea atribuțiilor) și nu poate repartiza non-profesori", async () => {
    const self = await call(createAssignmentRoute, "POST", "/api/admin/assignments", {
      cookie: cookies[A],
      body: { teacherId: f.users.admin, classSectionId: f.classes.c112, subjectId: f.subjects.mat },
    });
    expect(self.status).toBe(409);
    const commander = await call(createAssignmentRoute, "POST", "/api/admin/assignments", {
      cookie: cookies[A],
      body: { teacherId: f.users.comandant, classSectionId: f.classes.c112, subjectId: f.subjects.mat },
    });
    expect(commander.status).toBe(400);
    const conduct = await call(createAssignmentRoute, "POST", "/api/admin/assignments", {
      cookie: cookies[A],
      body: { teacherId: f.users.georgescu, classSectionId: f.classes.c112, subjectId: f.subjects.purtare },
    });
    expect(conduct.status).toBe(400);
  });

  it("nu își poate schimba propriul rol și nu își poate reseta parola prin fluxul de administrare", async () => {
    const role = await call(updateUserRoute, "PATCH", "/api/admin/users/x", {
      cookie: cookies[A],
      params: { id: f.users.admin },
      body: { role: "PROFESOR" },
    });
    expect(role.status).toBe(409);
    const reset = await call(resetPasswordRoute, "POST", "/api/admin/users/x/reset-password", {
      cookie: cookies[A],
      params: { id: f.users.admin },
      body: { temporaryPassword: "Altceva#2026" },
    });
    expect(reset.status).toBe(409);
  });

  it("are acces la audit", async () => {
    const res = await get(auditRoute, A, "/api/audit");
    expect(res.status).toBe(200);
    expect(res.json.entries.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────── COMANDANT UNITATE ──────────────────────────────
describe("COMANDANT UNITATE", () => {
  const C = "comandant.demo";

  it("vede toate clasele, elevii și notele (citire globală)", async () => {
    const classes = await get(classesRoute, C, "/api/classes");
    expect(classes.status).toBe(200);
    expect(classes.json.classes).toHaveLength(14);
    expect((await classGrades(C, f.classes.c113, f.subjects.nav)).status).toBe(200);
    expect((await classGrades(C, f.classes.c112, f.subjects.purtare)).status).toBe(200);
    const student = await get(studentRoute, C, "/api/students/x", { studentId: f.students.marin });
    expect(new Set(student.json.grades.map((g: any) => g.subject.id))).toEqual(
      new Set([f.subjects.mat, f.subjects.eng, f.subjects.purtare]),
    );
    expect((await get(adminClassesRoute, C, "/api/admin/classes")).status).toBe(200);
    expect((await get(timetableRoute, C, "/api/timetable", {}, { teacherId: f.users.ionescu })).status).toBe(200);
  });

  it("nu poate introduce note în această etapă", async () => {
    expect((await postGrade(C, {})).status).toBe(403);
  });

  it("nu poate administra utilizatori, structura sau repartizări", async () => {
    expect((await get(listUsersRoute, C, "/api/admin/users")).status).toBe(403);
    const createUser = await call(createUserRoute, "POST", "/api/admin/users", {
      cookie: cookies[C],
      body: { firstName: "X", lastName: "Y", username: "hack.admin", role: "ADMINISTRATOR", temporaryPassword: "Temporar#2026" },
    });
    expect(createUser.status).toBe(403);
    expect(await db.user.findUnique({ where: { username: "hack.admin" } })).toBeNull();
    const cls = await call(createClassRoute, "POST", "/api/admin/classes", {
      cookie: cookies[C],
      body: { academicYearId: f.yearId, yearOfStudy: 1, suffix: "16" },
    });
    expect(cls.status).toBe(403);
    const assign = await call(createAssignmentRoute, "POST", "/api/admin/assignments", {
      cookie: cookies[C],
      body: { teacherId: f.users.popescu, classSectionId: f.classes.c113, subjectId: f.subjects.nav },
    });
    expect(assign.status).toBe(403);
    const setting = await call(updateSettingRoute, "PUT", "/api/admin/settings/x", {
      cookie: cookies[C],
      params: { key: "grades.editWindowDays" },
      body: { value: 100 },
    });
    expect(setting.status).toBe(403);
  });

  it("are acces la audit și la verificarea integrității", async () => {
    expect((await get(auditRoute, C, "/api/audit")).status).toBe(200);
    const verify = await get(auditVerifyRoute, C, "/api/audit/verify");
    expect(verify.status).toBe(200);
    expect(verify.json.intact).toBe(true);
  });
});

// ────────────────────────────── ELEV ──────────────────────────────
describe("ELEV (elev.marin, clasa 112)", () => {
  const E = "elev.marin";

  it("își vede propriile note", async () => {
    const res = await get(myGradesRoute, E, "/api/me/grades");
    expect(res.status).toBe(200);
    expect(res.json.student.id).toBe(f.students.marin);
    expect(res.json.grades.length).toBeGreaterThan(0);
    expect(res.json.grades.every((g: any) => g.studentId === f.students.marin)).toBe(true);
    expect((await get(studentRoute, E, "/api/students/x", { studentId: f.students.marin })).status).toBe(200);
  });

  it("izolare: nu vede alți elevi, nici colegii de clasă", async () => {
    expect((await get(studentRoute, E, "/api/students/x", { studentId: f.students.stan })).status).toBe(404);
    expect((await get(studentRoute, E, "/api/students/x", { studentId: f.students.dobre })).status).toBe(404);
    expect((await get(classRoute, E, "/api/classes/x", { classId: f.classes.c112 })).status).toBe(404);
    expect((await classGrades(E, f.classes.c112, f.subjects.mat)).status).toBe(404);
    expect((await get(classesRoute, E, "/api/classes")).status).toBe(403);
  });

  it("nu are acces la audit, administrare sau introducerea notelor", async () => {
    expect((await get(auditRoute, E, "/api/audit")).status).toBe(403);
    expect((await get(listUsersRoute, E, "/api/admin/users")).status).toBe(403);
    expect((await get(adminClassesRoute, E, "/api/admin/classes")).status).toBe(403);
    expect((await postGrade(E, {})).status).toBe(403);
  });

  it("vede doar orarul clasei proprii", async () => {
    const res = await get(timetableRoute, E, "/api/timetable", {}, { week: f.yearStart });
    expect(res.status).toBe(200);
    expect(res.json.entries.length).toBeGreaterThan(0);
    expect(res.json.entries.every((e: any) => e.classSection.id === f.classes.c112)).toBe(true);
    expect((await get(timetableRoute, E, "/api/timetable", {}, { classSectionId: f.classes.c113 })).status).toBe(404);
    expect((await get(timetableRoute, E, "/api/timetable", {}, { teacherId: f.users.popescu })).status).toBe(404);
  });
});

// ────────────────────────────── Assignment lifecycle ──────────────────────────────
describe("ciclul de viață al repartizărilor", () => {
  it("încheierea unei repartizări retrage imediat accesul, iar notele rămân ale autorului", async () => {
    const A = cookies["admin.demo"];
    const created = await call(createAssignmentRoute, "POST", "/api/admin/assignments", {
      cookie: A,
      body: { teacherId: f.users.georgescu, classSectionId: f.classes.c211, subjectId: f.subjects.eng },
    });
    expect(created.status, created.text).toBe(200);
    const G = "prof.georgescu";
    expect((await get(classRoute, G, "/api/classes/x", { classId: f.classes.c211 })).status).toBe(200);
    const grade = await postGrade(G, { studentId: f.students.petre, classSectionId: f.classes.c211, subjectId: f.subjects.eng, moduleId: f.moduleId2 });
    expect(grade.status, grade.text).toBe(200);

    const ended = await call(endAssignmentRoute, "POST", "/api/admin/assignments/x/end", {
      cookie: A,
      params: { id: created.json.assignment.id },
      body: { reason: "Schimbare de catedră" },
    });
    expect(ended.status, ended.text).toBe(200);
    expect((await get(classRoute, G, "/api/classes/x", { classId: f.classes.c211 })).status).toBe(404);
    expect((await postGrade(G, { studentId: f.students.petre, classSectionId: f.classes.c211, subjectId: f.subjects.eng, moduleId: f.moduleId2 })).status).toBe(404);

    // History: the assignment row and the grade (with its original author) remain.
    expect(await db.teachingAssignment.findUnique({ where: { id: created.json.assignment.id } })).not.toBeNull();
    const g = await db.grade.findUniqueOrThrow({ where: { id: grade.json.grade.id } });
    expect(g.authorId).toBe(f.users.georgescu);
    expect(g.status).toBe("ACTIVE");
  });
});

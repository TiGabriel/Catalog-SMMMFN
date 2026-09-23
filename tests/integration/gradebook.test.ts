/**
 * Gradebook core: grade lifecycle, special categories (conduct, practical training,
 * module exam), the correction workflow and module results – all through the real
 * route handlers with real sessions.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { POST as gradesRoute } from "@/app/api/grades/route";
import { GET as gradeRoute, PATCH as updateGradeRoute } from "@/app/api/grades/[gradeId]/route";
import { POST as deleteGradeRoute } from "@/app/api/grades/[gradeId]/delete/route";
import { GET as myGradesRoute } from "@/app/api/grades/mine/route";
import { GET as listCorrectionsRoute, POST as createCorrectionRoute } from "@/app/api/corrections/route";
import { POST as reviewRoute } from "@/app/api/corrections/[id]/review/route";
import { POST as cancelRoute } from "@/app/api/corrections/[id]/cancel/route";
import { GET as resultsRoute } from "@/app/api/classes/[classId]/modules/[moduleId]/results/route";
import { POST as createModuleRoute } from "@/app/api/admin/modules/route";
import { PATCH as updateModuleRoute } from "@/app/api/admin/modules/[id]/route";
import { POST as addModuleSubjectRoute, GET as listModuleSubjectsRoute } from "@/app/api/admin/modules/[id]/subjects/route";
import { DELETE as removeModuleSubjectRoute } from "@/app/api/admin/module-subjects/[id]/route";
import { POST as createAssignmentRoute } from "@/app/api/admin/assignments/route";
import { PUT as updateSettingRoute } from "@/app/api/admin/settings/[key]/route";
import { PATCH as updateStudentRoute } from "@/app/api/admin/students/[id]/route";
import { db } from "@/server/db/client";
import { resetTestDb } from "../db";
import { call, fixtures, loginCookie, type Fixtures } from "../helpers";

let f: Fixtures;
const c: Record<string, string> = {};
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await resetTestDb();
  f = await fixtures();
  for (const u of ["admin.demo", "comandant.demo", "prof.popescu", "prof.ionescu", "prof.georgescu", "elev.marin"]) c[u] = await loginCookie(u);
});

const base = () => ({
  studentId: f.students.marin,
  classSectionId: f.classes.c112,
  subjectId: f.subjects.mat,
  kind: "CURRENT",
  value: 7,
  reasonId: f.reasons.testare,
  gradeDate: today,
  moduleId: f.moduleId,
});
const post = (u: string, over: Record<string, unknown> = {}) =>
  call(gradesRoute, "POST", "/api/grades", { cookie: c[u], body: { ...base(), ...over } });
const patch = (u: string, id: string, body: Record<string, unknown>) =>
  call(updateGradeRoute, "PATCH", `/api/grades/${id}`, { cookie: c[u], params: { gradeId: id }, body });
const del = (u: string, id: string, body: Record<string, unknown>) =>
  call(deleteGradeRoute, "POST", `/api/grades/${id}/delete`, { cookie: c[u], params: { gradeId: id }, body });
const newGrade = async (u = "prof.popescu", over: Record<string, unknown> = {}) => {
  const res = await post(u, over);
  expect(res.status, res.text).toBe(200);
  return res.json.grade as { id: string; version: number };
};

describe("introducerea notelor", () => {
  it("profesorul introduce o notă validă (cu autor, modul, clasă, an, motiv, revizie și audit)", async () => {
    const g = await newGrade();
    const row = await db.grade.findUniqueOrThrow({ where: { id: g.id } });
    expect(row).toMatchObject({ authorId: f.users.popescu, moduleId: f.moduleId, classSectionId: f.classes.c112, academicYearId: f.yearId, status: "ACTIVE" });
    expect(Number(row.value)).toBe(7);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(await db.gradeRevision.count({ where: { gradeId: g.id, action: "CREATE" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "GRADE_CREATE", entityId: g.id } })).toBe(1);
  });

  it("note invalide sunt respinse", async () => {
    for (const over of [{ value: 0 }, { value: 11 }, { value: 9.5 }, { value: null }, { gradeDate: "2099-01-01" }, { gradeDate: "2020-01-01" }, { reasonId: f.reasons.purtare }]) {
      expect((await post("prof.popescu", over)).status, JSON.stringify(over)).toBe(400);
    }
    // moduleId is mandatory, and the module must belong to the class's year of study
    const noModule: Record<string, unknown> = base();
    delete noModule.moduleId;
    expect((await call(gradesRoute, "POST", "/api/grades", { cookie: c["prof.popescu"], body: noModule })).status).toBe(400);
    expect((await post("prof.popescu", { moduleId: f.moduleId2 })).status).toBe(400);
  });

  it("nu poate introduce note pentru altă clasă sau altă materie (manipularea cererii)", async () => {
    expect((await post("prof.popescu", { classSectionId: f.classes.c113, studentId: f.students.dobre, subjectId: f.subjects.nav })).status).toBe(404);
    expect((await post("prof.popescu", { classSectionId: f.classes.c113, studentId: f.students.dobre })).status).toBe(404);
    expect((await post("prof.popescu", { subjectId: f.subjects.eng })).status).toBe(404);
    expect((await post("prof.popescu", { studentId: f.students.dobre })).status).toBe(404);
    expect((await post("prof.popescu", { classSectionId: f.classes.c111, studentId: f.students.marin })).status).toBe(404);
  });

  it("un profesor inactiv nu mai poate acționa (sesiunile sunt refuzate)", async () => {
    // prof.inactiv cannot authenticate at all – covered in auth tests; its old assignment is ended.
    const ended = await db.teachingAssignment.findFirstOrThrow({ where: { teacherId: f.users.inactiv } });
    expect(ended.endedAt).not.toBeNull();
  });
});

describe("modificarea și ștergerea notelor", () => {
  it("modificarea cere motiv; păstrează valoarea veche în revizii și audit", async () => {
    const g = await newGrade();
    expect((await patch("prof.popescu", g.id, { value: 8, version: g.version })).status).toBe(400);
    expect((await patch("prof.popescu", g.id, { value: 8, version: g.version, changeReason: " " })).status).toBe(400);
    const ok = await patch("prof.popescu", g.id, { value: 8, version: g.version, changeReason: "Greșeală de transcriere" });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json.grade.value).toBe(8);

    const revisions = await db.gradeRevision.findMany({ where: { gradeId: g.id }, orderBy: { revisionNo: "asc" } });
    expect(revisions.map((r) => [r.action, Number(r.value)])).toEqual([["CREATE", 7], ["UPDATE", 8]]);
    expect(revisions[1]!.changeReason).toBe("Greșeală de transcriere");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "GRADE_UPDATE", entityId: g.id } });
    expect(audit).toMatchObject({ actorId: f.users.popescu, studentId: f.students.marin, classSectionId: f.classes.c112, subjectId: f.subjects.mat, reason: "Greșeală de transcriere" });
    expect((audit.before as any).value).toBe(7);
    expect((audit.after as any).value).toBe(8);
    expect((audit.metadata as any).moduleId).toBe(f.moduleId);
    expect(audit.userAgent).toBe("vitest");
    expect(audit.sessionRef).toMatch(/^[0-9a-f]{16}$/);
    expect(audit.requestId).toBeTruthy();
  });

  it("versiunea învechită este respinsă (fără suprascrieri silențioase)", async () => {
    const g = await newGrade();
    expect((await patch("prof.popescu", g.id, { value: 9, version: g.version, changeReason: "Prima modificare" })).status).toBe(200);
    expect((await patch("prof.popescu", g.id, { value: 10, version: g.version, changeReason: "Modificare concurentă" })).status).toBe(409);
  });

  it("ștergerea cere motiv, este logică (nu fizică) și creează audit", async () => {
    const g = await newGrade();
    expect((await del("prof.popescu", g.id, { version: g.version })).status).toBe(400);
    const ok = await del("prof.popescu", g.id, { version: g.version, reason: "Notă introdusă la elevul greșit" });
    expect(ok.status, ok.text).toBe(200);
    const row = await db.grade.findUniqueOrThrow({ where: { id: g.id } });
    expect(row).toMatchObject({ status: "DELETED", deletedById: f.users.popescu, deletionReason: "Notă introdusă la elevul greșit" });
    expect(row.deletedAt).toBeInstanceOf(Date);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "GRADE_DELETE", entityId: g.id } });
    expect(audit.reason).toBe("Notă introdusă la elevul greșit");
    expect((audit.before as any).value).toBe(7);
    // History remains visible, the grade no longer counts.
    const history = await call(gradeRoute, "GET", "/x", { cookie: c["prof.popescu"], params: { gradeId: g.id } });
    expect(history.json.grade.status).toBe("DELETED");
    expect(history.json.revisions.map((r: any) => r.action)).toEqual(["CREATE", "DELETE"]);
    expect((await patch("prof.popescu", g.id, { value: 5, version: row.version, changeReason: "Încercare" })).status).toBe(409);
  });

  it("un profesor nu poate modifica sau șterge nota altui profesor", async () => {
    const g = await newGrade("prof.popescu");
    // diriginte of 112 can SEE the grade but is not its author
    expect((await patch("prof.ionescu", g.id, { value: 3, version: g.version, changeReason: "Încercare" })).status).toBe(403);
    expect((await del("prof.ionescu", g.id, { version: g.version, reason: "Încercare" })).status).toBe(403);
    // another teacher who cannot even see it gets 404
    expect((await patch("prof.georgescu", g.id, { value: 3, version: g.version, changeReason: "Încercare" })).status).toBe(404);
    expect(Number((await db.grade.findUniqueOrThrow({ where: { id: g.id } })).value)).toBe(7);
  });

  it("după expirarea termenului de modificare este necesară cererea de corecție", async () => {
    const g = await newGrade();
    const set = (value: number) =>
      call(updateSettingRoute, "PUT", "/x", { cookie: c["admin.demo"], params: { key: "grades.editWindowDays" }, body: { value } });
    expect((await set(0)).status).toBe(200);
    try {
      const res = await patch("prof.popescu", g.id, { value: 9, version: g.version, changeReason: "Prea târziu" });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe("CORECTIE_NECESARA");
    } finally {
      await set(7);
    }
  });

  it("istoricul propriilor note", async () => {
    const res = await call(myGradesRoute, "GET", "/api/grades/mine", { cookie: c["prof.popescu"] });
    expect(res.status).toBe(200);
    expect(res.json.grades.length).toBeGreaterThan(0);
    expect(res.json.grades.every((g: any) => g.classSection.code === "112" || g.classSection.code === "111")).toBe(true);
    expect((await call(myGradesRoute, "GET", "/api/grades/mine", { cookie: c["comandant.demo"] })).status).toBe(403);
  });
});

describe("categorii speciale", () => {
  const conduct = (u: string, over: Record<string, unknown> = {}) =>
    post(u, { subjectId: f.subjects.purtare, kind: "FINAL", reasonId: f.reasons.purtare, value: 9, studentId: f.students.stan, ...over });

  it("purtarea: doar dirigintele clasei, o singură notă pe modul", async () => {
    expect((await conduct("prof.popescu")).status).toBe(404);
    expect((await conduct("prof.georgescu")).status).toBe(404); // diriginte of 113, not 112
    expect((await conduct("comandant.demo")).status).toBe(403);
    expect((await conduct("admin.demo")).status).toBe(403);
    const first = await conduct("prof.ionescu", { studentId: f.students.stan });
    expect(first.status, first.text).toBe(200);
    expect((await conduct("prof.ionescu", { studentId: f.students.stan })).status).toBe(409);
    // georgescu (diriginte 113) manages conduct in 113
    const g113 = await conduct("prof.georgescu", { studentId: f.students.dobre, classSectionId: f.classes.c113 });
    expect(g113.status, g113.text).toBe(200);
    // and another teacher cannot modify it
    const g = await db.grade.findFirstOrThrow({ where: { subjectId: f.subjects.purtare, studentId: f.students.dobre, status: "ACTIVE" } });
    expect((await patch("prof.ionescu", g.id, { value: 5, version: g.version, changeReason: "Încercare" })).status).toBe(404);
  });

  it("instruirea practică: doar profesorul repartizat pentru practică", async () => {
    const body = { subjectId: f.subjects.practica, studentId: f.students.dobre, classSectionId: f.classes.c113 };
    expect((await post("prof.popescu", body)).status).toBe(404);
    expect((await post("prof.georgescu", body)).status).toBe(404); // diriginte of 113 ≠ practical instructor
    const ok = await post("prof.ionescu", body);
    expect(ok.status, ok.text).toBe(200);
    expect((await post("prof.ionescu", { ...body, studentId: f.students.marin, classSectionId: f.classes.c112 })).status).toBe(404);
  });

  it("examenul final de modul: doar examinatorul desemnat", async () => {
    const exam = { kind: "MODULE_EXAM", reasonId: f.reasonExam };
    // popescu is the designated examiner for MAT / 112 / module 1
    const ok = await post("prof.popescu", { ...exam, studentId: f.students.stan, value: 9 });
    expect(ok.status, ok.text).toBe(200);
    expect((await post("prof.popescu", { ...exam, studentId: f.students.stan })).status).toBe(409); // single exam grade
    // ionescu teaches NAV in 113 but is not its examiner
    expect((await post("prof.ionescu", { ...exam, subjectId: f.subjects.nav, studentId: f.students.dobre, classSectionId: f.classes.c113 })).status).toBe(404);
    // the diriginte of 112 is not the MAT examiner
    expect((await post("prof.ionescu", { ...exam, studentId: f.students.marin })).status).toBe(404);
    // wrong reason type for an exam
    expect((await post("prof.popescu", { ...exam, reasonId: f.reasons.testare, studentId: f.students.marin })).status).toBe(400);
  });
});

describe("fluxul special de corecție", () => {
  const request = (u: string, body: Record<string, unknown>) =>
    call(createCorrectionRoute, "POST", "/api/corrections", { cookie: c[u], body });
  const review = (u: string, id: string, body: Record<string, unknown>) =>
    call(reviewRoute, "POST", `/api/corrections/${id}/review`, { cookie: c[u], params: { id }, body });

  it("profesorul cere corecția cu motiv; comandantul aprobă; nota se modifică doar prin flux", async () => {
    const g = await newGrade();
    expect((await request("prof.popescu", { gradeId: g.id, type: "MODIFY", proposedValue: 10 })).status).toBe(400); // no reason
    const created = await request("prof.popescu", { gradeId: g.id, type: "MODIFY", proposedValue: 10, justification: "Lucrare recorectată" });
    expect(created.status, created.text).toBe(200);
    expect((await request("prof.popescu", { gradeId: g.id, type: "DELETE", justification: "A doua cerere" })).status).toBe(409);

    const list = await call(listCorrectionsRoute, "GET", "/api/corrections", { cookie: c["comandant.demo"], query: { status: "PENDING" } });
    expect(list.status).toBe(200);
    expect(list.json.requests.some((r: any) => r.id === created.json.request.id)).toBe(true);

    const approved = await review("comandant.demo", created.json.request.id, { decision: "APPROVE", comment: "Aprobat" });
    expect(approved.status, approved.text).toBe(200);
    const row = await db.grade.findUniqueOrThrow({ where: { id: g.id } });
    expect(Number(row.value)).toBe(10);
    expect(row.authorId).toBe(f.users.popescu); // original author preserved
    const rev = await db.gradeRevision.findFirstOrThrow({ where: { gradeId: g.id, action: "UPDATE" } });
    expect(rev.correctionRequestId).toBe(created.json.request.id);
    expect(rev.changedById).toBe(f.users.popescu);
    for (const action of ["CORRECTION_REQUEST_CREATE", "CORRECTION_REQUEST_APPROVE"]) {
      expect(await db.auditLog.count({ where: { action, entityId: created.json.request.id } }), action).toBe(1);
    }
    const gradeAudit = await db.auditLog.findFirstOrThrow({ where: { action: "GRADE_UPDATE", entityId: g.id } });
    expect((gradeAudit.metadata as any).approvedById).toBe(f.users.comandant);
    // cannot be reviewed twice
    expect((await review("comandant.demo", created.json.request.id, { decision: "REJECT" })).status).toBe(409);
  });

  it("respingerea, anularea și ștergerea aprobată sunt auditate", async () => {
    const g1 = await newGrade();
    const r1 = await request("prof.popescu", { gradeId: g1.id, type: "MODIFY", proposedValue: 5, justification: "Motiv" });
    expect((await review("comandant.demo", r1.json.request.id, { decision: "REJECT", comment: "Nejustificat" })).status).toBe(200);
    expect(Number((await db.grade.findUniqueOrThrow({ where: { id: g1.id } })).value)).toBe(7);
    expect(await db.auditLog.count({ where: { action: "CORRECTION_REQUEST_REJECT", entityId: r1.json.request.id } })).toBe(1);

    const r2 = await request("prof.popescu", { gradeId: g1.id, type: "DELETE", justification: "Notă dublată" });
    expect((await call(cancelRoute, "POST", "/x", { cookie: c["prof.georgescu"], params: { id: r2.json.request.id } })).status).toBe(404);
    expect((await call(cancelRoute, "POST", "/x", { cookie: c["prof.popescu"], params: { id: r2.json.request.id } })).status).toBe(200);

    const r3 = await request("prof.popescu", { gradeId: g1.id, type: "DELETE", justification: "Notă dublată" });
    expect((await review("comandant.demo", r3.json.request.id, { decision: "APPROVE" })).status).toBe(200);
    const row = await db.grade.findUniqueOrThrow({ where: { id: g1.id } });
    expect(row.status).toBe("DELETED");
    expect(row.deletionReason).toBe("Notă dublată");
    expect(await db.auditLog.count({ where: { action: "GRADE_DELETE", entityId: g1.id } })).toBe(1);
  });

  it("comandantul nu poate edita/șterge direct note și nici nu poate crea cereri", async () => {
    const g = await newGrade();
    expect((await patch("comandant.demo", g.id, { value: 3, version: g.version, changeReason: "Direct" })).status).toBe(403);
    expect((await del("comandant.demo", g.id, { version: g.version, reason: "Direct" })).status).toBe(403);
    expect((await request("comandant.demo", { gradeId: g.id, type: "MODIFY", proposedValue: 3, justification: "Direct" })).status).toBe(403);
    expect(Number((await db.grade.findUniqueOrThrow({ where: { id: g.id } })).value)).toBe(7);
  });

  it("administratorul nu poate ocoli fluxul (nici editare, nici aprobare)", async () => {
    const g = await newGrade();
    const r = await request("prof.popescu", { gradeId: g.id, type: "MODIFY", proposedValue: 4, justification: "Test" });
    expect((await patch("admin.demo", g.id, { value: 3, version: g.version, changeReason: "Direct" })).status).toBe(403);
    expect((await del("admin.demo", g.id, { version: g.version, reason: "Direct" })).status).toBe(403);
    expect((await review("admin.demo", r.json.request.id, { decision: "APPROVE" })).status).toBe(403);
    expect((await review("prof.popescu", r.json.request.id, { decision: "APPROVE" })).status).toBe(403);
    expect((await call(listCorrectionsRoute, "GET", "/api/corrections", { cookie: c["admin.demo"] })).status).toBe(403);
    expect(Number((await db.grade.findUniqueOrThrow({ where: { id: g.id } })).value)).toBe(7);
  });

  it("profesorul vede doar propriile cereri; profesorul nerepartizat nu poate cere corecții", async () => {
    const mine = await call(listCorrectionsRoute, "GET", "/api/corrections", { cookie: c["prof.georgescu"] });
    expect(mine.status).toBe(200);
    expect(mine.json.requests.every((r: any) => r.requestedBy.id === f.users.georgescu)).toBe(true);
    const g = await newGrade();
    // diriginte ionescu sees the grade but holds no MAT assignment → cannot request
    expect((await request("prof.ionescu", { gradeId: g.id, type: "DELETE", justification: "Test" })).status).toBe(403);
  });
});

describe("module, planuri și rezultate", () => {
  it("rezultatele modulului: diriginte și comandant da; profesor, administrator, elev nu", async () => {
    const get = (u: string) =>
      call(resultsRoute, "GET", "/x", { cookie: c[u], params: { classId: f.classes.c112, moduleId: f.moduleId } });
    const d = await get("prof.ionescu");
    expect(d.status, d.text).toBe(200);
    expect(d.json.rows.length).toBe(2);
    expect(d.json.ruleSet.provisional).toBe(true);
    expect(d.json.subjects.map((s: any) => s.type)).toContain("CONDUCT");
    expect((await get("comandant.demo")).status).toBe(200);
    expect((await get("prof.popescu")).status).toBe(404);
    expect((await get("admin.demo")).status).toBe(404);
    expect((await get("elev.marin")).status).toBe(404);
    // module of another year of study → 404
    expect((await call(resultsRoute, "GET", "/x", { cookie: c["prof.ionescu"], params: { classId: f.classes.c112, moduleId: f.moduleId2 } })).status).toBe(404);
  });

  it("administratorul gestionează planul modulului; închiderea îngheață rezultatele și notarea", async () => {
    const A = c["admin.demo"];
    const mod = await call(createModuleRoute, "POST", "/api/admin/modules", {
      cookie: A,
      body: { academicYearId: f.yearId, yearOfStudy: 1, name: "Modulul 3", order: 3 },
    });
    expect(mod.status, mod.text).toBe(200);
    const moduleId = mod.json.module.id;
    const add = await call(addModuleSubjectRoute, "POST", "/x", { cookie: A, params: { id: moduleId }, body: { subjectId: f.subjects.eng } });
    expect(add.status, add.text).toBe(200);
    expect((await call(addModuleSubjectRoute, "POST", "/x", { cookie: A, params: { id: moduleId }, body: { subjectId: f.subjects.eng } })).status).toBe(409);
    expect((await call(addModuleSubjectRoute, "POST", "/x", { cookie: A, params: { id: moduleId }, body: { subjectId: f.subjects.purtare } })).status).toBe(400);
    expect((await call(addModuleSubjectRoute, "POST", "/x", { cookie: c["comandant.demo"], params: { id: moduleId }, body: { subjectId: f.subjects.nav } })).status).toBe(403);
    const list = await call(listModuleSubjectsRoute, "GET", "/x", { cookie: A, params: { id: moduleId } });
    expect(list.json.subjects).toHaveLength(1);

    // grading in a PLANNED module is refused, in an OPEN module allowed (georgescu teaches ENG in 112 for all modules)
    const grade = { subjectId: f.subjects.eng, moduleId };
    expect((await post("prof.georgescu", grade)).status).toBe(409);
    expect((await call(updateModuleRoute, "PATCH", "/x", { cookie: A, params: { id: moduleId }, body: { status: "OPEN" } })).status).toBe(200);
    expect((await post("prof.georgescu", grade)).status).toBe(200);
    // MAT is not part of module 3
    expect((await post("prof.popescu", { moduleId })).status).toBe(400);
    // the subject cannot be removed from the plan once graded
    expect((await call(removeModuleSubjectRoute, "DELETE", "/x", { cookie: A, params: { id: add.json.moduleSubject.id } })).status).toBe(409);

    const closed = await call(updateModuleRoute, "PATCH", "/x", { cookie: A, params: { id: moduleId }, body: { status: "CLOSED" } });
    expect(closed.status, closed.text).toBe(200);
    expect(await db.moduleResultSnapshot.count({ where: { moduleId } })).toBe(7); // every year-I class
    expect((await post("prof.georgescu", grade)).status).toBe(409);
    const frozen = await call(resultsRoute, "GET", "/x", { cookie: c["comandant.demo"], params: { classId: f.classes.c112, moduleId } });
    expect(frozen.json.frozen).toBe(true);
    expect(frozen.json.module.status).toBe("CLOSED");
  });

  it("repartizările conflictuale sunt respinse; examinatorul cere materie cu examen în modul", async () => {
    const A = c["admin.demo"];
    const conflict = await call(createAssignmentRoute, "POST", "/x", {
      cookie: A,
      body: { teacherId: f.users.georgescu, classSectionId: f.classes.c112, subjectId: f.subjects.mat },
    });
    expect(conflict.status).toBe(409); // MAT/112 already taught by popescu
    const noExam = await call(createAssignmentRoute, "POST", "/x", {
      cookie: A,
      body: { teacherId: f.users.georgescu, classSectionId: f.classes.c111, subjectId: f.subjects.eng, kind: "MODULE_EXAM", moduleId: f.moduleId },
    });
    expect(noExam.status).toBe(400);
    // the same teacher may teach several subjects/classes, also module-specific
    const nav112 = await call(createAssignmentRoute, "POST", "/x", {
      cookie: A,
      body: { teacherId: f.users.popescu, classSectionId: f.classes.c112, subjectId: f.subjects.nav, moduleId: f.moduleId },
    });
    expect(nav112.status, nav112.text).toBe(200);
    const again = await call(createAssignmentRoute, "POST", "/x", {
      cookie: A,
      body: { teacherId: f.users.georgescu, classSectionId: f.classes.c112, subjectId: f.subjects.nav },
    });
    expect(again.status).toBe(409); // "all modules" overlaps the module-1 assignment
  });

  it("elevii nu pot fi mutați între clase prin actualizare", async () => {
    const res = await call(updateStudentRoute, "PATCH", "/x", {
      cookie: c["admin.demo"],
      params: { id: f.students.marin },
      body: { classSectionId: f.classes.c113 },
    });
    expect(res.status).toBe(400);
    const e = await db.enrollment.findFirstOrThrow({ where: { studentId: f.students.marin, status: "ACTIVE" } });
    expect(e.classSectionId).toBe(f.classes.c112);
  });
});

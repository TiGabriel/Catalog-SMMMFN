/**
 * Reports (authorization, Excel export) and the audit viewer (role scope, filters,
 * no technical data for the commander).
 */
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as reportRoute } from "@/app/api/reports/[type]/route";
import { GET as auditRoute } from "@/app/api/audit/route";
import { POST as gradesRoute } from "@/app/api/grades/route";
import { PATCH as updateGradeRoute } from "@/app/api/grades/[gradeId]/route";
import { db } from "@/server/db/client";
import { reportToXlsx } from "@/server/reports/xlsx";
import { resetTestDb } from "../db";
import { call, fixtures, loginCookie, type Fixtures } from "../helpers";

let f: Fixtures;
const c: Record<string, string> = {};

beforeAll(async () => {
  await resetTestDb();
  f = await fixtures();
  for (const u of ["admin.demo", "comandant.demo", "prof.popescu", "prof.ionescu", "prof.georgescu", "elev.marin"]) c[u] = await loginCookie(u);
  // Some grade activity for the audit tests.
  const g = await call(gradesRoute, "POST", "/api/grades", {
    cookie: c["prof.popescu"],
    body: { studentId: f.students.marin, classSectionId: f.classes.c112, subjectId: f.subjects.mat, kind: "CURRENT", value: 6, reasonId: f.reasons.testare, gradeDate: new Date().toISOString().slice(0, 10), moduleId: f.moduleId },
  });
  await call(updateGradeRoute, "PATCH", "/x", { cookie: c["prof.popescu"], params: { gradeId: g.json.grade.id }, body: { value: 7, version: 1, changeReason: "Recorectare" } });
});

const report = (u: string, type: string, query: Record<string, string> = {}) =>
  call(reportRoute, "GET", `/api/reports/${type}`, { cookie: c[u], params: { type }, query });

describe("rapoarte – autorizare", () => {
  it("profesorul: doar clasele și materiile proprii", async () => {
    const cat = await report("prof.popescu", "catalog-clasa", { clasa: f.classes.c112 });
    expect(cat.status, cat.text).toBe(200);
    expect(cat.json.report.sections.map((s: any) => s.title)).toEqual(["Matematică"]);
    expect((await report("prof.popescu", "catalog-clasa", { clasa: f.classes.c113 })).status).toBe(404);
    const med = await report("prof.popescu", "medii-clasa", { clasa: f.classes.c112 });
    expect(med.json.report.sections[0].columns.map((c: any) => c.label)).not.toContain("Media generală");
    expect((await report("prof.popescu", "rezultate-an", { clasa: f.classes.c112 })).status).toBe(404);
    expect((await report("prof.popescu", "rezultate-modul", { clasa: f.classes.c112, modul: f.moduleId })).status).toBe(404);
    const st = await report("prof.popescu", "situatie-elev", { elev: f.students.marin });
    expect(st.status).toBe(200);
    expect(new Set(st.json.report.sections[0].rows.map((r: any) => r[0]))).toEqual(new Set(["Matematică"]));
    expect((await report("prof.popescu", "situatie-elev", { elev: f.students.dobre })).status).toBe(404);
    expect((await report("prof.popescu", "foaie-matricola", { elev: f.students.marin })).status).toBe(403);
    expect((await report("prof.popescu", "situatie-generala")).status).toBe(403);
    // Excel export of another class is refused as well.
    expect((await report("prof.popescu", "catalog-clasa", { clasa: f.classes.c113, format: "xlsx" })).status).toBe(404);
  });

  it("dirigintele: toată clasa proprie, nu și alte clase", async () => {
    const cat = await report("prof.ionescu", "catalog-clasa", { clasa: f.classes.c112 });
    expect(cat.json.report.sections.map((s: any) => s.title).sort()).toEqual(["Limba engleză", "Matematică", "Purtare"]);
    expect((await report("prof.ionescu", "rezultate-an", { clasa: f.classes.c112 })).status).toBe(200);
    expect((await report("prof.ionescu", "rezultate-modul", { clasa: f.classes.c112, modul: f.moduleId })).status).toBe(200);
    expect((await report("prof.ionescu", "catalog-clasa", { clasa: f.classes.c111 })).status).toBe(404);
    expect((await report("prof.ionescu", "rezultate-an", { clasa: f.classes.c113 })).status).toBe(404); // teaches there, but not diriginte
  });

  it("comandantul: toate rapoartele, inclusiv exportul Excel", async () => {
    for (const [type, q] of [
      ["catalog-clasa", { clasa: f.classes.c113 }],
      ["medii-clasa", { clasa: f.classes.c112 }],
      ["rezultate-an", { clasa: f.classes.c112 }],
      ["rezultate-modul", { clasa: f.classes.c112, modul: f.moduleId }],
      ["situatie-elev", { elev: f.students.dobre }],
      ["foaie-matricola", { elev: f.students.marin }],
      ["situatie-generala", {}],
    ] as const) {
      expect((await report("comandant.demo", type, q)).status, type).toBe(200);
    }
    const x = await call(reportRoute, "GET", "/x", { cookie: c["comandant.demo"], params: { type: "catalog-clasa" }, query: { clasa: f.classes.c112, format: "xlsx" } });
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toMatch(/spreadsheetml/);
    expect(x.headers.get("content-disposition")).toMatch(/attachment; filename=".*\.xlsx"/);
    expect(await db.auditLog.count({ where: { action: "REPORT_EXPORT", actorId: f.users.comandant } })).toBeGreaterThan(0);
    const general = await report("comandant.demo", "situatie-generala");
    expect(general.json.report.sections[0].rows).toHaveLength(14);
  });

  it("administratorul nu exportă note; elevul doar propria foaie matricolă", async () => {
    expect((await report("admin.demo", "catalog-clasa", { clasa: f.classes.c112 })).status).toBe(404);
    expect((await report("admin.demo", "situatie-generala")).status).toBe(403);
    expect((await report("admin.demo", "foaie-matricola", { elev: f.students.marin })).status).toBe(403);
    expect((await report("elev.marin", "foaie-matricola", { elev: f.students.marin })).status).toBe(200);
    expect((await report("elev.marin", "foaie-matricola", { elev: f.students.stan })).status).toBe(404);
    expect((await report("elev.marin", "catalog-clasa", { clasa: f.classes.c112 })).status).toBe(404);
  });

  it("tip necunoscut sau parametri invalizi → 404", async () => {
    expect((await report("comandant.demo", "raport-inexistent")).status).toBe(404);
    expect((await report("comandant.demo", "catalog-clasa", { clasa: "nu-e-uuid" })).status).toBe(404);
  });

  it("exportul Excel neutralizează formulele (formula injection)", async () => {
    const buf = await reportToXlsx({
      type: "catalog-clasa",
      title: "Test",
      generatedAt: new Date().toISOString(),
      generatedBy: "test",
      sections: [{ columns: [{ label: "A" }, { label: "B", numeric: true }], rows: [["=HYPERLINK(\"http://x\")", 9], ["@SUM(1)", 10]] }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const values = ws.getColumn(1).values.filter((v) => typeof v === "string") as string[];
    expect(values).toContain("'=HYPERLINK(\"http://x\")");
    expect(values).toContain("'@SUM(1)");
    expect(ws.getColumn(1).values.some((v) => typeof v === "object" && v !== null && "formula" in v)).toBe(false);
  });
});

describe("jurnalul de audit – vizibilitate", () => {
  const audit = (u: string, query: Record<string, string> = {}) => call(auditRoute, "GET", "/api/audit", { cookie: c[u], query });

  it("utilizatorii obișnuiți nu au acces", async () => {
    for (const u of ["prof.popescu", "prof.ionescu", "elev.marin"]) expect((await audit(u)).status).toBe(403);
  });

  it("comandantul vede doar auditul academic, fără date tehnice", async () => {
    const res = await audit("comandant.demo", { pageSize: "200" });
    expect(res.status).toBe(200);
    expect(res.json.scope).toBe("academic");
    const actions = new Set(res.json.entries.map((e: any) => e.action));
    expect(actions.has("GRADE_UPDATE")).toBe(true);
    for (const a of ["LOGIN", "LOGIN_FAILED", "USER_CREATE", "CONFIG_UPDATE", "AUDIT_VIEW", "ACCESS_DENIED"]) expect(actions.has(a)).toBe(false);
    for (const e of res.json.entries) {
      expect(e).not.toHaveProperty("ip");
      expect(e).not.toHaveProperty("userAgent");
      expect(e).not.toHaveProperty("hash");
      expect(e.metadata).toBeNull();
    }
    // Asking for a system action explicitly returns nothing.
    expect((await audit("comandant.demo", { action: "LOGIN" })).json.total).toBe(0);
    const upd = res.json.entries.find((e: any) => e.action === "GRADE_UPDATE");
    expect(upd.before.value).toBe(6);
    expect(upd.after.value).toBe(7);
    expect(upd.reason).toBe("Recorectare");
    expect(upd.student).toBe("Marin Andrei");
  });

  it("administratorul vede auditul complet, inclusiv datele tehnice", async () => {
    const res = await audit("admin.demo", { action: "LOGIN" });
    expect(res.json.scope).toBe("system");
    expect(res.json.total).toBeGreaterThan(0);
    expect(res.json.entries[0]).toHaveProperty("ip");
    expect(res.json.entries[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("filtre: utilizator, elev, clasă, materie, an, perioadă", async () => {
    const byClass = await audit("admin.demo", { classSectionId: f.classes.c112, pageSize: "200" });
    expect(byClass.json.entries.length).toBeGreaterThan(0);
    expect(byClass.json.entries.every((e: any) => e.classSection?.startsWith("112"))).toBe(true);
    const byStudent = await audit("comandant.demo", { studentId: f.students.marin });
    expect(byStudent.json.entries.every((e: any) => e.student === "Marin Andrei")).toBe(true);
    const bySubject = await audit("comandant.demo", { subjectId: f.subjects.mat });
    expect(bySubject.json.entries.every((e: any) => e.subject === "Matematică")).toBe(true);
    const byActor = await audit("comandant.demo", { actorId: f.users.popescu });
    expect(byActor.json.entries.length).toBeGreaterThan(0);
    expect(byActor.json.entries.every((e: any) => e.actorId === f.users.popescu)).toBe(true);
    const byYear = await audit("comandant.demo", { academicYearId: f.yearId });
    expect(byYear.json.total).toBeGreaterThan(0);
    expect((await audit("admin.demo", { from: "2099-01-01" })).json.total).toBe(0);
    expect((await audit("admin.demo", { studentId: "nu-e-uuid" })).status).toBe(400);
  });
});

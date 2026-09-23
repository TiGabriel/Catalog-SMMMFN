/**
 * Timetable: template, import validation, preview, publication, weekly
 * resolution, versioning/recovery and teacher isolation.
 */
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as templateRoute } from "@/app/api/admin/timetable/template/route";
import { POST as importRoute } from "@/app/api/admin/timetable/imports/route";
import { GET as versionRoute } from "@/app/api/admin/timetable/versions/[id]/route";
import { POST as publishRoute } from "@/app/api/admin/timetable/versions/[id]/publish/route";
import { POST as archiveRoute } from "@/app/api/admin/timetable/versions/[id]/archive/route";
import { POST as republishRoute } from "@/app/api/admin/timetable/versions/[id]/republish/route";
import { GET as timetableRoute } from "@/app/api/timetable/route";
import { checkXlsxContainer } from "@/server/timetable/xlsx-safety";
import { resetTestDb } from "../db";
import { call, fixtures, loginCookie, ORIGIN, type Fixtures } from "../helpers";

let f: Fixtures;
const c: Record<string, string> = {};

beforeAll(async () => {
  await resetTestDb();
  f = await fixtures();
  for (const u of ["admin.demo", "prof.popescu", "prof.ionescu", "comandant.demo"]) c[u] = await loginCookie(u);
});

type Row = (string | number | { formula: string } | null)[];
const HEADER = ["Clasa", "Ziua", "Ora", "Materie", "Profesor", "Sala", "Săptămâna", "Grupa"];

async function xlsx(rows: Row[], header = HEADER): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Orar");
  ws.addRow(header);
  for (const r of rows) ws.addRow(r as ExcelJS.CellValue[]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function upload(file: Buffer, fields: Record<string, string>, opts: { cookie?: string; name?: string; origin?: string } = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(file)], opts.name ?? "orar.xlsx"));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const encoded = new Response(form);
  const body = Buffer.from(await encoded.arrayBuffer());
  const req = new NextRequest(new URL("/api/admin/timetable/imports", ORIGIN), {
    method: "POST",
    body,
    headers: {
      cookie: opts.cookie ?? c["admin.demo"]!,
      origin: opts.origin ?? ORIGIN,
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(body.length),
    },
  });
  const res = await importRoute(req, { params: Promise.resolve({}) });
  return { status: res.status, json: (await res.json()) as any };
}

const fields = (over: Record<string, string> = {}) => ({ academicYearId: f.yearId, validFrom: "2026-10-05", name: "Orar semestrul I", ...over });
const week = (u: string, query: Record<string, string>) => call(timetableRoute, "GET", "/api/timetable", { cookie: c[u], query });

describe("șablonul Excel", () => {
  it("administratorul descarcă șablonul cu foile de referință", async () => {
    const res = await call(templateRoute, "GET", "/x", { cookie: c["admin.demo"] });
    expect(res.status).toBe(200);
    expect((await call(templateRoute, "GET", "/x", { cookie: c["prof.popescu"] })).status).toBe(403);
  });
});

describe("validarea importului", () => {
  it("rândurile invalide sunt raportate precis și nimic nu se importă", async () => {
    const file = await xlsx([
      ["112", "Luni", 1, "MAT", "prof.popescu", "A12", "Toate", null], // valid
      ["199", "Luni", 2, "MAT", "prof.popescu", null, null, null], // unknown class
      ["112", "Lunea", 3, "MAT", "prof.popescu", null, null, null], // bad day
      ["112", "Marți", 99, "MAT", "prof.popescu", null, null, null], // bad slot
      ["112", "Marți", 1, "XYZ", "prof.popescu", null, null, null], // bad subject
      ["112", "Marți", 2, "MAT", "prof.nimeni", null, null, null], // unknown teacher
      ["112", "Marți", 3, "MAT", "prof.inactiv", null, null, null], // inactive teacher
      ["113", "Luni", 1, "NAV", "prof.popescu", null, null, null], // teacher double-booked with row 2
      ["112", "Luni", 1, "ENG", "prof.georgescu", null, null, null], // class double-booked with row 2
      ["112", "Miercuri", { formula: "1+1" }, "MAT", "prof.popescu", null, null, null], // formula
      ["112", "Joi", 1, "MAT", "prof.popescu", null, "Uneori", null], // bad parity
    ]);
    const res = await upload(file, fields());
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(false);
    expect(res.json.versionId).toBeNull();
    const byRow = (row: number) => res.json.report.errors.filter((e: any) => e.row === row).map((e: any) => e.message).join(" ");
    expect(byRow(3)).toMatch(/Clasa „199” nu există/);
    expect(byRow(4)).toMatch(/Zi necunoscută/);
    expect(byRow(5)).toMatch(/Ora „99”/);
    expect(byRow(6)).toMatch(/Materia „XYZ”/);
    expect(byRow(7)).toMatch(/„prof.nimeni” nu există/);
    expect(byRow(8)).toMatch(/nu este activ/);
    expect(byRow(9)).toMatch(/predă deja/);
    expect(byRow(10)).toMatch(/are deja o oră/);
    expect(byRow(11)).toMatch(/formule/);
    expect(byRow(12)).toMatch(/Toate, Impară sau Pară/);
  });

  it("coloanele obligatorii lipsă, fișierele non-Excel și datele în afara anului sunt respinse", async () => {
    const noTeacher = await upload(await xlsx([["112", "Luni", 1, "MAT"]], ["Clasa", "Ziua", "Ora", "Materie"]), fields());
    expect(noTeacher.json.report.errors[0].message).toMatch(/Profesor/);
    const fake = await upload(Buffer.from("nu sunt excel"), fields());
    expect(fake.json.ok).toBe(false);
    expect(fake.json.report.errors[0].message).toMatch(/nu este un document Excel/);
    const wrongExt = await upload(await xlsx([]), fields(), { name: "orar.csv" });
    expect(wrongExt.status).toBe(400);
    const outside = await upload(await xlsx([["112", "Luni", 1, "MAT", "prof.popescu"]]), fields({ validFrom: "2030-01-06" }));
    expect(outside.json.ok).toBe(false);
  });

  it("detectează macro-uri și arhive supradimensionate înainte de parsare", () => {
    expect(checkXlsxContainer(Buffer.from("PK\u0003\u0004 fără structură")).ok).toBe(false);
    expect(checkXlsxContainer(zip([["xl/workbook.xml", 10], ["xl/vbaProject.bin", 10]])).ok).toBe(false);
    expect(checkXlsxContainer(zip([["xl/workbook.xml", 30 * 1024 * 1024]])).ok).toBe(false);
    expect(checkXlsxContainer(zip([["xl/workbook.xml", 100]])).ok).toBe(true);
  });

  it("doar administratorul poate încărca; Origin străin este respins", async () => {
    const file = await xlsx([["112", "Luni", 1, "MAT", "prof.popescu"]]);
    expect((await upload(file, fields(), { cookie: c["prof.popescu"] })).status).toBe(403);
    expect((await upload(file, fields(), { cookie: c["comandant.demo"] })).status).toBe(403);
    expect((await upload(file, fields(), { origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("publicare, rezolvare pe săptămână și versiuni", () => {
  let versionId: string;

  it("un fișier valid devine ciornă, cu previzualizare și diferențe", async () => {
    const res = await upload(
      await xlsx([
        ["112", "Luni", 1, "MAT", "prof.popescu", "A12", "Toate", null],
        ["111", "Luni", 2, "MAT", "prof.popescu", "B03", "Toate", null],
        ["113", "Marți", 1, "NAV", "prof.ionescu", "Sim-1", "Impară", null],
        ["113", "Marți", 1, "INSTR_PRACTICA", "prof.ionescu", "Atelier", "Pară", null],
        ["112", "Vineri", 4, "ENG", "prof.georgescu", null, null, null],
      ]),
      fields({ validFrom: "2026-10-07" }), // a Wednesday → normalized to Monday 05.10
    );
    expect(res.status).toBe(200);
    expect(res.json.ok, JSON.stringify(res.json.report.errors)).toBe(true);
    versionId = res.json.versionId;
    const preview = await call(versionRoute, "GET", "/x", { cookie: c["admin.demo"], params: { id: versionId } });
    expect(preview.json.version.status).toBe("DRAFT");
    expect(preview.json.version.validFrom.slice(0, 10)).toBe("2026-10-05");
    expect(preview.json.version.entries).toHaveLength(5);
    expect(preview.json.diff.replacedVersion.name).toBe("Orar demonstrativ");
    // A draft is not visible yet.
    const w = await week("admin.demo", { week: "2026-10-12" });
    expect(w.json.version.name).toBe("Orar demonstrativ");
  });

  it("după publicare, fiecare săptămână primește orarul corect; profesorul vede doar orele proprii", async () => {
    expect((await call(publishRoute, "POST", "/x", { cookie: c["admin.demo"], params: { id: versionId } })).status).toBe(200);
    expect((await week("admin.demo", { week: "2026-09-28" })).json.version.name).toBe("Orar demonstrativ");
    const after = await week("admin.demo", { week: "2026-10-12" });
    expect(after.json.version.name).toBe("Orar semestrul I");
    expect(after.json.weekStart).toBe("2026-10-12");

    const pop = await week("prof.popescu", { week: "2026-10-12" });
    expect(pop.json.entries).toHaveLength(2);
    expect(pop.json.entries.every((e: any) => e.teacher.id === f.users.popescu)).toBe(true);
    // Week parity: 12.10.2026 is ISO week 42 (even) → only the "Pară" lesson for ionescu on Tuesday.
    const ion = await week("prof.ionescu", { week: "2026-10-12" });
    expect(ion.json.parity).toBe("EVEN");
    expect(ion.json.entries.map((e: any) => e.subject.id)).toEqual([f.subjects.practica]);
    const ionOdd = await week("prof.ionescu", { week: "2026-10-19" });
    expect(ionOdd.json.entries.map((e: any) => e.subject.id)).toEqual([f.subjects.nav]);
  });

  it("o nouă încărcare nu distruge versiunea anterioară; arhivarea restaurează orarul precedent", async () => {
    const second = await upload(await xlsx([["112", "Luni", 1, "MAT", "prof.popescu", "A12", null, null]]), fields({ validFrom: "2026-11-02", name: "Orar modificat" }));
    expect(second.json.ok).toBe(true);
    await call(publishRoute, "POST", "/x", { cookie: c["admin.demo"], params: { id: second.json.versionId } });
    expect((await week("admin.demo", { week: "2026-10-26" })).json.version.name).toBe("Orar semestrul I");
    expect((await week("admin.demo", { week: "2026-11-09" })).json.version.name).toBe("Orar modificat");

    expect((await call(archiveRoute, "POST", "/x", { cookie: c["admin.demo"], params: { id: second.json.versionId } })).status).toBe(200);
    expect((await week("admin.demo", { week: "2026-11-09" })).json.version.name).toBe("Orar semestrul I");
    expect((await call(republishRoute, "POST", "/x", { cookie: c["admin.demo"], params: { id: second.json.versionId } })).status).toBe(200);
    expect((await week("admin.demo", { week: "2026-11-09" })).json.version.name).toBe("Orar modificat");
    // A draft that was never published cannot be "republished".
    expect((await call(publishRoute, "POST", "/x", { cookie: c["admin.demo"], params: { id: second.json.versionId } })).status).toBe(409);
  });

  it("profesorii nu pot publica sau arhiva", async () => {
    expect((await call(publishRoute, "POST", "/x", { cookie: c["prof.popescu"], params: { id: versionId } })).status).toBe(403);
    expect((await call(archiveRoute, "POST", "/x", { cookie: c["comandant.demo"], params: { id: versionId } })).status).toBe(403);
  });
});

/** Minimal ZIP writer (stored entries, fake sizes) for container checks. */
function zip(entries: [string, number][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, size] of entries) {
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n);
    centrals.push(central, n);
    offset += local.length + n.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

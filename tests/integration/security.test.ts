/**
 * Security audit regression tests: session fixation, brute-force races, logging
 * of credentials, body limits, zip bombs, weak passwords, separation of duties
 * (commander oversight of administrator actions), IDOR on grades, history
 * preservation when accounts are deactivated/deleted, concurrency.
 */
import { deflateRawSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as changePasswordRoute } from "@/app/api/auth/change-password/route";
import { GET as gradeRoute } from "@/app/api/grades/[gradeId]/route";
import { POST as gradesRoute } from "@/app/api/grades/route";
import { GET as auditRoute } from "@/app/api/audit/route";
import { GET as classGradesRoute } from "@/app/api/classes/[classId]/subjects/[subjectId]/grades/route";
import { GET as studentRoute } from "@/app/api/students/[studentId]/route";
import { POST as createUserRoute } from "@/app/api/admin/users/route";
import { POST as userStatusRoute } from "@/app/api/admin/users/[id]/status/route";
import { POST as resetPasswordRoute } from "@/app/api/admin/users/[id]/reset-password/route";
import { POST as createAssignmentRoute } from "@/app/api/admin/assignments/route";
import { PUT as updateSettingRoute } from "@/app/api/admin/settings/[key]/route";
import { db } from "@/server/db/client";
import { hashToken } from "@/server/auth/session";
import { checkXlsxContainer } from "@/server/timetable/xlsx-safety";
import { passwordPolicyErrors } from "@/lib/validation/password";
import nextConfig from "../../next.config";
import { resetTestDb } from "../db";
import { call, DEMO_PASSWORD, fixtures, login, loginCookie, ORIGIN, sessionCookieFrom, uniqueName, type Fixtures } from "../helpers";

let f: Fixtures;
const c: Record<string, string> = {};
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await resetTestDb();
  f = await fixtures();
  for (const u of ["admin.demo", "comandant.demo", "prof.popescu", "prof.ionescu", "prof.georgescu"]) c[u] = await loginCookie(u);
});

async function newStaff(role = "PROFESOR") {
  const username = uniqueName("sec");
  const res = await call(createUserRoute, "POST", "/x", {
    cookie: c["admin.demo"],
    body: { firstName: "Test", lastName: "Securitate", username, role, temporaryPassword: "Temporar#2026" },
  });
  expect(res.status, res.text).toBe(200);
  return { id: res.json.user.id as string, username };
}

describe("autentificare și sesiuni", () => {
  it("session fixation: o sesiune prezentată la autentificare este revocată, nu refolosită", async () => {
    const old = await loginCookie("prof.georgescu");
    const res = await call(loginRoute, "POST", "/api/auth/login", { cookie: old, body: { username: "prof.georgescu", password: DEMO_PASSWORD } });
    expect(res.status).toBe(200);
    const fresh = sessionCookieFrom(res.headers.get("set-cookie"));
    expect(fresh).not.toBe(old);
    const oldRow = await db.session.findUniqueOrThrow({ where: { id: hashToken(old.split("=")[1]!) } });
    expect(oldRow.revokeReason).toBe("REPLACED_BY_LOGIN");
    expect((await call(meRoute, "GET", "/x", { cookie: old })).status).toBe(401);
    expect((await call(meRoute, "GET", "/x", { cookie: fresh })).status).toBe(200);
  });

  it("brute force paralel: limita de 5 eșecuri nu poate fi ocolită prin cereri simultane", async () => {
    const u = await newStaff();
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => login(u.username, `Gresit#${i}xyz`)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBe(5);
    expect(statuses.filter((s) => s === 429).length).toBe(10);
    expect(await db.loginAttempt.count({ where: { username: u.username, success: false } })).toBe(5);
  });

  it("o parolă tastată în câmpul de utilizator nu este stocată în clar (audit, încercări)", async () => {
    const secret = "Secret#Parola-2026!";
    expect((await login(secret, "orice")).status).toBe(401);
    expect(await db.loginAttempt.count({ where: { username: { contains: "secret" } } })).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "LOGIN_FAILED" }, orderBy: { id: "desc" } });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/Secret|secret/);
    expect((audit.metadata as any).username).toBe("[format invalid]");
  });

  it("sesiunile de elev încetează imediat ce conturile de elev sunt dezactivate", async () => {
    const elev = await loginCookie("elev.marin");
    expect((await call(meRoute, "GET", "/x", { cookie: elev })).status).toBe(200);
    await db.systemSetting.update({ where: { key: "features.studentAccounts" }, data: { value: false } });
    try {
      expect((await call(meRoute, "GET", "/x", { cookie: elev })).status).toBe(401);
    } finally {
      await db.systemSetting.update({ where: { key: "features.studentAccounts" }, data: { value: true } });
    }
  });

  it("parolele ușor de ghicit sunt respinse", async () => {
    for (const pw of ["Parola#2026", "P@ssw0rd!2026", "Qwerty#2026x", "Smmmfn#2026", "Admin#12345"]) {
      expect(passwordPolicyErrors(pw).length, pw).toBeGreaterThan(0);
    }
    const weak = await call(createUserRoute, "POST", "/x", {
      cookie: c["admin.demo"],
      body: { firstName: "A", lastName: "B", username: uniqueName("weak"), role: "PROFESOR", temporaryPassword: "Parola#2026" },
    });
    expect(weak.status).toBe(400);
    const change = await call(changePasswordRoute, "POST", "/x", { cookie: c["prof.georgescu"], body: { currentPassword: DEMO_PASSWORD, newPassword: "Parola#2027" } });
    expect(change.status).toBe(400);
  });

  it("limita de cereri pe sesiune", async () => {
    const cookie = await loginCookie("prof.ionescu");
    let last = 200;
    for (let i = 0; i < 250 && last !== 429; i++) last = (await call(meRoute, "GET", "/x", { cookie })).status;
    expect(last).toBe(429);
  });
});

describe("validarea intrărilor și încărcări", () => {
  it("corpurile JSON fragmentate (fără Content-Length) sunt limitate", async () => {
    const big = new TextEncoder().encode(`{"username":"${"a".repeat(200_000)}","password":"x"}`);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent >= big.length) return ctrl.close();
        ctrl.enqueue(big.subarray(sent, sent + 16_384));
        sent += 16_384;
      },
    });
    const req = new NextRequest(new URL("/api/auth/login", ORIGIN), {
      method: "POST",
      body: stream,
      headers: { origin: ORIGIN, "content-type": "application/json" },
      duplex: "half", // required by Node's fetch implementation for streamed bodies
    });
    const res = await loginRoute(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(sent).toBeLessThan(big.length); // reading stopped early
  });

  it("zip bomb cu dimensiuni declarate false este detectat prin decompresie limitată", () => {
    const bomb = deflateRawSync(Buffer.alloc(40 * 1024 * 1024)); // ~40 MB of zeros → ~40 KB
    const name = Buffer.from("xl/workbook.xml");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(bomb.length, 18);
    local.writeUInt32LE(100, 22); // lie: 100 bytes
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(bomb.length, 20);
    central.writeUInt32LE(100, 24); // lie
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const cd = Buffer.concat([central, name]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(local.length + name.length + bomb.length, 16);
    const zip = Buffer.concat([local, name, bomb, cd, eocd]);
    const res = checkXlsxContainer(zip);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/prea mare/);
  });

  it("antetele de securitate sunt configurate pentru toate rutele", async () => {
    const rules = await nextConfig.headers!();
    const keys = rules[0]!.headers.map((h) => h.key);
    for (const k of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
      expect(keys).toContain(k);
    }
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("IDOR și separarea atribuțiilor", () => {
  it("profesorul nu poate citi nota altui profesor după ID", async () => {
    const eng = await db.grade.findFirstOrThrow({ where: { authorId: f.users.georgescu } });
    expect((await call(gradeRoute, "GET", "/x", { cookie: c["prof.popescu"], params: { gradeId: eng.id } })).status).toBe(404);
    const nav = await db.grade.findFirstOrThrow({ where: { authorId: f.users.ionescu, subjectId: f.subjects.nav } });
    expect((await call(gradeRoute, "GET", "/x", { cookie: c["prof.popescu"], params: { gradeId: nav.id } })).status).toBe(404);
    expect((await call(gradeRoute, "GET", "/x", { cookie: c["admin.demo"], params: { gradeId: nav.id } })).status).toBe(404);
  });

  it("comandantul vede acțiunile administratorului care afectează notarea (fără date despre administratori)", async () => {
    const teacher = await newStaff("PROFESOR");
    const admin2 = await newStaff("ADMINISTRATOR");
    await call(createAssignmentRoute, "POST", "/x", { cookie: c["admin.demo"], body: { teacherId: teacher.id, classSectionId: f.classes.c211, subjectId: f.subjects.mat } });
    await call(resetPasswordRoute, "POST", "/x", { cookie: c["admin.demo"], params: { id: teacher.id }, body: { temporaryPassword: "Resetare#2026x" } });
    await call(resetPasswordRoute, "POST", "/x", { cookie: c["admin.demo"], params: { id: admin2.id }, body: { temporaryPassword: "Resetare#2026y" } });
    await call(updateSettingRoute, "PUT", "/x", { cookie: c["admin.demo"], params: { key: "grades.editWindowDays" }, body: { value: 30 } });
    await call(updateSettingRoute, "PUT", "/x", { cookie: c["admin.demo"], params: { key: "features.studentAccounts" }, body: { value: true } });

    const res = await call(auditRoute, "GET", "/api/audit", { cookie: c["comandant.demo"], query: { pageSize: "200" } });
    const entries = res.json.entries as any[];
    expect(entries.some((e) => e.action === "ASSIGNMENT_CREATE")).toBe(true);
    expect(entries.some((e) => e.action === "PASSWORD_RESET" && e.entityId === teacher.id)).toBe(true);
    expect(entries.some((e) => e.action === "PASSWORD_RESET" && e.entityId === admin2.id)).toBe(false);
    expect(entries.some((e) => e.action === "CONFIG_UPDATE" && e.entityId === "grades.editWindowDays")).toBe(true);
    expect(entries.some((e) => e.action === "CONFIG_UPDATE" && e.entityId === "features.studentAccounts")).toBe(false);
    expect(entries.some((e) => e.action === "USER_CREATE")).toBe(false);
    expect(JSON.stringify(entries)).not.toMatch(/ADMINISTRATOR/);
  });

  it("două note la purtare trimise simultan → doar una este înregistrată", async () => {
    const body = { studentId: f.students.stan, classSectionId: f.classes.c112, subjectId: f.subjects.purtare, kind: "FINAL", value: 9, reasonId: f.reasons.purtare, gradeDate: today, moduleId: f.moduleId };
    const results = await Promise.all([1, 2, 3].map(() => call(gradesRoute, "POST", "/api/grades", { cookie: c["prof.ionescu"], body })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await db.grade.count({ where: { studentId: f.students.stan, subjectId: f.subjects.purtare, moduleId: f.moduleId, status: "ACTIVE" } })).toBe(1);
  });
});

describe("date istorice la dezactivarea/ștergerea conturilor", () => {
  it("un profesor dezactivat și apoi șters își păstrează notele și numele în istoric", async () => {
    const gradesBefore = await db.grade.count({ where: { authorId: f.users.popescu } });
    expect(gradesBefore).toBeGreaterThan(0);
    expect((await call(userStatusRoute, "POST", "/x", { cookie: c["admin.demo"], params: { id: f.users.popescu }, body: { status: "INACTIVE", reason: "Plecat din unitate" } })).status).toBe(200);
    expect((await call(userStatusRoute, "POST", "/x", { cookie: c["admin.demo"], params: { id: f.users.popescu }, body: { status: "DELETED", reason: "Cont eliminat" } })).status).toBe(200);
    expect((await login("prof.popescu")).status).toBe(401);
    const u = await db.user.findUniqueOrThrow({ where: { id: f.users.popescu } });
    expect(u.status).toBe("DELETED");
    expect(u.passwordHash).toBeNull();
    expect(u.lastName).toBe("Popescu");
    expect(await db.grade.count({ where: { authorId: f.users.popescu } })).toBe(gradesBefore);
    const view = await call(classGradesRoute, "GET", "/x", { cookie: c["comandant.demo"], params: { classId: f.classes.c112, subjectId: f.subjects.mat } });
    const g = view.json.students.flatMap((s: any) => s.grades).find((x: any) => x.author.id === f.users.popescu);
    expect(g.author.lastName).toBe("Popescu");
  });

  it("ștergerea contului unui elev nu îi șterge istoricul academic", async () => {
    const elevUser = await db.user.findUniqueOrThrow({ where: { username: "elev.marin" } });
    expect((await call(userStatusRoute, "POST", "/x", { cookie: c["admin.demo"], params: { id: elevUser.id }, body: { status: "DELETED", reason: "Absolvent" } })).status).toBe(200);
    const st = await db.student.findUniqueOrThrow({ where: { id: f.students.marin } });
    expect(st.userId).toBe(elevUser.id); // link kept for history; login is gone
    const view = await call(studentRoute, "GET", "/x", { cookie: c["comandant.demo"], params: { studentId: f.students.marin } });
    expect(view.status).toBe(200);
    expect(view.json.grades.length).toBeGreaterThan(0);
  });
});

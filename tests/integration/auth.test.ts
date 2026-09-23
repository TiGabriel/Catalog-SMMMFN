import { beforeAll, describe, expect, it } from "vitest";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as changePasswordRoute } from "@/app/api/auth/change-password/route";
import { GET as classesRoute } from "@/app/api/classes/route";
import { POST as createUserRoute, GET as listUsersRoute } from "@/app/api/admin/users/route";
import { POST as userStatusRoute } from "@/app/api/admin/users/[id]/status/route";
import { POST as resetPasswordRoute } from "@/app/api/admin/users/[id]/reset-password/route";
import { db } from "@/server/db/client";
import { resetTestDb } from "../db";
import { hashToken } from "@/server/auth/session";
import { call, DEMO_PASSWORD, login, loginCookie, sessionCookieFrom, uniqueName } from "../helpers";

const GENERIC = "Nume de utilizator sau parolă incorecte.";

async function createStaff(adminCookie: string, role = "PROFESOR", password = "Temporar#2026") {
  const username = uniqueName("test");
  const res = await call(createUserRoute, "POST", "/api/admin/users", {
    cookie: adminCookie,
    body: { firstName: "Test", lastName: "Utilizator", username, role, temporaryPassword: password },
  });
  expect(res.status, res.text).toBe(200);
  return { id: res.json.user.id as string, username, password };
}

beforeAll(async () => {
  await resetTestDb();
});

describe("autentificare", () => {
  it("autentificare validă: cookie securizat, fără date sensibile în răspuns", async () => {
    const res = await login("prof.popescu");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, mustChangePassword: false });
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^__Host-sesiune=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=strict/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(res.text).not.toMatch(/argon2|passwordHash|PROFESOR/);

    // The token itself is never stored – only its SHA-256.
    const token = sessionCookieFrom(setCookie).split("=")[1]!;
    expect(await db.session.findUnique({ where: { id: token } })).toBeNull();
    expect(await db.session.findUnique({ where: { id: hashToken(token) } })).not.toBeNull();

    const audit = await db.auditLog.findFirst({ where: { action: "LOGIN" }, orderBy: { id: "desc" } });
    expect(audit?.actorId).toBe((await db.user.findUniqueOrThrow({ where: { username: "prof.popescu" } })).id);
  });

  it("numele de utilizator nu ține cont de majuscule/spații", async () => {
    expect((await login("  Prof.Popescu ")).status).toBe(200);
  });

  it("profilul nu expune rolul intern și nici hash-ul parolei", async () => {
    const cookie = await loginCookie("prof.ionescu");
    const res = await call(meRoute, "GET", "/api/auth/me", { cookie });
    expect(res.status).toBe(200);
    expect(res.json.firstName).toBe("Andrei");
    expect(res.json.capabilities.diriginte).toBe(true);
    expect(res.json).not.toHaveProperty("role");
    expect(res.text).not.toMatch(/PROFESOR|ADMINISTRATOR|COMANDANT|passwordHash|argon2/);
  });

  it("parolă greșită → 401 cu mesaj generic și intrare de audit LOGIN_FAILED", async () => {
    const res = await login("prof.georgescu", "Gresita#2026");
    expect(res.status).toBe(401);
    expect(res.json.error.message).toBe(GENERIC);
    expect(res.headers.get("set-cookie")).toBeNull();
    const audit = await db.auditLog.findFirst({ where: { action: "LOGIN_FAILED" }, orderBy: { id: "desc" } });
    expect(audit?.outcome).toBe("FAILURE");
    expect(JSON.stringify(audit?.metadata)).not.toContain("Gresita#2026");
  });

  it("utilizator inexistent → același răspuns ca parola greșită (fără enumerare)", async () => {
    const res = await login("nu.exista", "Oarecare#2026");
    expect(res.status).toBe(401);
    expect(res.json.error.message).toBe(GENERIC);
  });

  it("cont inactiv → autentificare refuzată chiar și cu parola corectă", async () => {
    const res = await login("prof.inactiv", DEMO_PASSWORD);
    expect(res.status).toBe(401);
    expect(res.json.error.message).toBe(GENERIC);
  });

  it("date lipsă sau malformate → 400/401 fără detalii interne", async () => {
    const res = await call(loginRoute, "POST", "/api/auth/login", { body: { username: 123 } });
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(/stack|prisma|at /i);
  });

  it("protecție brute-force: după 5 eșecuri contul este blocat temporar, chiar și cu parola corectă", async () => {
    const adminCookie = await loginCookie("admin.demo");
    const u = await createStaff(adminCookie);
    for (let i = 0; i < 5; i++) expect((await login(u.username, `Gresit#${i}abc`)).status).toBe(401);
    const blocked = await login(u.username, u.password);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("set-cookie")).toBeNull();
    expect(await db.auditLog.count({ where: { action: "LOGIN_BLOCKED" } })).toBeGreaterThan(0);
  });

  it("delogare: sesiunea este revocată pe server", async () => {
    const cookie = await loginCookie("prof.popescu");
    expect((await call(logoutRoute, "POST", "/api/auth/logout", { cookie })).status).toBe(200);
    expect((await call(meRoute, "GET", "/api/auth/me", { cookie })).status).toBe(401);
  });

  it("fără cookie sau cu cookie falsificat → 401", async () => {
    expect((await call(meRoute, "GET", "/api/auth/me")).status).toBe(401);
    expect((await call(meRoute, "GET", "/api/auth/me", { cookie: "__Host-sesiune=falsificat-0123456789abcdefghij" })).status).toBe(401);
  });

  it("sesiune expirată prin inactivitate → 401", async () => {
    const cookie = await loginCookie("prof.georgescu");
    const token = cookie.split("=")[1]!;
    await db.session.update({ where: { id: hashToken(token) }, data: { lastSeenAt: new Date(Date.now() - 3 * 3600_000) } });
    expect((await call(meRoute, "GET", "/api/auth/me", { cookie })).status).toBe(401);
  });

  it("CSRF: cererile care modifică date fără Origin corect sau cu alt tip de conținut sunt respinse", async () => {
    const cookie = await loginCookie("prof.popescu");
    expect((await call(logoutRoute, "POST", "/api/auth/logout", { cookie, origin: null })).status).toBe(403);
    expect((await call(logoutRoute, "POST", "/api/auth/logout", { cookie, origin: "https://evil.example" })).status).toBe(403);
    const form = await call(loginRoute, "POST", "/api/auth/login", {
      body: { username: "prof.popescu", password: DEMO_PASSWORD },
      contentType: "text/plain",
    });
    expect(form.status).toBe(415);
    // Session still valid after the rejected cross-site logout.
    expect((await call(meRoute, "GET", "/api/auth/me", { cookie })).status).toBe(200);
  });

  it("schimbarea parolei este obligatorie după crearea contului / resetare", async () => {
    const adminCookie = await loginCookie("admin.demo");
    const u = await createStaff(adminCookie);
    const res = await login(u.username, u.password);
    expect(res.json.mustChangePassword).toBe(true);
    const cookie = sessionCookieFrom(res.headers.get("set-cookie"));

    const blocked = await call(classesRoute, "GET", "/api/classes", { cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.json.error.code).toBe("SCHIMBARE_PAROLA_OBLIGATORIE");

    const weak = await call(changePasswordRoute, "POST", "/api/auth/change-password", {
      cookie,
      body: { currentPassword: u.password, newPassword: "slaba" },
    });
    expect(weak.status).toBe(400);
    const wrongCurrent = await call(changePasswordRoute, "POST", "/api/auth/change-password", {
      cookie,
      body: { currentPassword: "Gresita#2026", newPassword: "NouaParola#2026" },
    });
    expect(wrongCurrent.status).toBe(400);
    const ok = await call(changePasswordRoute, "POST", "/api/auth/change-password", {
      cookie,
      body: { currentPassword: u.password, newPassword: "NouaParola#2026" },
    });
    expect(ok.status, ok.text).toBe(200);
    expect((await call(classesRoute, "GET", "/api/classes", { cookie })).status).toBe(200);

    // Admin reset → all sessions of the user are revoked and a change is required again.
    const reset = await call(resetPasswordRoute, "POST", `/api/admin/users/${u.id}/reset-password`, {
      cookie: adminCookie,
      params: { id: u.id },
      body: { temporaryPassword: "Resetata#2026" },
    });
    expect(reset.status).toBe(200);
    expect((await call(meRoute, "GET", "/api/auth/me", { cookie })).status).toBe(401);
    expect((await login(u.username, "Resetata#2026")).json.mustChangePassword).toBe(true);
    const audit = await db.auditLog.findFirst({ where: { action: "PASSWORD_RESET", entityId: u.id } });
    expect(JSON.stringify({ ...audit, id: String(audit?.id) })).not.toContain("Resetata#2026");
  });

  it("dezactivarea unui cont îi închide imediat sesiunile active", async () => {
    const adminCookie = await loginCookie("admin.demo");
    const u = await createStaff(adminCookie);
    const res = await login(u.username, u.password);
    const cookie = sessionCookieFrom(res.headers.get("set-cookie"));
    expect((await call(meRoute, "GET", "/api/auth/me", { cookie })).status).toBe(200);

    const deactivate = await call(userStatusRoute, "POST", `/api/admin/users/${u.id}/status`, {
      cookie: adminCookie,
      params: { id: u.id },
      body: { status: "INACTIVE", reason: "Test dezactivare" },
    });
    expect(deactivate.status).toBe(200);
    expect((await call(meRoute, "GET", "/api/auth/me", { cookie })).status).toBe(401);
    expect((await login(u.username, u.password)).status).toBe(401);
  });

  it("conturile de elev nu se pot autentifica cât timp funcționalitatea este dezactivată", async () => {
    await db.systemSetting.update({ where: { key: "features.studentAccounts" }, data: { value: false } });
    try {
      expect((await login("elev.marin")).status).toBe(401);
    } finally {
      await db.systemSetting.update({ where: { key: "features.studentAccounts" }, data: { value: true } });
    }
    expect((await login("elev.marin")).status).toBe(200);
  });

  it("lista de utilizatori nu conține niciodată hash-uri de parolă", async () => {
    const cookie = await loginCookie("admin.demo");
    const res = await call(listUsersRoute, "GET", "/api/admin/users", { cookie });
    expect(res.status).toBe(200);
    expect(res.json.users.length).toBeGreaterThan(5);
    expect(res.text).not.toMatch(/passwordHash|password_hash|\$argon2/);
  });
});

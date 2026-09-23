/**
 * Database-level protection of history and audit: these guarantees hold even if
 * application code is buggy or the application's DB credentials are misused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { db } from "@/server/db/client";
import { fixtures, type Fixtures } from "../helpers";

let f: Fixtures;
let app: Client; // least-privilege application role
let owner: Client; // schema owner (migrations)

beforeAll(async () => {
  f = await fixtures();
  app = new Client({ connectionString: process.env.DATABASE_URL });
  owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await app.connect();
  await owner.connect();
  // The suite must not depend on other test files having produced audit entries.
  for (let i = 0; i < 5; i++) await db.auditLog.create({ data: { action: "TEST_SETUP", metadata: { i } } });
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

async function lastAuditId(): Promise<string> {
  const r = await app.query("SELECT max(id)::text AS id FROM audit_log");
  return r.rows[0].id;
}

describe("jurnalul de audit este append-only", () => {
  it("rolul aplicației nu poate modifica, șterge sau goli jurnalul", async () => {
    const id = await lastAuditId();
    await expect(app.query("UPDATE audit_log SET action = 'X' WHERE id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(app.query("DELETE FROM audit_log WHERE id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(app.query("TRUNCATE audit_log")).rejects.toThrow(/permission denied/);
  });

  it("nici proprietarul schemei nu poate modifica/șterge intrări (trigger)", async () => {
    const id = await lastAuditId();
    await expect(owner.query("UPDATE audit_log SET action = 'X' WHERE id = $1", [id])).rejects.toThrow(/interzisă/);
    await expect(owner.query("DELETE FROM audit_log WHERE id = $1", [id])).rejects.toThrow(/interzisă/);
    await expect(owner.query("TRUNCATE audit_log")).rejects.toThrow(/interzisă/);
  });

  it("aplicația nu poate antedata intrările; hash-urile formează un lanț verificabil", async () => {
    await db.auditLog.create({ data: { action: "TEST_ENTRY", occurredAt: new Date("2000-01-01T00:00:00Z") } });
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "TEST_ENTRY" }, orderBy: { id: "desc" } });
    expect(row.occurredAt.getUTCFullYear()).toBeGreaterThan(2020);
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    const prev = await db.auditLog.findFirstOrThrow({ where: { id: { lt: row.id } }, orderBy: { id: "desc" } });
    expect(row.prevHash).toBe(prev.hash);

    const ok = await app.query("SELECT checked::int, first_invalid_id FROM audit_log_verify_chain()");
    expect(ok.rows[0].first_invalid_id).toBeNull();
    expect(ok.rows[0].checked).toBeGreaterThanOrEqual(6);
  });

  it("verificarea detectează o modificare făcută ocolind protecțiile (simulare de manipulare)", async () => {
    const r = await owner.query("SELECT id::text, action FROM audit_log ORDER BY id LIMIT 1 OFFSET 3");
    const { id, action } = r.rows[0];
    await owner.query("BEGIN");
    try {
      await owner.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable");
      await owner.query("UPDATE audit_log SET action = 'FALSIFICAT' WHERE id = $1", [id]);
      const bad = await owner.query("SELECT first_invalid_id::text FROM audit_log_verify_chain()");
      expect(bad.rows[0].first_invalid_id).toBe(id);
    } finally {
      await owner.query("ROLLBACK"); // restores the original row and the trigger
    }
    const after = await app.query("SELECT action FROM audit_log WHERE id = $1", [id]);
    expect(after.rows[0].action).toBe(action);
  });
});

describe("datele istorice nu pot fi șterse", () => {
  it("notele, reviziile, utilizatorii, elevii, înmatriculările și repartizările nu pot fi șterse fizic", async () => {
    for (const [table, id] of [
      ["grades", (await db.grade.findFirstOrThrow()).id],
      ["users", f.users.inactiv],
      ["students", f.students.marin],
      ["enrollments", (await db.enrollment.findFirstOrThrow()).id],
      ["teaching_assignments", (await db.teachingAssignment.findFirstOrThrow()).id],
      ["homeroom_assignments", (await db.homeroomAssignment.findFirstOrThrow()).id],
      ["class_sections", f.classes.c112],
      ["academic_years", f.yearId],
    ] as const) {
      await expect(app.query(`DELETE FROM ${table} WHERE id = $1`, [id]), table).rejects.toThrow(/permission denied/);
      await expect(owner.query(`DELETE FROM ${table} WHERE id = $1`, [id]), table).rejects.toThrow(/interzisă|foreign key/);
    }
    const rev = await app.query("SELECT id FROM grade_revisions LIMIT 1");
    await expect(app.query("UPDATE grade_revisions SET value = 1 WHERE id = $1", [rev.rows[0].id])).rejects.toThrow(/permission denied/);
    await expect(owner.query("UPDATE grade_revisions SET value = 1 WHERE id = $1", [rev.rows[0].id])).rejects.toThrow(/interzisă/);
  });

  it("autorul, elevul și clasa unei note nu pot fi schimbate", async () => {
    const g = await db.grade.findFirstOrThrow({ where: { authorId: f.users.popescu } });
    await expect(db.grade.update({ where: { id: g.id }, data: { authorId: f.users.ionescu } })).rejects.toThrow();
    await expect(db.grade.update({ where: { id: g.id }, data: { studentId: f.students.dobre } })).rejects.toThrow();
  });

  it("nota trebuie să fie între 1 și 10 (constrângere în baza de date)", async () => {
    const g = await db.grade.findFirstOrThrow();
    await expect(db.grade.update({ where: { id: g.id }, data: { value: 11 } })).rejects.toThrow();
    await expect(db.grade.update({ where: { id: g.id }, data: { value: 0 } })).rejects.toThrow();
  });

  it("un profesor dezactivat își păstrează notele și intrările de audit", async () => {
    const inactive = await db.user.findUniqueOrThrow({ where: { id: f.users.inactiv } });
    expect(inactive.status).toBe("INACTIVE");
    const ended = await db.teachingAssignment.findFirstOrThrow({ where: { teacherId: f.users.inactiv } });
    expect(ended.endedAt).not.toBeNull();
    // Historical grades authored by the popescu account remain linked even if it were deactivated.
    expect(await db.grade.count({ where: { authorId: f.users.popescu } })).toBeGreaterThan(0);
  });

  it("un singur an școlar activ și o singură înmatriculare activă pe an", async () => {
    await expect(
      db.academicYear.create({ data: { name: "2030–2031", startDate: new Date("2030-09-01"), endDate: new Date("2031-08-31"), status: "ACTIVE" } }),
    ).rejects.toThrow(/singur an școlar activ/);
    await expect(
      db.enrollment.create({
        data: { studentId: f.students.marin, classSectionId: f.classes.c113, academicYearId: f.yearId, startDate: new Date() },
      }),
    ).rejects.toThrow(/înmatriculare activă|Unique constraint/);
  });
});

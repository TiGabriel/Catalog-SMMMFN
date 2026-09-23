import "server-only";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission, hasPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import { snapshotModule } from "@/server/domain/results";
import type {
  moduleSubjectSchema,
  updateModuleSubjectSchema,
  createModuleSchema,
  createSubjectSchema,
  gradeReasonSchema,
  updateGradeReasonSchema,
  updateModuleSchema,
  updateSubjectSchema,
} from "@/lib/validation/schemas";
import { getActiveAcademicYear } from "@/server/domain/academic";

// ───────────── Subjects ─────────────

export async function listSubjects(actor: Actor) {
  await assertPermission(actor, "structure.read");
  return db.subject.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
}

export async function createSubject(actor: Actor, input: z.infer<typeof createSubjectSchema>) {
  await assertPermission(actor, "structure.manage");
  return db.$transaction(async (tx) => {
    const s = await tx.subject.create({ data: { ...input, shortName: input.shortName || null } });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.SUBJECT_CREATE,
      entityType: "Subject",
      entityId: s.id,
      subjectId: s.id,
      after: s,
    });
    return s;
  });
}

export async function updateSubject(actor: Actor, id: string, input: z.infer<typeof updateSubjectSchema>) {
  await assertPermission(actor, "structure.manage");
  const before = await db.subject.findUnique({ where: { id } });
  if (!before) throw Errors.notFound();
  if (before.isSystem && input.active === false) throw Errors.conflict("Materia de sistem nu poate fi dezactivată.");
  return db.$transaction(async (tx) => {
    const s = await tx.subject.update({ where: { id }, data: input });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.SUBJECT_UPDATE,
      entityType: "Subject",
      entityId: id,
      subjectId: id,
      before,
      after: s,
    });
    return s;
  });
}

// ───────────── Modules ─────────────

export async function listModules(actor: Actor, academicYearId?: string) {
  await assertPermission(actor, "structure.read");
  const yearId = academicYearId ?? (await getActiveAcademicYear())?.id;
  if (!yearId) return [];
  return db.module.findMany({ where: { academicYearId: yearId }, orderBy: [{ yearOfStudy: "asc" }, { order: "asc" }] });
}

export async function getModuleAdmin(actor: Actor, id: string) {
  await assertPermission(actor, "structure.read");
  const m = await db.module.findUnique({ where: { id }, include: { academicYear: { select: { id: true, name: true, status: true } } } });
  if (!m) throw Errors.notFound();
  return m;
}

export async function createModule(actor: Actor, input: z.infer<typeof createModuleSchema>) {
  await assertPermission(actor, "structure.manage");
  const year = await db.academicYear.findUnique({ where: { id: input.academicYearId } });
  if (!year) throw Errors.validation({ academicYearId: ["An școlar inexistent."] });
  if (year.status === "CLOSED") throw Errors.conflict("Anul școlar este închis.");
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw Errors.validation({ endDate: ["Data de sfârșit trebuie să fie după data de început."] });
  }
  return db.$transaction(async (tx) => {
    const m = await tx.module.create({ data: { ...input, status: "PLANNED" } });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.MODULE_CREATE,
      entityType: "Module",
      entityId: m.id,
      academicYearId: m.academicYearId,
      after: m,
    });
    return m;
  });
}

/** Status flow PLANNED → OPEN → CLOSED; reopening a closed module is not possible (correction workflow). */
export async function updateModule(actor: Actor, id: string, input: z.infer<typeof updateModuleSchema>) {
  await assertPermission(actor, "structure.manage");
  const before = await db.module.findUnique({ where: { id } });
  if (!before) throw Errors.notFound();
  if (before.status === "CLOSED") throw Errors.conflict("Modulul este închis.");
  if (input.status) {
    const ok = (before.status === "PLANNED" && input.status === "OPEN") || (before.status === "OPEN" && input.status === "CLOSED");
    if (!ok) throw Errors.conflict("Tranziție de stare nepermisă pentru modul.");
  }
  return db.$transaction(async (tx) => {
    const m = await tx.module.update({ where: { id }, data: input });
    // Closing a module freezes the results of every class (immutable snapshots).
    const snapshots = input.status === "CLOSED" ? await snapshotModule(tx, id, actor.userId) : 0;
    await recordAudit(tx, actor, actor.meta, {
      action: input.status === "CLOSED" ? AuditAction.MODULE_CLOSE : AuditAction.MODULE_UPDATE,
      entityType: "Module",
      entityId: id,
      academicYearId: m.academicYearId,
      before,
      after: m,
      metadata: input.status === "CLOSED" ? { snapshots } : undefined,
    });
    return m;
  });
}

// ───────────── Module curriculum (subject ↔ module) ─────────────

export async function listModuleSubjects(actor: Actor, moduleId: string) {
  await assertPermission(actor, "structure.read");
  const mod = await db.module.findUnique({ where: { id: moduleId } });
  if (!mod) throw Errors.notFound();
  const rows = await db.moduleSubject.findMany({
    where: { moduleId },
    include: {
      subject: { select: { id: true, code: true, name: true, type: true } },
      specialization: { select: { id: true, name: true } },
    },
    orderBy: { subject: { name: "asc" } },
  });
  return rows.map((r) => ({ ...r, weight: r.weight === null ? null : Number(r.weight) }));
}

export async function addModuleSubject(actor: Actor, moduleId: string, input: z.infer<typeof moduleSubjectSchema>) {
  await assertPermission(actor, "structure.manage");
  const mod = await db.module.findUnique({ where: { id: moduleId } });
  if (!mod) throw Errors.notFound();
  if (mod.status === "CLOSED") throw Errors.conflict("Modulul este închis.");
  const subject = await db.subject.findUnique({ where: { id: input.subjectId } });
  if (!subject || !subject.active) throw Errors.validation({ subjectId: ["Materie invalidă."] });
  if (subject.type === "CONDUCT") throw Errors.validation({ subjectId: ["Purtarea face parte automat din fiecare modul."] });
  const dup = await db.moduleSubject.findFirst({
    where: { moduleId, subjectId: input.subjectId, specializationId: input.specializationId ?? null },
  });
  if (dup) throw Errors.conflict("Materia este deja inclusă în modul.");
  return db.$transaction(async (tx) => {
    const ms = await tx.moduleSubject.create({
      data: {
        moduleId,
        subjectId: input.subjectId,
        specializationId: input.specializationId ?? null,
        hasFinalExam: input.hasFinalExam,
        weight: input.weight ?? null,
        hoursPerWeek: input.hoursPerWeek ?? null,
      },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.MODULE_SUBJECT_ADD,
      entityType: "ModuleSubject",
      entityId: ms.id,
      subjectId: input.subjectId,
      academicYearId: mod.academicYearId,
      after: { moduleId, ...input },
    });
    return { ...ms, weight: ms.weight === null ? null : Number(ms.weight) };
  });
}

export async function updateModuleSubject(actor: Actor, id: string, input: z.infer<typeof updateModuleSubjectSchema>) {
  await assertPermission(actor, "structure.manage");
  const before = await db.moduleSubject.findUnique({ where: { id }, include: { module: true } });
  if (!before) throw Errors.notFound();
  if (before.module.status === "CLOSED") throw Errors.conflict("Modulul este închis.");
  if (input.hasFinalExam === false && before.hasFinalExam) {
    const exams = await db.grade.count({ where: { moduleId: before.moduleId, subjectId: before.subjectId, kind: "MODULE_EXAM" } });
    if (exams > 0) throw Errors.conflict("Există deja note de examen pentru această materie în modul.");
  }
  return db.$transaction(async (tx) => {
    const ms = await tx.moduleSubject.update({ where: { id }, data: input });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.MODULE_SUBJECT_UPDATE,
      entityType: "ModuleSubject",
      entityId: id,
      subjectId: ms.subjectId,
      academicYearId: before.module.academicYearId,
      before: { hasFinalExam: before.hasFinalExam, weight: before.weight, hoursPerWeek: before.hoursPerWeek },
      after: { hasFinalExam: ms.hasFinalExam, weight: ms.weight, hoursPerWeek: ms.hoursPerWeek },
    });
    return { ...ms, weight: ms.weight === null ? null : Number(ms.weight) };
  });
}

/** Removal is refused (by a DB trigger as well) once grades exist for the subject in this module. */
export async function removeModuleSubject(actor: Actor, id: string) {
  await assertPermission(actor, "structure.manage");
  const before = await db.moduleSubject.findUnique({ where: { id }, include: { module: true } });
  if (!before) throw Errors.notFound();
  if (before.module.status === "CLOSED") throw Errors.conflict("Modulul este închis.");
  const graded = await db.grade.count({ where: { moduleId: before.moduleId, subjectId: before.subjectId } });
  if (graded > 0) throw Errors.conflict("Materia are deja note în acest modul și nu poate fi eliminată.");
  return db.$transaction(async (tx) => {
    await tx.moduleSubject.delete({ where: { id } });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.MODULE_SUBJECT_REMOVE,
      entityType: "ModuleSubject",
      entityId: id,
      subjectId: before.subjectId,
      academicYearId: before.module.academicYearId,
      before: { moduleId: before.moduleId, subjectId: before.subjectId },
    });
    return { ok: true };
  });
}

/** Which classes study a subject (via module curriculum and assignments) and who teaches it. */
export async function getSubjectOverview(actor: Actor, subjectId: string, academicYearId?: string) {
  await assertPermission(actor, "structure.read");
  const subject = await db.subject.findUnique({ where: { id: subjectId } });
  if (!subject) throw Errors.notFound();
  const yearId = academicYearId ?? (await getActiveAcademicYear())?.id;
  const [modules, assignments] = await Promise.all([
    db.moduleSubject.findMany({
      where: { subjectId, module: { academicYearId: yearId } },
      select: { id: true, hasFinalExam: true, module: { select: { id: true, name: true, yearOfStudy: true, status: true } } },
      orderBy: { module: { order: "asc" } },
    }),
    db.teachingAssignment.findMany({
      where: { subjectId, academicYearId: yearId, endedAt: null },
      select: {
        id: true,
        kind: true,
        classSection: { select: { id: true, code: true } },
        module: { select: { id: true, name: true } },
        teacher: { select: { id: true, firstName: true, lastName: true, rank: { select: { label: true } } } },
      },
      orderBy: { classSection: { code: "asc" } },
    }),
  ]);
  return { subject, modules, assignments };
}

// ───────────── Grade reasons (configurable list) ─────────────

export async function listGradeReasons(actor: Actor, includeInactive = false) {
  if (!hasPermission(actor, "config.read") && !hasPermission(actor, "grades.create.scoped")) {
    await assertPermission(actor, "config.read");
  }
  return db.gradeReason.findMany({
    where: includeInactive && hasPermission(actor, "config.read") ? {} : { active: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createGradeReason(actor: Actor, input: z.infer<typeof gradeReasonSchema>) {
  await assertPermission(actor, "config.manage");
  return db.$transaction(async (tx) => {
    const r = await tx.gradeReason.create({ data: { ...input, appliesTo: [...new Set(input.appliesTo)] } });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.GRADE_REASON_CREATE,
      entityType: "GradeReason",
      entityId: r.id,
      after: r,
    });
    return r;
  });
}

export async function updateGradeReason(actor: Actor, id: string, input: z.infer<typeof updateGradeReasonSchema>) {
  await assertPermission(actor, "config.manage");
  const before = await db.gradeReason.findUnique({ where: { id } });
  if (!before) throw Errors.notFound();
  return db.$transaction(async (tx) => {
    const r = await tx.gradeReason.update({
      where: { id },
      data: { ...input, appliesTo: input.appliesTo ? [...new Set(input.appliesTo)] : undefined },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.GRADE_REASON_UPDATE,
      entityType: "GradeReason",
      entityId: id,
      before,
      after: r,
    });
    return r;
  });
}

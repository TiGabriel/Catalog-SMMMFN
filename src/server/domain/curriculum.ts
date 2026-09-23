import "server-only";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission, hasPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import type {
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
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.MODULE_UPDATE,
      entityType: "Module",
      entityId: id,
      academicYearId: m.academicYearId,
      before,
      after: m,
    });
    return m;
  });
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

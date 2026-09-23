import "server-only";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import { todayUtc } from "@/server/authz/scope";
import type { createHomeroomSchema, createTeachingAssignmentSchema } from "@/lib/validation/schemas";

const personSelect = { id: true, firstName: true, lastName: true, rank: { select: { label: true } } } as const;

/**
 * Only an ACTIVE account with role PROFESOR can receive assignments. This also
 * enforces separation of duties: an administrator (or the commander) can never
 * assign a class to their own account.
 */
async function assertAssignableTeacher(actor: Actor, teacherId: string) {
  if (teacherId === actor.userId) throw Errors.conflict("Nu vă puteți repartiza propriului cont.");
  const t = await db.user.findUnique({ where: { id: teacherId }, select: { role: true, status: true } });
  if (!t || t.role !== "PROFESOR" || t.status !== "ACTIVE") {
    throw Errors.validation({ teacherId: ["Selectați un profesor activ."] });
  }
}

async function assertOpenClass(classSectionId: string) {
  const cls = await db.classSection.findUnique({
    where: { id: classSectionId },
    select: { id: true, active: true, yearOfStudy: true, academicYearId: true, academicYear: { select: { status: true } } },
  });
  if (!cls || !cls.active) throw Errors.validation({ classSectionId: ["Clasă invalidă."] });
  if (cls.academicYear.status === "CLOSED") throw Errors.conflict("Anul școlar este închis.");
  return cls;
}

export async function listTeachingAssignments(
  actor: Actor,
  filter: { academicYearId?: string; teacherId?: string; classSectionId?: string; includeEnded?: boolean } = {},
) {
  await assertPermission(actor, "structure.read");
  return db.teachingAssignment.findMany({
    where: {
      academicYearId: filter.academicYearId,
      teacherId: filter.teacherId,
      classSectionId: filter.classSectionId,
      ...(filter.includeEnded ? {} : { endedAt: null }),
    },
    select: {
      id: true,
      kind: true,
      validFrom: true,
      validTo: true,
      endedAt: true,
      endReason: true,
      teacher: { select: personSelect },
      classSection: { select: { id: true, code: true } },
      subject: { select: { id: true, name: true, type: true } },
      module: { select: { id: true, name: true } },
      academicYear: { select: { id: true, name: true } },
    },
    orderBy: [{ classSection: { code: "asc" } }, { subject: { name: "asc" } }],
  });
}

export async function createTeachingAssignment(actor: Actor, input: z.infer<typeof createTeachingAssignmentSchema>) {
  await assertPermission(actor, "assignments.manage");
  await assertAssignableTeacher(actor, input.teacherId);
  const cls = await assertOpenClass(input.classSectionId);
  const subject = await db.subject.findUnique({ where: { id: input.subjectId } });
  if (!subject || !subject.active) throw Errors.validation({ subjectId: ["Materie invalidă."] });
  if (subject.type === "CONDUCT") {
    throw Errors.validation({ subjectId: ["Nota la purtare este acordată de diriginte; nu se repartizează."] });
  }
  if (input.kind === "PRACTICAL_TRAINING" && subject.type !== "PRACTICAL_TRAINING") {
    throw Errors.validation({ kind: ["Repartizarea pentru instruire practică necesită o materie de tip instruire practică."] });
  }
  if (input.kind === "SUBJECT_TEACHING" && subject.type === "PRACTICAL_TRAINING") {
    throw Errors.validation({ kind: ["Pentru instruirea practică folosiți tipul „Instruire practică”."] });
  }
  let moduleId: string | null = null;
  if (input.kind === "MODULE_EXAM" || input.moduleId) {
    if (!input.moduleId) throw Errors.validation({ moduleId: ["Selectați modulul."] });
    const mod = await db.module.findUnique({ where: { id: input.moduleId } });
    if (!mod || mod.academicYearId !== cls.academicYearId || mod.yearOfStudy !== cls.yearOfStudy) {
      throw Errors.validation({ moduleId: ["Modul invalid pentru această clasă."] });
    }
    if (mod.status === "CLOSED") throw Errors.conflict("Modulul este închis.");
    moduleId = mod.id;
  }
  const duplicate = await db.teachingAssignment.findFirst({
    where: {
      teacherId: input.teacherId,
      classSectionId: cls.id,
      subjectId: subject.id,
      kind: input.kind,
      moduleId,
      endedAt: null,
    },
    select: { id: true },
  });
  if (duplicate) throw Errors.conflict("Repartizarea există deja.");

  const validFrom = input.validFrom ?? todayUtc();
  if (input.validTo && input.validTo < validFrom) {
    throw Errors.validation({ validTo: ["Data de sfârșit trebuie să fie după data de început."] });
  }
  return db.$transaction(async (tx) => {
    const a = await tx.teachingAssignment.create({
      data: {
        teacherId: input.teacherId,
        classSectionId: cls.id,
        subjectId: subject.id,
        academicYearId: cls.academicYearId,
        moduleId,
        kind: input.kind,
        validFrom,
        validTo: input.validTo ?? null,
        createdById: actor.userId,
      },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.ASSIGNMENT_CREATE,
      entityType: "TeachingAssignment",
      entityId: a.id,
      classSectionId: cls.id,
      subjectId: subject.id,
      academicYearId: cls.academicYearId,
      after: { teacherId: a.teacherId, kind: a.kind, moduleId, validFrom: a.validFrom, validTo: a.validTo },
    });
    return a;
  });
}

export async function endTeachingAssignment(actor: Actor, id: string, reason: string) {
  await assertPermission(actor, "assignments.manage");
  const a = await db.teachingAssignment.findUnique({ where: { id } });
  if (!a) throw Errors.notFound();
  if (a.endedAt) throw Errors.conflict("Repartizarea este deja încheiată.");
  const today = todayUtc();
  return db.$transaction(async (tx) => {
    const updated = await tx.teachingAssignment.update({
      where: { id },
      data: {
        endedAt: new Date(),
        endedById: actor.userId,
        endReason: reason,
        validTo: !a.validTo || a.validTo > today ? (today < a.validFrom ? a.validFrom : today) : a.validTo,
      },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.ASSIGNMENT_END,
      entityType: "TeachingAssignment",
      entityId: id,
      classSectionId: a.classSectionId,
      subjectId: a.subjectId,
      academicYearId: a.academicYearId,
      before: { endedAt: null, validTo: a.validTo },
      after: { endedAt: updated.endedAt, validTo: updated.validTo },
      reason,
    });
    return updated;
  });
}

export async function listHomeroomAssignments(actor: Actor, filter: { academicYearId?: string; includeEnded?: boolean } = {}) {
  await assertPermission(actor, "structure.read");
  return db.homeroomAssignment.findMany({
    where: { academicYearId: filter.academicYearId, ...(filter.includeEnded ? {} : { endedAt: null }) },
    select: {
      id: true,
      validFrom: true,
      validTo: true,
      endedAt: true,
      teacher: { select: personSelect },
      classSection: { select: { id: true, code: true } },
      academicYear: { select: { id: true, name: true } },
    },
    orderBy: { classSection: { code: "asc" } },
  });
}

export async function createHomeroomAssignment(actor: Actor, input: z.infer<typeof createHomeroomSchema>) {
  await assertPermission(actor, "assignments.manage");
  await assertAssignableTeacher(actor, input.teacherId);
  const cls = await assertOpenClass(input.classSectionId);
  return db.$transaction(async (tx) => {
    const h = await tx.homeroomAssignment.create({
      data: {
        teacherId: input.teacherId,
        classSectionId: cls.id,
        academicYearId: cls.academicYearId,
        validFrom: input.validFrom ?? todayUtc(),
        createdById: actor.userId,
      },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.HOMEROOM_CREATE,
      entityType: "HomeroomAssignment",
      entityId: h.id,
      classSectionId: cls.id,
      academicYearId: cls.academicYearId,
      after: { teacherId: h.teacherId, validFrom: h.validFrom },
    });
    return h;
  });
}

export async function endHomeroomAssignment(actor: Actor, id: string, reason: string) {
  await assertPermission(actor, "assignments.manage");
  const h = await db.homeroomAssignment.findUnique({ where: { id } });
  if (!h) throw Errors.notFound();
  if (h.endedAt) throw Errors.conflict("Repartizarea este deja încheiată.");
  const today = todayUtc();
  return db.$transaction(async (tx) => {
    const updated = await tx.homeroomAssignment.update({
      where: { id },
      data: {
        endedAt: new Date(),
        endedById: actor.userId,
        endReason: reason,
        validTo: today < h.validFrom ? h.validFrom : today,
      },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.HOMEROOM_END,
      entityType: "HomeroomAssignment",
      entityId: id,
      classSectionId: h.classSectionId,
      academicYearId: h.academicYearId,
      after: { endedAt: updated.endedAt, validTo: updated.validTo },
      reason,
    });
    return updated;
  });
}

/** Teachers selectable in assignment forms (admin only). */
export async function listAssignableTeachers(actor: Actor) {
  await assertPermission(actor, "assignments.manage");
  return db.user.findMany({
    where: { role: "PROFESOR", status: "ACTIVE" },
    select: personSelect,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

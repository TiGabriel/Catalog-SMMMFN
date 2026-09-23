import "server-only";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import type { createStudentSchema, updateStudentSchema } from "@/lib/validation/schemas";
import { todayUtc } from "@/server/authz/scope";

/** Administrative student list (roster only – no grades). */
export async function listStudentsAdmin(actor: Actor, classSectionId?: string, historical = false) {
  await assertPermission(actor, "structure.read");
  // For a closed year, list everyone who finished the year in that class (promoted/graduated/…).
  const statusFilter = historical ? { notIn: ["WITHDRAWN", "TRANSFERRED"] as ("WITHDRAWN" | "TRANSFERRED")[] } : ("ACTIVE" as const);
  return db.student.findMany({
    where: classSectionId ? { enrollments: { some: { classSectionId, status: statusFilter } } } : {},
    select: {
      id: true,
      firstName: true,
      lastName: true,
      registryNumber: true,
      status: true,
      rank: { select: { label: true } },
      enrollments: {
        where: { status: "ACTIVE" },
        select: { classSection: { select: { id: true, code: true, academicYear: { select: { name: true } } } } },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

export async function createStudent(actor: Actor, input: z.infer<typeof createStudentSchema>) {
  await assertPermission(actor, "students.manage");
  const cls = await db.classSection.findUnique({
    where: { id: input.classSectionId },
    select: { id: true, active: true, academicYearId: true, academicYear: { select: { status: true, startDate: true } } },
  });
  if (!cls || !cls.active) throw Errors.validation({ classSectionId: ["Clasă invalidă."] });
  if (cls.academicYear.status === "CLOSED") throw Errors.conflict("Anul școlar este închis.");
  const today = todayUtc();
  const startDate = today > cls.academicYear.startDate ? today : cls.academicYear.startDate;

  return db.$transaction(async (tx) => {
    const student = await tx.student.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        rankId: input.rankId ?? null,
        registryNumber: input.registryNumber || null,
      },
    });
    const enrollment = await tx.enrollment.create({
      data: { studentId: student.id, classSectionId: cls.id, academicYearId: cls.academicYearId, startDate },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.STUDENT_CREATE,
      entityType: "Student",
      entityId: student.id,
      studentId: student.id,
      classSectionId: cls.id,
      academicYearId: cls.academicYearId,
      after: { firstName: student.firstName, lastName: student.lastName, registryNumber: student.registryNumber, enrollmentId: enrollment.id },
    });
    return { ...student, enrollmentId: enrollment.id };
  });
}

/**
 * Updates identity data only. Class membership cannot be changed through normal
 * functionality (no transfer endpoint) – students stay with their class and
 * their historical enrollments.
 */
export async function updateStudent(actor: Actor, id: string, input: z.infer<typeof updateStudentSchema>) {
  await assertPermission(actor, "students.manage");
  const before = await db.student.findUnique({ where: { id } });
  if (!before) throw Errors.notFound();
  return db.$transaction(async (tx) => {
    const s = await tx.student.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        rankId: input.rankId === undefined ? undefined : input.rankId,
        registryNumber: input.registryNumber === undefined ? undefined : input.registryNumber || null,
      },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.STUDENT_UPDATE,
      entityType: "Student",
      entityId: id,
      studentId: id,
      before: { firstName: before.firstName, lastName: before.lastName, registryNumber: before.registryNumber, rankId: before.rankId },
      after: { firstName: s.firstName, lastName: s.lastName, registryNumber: s.registryNumber, rankId: s.rankId },
    });
    return s;
  });
}

/** Administrative view of one student: identity + enrollment history (no grades). */
export async function getStudentAdmin(actor: Actor, id: string) {
  await assertPermission(actor, "structure.read");
  const s = await db.student.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      registryNumber: true,
      status: true,
      rank: { select: { id: true, label: true } },
      user: { select: { id: true, username: true, status: true } },
      enrollments: {
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          classSection: { select: { id: true, code: true } },
          academicYear: { select: { id: true, name: true } },
        },
        orderBy: { startDate: "asc" },
      },
    },
  });
  if (!s) throw Errors.notFound();
  return s;
}

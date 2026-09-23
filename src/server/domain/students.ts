import "server-only";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import type { createStudentSchema } from "@/lib/validation/schemas";
import { todayUtc } from "@/server/authz/scope";

/** Administrative student list (roster only – no grades). */
export async function listStudentsAdmin(actor: Actor, classSectionId?: string) {
  await assertPermission(actor, "structure.read");
  return db.student.findMany({
    where: classSectionId ? { enrollments: { some: { classSectionId, status: "ACTIVE" } } } : {},
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

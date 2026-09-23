import "server-only";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import type {
  academicYearSchema,
  createClassSchema,
  createSpecializationSchema,
  updateClassSchema,
} from "@/lib/validation/schemas";

// ───────────── Academic years ─────────────

export async function listAcademicYears(actor: Actor) {
  await assertPermission(actor, "structure.read");
  return db.academicYear.findMany({ orderBy: { startDate: "desc" } });
}

export async function getActiveAcademicYear() {
  return db.academicYear.findFirst({ where: { status: "ACTIVE" } });
}

export async function createAcademicYear(actor: Actor, input: z.infer<typeof academicYearSchema>) {
  await assertPermission(actor, "structure.manage");
  const name = input.name.replace("-", "–");
  return db.$transaction(async (tx) => {
    const year = await tx.academicYear.create({
      data: { name, startDate: input.startDate, endDate: input.endDate, status: "PLANNED" },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.ACADEMIC_YEAR_CREATE,
      entityType: "AcademicYear",
      entityId: year.id,
      academicYearId: year.id,
      after: year,
    });
    return year;
  });
}

/** PLANNED → ACTIVE (only one active year, enforced by the DB) and ACTIVE → CLOSED. A closed year is final. */
export async function setAcademicYearStatus(actor: Actor, id: string, status: "ACTIVE" | "CLOSED") {
  await assertPermission(actor, "structure.manage");
  const year = await db.academicYear.findUnique({ where: { id } });
  if (!year) throw Errors.notFound();
  const allowed = (year.status === "PLANNED" && status === "ACTIVE") || (year.status === "ACTIVE" && status === "CLOSED");
  if (!allowed) throw Errors.conflict("Tranziție de stare nepermisă pentru anul școlar.");
  return db.$transaction(async (tx) => {
    const updated = await tx.academicYear.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.ACADEMIC_YEAR_UPDATE,
      entityType: "AcademicYear",
      entityId: id,
      academicYearId: id,
      before: { status: year.status },
      after: { status },
    });
    return updated;
  });
}

// ───────────── Companies & specializations ─────────────

export async function listCompanies(actor: Actor) {
  await assertPermission(actor, "structure.read");
  return db.company.findMany({ orderBy: { number: "asc" } });
}

export async function listSpecializations(actor: Actor) {
  await assertPermission(actor, "structure.read");
  return db.specialization.findMany({ orderBy: { code: "asc" } });
}

export async function createSpecialization(actor: Actor, input: z.infer<typeof createSpecializationSchema>) {
  await assertPermission(actor, "structure.manage");
  return db.$transaction(async (tx) => {
    const s = await tx.specialization.create({ data: input });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.CONFIG_UPDATE,
      entityType: "Specialization",
      entityId: s.id,
      after: s,
    });
    return s;
  });
}

// ───────────── Classes ─────────────

const classSelect = {
  id: true,
  code: true,
  yearOfStudy: true,
  active: true,
  academicYear: { select: { id: true, name: true, status: true } },
  company: { select: { id: true, name: true, number: true } },
  cohort: { select: { id: true, name: true, suffix: true, startYear: true } },
  specialization: { select: { id: true, code: true, name: true } },
} as const;

export async function listClasses(actor: Actor, academicYearId?: string) {
  await assertPermission(actor, "structure.read");
  const yearId = academicYearId ?? (await getActiveAcademicYear())?.id;
  if (!yearId) return [];
  return db.classSection.findMany({
    where: { academicYearId: yearId },
    select: classSelect,
    orderBy: [{ yearOfStudy: "desc" }, { code: "asc" }],
  });
}

/**
 * Creates class `<yearOfStudy><suffix>` in an academic year. The cohort
 * (promoție) is derived from the year of entry so that 1xy and the later 2xy
 * share it; the company follows the configured year-of-study mapping.
 */
export async function createClass(actor: Actor, input: z.infer<typeof createClassSchema>) {
  await assertPermission(actor, "structure.manage");
  const year = await db.academicYear.findUnique({ where: { id: input.academicYearId } });
  if (!year) throw Errors.validation({ academicYearId: ["An școlar inexistent."] });
  if (year.status === "CLOSED") throw Errors.conflict("Anul școlar este închis.");
  const company = await db.company.findUnique({ where: { yearOfStudy: input.yearOfStudy } });
  if (!company) throw Errors.conflict("Nu există o companie configurată pentru acest an de studiu.");

  const startYear = year.startDate.getUTCFullYear() - (input.yearOfStudy - 1);
  const code = `${input.yearOfStudy}${input.suffix}`;
  return db.$transaction(async (tx) => {
    const cohort = await tx.cohort.upsert({
      where: { startYear_suffix: { startYear, suffix: input.suffix } },
      create: {
        startYear,
        suffix: input.suffix,
        specializationId: input.specializationId ?? null,
        name: `Promoția ${startYear}–${startYear + 2} / ${input.suffix}`,
      },
      update: {},
    });
    const cls = await tx.classSection.create({
      data: {
        academicYearId: year.id,
        cohortId: cohort.id,
        companyId: company.id,
        specializationId: input.specializationId ?? cohort.specializationId,
        yearOfStudy: input.yearOfStudy,
        code,
      },
      select: classSelect,
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.CLASS_CREATE,
      entityType: "ClassSection",
      entityId: cls.id,
      classSectionId: cls.id,
      academicYearId: year.id,
      after: { code, yearOfStudy: input.yearOfStudy, company: company.name, cohort: cohort.name },
    });
    return cls;
  });
}

export async function updateClass(actor: Actor, id: string, input: z.infer<typeof updateClassSchema>) {
  await assertPermission(actor, "structure.manage");
  const before = await db.classSection.findUnique({ where: { id }, select: { ...classSelect } });
  if (!before) throw Errors.notFound();
  if (before.academicYear.status === "CLOSED") throw Errors.conflict("Anul școlar este închis.");
  return db.$transaction(async (tx) => {
    const cls = await tx.classSection.update({ where: { id }, data: input, select: classSelect });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.CLASS_UPDATE,
      entityType: "ClassSection",
      entityId: id,
      classSectionId: id,
      before: { active: before.active, specializationId: before.specialization?.id ?? null },
      after: { active: cls.active, specializationId: cls.specialization?.id ?? null },
    });
    return cls;
  });
}

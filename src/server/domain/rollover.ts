import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/server/db/client";
import { AppError, Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import { revokeAllUserSessions } from "@/server/auth/session";
import { getSetting } from "@/server/domain/settings";
import { snapshotModule } from "@/server/domain/results";
import { addDays, isoDateOnly, schoolDate } from "@/server/time";

/**
 * Academic-year transition ("trecerea în noul an școlar"), normally on 1 September:
 * - year I classes 1xy → new year II classes 2xy (same cohort / promoție), students promoted;
 * - year II students → graduated (history kept, optional login accounts deactivated);
 * - new, empty year I classes are prepared for the next intake;
 * - the old year is closed (read-only), open modules are closed with frozen results,
 *   the old year's assignments are ended – nothing is deleted.
 *
 * Idempotent: serialized by an advisory lock, refused before the new year's start
 * date, and recorded once per (fromYear, toYear) in `year_rollovers` (unique).
 * Running it twice never duplicates enrollments or promotes anyone twice.
 */

export type RolloverTrigger = "ADMIN" | "AUTO" | "CLI";

export class RolloverNotDue extends AppError {
  constructor(public readonly earliest: string) {
    super(409, "TRECERE_PREMATURA", `Trecerea în noul an școlar poate fi efectuată începând cu ${earliest.split("-").reverse().join(".")}.`);
  }
}

type Year = { id: string; name: string; startDate: Date; endDate: Date; status: string };

function nextYearOf(from: Year) {
  const start = addDays(from.endDate, 1);
  const startYear = start.getUTCFullYear();
  return {
    name: `${startYear}–${startYear + 1}`,
    startDate: start,
    endDate: new Date(Date.UTC(startYear + 1, 7, 31)),
  };
}

export type RolloverPlan = {
  fromYear: { id: string; name: string };
  toYear: { name: string; startDate: string; endDate: string; exists: boolean };
  due: boolean;
  alreadyExecuted: boolean;
  promotions: { fromClass: string; toClass: string; students: number }[];
  graduations: { classCode: string; students: number }[];
  repeating: number;
  newYearOneClasses: string[];
  openModules: number;
  pendingCorrections: number;
  activeAssignments: number;
  warnings: string[];
};

async function buildPlan(client: Tx | typeof db, now: Date): Promise<RolloverPlan> {
  const from = await client.academicYear.findFirst({ where: { status: "ACTIVE" } });
  if (!from) throw Errors.conflict("Nu există un an școlar activ.");
  const target = nextYearOf(from);
  const existingTo = await client.academicYear.findUnique({ where: { name: target.name } });
  const already = existingTo ? await client.yearRollover.findUnique({ where: { fromYearId_toYearId: { fromYearId: from.id, toYearId: existingTo.id } } }) : null;

  const classes = await client.classSection.findMany({
    where: { academicYearId: from.id },
    select: { id: true, code: true, yearOfStudy: true, cohort: { select: { suffix: true } } },
    orderBy: { code: "asc" },
  });
  const counts = await client.enrollment.groupBy({
    by: ["classSectionId", "status"],
    where: { academicYearId: from.id, status: { in: ["ACTIVE", "REPEATING"] } },
    _count: { _all: true },
  });
  const count = (classId: string, status: "ACTIVE" | "REPEATING") =>
    counts.find((c) => c.classSectionId === classId && c.status === status)?._count._all ?? 0;

  const suffixes = await getSetting("school.classSuffixes");
  const [openModules, pendingCorrections, activeAssignments] = await Promise.all([
    client.module.count({ where: { academicYearId: from.id, status: { not: "CLOSED" } } }),
    client.gradeCorrectionRequest.count({ where: { status: "PENDING", classSection: { academicYearId: from.id } } }),
    client.teachingAssignment.count({ where: { academicYearId: from.id, endedAt: null } }),
  ]);
  const warnings: string[] = [];
  if (openModules) warnings.push(`${openModules} module nu sunt închise; vor fi închise automat, cu înghețarea rezultatelor.`);
  if (pendingCorrections) warnings.push(`${pendingCorrections} cereri de corecție sunt încă în așteptare; ele pot fi soluționate și după trecere.`);
  const today = schoolDate(now);

  return {
    fromYear: { id: from.id, name: from.name },
    toYear: { name: target.name, startDate: isoDateOnly(target.startDate), endDate: isoDateOnly(target.endDate), exists: !!existingTo },
    due: today >= target.startDate,
    alreadyExecuted: !!already,
    promotions: classes
      .filter((c) => c.yearOfStudy === 1)
      .map((c) => ({ fromClass: c.code, toClass: `2${c.cohort.suffix}`, students: count(c.id, "ACTIVE") })),
    graduations: classes.filter((c) => c.yearOfStudy === 2).map((c) => ({ classCode: c.code, students: count(c.id, "ACTIVE") })),
    repeating: classes.reduce((a, c) => a + count(c.id, "REPEATING"), 0),
    newYearOneClasses: suffixes.map((s) => `1${s}`),
    openModules,
    pendingCorrections,
    activeAssignments,
    warnings,
  };
}

export async function previewRollover(actor: Actor, now = new Date()) {
  await assertPermission(actor, "structure.manage");
  return buildPlan(db, now);
}

export type RolloverResult = { status: "EXECUTED" | "ALREADY_EXECUTED"; fromYear: string; toYear: string; summary: Record<string, unknown> };

/**
 * Executes the transition. `actor` is null for the automatic server job / CLI.
 * Throws RolloverNotDue before the new year's start date (1 September).
 */
export async function executeRollover(opts: { actor: Actor | null; trigger: RolloverTrigger; now?: Date }): Promise<RolloverResult> {
  if (opts.actor) await assertPermission(opts.actor, "structure.manage");
  const now = opts.now ?? new Date();
  const today = schoolDate(now);

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('year_rollover'))`;
      const from = await tx.academicYear.findFirst({ where: { status: "ACTIVE" } });
      if (!from) throw Errors.conflict("Nu există un an școlar activ.");
      const target = nextYearOf(from);
      if (today < target.startDate) throw new RolloverNotDue(isoDateOnly(target.startDate));

      let to = await tx.academicYear.findUnique({ where: { name: target.name } });
      if (to) {
        const done = await tx.yearRollover.findUnique({ where: { fromYearId_toYearId: { fromYearId: from.id, toYearId: to.id } } });
        if (done) return { status: "ALREADY_EXECUTED", fromYear: from.name, toYear: to.name, summary: done.summary as Record<string, unknown> };
        if (to.status === "CLOSED") throw Errors.conflict(`Anul școlar ${to.name} este deja închis.`);
      } else {
        to = await tx.academicYear.create({ data: { ...target, status: "PLANNED" } });
      }

      const actorId = opts.actor?.userId ?? null;
      const plan = await buildPlan(tx, now);

      // 1. Close the old year's open modules (results are frozen, nothing is lost).
      const openModules = await tx.module.findMany({ where: { academicYearId: from.id, status: { not: "CLOSED" } } });
      let snapshots = 0;
      for (const m of openModules) {
        await tx.module.update({ where: { id: m.id }, data: { status: "CLOSED" } });
        snapshots += await snapshotModule(tx, m.id, actorId);
      }

      // 2. Switch years: the old one becomes read-only history.
      await tx.academicYear.update({ where: { id: from.id }, data: { status: "CLOSED" } });
      await tx.academicYear.update({ where: { id: to.id }, data: { status: "ACTIVE" } });

      // 3. Classes of the new year.
      const companies = await tx.company.findMany();
      const companyFor = (y: number) => {
        const c = companies.find((x) => x.yearOfStudy === y);
        if (!c) throw Errors.conflict(`Nu există o companie configurată pentru anul ${y}.`);
        return c.id;
      };
      const oldClasses = await tx.classSection.findMany({ where: { academicYearId: from.id }, include: { cohort: true } });
      const ensureClass = async (yearOfStudy: 1 | 2, cohortId: string, suffix: string, specializationId: string | null) =>
        tx.classSection.upsert({
          where: { academicYearId_code: { academicYearId: to.id, code: `${yearOfStudy}${suffix}` } },
          create: { academicYearId: to.id, cohortId, companyId: companyFor(yearOfStudy), yearOfStudy, code: `${yearOfStudy}${suffix}`, specializationId },
          update: {},
        });
      const newYearTwo = new Map<string, string>(); // suffix → class id
      for (const c of oldClasses.filter((x) => x.yearOfStudy === 1)) {
        const cls = await ensureClass(2, c.cohortId, c.cohort.suffix, c.specializationId);
        newYearTwo.set(c.cohort.suffix, cls.id);
      }
      const newYearOne = new Map<string, string>();
      const startYear = to.startDate.getUTCFullYear();
      const suffixes = new Set([...(await getSetting("school.classSuffixes")), ...oldClasses.filter((x) => x.yearOfStudy === 1).map((x) => x.cohort.suffix)]);
      for (const suffix of suffixes) {
        const cohort = await tx.cohort.upsert({
          where: { startYear_suffix: { startYear, suffix } },
          create: { startYear, suffix, name: `Promoția ${startYear}–${startYear + 2} / ${suffix}` },
          update: {},
        });
        const cls = await ensureClass(1, cohort.id, suffix, cohort.specializationId);
        newYearOne.set(suffix, cls.id);
      }

      // 4. Enrollments: promote year I, graduate year II, keep repeaters in their year.
      const enrollments = await tx.enrollment.findMany({
        where: { academicYearId: from.id, status: { in: ["ACTIVE", "REPEATING"] } },
        include: { classSection: { include: { cohort: true } }, student: { select: { id: true, userId: true } } },
      });
      const alreadyInNewYear = new Set(
        (await tx.enrollment.findMany({ where: { academicYearId: to.id }, select: { studentId: true } })).map((e) => e.studentId),
      );
      let promoted = 0;
      let graduated = 0;
      let repeating = 0;
      const enroll = async (studentId: string, classSectionId: string) => {
        if (alreadyInNewYear.has(studentId)) return;
        await tx.enrollment.create({ data: { studentId, classSectionId, academicYearId: to!.id, startDate: to!.startDate } });
        alreadyInNewYear.add(studentId);
      };
      for (const e of enrollments) {
        const suffix = e.classSection.cohort.suffix;
        if (e.status === "REPEATING") {
          await tx.enrollment.update({ where: { id: e.id }, data: { endDate: from.endDate } });
          const target = e.classSection.yearOfStudy === 1 ? newYearOne.get(suffix) : newYearTwo.get(suffix);
          if (target) await enroll(e.studentId, target);
          repeating++;
        } else if (e.classSection.yearOfStudy === 1) {
          await tx.enrollment.update({ where: { id: e.id }, data: { status: "PROMOTED", endDate: from.endDate } });
          await enroll(e.studentId, newYearTwo.get(suffix)!);
          promoted++;
        } else {
          await tx.enrollment.update({ where: { id: e.id }, data: { status: "GRADUATED", endDate: from.endDate } });
          await tx.student.update({ where: { id: e.studentId }, data: { status: "GRADUATED" } });
          if (e.student.userId) {
            // Graduated students' login accounts are deactivated; their academic history stays.
            await tx.user.updateMany({ where: { id: e.student.userId, status: "ACTIVE" }, data: { status: "INACTIVE", deactivatedAt: now } });
            await revokeAllUserSessions(tx, e.student.userId, "STUDENT_GRADUATED");
          }
          graduated++;
        }
      }

      // 5. The old year's assignments end with the year (kept as history).
      const endData = (validFrom: Date) => ({ endedAt: now, endedById: actorId, endReason: "Încheierea anului școlar", validTo: from.endDate < validFrom ? validFrom : from.endDate });
      const teaching = await tx.teachingAssignment.findMany({ where: { academicYearId: from.id, endedAt: null }, select: { id: true, validFrom: true } });
      for (const a of teaching) await tx.teachingAssignment.update({ where: { id: a.id }, data: endData(a.validFrom) });
      const homeroom = await tx.homeroomAssignment.findMany({ where: { academicYearId: from.id, endedAt: null }, select: { id: true, validFrom: true } });
      for (const a of homeroom) await tx.homeroomAssignment.update({ where: { id: a.id }, data: endData(a.validFrom) });

      const summary = {
        trigger: opts.trigger,
        executedOn: isoDateOnly(today),
        promoted,
        graduated,
        repeating,
        classesYearTwo: [...newYearTwo.keys()].map((s) => `2${s}`),
        classesYearOne: [...newYearOne.keys()].map((s) => `1${s}`),
        modulesClosed: openModules.length,
        resultSnapshots: snapshots,
        assignmentsEnded: teaching.length + homeroom.length,
        plan: { promotions: plan.promotions, graduations: plan.graduations },
      };
      await tx.yearRollover.create({
        data: { fromYearId: from.id, toYearId: to.id, executedById: actorId, summary: summary as Prisma.InputJsonValue },
      });
      await recordAudit(tx, opts.actor, opts.actor?.meta ?? null, {
        action: AuditAction.YEAR_ROLLOVER,
        entityType: "AcademicYear",
        entityId: to.id,
        academicYearId: to.id,
        before: { activeYear: from.name },
        after: { activeYear: to.name },
        metadata: summary,
      });
      return { status: "EXECUTED", fromYear: from.name, toYear: to.name, summary };
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}

/** Automatic mode: called by the server scheduler and the CLI. Never throws for "not due yet". */
export async function runAutomaticRollover(trigger: "AUTO" | "CLI", now = new Date()): Promise<RolloverResult | { status: "NOT_DUE" | "DISABLED"; earliest?: string }> {
  if (trigger === "AUTO" && (await getSetting("rollover.mode")) !== "AUTO") return { status: "DISABLED" };
  try {
    return await executeRollover({ actor: null, trigger, now });
  } catch (err) {
    if (err instanceof RolloverNotDue) return { status: "NOT_DUE", earliest: err.earliest };
    throw err;
  }
}

export async function listRollovers(actor: Actor) {
  await assertPermission(actor, "structure.read");
  return db.yearRollover.findMany({
    orderBy: { executedAt: "desc" },
    include: {
      fromYear: { select: { name: true } },
      toYear: { select: { name: true } },
      executedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

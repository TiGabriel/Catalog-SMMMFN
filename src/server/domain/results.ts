import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type DbOrTx } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission, denyWith, getClassAccess } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import { computeModuleResults, type EngineSubject, type StudentResult } from "@/server/results/engine";
import { PROVISIONAL_RULES, PROVISIONAL_RULESET_NAME, ruleDefinitionSchema, type RuleDefinition } from "@/server/results/rules";
import type { ruleSetCreateSchema } from "@/lib/validation/schemas";

export type RuleSetRef = { id: string | null; name: string; version: number; definition: RuleDefinition; provisional: boolean };

export type ModuleResultTable = {
  module: { id: string; name: string; status: string };
  classSection: { id: string; code: string };
  ruleSet: RuleSetRef;
  subjects: EngineSubject[];
  rows: StudentResult[];
  frozen: boolean;
  computedAt: string;
};

/** Active rule set for a year (year-specific first, then global); provisional defaults otherwise. */
export async function getActiveRuleSet(client: DbOrTx, academicYearId: string): Promise<RuleSetRef> {
  const rs =
    (await client.averagingRuleSet.findFirst({ where: { status: "ACTIVE", academicYearId } })) ??
    (await client.averagingRuleSet.findFirst({ where: { status: "ACTIVE", academicYearId: null } }));
  if (rs) {
    const parsed = ruleDefinitionSchema.safeParse(rs.definition);
    if (parsed.success) {
      return { id: rs.id, name: rs.name, version: rs.version, definition: parsed.data, provisional: rs.name === PROVISIONAL_RULESET_NAME };
    }
    console.error(`[results] invalid rule set ${rs.id}; falling back to provisional rules`);
  }
  return { id: null, name: PROVISIONAL_RULESET_NAME, version: 0, definition: PROVISIONAL_RULES, provisional: true };
}

/** Live calculation for one class and module (no authorization – callers check). */
export async function computeClassModule(client: DbOrTx, classSectionId: string, moduleId: string): Promise<ModuleResultTable> {
  const [cls, mod] = await Promise.all([
    client.classSection.findUniqueOrThrow({ where: { id: classSectionId }, select: { id: true, code: true, specializationId: true, academicYearId: true } }),
    client.module.findUniqueOrThrow({ where: { id: moduleId }, select: { id: true, name: true, status: true } }),
  ]);
  const [moduleSubjects, conduct, enrollments, grades, ruleSet] = await Promise.all([
    client.moduleSubject.findMany({
      where: { moduleId, OR: [{ specializationId: null }, ...(cls.specializationId ? [{ specializationId: cls.specializationId }] : [])] },
      select: { hasFinalExam: true, weight: true, subject: { select: { id: true, name: true, type: true } } },
      orderBy: { subject: { name: "asc" } },
    }),
    client.subject.findFirst({ where: { type: "CONDUCT", isSystem: true }, select: { id: true, name: true } }),
    client.enrollment.findMany({
      where: { classSectionId, status: { notIn: ["WITHDRAWN", "TRANSFERRED"] } },
      select: { student: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
    }),
    client.grade.findMany({
      where: { classSectionId, moduleId, status: "ACTIVE" },
      select: { studentId: true, subjectId: true, kind: true, value: true, gradeDate: true, createdAt: true },
    }),
    getActiveRuleSet(client, cls.academicYearId),
  ]);
  const subjects: EngineSubject[] = moduleSubjects
    .filter((ms) => ms.subject.type !== "CONDUCT")
    .map((ms) => ({
      id: ms.subject.id,
      name: ms.subject.name,
      type: ms.subject.type,
      hasFinalExam: ms.hasFinalExam,
      weight: ms.weight === null ? null : Number(ms.weight),
    }));
  if (conduct) subjects.push({ id: conduct.id, name: conduct.name, type: "CONDUCT", hasFinalExam: false, weight: null });

  const rows = computeModuleResults(
    enrollments.map((e) => e.student),
    subjects,
    grades.map((g) => ({ ...g, value: Number(g.value) })),
    ruleSet.definition,
  );
  return {
    module: mod,
    classSection: { id: cls.id, code: cls.code },
    ruleSet,
    subjects,
    rows,
    frozen: false,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Module results are visible to those who see every subject of the class:
 * the commander (all classes) and the diriginte (own class). Frozen snapshots
 * are returned for closed modules.
 */
export async function getModuleResults(actor: Actor, classSectionId: string, moduleId: string): Promise<ModuleResultTable> {
  const access = await getClassAccess(actor, classSectionId);
  if (access.gradeSubjects !== "ALL") {
    return denyWith(actor, "notFound", { resource: "ModuleResults", classSectionId, moduleId });
  }
  const [cls, mod] = await Promise.all([
    db.classSection.findUniqueOrThrow({ where: { id: classSectionId }, select: { academicYearId: true, yearOfStudy: true } }),
    db.module.findUnique({ where: { id: moduleId } }),
  ]);
  if (!mod || mod.academicYearId !== cls.academicYearId || mod.yearOfStudy !== cls.yearOfStudy) {
    return denyWith(actor, "notFound", { resource: "ModuleResults", classSectionId, moduleId });
  }
  const snapshot = await db.moduleResultSnapshot.findUnique({ where: { moduleId_classSectionId: { moduleId, classSectionId } } });
  if (snapshot) return { ...(snapshot.data as unknown as ModuleResultTable), frozen: true, computedAt: snapshot.computedAt.toISOString() };
  return computeClassModule(db, classSectionId, moduleId);
}

/** Freezes the results of every class of a module (called in the module-closing transaction). */
/** `actorId` is null when the automatic year transition closes the module. */
export async function snapshotModule(tx: DbOrTx, moduleId: string, actorId: string | null): Promise<number> {
  const mod = await tx.module.findUniqueOrThrow({ where: { id: moduleId } });
  const classes = await tx.classSection.findMany({
    where: { academicYearId: mod.academicYearId, yearOfStudy: mod.yearOfStudy },
    select: { id: true },
  });
  let count = 0;
  for (const c of classes) {
    const exists = await tx.moduleResultSnapshot.findUnique({ where: { moduleId_classSectionId: { moduleId, classSectionId: c.id } } });
    if (exists) continue;
    const table = await computeClassModule(tx, c.id, moduleId);
    await tx.moduleResultSnapshot.create({
      data: {
        moduleId,
        classSectionId: c.id,
        ruleSetId: table.ruleSet.id,
        data: JSON.parse(JSON.stringify({ ...table, module: { ...table.module, status: "CLOSED" } })) as Prisma.InputJsonValue,
        computedById: actorId,
      },
    });
    count++;
  }
  return count;
}

// ───────────── Rule set administration ─────────────

export async function listRuleSets(actor: Actor) {
  await assertPermission(actor, "config.read");
  return db.averagingRuleSet.findMany({
    orderBy: [{ name: "asc" }, { version: "desc" }],
    include: { academicYear: { select: { name: true } } },
  });
}

export async function createRuleSet(actor: Actor, input: z.infer<typeof ruleSetCreateSchema>) {
  await assertPermission(actor, "config.manage");
  const parsed = ruleDefinitionSchema.safeParse(input.definition);
  if (!parsed.success) throw Errors.validation({ definition: ["Definiția regulilor nu este validă."] });
  const last = await db.averagingRuleSet.findFirst({ where: { name: input.name }, orderBy: { version: "desc" } });
  return db.$transaction(async (tx) => {
    const rs = await tx.averagingRuleSet.create({
      data: {
        name: input.name,
        version: (last?.version ?? 0) + 1,
        academicYearId: input.academicYearId ?? null,
        definition: parsed.data,
        createdById: actor.userId,
      },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.RULESET_CREATE,
      entityType: "AveragingRuleSet",
      entityId: rs.id,
      after: { name: rs.name, version: rs.version, definition: parsed.data },
    });
    return rs;
  });
}

/** Activates a draft; the previously active set of the same scope is archived. */
export async function activateRuleSet(actor: Actor, id: string) {
  await assertPermission(actor, "config.manage");
  const rs = await db.averagingRuleSet.findUnique({ where: { id } });
  if (!rs) throw Errors.notFound();
  if (rs.status !== "DRAFT") throw Errors.conflict("Doar un set de reguli în lucru poate fi activat.");
  return db.$transaction(async (tx) => {
    const previous = await tx.averagingRuleSet.findMany({ where: { status: "ACTIVE", academicYearId: rs.academicYearId } });
    await tx.averagingRuleSet.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { status: "ARCHIVED" } });
    const activated = await tx.averagingRuleSet.update({ where: { id }, data: { status: "ACTIVE", activatedAt: new Date() } });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.RULESET_ACTIVATE,
      entityType: "AveragingRuleSet",
      entityId: id,
      before: { active: previous.map((p) => ({ id: p.id, name: p.name, version: p.version })) },
      after: { id, name: activated.name, version: activated.version },
    });
    return activated;
  });
}

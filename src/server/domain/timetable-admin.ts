import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import { buildTemplate, normalizeText, TEMPLATE_VERSION } from "@/server/timetable/template";
import { parseTimetableWorkbook, type Issue, type RefData } from "@/server/timetable/parse";
import { weekStart } from "@/server/domain/timetable";
import { addDays, isoDateOnly } from "@/server/time";

/**
 * Timetable administration: template → upload → validation report → draft
 * version → preview (with diff) → publish. Publishing never modifies or deletes
 * earlier versions: the displayed timetable for a week is the published version
 * with the latest start date covering that week, so archiving the newest
 * version restores the previous one automatically.
 */

async function loadRefData(academicYearId: string): Promise<RefData> {
  const [classes, subjects, teachers, slots, assignments] = await Promise.all([
    db.classSection.findMany({ where: { academicYearId, active: true }, select: { id: true, code: true } }),
    db.subject.findMany({ where: { active: true }, select: { id: true, code: true, name: true, type: true } }),
    db.user.findMany({ where: { role: "PROFESOR", status: { not: "DELETED" } }, select: { id: true, username: true, status: true } }),
    db.timeSlot.findMany({ where: { active: true } }),
    db.teachingAssignment.findMany({ where: { academicYearId, endedAt: null }, select: { teacherId: true, classSectionId: true, subjectId: true } }),
  ]);
  return {
    classes: new Map(classes.map((c) => [c.code, c.id])),
    subjectsByCode: new Map(subjects.map((s) => [s.code.toUpperCase(), { id: s.id, type: s.type }])),
    subjectsByName: new Map(subjects.map((s) => [normalizeText(s.name), { id: s.id, type: s.type }])),
    teachers: new Map(teachers.map((t) => [t.username, { id: t.id, active: t.status === "ACTIVE" }])),
    slotsByIndex: new Map(slots.map((s) => [s.index, s.id])),
    slotsByStart: new Map(slots.map((s) => [s.startTime, s.id])),
    assignments: new Set(assignments.map((a) => `${a.teacherId}|${a.classSectionId}|${a.subjectId}`)),
  };
}

async function openYear(academicYearId: string) {
  const year = await db.academicYear.findUnique({ where: { id: academicYearId } });
  if (!year) throw Errors.validation({ academicYearId: ["An școlar inexistent."] });
  if (year.status === "CLOSED") throw Errors.conflict("Anul școlar este închis; orarul său nu mai poate fi modificat.");
  return year;
}

export async function downloadTemplate(actor: Actor, academicYearId: string) {
  await assertPermission(actor, "timetable.manage");
  const year = await openYear(academicYearId);
  const [classes, subjects, teachers, slots] = await Promise.all([
    db.classSection.findMany({ where: { academicYearId, active: true }, select: { code: true }, orderBy: { code: "asc" } }),
    db.subject.findMany({ where: { active: true, type: { not: "CONDUCT" } }, select: { code: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { role: "PROFESOR", status: "ACTIVE" }, select: { username: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }),
    db.timeSlot.findMany({ where: { active: true }, orderBy: { index: "asc" } }),
  ]);
  const buf = await buildTemplate({
    yearName: year.name,
    classes: classes.map((c) => c.code),
    subjects,
    teachers: teachers.map((t) => ({ username: t.username, name: `${t.lastName} ${t.firstName}` })),
    slots,
  });
  return { buffer: buf, fileName: `sablon-orar-${year.name.replace("–", "-")}.xlsx` };
}

export type ImportInput = { file: Buffer; fileName: string; academicYearId: string; validFrom: Date; validTo?: Date; name: string };

export async function importTimetable(actor: Actor, input: ImportInput) {
  await assertPermission(actor, "timetable.manage");
  const year = await openYear(input.academicYearId);
  // Versions start on a Monday and end on a Sunday.
  const validFrom = weekStart(input.validFrom);
  const validTo = input.validTo ? addDays(weekStart(input.validTo), 6) : null;
  const dateErrors: Issue[] = [];
  if (validFrom < weekStart(year.startDate) || validFrom > year.endDate) {
    dateErrors.push({ row: null, column: null, message: "Săptămâna de început trebuie să fie în anul școlar selectat." });
  }
  if (validTo && (validTo < validFrom || validTo > addDays(year.endDate, 6))) {
    dateErrors.push({ row: null, column: null, message: "Săptămâna de sfârșit trebuie să fie după cea de început și în anul școlar selectat." });
  }

  const ref = await loadRefData(year.id);
  const parsed = dateErrors.length
    ? { entries: [], errors: dateErrors, warnings: [], rowsRead: 0 }
    : await parseTimetableWorkbook(input.file, ref);
  const ok = parsed.errors.length === 0 && parsed.entries.length > 0;
  const report = {
    rowsRead: parsed.rowsRead,
    lessons: parsed.entries.length,
    errors: parsed.errors.slice(0, 500),
    warnings: parsed.warnings.slice(0, 500),
    truncated: parsed.errors.length > 500 || parsed.warnings.length > 500,
  };
  const safeName = input.fileName.replace(/[\\/]/g, "_").replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 120) || "orar.xlsx";

  return db.$transaction(async (tx) => {
    const imp = await tx.timetableImport.create({
      data: {
        fileName: safeName,
        fileHash: createHash("sha256").update(input.file).digest("hex"),
        fileSize: input.file.length,
        templateVersion: TEMPLATE_VERSION,
        status: ok ? "VALIDATED" : "FAILED",
        report: report as unknown as Prisma.InputJsonValue,
        content: new Uint8Array(input.file),
        uploadedById: actor.userId,
      },
    });
    let versionId: string | null = null;
    if (ok) {
      const version = await tx.timetableVersion.create({
        data: { academicYearId: year.id, name: input.name, validFrom, validTo, status: "DRAFT", importId: imp.id, createdById: actor.userId },
      });
      versionId = version.id;
      await tx.timetableEntry.createMany({
        data: parsed.entries.map((e) => ({
          versionId: version.id,
          classSectionId: e.classSectionId,
          dayOfWeek: e.dayOfWeek,
          timeSlotId: e.timeSlotId,
          subjectId: e.subjectId,
          teacherId: e.teacherId,
          room: e.room,
          groupLabel: e.groupLabel,
          weekParity: e.weekParity,
        })),
      });
    }
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.TIMETABLE_IMPORT,
      outcome: ok ? "SUCCESS" : "FAILURE",
      entityType: "TimetableImport",
      entityId: imp.id,
      academicYearId: year.id,
      after: { fileName: safeName, fileHash: imp.fileHash, versionId, validFrom: isoDateOnly(validFrom), validTo: validTo ? isoDateOnly(validTo) : null },
      metadata: { lessons: report.lessons, errors: report.errors.length, warnings: report.warnings.length },
    });
    return { importId: imp.id, versionId, ok, report };
  });
}

export async function listTimetableVersions(actor: Actor, academicYearId?: string) {
  await assertPermission(actor, "timetable.manage");
  return db.timetableVersion.findMany({
    where: academicYearId ? { academicYearId } : {},
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
    include: {
      academicYear: { select: { name: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      publishedBy: { select: { firstName: true, lastName: true } },
      import: { select: { fileName: true, status: true } },
      _count: { select: { entries: true } },
    },
  });
}

export async function listTimetableImports(actor: Actor) {
  await assertPermission(actor, "timetable.manage");
  return db.timetableImport.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 30,
    select: { id: true, fileName: true, status: true, report: true, uploadedAt: true, uploadedBy: { select: { firstName: true, lastName: true } }, version: { select: { id: true } } },
  });
}

const entryKey = (e: { classSectionId: string; dayOfWeek: number; timeSlotId: string; weekParity: string; groupLabel: string | null; subjectId: string; teacherId: string | null; room: string | null }) =>
  [e.classSectionId, e.dayOfWeek, e.timeSlotId, e.weekParity, e.groupLabel ?? "", e.subjectId, e.teacherId ?? "", e.room ?? ""].join("|");

/** Version detail for preview: entries + validation report + diff against the version it would replace. */
export async function getTimetableVersion(actor: Actor, id: string) {
  await assertPermission(actor, "timetable.manage");
  const version = await db.timetableVersion.findUnique({
    where: { id },
    include: {
      academicYear: { select: { id: true, name: true, status: true } },
      import: { select: { fileName: true, report: true, uploadedAt: true } },
      entries: {
        include: {
          classSection: { select: { code: true } },
          subject: { select: { name: true } },
          teacher: { select: { firstName: true, lastName: true, username: true } },
          timeSlot: { select: { index: true, startTime: true, endTime: true } },
        },
        orderBy: [{ classSection: { code: "asc" } }, { dayOfWeek: "asc" }, { timeSlot: { index: "asc" } }],
      },
    },
  });
  if (!version) throw Errors.notFound();
  const replaced = await db.timetableVersion.findFirst({
    where: {
      id: { not: id },
      status: "PUBLISHED",
      validFrom: { lte: addDays(version.validFrom, 6) },
      OR: [{ validTo: null }, { validTo: { gte: version.validFrom } }],
    },
    orderBy: [{ validFrom: "desc" }, { publishedAt: "desc" }],
    include: { entries: true },
  });
  let diff = null;
  if (replaced) {
    const before = new Set(replaced.entries.map(entryKey));
    const after = new Set(version.entries.map(entryKey));
    diff = {
      replacedVersion: { id: replaced.id, name: replaced.name },
      added: [...after].filter((k) => !before.has(k)).length,
      removed: [...before].filter((k) => !after.has(k)).length,
      unchanged: [...after].filter((k) => before.has(k)).length,
    };
  }
  return { version, diff };
}

async function setStatus(actor: Actor, id: string, from: ("DRAFT" | "PUBLISHED" | "ARCHIVED")[], to: "PUBLISHED" | "ARCHIVED", action: "TIMETABLE_PUBLISH" | "TIMETABLE_ARCHIVE") {
  await assertPermission(actor, "timetable.manage");
  const v = await db.timetableVersion.findUnique({ where: { id }, include: { academicYear: true } });
  if (!v) throw Errors.notFound();
  if (!from.includes(v.status)) throw Errors.conflict("Operațiune nepermisă pentru starea curentă a orarului.");
  if (v.academicYear.status === "CLOSED") throw Errors.conflict("Anul școlar este închis.");
  return db.$transaction(async (tx) => {
    const updated = await tx.timetableVersion.update({
      where: { id },
      data: to === "PUBLISHED" ? { status: to, publishedAt: new Date(), publishedById: actor.userId } : { status: to },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction[action],
      entityType: "TimetableVersion",
      entityId: id,
      academicYearId: v.academicYearId,
      before: { status: v.status },
      after: { status: to, name: v.name, validFrom: isoDateOnly(v.validFrom), validTo: v.validTo ? isoDateOnly(v.validTo) : null },
    });
    return updated;
  });
}

export const publishTimetableVersion = (actor: Actor, id: string) => setStatus(actor, id, ["DRAFT"], "PUBLISHED", "TIMETABLE_PUBLISH");
export const archiveTimetableVersion = (actor: Actor, id: string) => setStatus(actor, id, ["DRAFT", "PUBLISHED"], "ARCHIVED", "TIMETABLE_ARCHIVE");
/** Recovery: an archived version that had been published can be published again. */
export async function republishTimetableVersion(actor: Actor, id: string) {
  const v = await db.timetableVersion.findUnique({ where: { id }, select: { publishedAt: true } });
  if (v && !v.publishedAt) throw Errors.conflict("Doar o versiune publicată anterior poate fi republicată.");
  return setStatus(actor, id, ["ARCHIVED"], "PUBLISHED", "TIMETABLE_PUBLISH");
}

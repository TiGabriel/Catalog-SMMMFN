import "server-only";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { assertPermission, hasPermission } from "@/server/authz/policy";
import { loadScope, todayUtc } from "@/server/authz/scope";
import type { Actor } from "@/server/authz/actor";
import { recordAuditSafe, AuditAction } from "@/server/audit/audit";

/** Monday (UTC midnight) of the ISO week containing `d`. */
export function weekStart(d: Date): Date {
  const day = d.getUTCDay() || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)));
}

export function isoWeekNumber(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

async function denyNotFound(actor: Actor, detail: Record<string, unknown>): Promise<never> {
  await recordAuditSafe(actor, actor.meta, { action: AuditAction.ACCESS_DENIED, outcome: "DENIED", metadata: detail });
  throw Errors.notFound();
}

/**
 * Weekly timetable, filtered by scope:
 * - ADMINISTRATOR / COMANDANT UNITATE: everything, optional class/teacher filter;
 * - PROFESOR: own lessons; plus the whole timetable of the own homeroom class;
 * - ELEV: the timetable of the own class.
 * Asking for another teacher or an out-of-scope class yields 404.
 */
export async function getWeekTimetable(
  actor: Actor,
  query: { week?: Date; classSectionId?: string; teacherId?: string },
) {
  const monday = weekStart(query.week ?? todayUtc());
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  const parity = isoWeekNumber(monday) % 2 === 0 ? "EVEN" : "ODD";

  // Plain column filter, applied to both regular entries and date overrides.
  let filter: { classSectionId?: string | { in: string[] }; teacherId?: string };
  if (hasPermission(actor, "timetable.read.all")) {
    filter = { classSectionId: query.classSectionId, teacherId: query.teacherId };
  } else {
    await assertPermission(actor, "timetable.read.own");
    const scope = await loadScope(actor);
    if (actor.role === "PROFESOR") {
      if (query.teacherId && query.teacherId !== actor.userId) {
        return denyNotFound(actor, { resource: "Timetable", teacherId: query.teacherId });
      }
      if (query.classSectionId) {
        if (!scope.homeroomClassIds.has(query.classSectionId)) {
          return denyNotFound(actor, { resource: "Timetable", classSectionId: query.classSectionId });
        }
        filter = { classSectionId: query.classSectionId };
      } else {
        filter = { teacherId: actor.userId };
      }
    } else {
      if (query.teacherId) return denyNotFound(actor, { resource: "Timetable", teacherId: query.teacherId });
      if (query.classSectionId && !scope.studentClassIds.has(query.classSectionId)) {
        return denyNotFound(actor, { resource: "Timetable", classSectionId: query.classSectionId });
      }
      filter = { classSectionId: { in: [...scope.studentClassIds] } };
    }
  }

  const version = await db.timetableVersion.findFirst({
    where: {
      status: "PUBLISHED",
      validFrom: { lte: sunday },
      OR: [{ validTo: null }, { validTo: { gte: monday } }],
    },
    // The newest start date wins; for equal start dates the latest publication wins.
    orderBy: [{ validFrom: "desc" }, { publishedAt: "desc" }],
    select: { id: true, name: true, validFrom: true, validTo: true },
  });

  const [slots, entries, overrides] = await Promise.all([
    db.timeSlot.findMany({ where: { active: true }, orderBy: { index: "asc" } }),
    version
      ? db.timetableEntry.findMany({
          where: { versionId: version.id, weekParity: { in: ["ALL", parity] }, ...filter },
          select: {
            id: true,
            dayOfWeek: true,
            room: true,
            groupLabel: true,
            timeSlot: { select: { id: true, index: true, startTime: true, endTime: true } },
            classSection: { select: { id: true, code: true } },
            subject: { select: { id: true, name: true, shortName: true } },
            teacher: { select: { id: true, firstName: true, lastName: true, rank: { select: { label: true } } } },
          },
          orderBy: [{ dayOfWeek: "asc" }, { timeSlot: { index: "asc" } }],
        })
      : Promise.resolve([]),
    db.timetableOverride.findMany({
      where: { date: { gte: monday, lte: sunday }, ...filter },
      select: {
        id: true,
        date: true,
        cancelled: true,
        room: true,
        note: true,
        timeSlot: { select: { id: true, index: true } },
        classSection: { select: { id: true, code: true } },
        subject: { select: { id: true, name: true } },
        teacher: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
    parity,
    version,
    slots: slots.map((s) => ({ id: s.id, index: s.index, startTime: s.startTime, endTime: s.endTime })),
    entries,
    overrides,
  };
}

/** Active bell schedule (reference data, not sensitive). */
export async function listTimeSlotsForGrid() {
  const slots = await db.timeSlot.findMany({ where: { active: true }, orderBy: { index: "asc" } });
  return slots.map((s) => ({ id: s.id, index: s.index, startTime: s.startTime, endTime: s.endTime }));
}

import "server-only";
import { z } from "zod";
import { Errors } from "@/server/errors";
import type { Actor } from "@/server/authz/actor";
import { recordAuditSafe, AuditAction } from "@/server/audit/audit";
import {
  classAveragesReport, classCatalogReport, generalSituationReport, moduleResultsReport, studentSituationReport, transcriptReport, yearResultsReport,
} from "@/server/reports/builders";
import { REPORT_TYPES, type Report, type ReportType } from "@/server/reports/types";

const id = z.uuid();
const params = {
  "catalog-clasa": z.object({ clasa: id }),
  "medii-clasa": z.object({ clasa: id }),
  "rezultate-modul": z.object({ clasa: id, modul: id }),
  "rezultate-an": z.object({ clasa: id }),
  "situatie-elev": z.object({ elev: id }),
  "foaie-matricola": z.object({ elev: id }),
  "situatie-generala": z.object({ an: id.optional() }),
} satisfies Record<ReportType, z.ZodType>;

export function isReportType(t: string): t is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(t);
}

/** Builds a report by type from query parameters (malformed parameters → 404). */
export async function buildReport(actor: Actor, type: string, query: Record<string, string>): Promise<Report> {
  if (!isReportType(type)) throw Errors.notFound();
  const parsed = params[type].safeParse(query);
  if (!parsed.success) throw Errors.notFound();
  const p = parsed.data as Record<string, string>;
  switch (type) {
    case "catalog-clasa":
      return classCatalogReport(actor, p.clasa!);
    case "medii-clasa":
      return classAveragesReport(actor, p.clasa!);
    case "rezultate-modul":
      return moduleResultsReport(actor, p.clasa!, p.modul!);
    case "rezultate-an":
      return yearResultsReport(actor, p.clasa!);
    case "situatie-elev":
      return studentSituationReport(actor, p.elev!);
    case "foaie-matricola":
      return transcriptReport(actor, p.elev!);
    case "situatie-generala":
      return generalSituationReport(actor, p.an);
  }
}

/** Exports are audited (type and parameters only – never the data). */
export async function auditExport(actor: Actor, type: string, query: Record<string, string>, format: string) {
  await recordAuditSafe(actor, actor.meta, {
    action: AuditAction.REPORT_EXPORT,
    entityType: "Report",
    entityId: type,
    classSectionId: query.clasa,
    studentId: query.elev,
    metadata: { type, format, params: query },
  });
}

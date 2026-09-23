import ExcelJS from "exceljs";
import { safeCell } from "@/server/timetable/template";
import type { Report } from "@/server/reports/types";

const SCHOOL = "Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”";

/** Renders a report as an .xlsx workbook: one sheet per section, print setup A4 landscape. */
export async function reportToXlsx(report: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Catalog SMMMFN";
  wb.created = new Date();
  const used = new Set<string>();
  report.sections.forEach((section, idx) => {
    // Sheet names: max 31 chars, no []:*?/\ and unique.
    let name = (section.title ?? report.title).replace(/[[\]:*?/\\]/g, " ").slice(0, 28) || `Foaia ${idx + 1}`;
    while (used.has(name)) name = `${name.slice(0, 26)} ${idx + 1}`;
    used.add(name);
    const ws = wb.addWorksheet(name, {
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: "frozen", ySplit: 5 }],
    });
    ws.addRow([SCHOOL]).font = { size: 9, italic: true };
    ws.addRow([report.title + (section.title && report.sections.length > 1 ? ` – ${section.title}` : "")]).font = { bold: true, size: 14 };
    ws.addRow([report.subtitle ?? ""]).font = { size: 10 };
    ws.addRow([`Generat la ${new Date(report.generatedAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })} de ${report.generatedBy}${report.provisional ? " · valori provizorii" : ""}`]).font = { size: 9, color: { argb: "FF555555" } };
    const header = ws.addRow(section.columns.map((c) => c.label));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2A55" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    for (const row of section.rows) {
      const r = ws.addRow(row.map((v) => (typeof v === "string" ? safeCell(v) : v)));
      r.eachCell((cell) => (cell.border = { bottom: { style: "hair", color: { argb: "FFBBBBBB" } } }));
    }
    section.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? 16;
      if (c.numeric) col.numFmt = "0.##";
    });
    const notes = [...(section.note ? [section.note] : []), ...(idx === 0 ? (report.notes ?? []) : [])];
    if (notes.length) {
      ws.addRow([]);
      for (const n of notes) ws.addRow([n]).font = { size: 9, italic: true };
    }
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function reportFileName(report: Report): string {
  const slug = report.title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return `${slug || "raport"}-${report.generatedAt.slice(0, 10)}.xlsx`;
}

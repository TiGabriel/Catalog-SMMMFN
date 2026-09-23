import ExcelJS from "exceljs";

/**
 * Timetable import template (version 1). Documented in docs/ORAR_IMPORT.md.
 * Columns are matched by header name (order does not matter, diacritics and
 * letter case are ignored). One row = one lesson.
 */
export const TEMPLATE_VERSION = "1";
export const SHEET_NAME = "Orar";

export const COLUMNS = [
  { key: "clasa", header: "Clasa", required: true, width: 10, help: "Codul clasei din anul școlar selectat, ex. 112" },
  { key: "ziua", header: "Ziua", required: true, width: 12, help: "Luni, Marți, Miercuri, Joi, Vineri (sau 1–5)" },
  { key: "ora", header: "Ora", required: true, width: 8, help: "Numărul orei (1, 2, …) sau ora de început (08:00)" },
  { key: "materie", header: "Materie", required: true, width: 16, help: "Codul materiei (ex. MAT) sau denumirea exactă" },
  { key: "profesor", header: "Profesor", required: true, width: 20, help: "Numele de utilizator al profesorului (ex. prof.popescu)" },
  { key: "sala", header: "Sala", required: false, width: 10, help: "Opțional" },
  { key: "saptamana", header: "Săptămâna", required: false, width: 12, help: "Toate (implicit), Impară sau Pară" },
  { key: "grupa", header: "Grupa", required: false, width: 10, help: "Opțional – pentru clase împărțite pe grupe" },
] as const;

export type ColumnKey = (typeof COLUMNS)[number]["key"];

export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[şș]/g, "s")
    .replace(/[ţț]/g, "t")
    .toLowerCase()
    .trim();
}

/** Guard for values written into spreadsheets (formula injection). */
export function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export async function buildTemplate(ref: {
  yearName: string;
  classes: string[];
  subjects: { code: string; name: string }[];
  teachers: { username: string; name: string }[];
  slots: { index: number; startTime: string; endTime: string }[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Catalog SMMMFN";
  wb.created = new Date();

  const ws = wb.addWorksheet(SHEET_NAME, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2A55" } };
  header.alignment = { vertical: "middle" };
  // Drop-down lists for the first 500 rows.
  for (let r = 2; r <= 501; r++) {
    ws.getCell(`B${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Luni,Marți,Miercuri,Joi,Vineri"'] };
    ws.getCell(`G${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Toate,Impară,Pară"'] };
  }

  const info = wb.addWorksheet("Instrucțiuni");
  info.columns = [{ width: 18 }, { width: 90 }];
  info.addRow(["Șablon import orar", `versiunea ${TEMPLATE_VERSION} – an școlar ${ref.yearName}`]).font = { bold: true, size: 13 };
  info.addRow([]);
  info.addRow(["Reguli", "Completați foaia „Orar”: un rând = o oră de curs. Nu redenumiți antetele. Nu folosiți formule."]);
  info.addRow(["", "Anul școlar și săptămâna de la care se aplică orarul se aleg în aplicație, la încărcare."]);
  info.addRow(["", "Rândurile invalide sunt raportate cu numărul rândului; orarul nu se publică până nu sunt corectate."]);
  info.addRow([]);
  for (const c of COLUMNS) info.addRow([c.header + (c.required ? " *" : ""), c.help]);
  info.addRow([]);
  info.addRow(["Exemplu", "112 | Luni | 1 | MAT | prof.popescu | A12 | Toate |"]);

  const list = (name: string, headers: string[], rows: (string | number)[][]) => {
    const s = wb.addWorksheet(name);
    s.addRow(headers).font = { bold: true };
    for (const r of rows) s.addRow(r.map((v) => (typeof v === "string" ? safeCell(v) : v)));
    s.columns.forEach((col) => (col.width = 24));
  };
  list("Clase", ["Clasa"], ref.classes.map((c) => [c]));
  list("Materii", ["Cod", "Denumire"], ref.subjects.map((s) => [s.code, s.name]));
  list("Profesori", ["Utilizator", "Nume"], ref.teachers.map((t) => [t.username, t.name]));
  list("Ore", ["Ora", "Început", "Sfârșit"], ref.slots.map((s) => [s.index, s.startTime, s.endTime]));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

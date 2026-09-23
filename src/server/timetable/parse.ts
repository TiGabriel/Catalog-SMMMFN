import ExcelJS from "exceljs";
import { COLUMNS, SHEET_NAME, normalizeText, type ColumnKey } from "@/server/timetable/template";
import { checkXlsxContainer } from "@/server/timetable/xlsx-safety";

/**
 * Parses and validates a timetable workbook against reference data. Nothing is
 * written here: the result is either a list of normalized entries or a precise
 * list of problems (row + column + message). Invalid rows are never imported.
 */

export type RefData = {
  classes: Map<string, string>; // code → classSectionId
  subjectsByCode: Map<string, { id: string; type: string }>;
  subjectsByName: Map<string, { id: string; type: string }>; // normalized name
  teachers: Map<string, { id: string; active: boolean }>; // username → PROFESOR
  slotsByIndex: Map<number, string>;
  slotsByStart: Map<string, string>;
  /** "teacherId|classId|subjectId" of active assignments – used for warnings only. */
  assignments: Set<string>;
};

export type ParsedEntry = {
  row: number;
  classSectionId: string;
  classCode: string;
  dayOfWeek: number;
  timeSlotId: string;
  slotLabel: string;
  subjectId: string;
  teacherId: string;
  teacherUsername: string;
  room: string | null;
  weekParity: "ALL" | "ODD" | "EVEN";
  groupLabel: string | null;
};

export type Issue = { row: number | null; column: string | null; message: string };
export type ParseResult = { entries: ParsedEntry[]; errors: Issue[]; warnings: Issue[]; rowsRead: number };

const MAX_ROWS = 3000;
const DAYS: Record<string, number> = { luni: 1, marti: 2, miercuri: 3, joi: 4, vineri: 5, sambata: 6, duminica: 7 };
const DAY_LABEL = ["", "Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"];

type Cell = { text: string | null; formula: boolean; error: boolean };

function readCell(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return { text: null, formula: false, error: false };
  if (typeof v === "string") return { text: v.trim() || null, formula: false, error: false };
  if (typeof v === "number") return { text: String(v), formula: false, error: false };
  if (typeof v === "boolean") return { text: v ? "DA" : "NU", formula: false, error: false };
  if (v instanceof Date) {
    // Excel stores times as dates (e.g. 08:00) – keep HH:MM.
    return { text: `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`, formula: false, error: false };
  }
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) return { text: null, formula: true, error: false };
    if ("error" in v) return { text: null, formula: false, error: true };
    if ("richText" in v) return { text: v.richText.map((r) => r.text).join("").trim() || null, formula: false, error: false };
    if ("text" in v && typeof v.text === "string") return { text: v.text.trim() || null, formula: false, error: false };
  }
  return { text: null, formula: false, error: true };
}

function parities(p: ParsedEntry["weekParity"]): ("ODD" | "EVEN")[] {
  return p === "ALL" ? ["ODD", "EVEN"] : [p];
}

function overlap(a: ParsedEntry, b: ParsedEntry) {
  return a.dayOfWeek === b.dayOfWeek && a.timeSlotId === b.timeSlotId && parities(a.weekParity).some((x) => parities(b.weekParity).includes(x));
}

export async function parseTimetableWorkbook(buf: Buffer, ref: RefData): Promise<ParseResult> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const container = checkXlsxContainer(buf);
  if (!container.ok) return { entries: [], errors: [{ row: null, column: null, message: container.message }], warnings, rowsRead: 0 };

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    return { entries: [], errors: [{ row: null, column: null, message: "Fișierul Excel nu a putut fi citit." }], warnings, rowsRead: 0 };
  }
  const ws = wb.getWorksheet(SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) return { entries: [], errors: [{ row: null, column: null, message: `Lipsește foaia „${SHEET_NAME}”.` }], warnings, rowsRead: 0 };
  if (ws.rowCount > MAX_ROWS + 1) {
    return { entries: [], errors: [{ row: null, column: null, message: `Foaia conține prea multe rânduri (maximum ${MAX_ROWS}).` }], warnings, rowsRead: 0 };
  }

  // Header → column index (order-independent, case/diacritics-insensitive).
  const colIndex = new Map<ColumnKey, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const h = normalizeText(String(readCell(cell.value).text ?? ""));
    const def = COLUMNS.find((c) => normalizeText(c.header) === h);
    if (def && !colIndex.has(def.key)) colIndex.set(def.key, col);
  });
  for (const c of COLUMNS.filter((x) => x.required)) {
    if (!colIndex.has(c.key)) errors.push({ row: 1, column: c.header, message: `Lipsește coloana obligatorie „${c.header}”.` });
  }
  if (errors.length) return { entries: [], errors, warnings, rowsRead: 0 };

  const entries: ParsedEntry[] = [];
  let rowsRead = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells = new Map<ColumnKey, Cell>();
    for (const c of COLUMNS) {
      const idx = colIndex.get(c.key);
      cells.set(c.key, idx ? readCell(row.getCell(idx).value) : { text: null, formula: false, error: false });
    }
    if ([...cells.values()].every((c) => c.text === null && !c.formula && !c.error)) continue; // empty row
    rowsRead++;
    const rowErrors: Issue[] = [];
    const err = (key: ColumnKey, message: string) => rowErrors.push({ row: r, column: COLUMNS.find((c) => c.key === key)!.header, message });
    for (const c of COLUMNS) {
      const cell = cells.get(c.key)!;
      if (cell.formula) err(c.key, "Celulele cu formule nu sunt acceptate; introduceți valoarea direct.");
      else if (cell.error) err(c.key, "Valoare invalidă în celulă.");
      else if (c.required && !cell.text) err(c.key, "Câmp obligatoriu necompletat.");
      else if (cell.text && cell.text.length > 80) err(c.key, "Valoare prea lungă.");
    }
    const t = (k: ColumnKey) => cells.get(k)!.text;

    const classCode = t("clasa")?.replace(/\.0$/, "") ?? "";
    const classId = ref.classes.get(classCode);
    if (t("clasa") && !classId) err("clasa", `Clasa „${classCode}” nu există în anul școlar selectat.`);

    const dayRaw = normalizeText(t("ziua") ?? "");
    const day = DAYS[dayRaw] ?? (/^[1-7]$/.test(dayRaw) ? Number(dayRaw) : undefined);
    if (t("ziua") && !day) err("ziua", `Zi necunoscută: „${t("ziua")}”.`);

    const oraRaw = (t("ora") ?? "").replace(/\.0$/, "");
    const hhmm = /^\d{1,2}:\d{2}$/.test(oraRaw) ? oraRaw.padStart(5, "0") : null;
    const slotId = hhmm ? ref.slotsByStart.get(hhmm) : /^\d{1,2}$/.test(oraRaw) ? ref.slotsByIndex.get(Number(oraRaw)) : undefined;
    if (t("ora") && !slotId) err("ora", `Ora „${oraRaw}” nu corespunde niciunui interval orar configurat.`);

    const subjRaw = t("materie") ?? "";
    const subject = ref.subjectsByCode.get(subjRaw.toUpperCase()) ?? ref.subjectsByName.get(normalizeText(subjRaw));
    if (subjRaw && !subject) err("materie", `Materia „${subjRaw}” nu există sau nu este activă.`);
    else if (subject?.type === "CONDUCT") err("materie", "Purtarea nu se trece în orar.");

    const username = (t("profesor") ?? "").toLowerCase();
    const teacher = ref.teachers.get(username);
    if (username && !teacher) err("profesor", `Profesorul „${username}” nu există.`);
    else if (teacher && !teacher.active) err("profesor", `Contul profesorului „${username}” nu este activ.`);

    const parityRaw = normalizeText(t("saptamana") ?? "toate");
    const weekParity = ["toate", "toata", "all", ""].includes(parityRaw) ? "ALL" : ["impara", "impar"].includes(parityRaw) ? "ODD" : ["para", "par"].includes(parityRaw) ? "EVEN" : null;
    if (!weekParity) err("saptamana", `Valoare necunoscută: „${t("saptamana")}” (Toate, Impară sau Pară).`);
    if (day && day > 5) warnings.push({ row: r, column: "Ziua", message: `Oră programată ${DAY_LABEL[day]!.toLowerCase()}.` });

    if (rowErrors.length) {
      errors.push(...rowErrors);
      continue;
    }
    const entry: ParsedEntry = {
      row: r,
      classSectionId: classId!,
      classCode,
      dayOfWeek: day!,
      timeSlotId: slotId!,
      slotLabel: oraRaw,
      subjectId: subject!.id,
      teacherId: teacher!.id,
      teacherUsername: username,
      room: t("sala"),
      weekParity: weekParity!,
      groupLabel: t("grupa"),
    };
    if (!ref.assignments.has(`${entry.teacherId}|${entry.classSectionId}|${entry.subjectId}`)) {
      warnings.push({ row: r, column: "Profesor", message: `Profesorul „${username}” nu are o repartizare activă pentru această materie la clasa ${classCode}.` });
    }
    entries.push(entry);
  }

  // Cross-row conflicts.
  for (let i = 0; i < entries.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = entries[i]!;
      const b = entries[j]!;
      if (!overlap(a, b)) continue;
      const where = `${DAY_LABEL[a.dayOfWeek]}, ora ${a.slotLabel}`;
      if (a.classSectionId === b.classSectionId && !(a.groupLabel && b.groupLabel && a.groupLabel !== b.groupLabel)) {
        errors.push({ row: a.row, column: "Clasa", message: `Clasa ${a.classCode} are deja o oră ${where} (rândul ${b.row}).` });
      }
      if (a.teacherId === b.teacherId && a.classSectionId !== b.classSectionId) {
        errors.push({ row: a.row, column: "Profesor", message: `Profesorul „${a.teacherUsername}” predă deja ${where} la clasa ${b.classCode} (rândul ${b.row}).` });
      }
      if (a.room && b.room && a.room.toLowerCase() === b.room.toLowerCase() && a.classSectionId !== b.classSectionId) {
        warnings.push({ row: a.row, column: "Sala", message: `Sala ${a.room} este folosită și de clasa ${b.classCode} ${where} (rândul ${b.row}).` });
      }
    }
  }
  if (rowsRead === 0) errors.push({ row: null, column: null, message: "Foaia „Orar” nu conține nicio oră." });
  return { entries: errors.length ? [] : entries, errors, warnings, rowsRead };
}

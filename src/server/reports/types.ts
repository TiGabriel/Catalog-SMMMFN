/** Generic, renderer-independent report model (rendered as HTML/print or Excel). */
export type Cell = string | number | null;

export type ReportSection = {
  title?: string;
  columns: { label: string; numeric?: boolean; width?: number }[];
  rows: Cell[][];
  note?: string;
};

export type Report = {
  type: ReportType;
  title: string;
  subtitle?: string;
  sections: ReportSection[];
  notes?: string[];
  generatedAt: string;
  generatedBy: string;
  provisional?: boolean;
};

export const REPORT_TYPES = [
  "catalog-clasa",
  "medii-clasa",
  "rezultate-modul",
  "rezultate-an",
  "situatie-elev",
  "foaie-matricola",
  "situatie-generala",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_LABEL: Record<ReportType, string> = {
  "catalog-clasa": "Catalogul clasei",
  "medii-clasa": "Medii pe materii",
  "rezultate-modul": "Rezultatele modulului",
  "rezultate-an": "Rezultatele anului școlar",
  "situatie-elev": "Situația școlară a elevului",
  "foaie-matricola": "Foaie matricolă (istoric academic)",
  "situatie-generala": "Situația generală a școlii",
};

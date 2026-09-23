/** Romanian formatting helpers (dates dd.MM.yyyy, Europe/Bucharest). */
const TZ = "Europe/Bucharest";

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  // Calendar dates are stored at UTC midnight – format them in UTC to avoid day shifts.
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(date);
}

export function formatGrade(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
}

export function personName(p: { firstName: string; lastName: string; rank?: { label: string } | null } | null | undefined, withRank = true): string {
  if (!p) return "—";
  return [withRank ? p.rank?.label : null, p.lastName, p.firstName].filter(Boolean).join(" ");
}

export function isoToday(): string {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

export const DAY_NAMES = ["", "Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"];

export const GRADE_KIND_LABEL: Record<string, string> = {
  CURRENT: "Notă curentă",
  MODULE_EXAM: "Examen final de modul",
  FINAL: "Notă finală",
};

export const SUBJECT_TYPE_LABEL: Record<string, string> = {
  GENERAL: "Cultură generală",
  SPECIALIZATION: "Specialitate",
  PRACTICAL_TRAINING: "Instruire practică",
  CONDUCT: "Purtare",
};

export const ASSIGNMENT_KIND_LABEL: Record<string, string> = {
  SUBJECT_TEACHING: "Predare",
  PRACTICAL_TRAINING: "Instruire practică",
  MODULE_EXAM: "Examinator modul",
};

export const MODULE_STATUS_LABEL: Record<string, string> = { PLANNED: "Planificat", OPEN: "Deschis", CLOSED: "Închis" };
export const YEAR_STATUS_LABEL: Record<string, string> = { PLANNED: "Planificat", ACTIVE: "Activ", CLOSED: "Închis" };
export const REQUEST_STATUS_LABEL: Record<string, string> = {
  PENDING: "În așteptare",
  APPROVED: "Aprobată",
  REJECTED: "Respinsă",
  CANCELLED: "Anulată",
};
export const REQUEST_TYPE_LABEL: Record<string, string> = { MODIFY: "Corectare notă", DELETE: "Ștergere notă", ADD_LATE: "Adăugare notă" };
export const REVISION_ACTION_LABEL: Record<string, string> = {
  CREATE: "Introducere",
  UPDATE: "Modificare",
  DELETE: "Ștergere",
  RESTORE: "Restaurare",
};
export const STUDENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activ",
  GRADUATED: "Absolvent",
  WITHDRAWN: "Retras",
  SUSPENDED: "Suspendat",
};
export const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activ",
  PROMOTED: "Promovat",
  GRADUATED: "Absolvent",
  REPEATING: "Repetent",
  TRANSFERRED: "Transferat",
  WITHDRAWN: "Retras",
};

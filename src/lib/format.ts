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

/** "1 elev", "2 elevi", "20 de elevi" (Romanian plural rules). */
export function plural(n: number, one: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const mod = n % 100;
  return n === 0 || (mod >= 1 && mod <= 19) ? `${n} ${many}` : `${n} de ${many}`;
}

export const ROLE_LABEL: Record<string, string> = {
  ADMINISTRATOR: "Administrator",
  COMANDANT_UNITATE: "COMANDANT UNITATE",
  PROFESOR: "Profesor",
  ELEV: "Elev",
};

export const USER_STATUS_LABEL: Record<string, string> = { ACTIVE: "Activ", INACTIVE: "Inactiv", DELETED: "Șters" };

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  LOGIN: "Autentificare",
  LOGIN_FAILED: "Autentificare eșuată",
  LOGIN_BLOCKED: "Autentificare blocată",
  LOGOUT: "Deconectare",
  SESSION_EXPIRED: "Sesiune expirată",
  PASSWORD_CHANGE: "Schimbare parolă",
  PASSWORD_CHANGE_FAILED: "Schimbare parolă eșuată",
  PASSWORD_RESET: "Resetare parolă",
  USER_CREATE: "Creare utilizator",
  USER_UPDATE: "Modificare utilizator",
  USER_STATUS_CHANGE: "Schimbare stare cont",
  ACADEMIC_YEAR_CREATE: "Creare an școlar",
  ACADEMIC_YEAR_UPDATE: "Modificare an școlar",
  CLASS_CREATE: "Creare clasă",
  CLASS_UPDATE: "Modificare clasă",
  SUBJECT_CREATE: "Creare materie",
  SUBJECT_UPDATE: "Modificare materie",
  MODULE_CREATE: "Creare modul",
  MODULE_UPDATE: "Modificare modul",
  MODULE_CLOSE: "Închidere modul",
  MODULE_SUBJECT_ADD: "Materie adăugată în modul",
  MODULE_SUBJECT_UPDATE: "Materie din modul modificată",
  MODULE_SUBJECT_REMOVE: "Materie eliminată din modul",
  STUDENT_CREATE: "Înmatriculare elev",
  STUDENT_UPDATE: "Modificare date elev",
  ENROLLMENT_CREATE: "Înmatriculare",
  ASSIGNMENT_CREATE: "Repartizare",
  ASSIGNMENT_END: "Încheiere repartizare",
  HOMEROOM_CREATE: "Numire diriginte",
  HOMEROOM_END: "Încheiere dirigenție",
  GRADE_CREATE: "Notă introdusă",
  GRADE_UPDATE: "Notă modificată",
  GRADE_DELETE: "Notă ștearsă",
  GRADE_REASON_CREATE: "Motiv notă adăugat",
  GRADE_REASON_UPDATE: "Motiv notă modificat",
  CORRECTION_REQUEST_CREATE: "Cerere de corecție",
  CORRECTION_REQUEST_APPROVE: "Cerere aprobată",
  CORRECTION_REQUEST_REJECT: "Cerere respinsă",
  CORRECTION_REQUEST_CANCEL: "Cerere anulată",
  CONFIG_UPDATE: "Modificare configurare",
  RULESET_CREATE: "Reguli de calcul – versiune nouă",
  RULESET_ACTIVATE: "Reguli de calcul activate",
  YEAR_ROLLOVER: "Trecere în noul an școlar",
  TIMETABLE_IMPORT: "Import orar",
  TIMETABLE_PUBLISH: "Publicare orar",
  TIMETABLE_ARCHIVE: "Arhivare orar",
  REPORT_EXPORT: "Export raport",
  ACCESS_DENIED: "Acces refuzat",
  AUDIT_VIEW: "Consultare audit",
  AUDIT_VERIFY: "Verificare integritate audit",
  SYSTEM_SEED: "Inițializare sistem",
  ADMIN_BOOTSTRAP: "Creare administrator inițial",
};

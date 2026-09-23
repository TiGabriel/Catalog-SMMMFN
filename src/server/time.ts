/**
 * School calendar time. All "today"/"1 September" decisions use the school's
 * timezone (Europe/Bucharest) regardless of the server's own timezone, and are
 * represented as UTC-midnight dates like the DATE columns.
 */
export const SCHOOL_TZ = "Europe/Bucharest";

export function schoolDate(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

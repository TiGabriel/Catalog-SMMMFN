import type { Role } from "@/generated/prisma/enums";

/**
 * Role → permission matrix. Defined in code on purpose: it is reviewed in git,
 * covered by tests and cannot be altered at runtime (no privilege escalation
 * through configuration). Roles themselves are stored per user in the DB.
 *
 * Permissions ending in `.scoped` are additionally limited by relationship
 * scope (teaching/homeroom assignments, own enrollment) – see scope.ts/policy.ts.
 * DIRIGINTE is not a role: it is PROFESOR + an active HomeroomAssignment.
 */
export const PERMISSIONS = [
  "users.manage",
  "structure.read",
  "structure.manage",
  "students.manage",
  "assignments.manage",
  "config.read",
  "config.manage",
  "audit.read",
  "audit.read.system",
  "academic.read.all",
  "academic.read.scoped",
  "grades.create.scoped",
  "grades.conduct.scoped",
  "corrections.request",
  "corrections.review",
  "timetable.read.all",
  "timetable.read.own",
  "timetable.manage",
  "self.academic.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMINISTRATOR: [
    "users.manage",
    "structure.read",
    "structure.manage",
    "students.manage",
    "assignments.manage",
    "config.read",
    "config.manage",
    "audit.read",
    "audit.read.system", // complete system audit (logins, users, configuration, …)
    "timetable.read.all",
    "timetable.manage",
    // Deliberately absent: academic.read.*, grades.* – the administrator never edits grades.
  ],
  COMANDANT_UNITATE: [
    "structure.read",
    "config.read",
    "audit.read", // academic audit only: grades, corrections, approvals, module closing, year transition
    "academic.read.all",
    "corrections.review",
    "timetable.read.all",
  ],
  PROFESOR: [
    "academic.read.scoped",
    "grades.create.scoped",
    "grades.conduct.scoped", // effective only for classes with an active HomeroomAssignment
    "corrections.request",
    "timetable.read.own",
  ],
  ELEV: ["self.academic.read", "timetable.read.own"],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

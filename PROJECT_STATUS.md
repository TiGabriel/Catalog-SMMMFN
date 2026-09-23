# PROJECT_STATUS – Catalog electronic SMMMFN

Electronic gradebook for **Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”**. The UI is entirely in Romanian.
The full design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

_Last updated: 2026-09-23. Phase: **0 – Architecture (completed)**_

## Current state
- The repository was **empty** at inspection: no commits, no source, no package or database config. Nothing existing had to be preserved.
- This phase added only documentation (`PROJECT_STATUS.md`, `docs/ARCHITECTURE.md`, `README.md`, `.gitignore`). No application code yet.

## Architecture decisions
| # | Decision |
|---|---|
| D1 | **TypeScript + Next.js (App Router)** modular monolith, server-rendered. **PostgreSQL** + **Prisma**, **Zod** validation, **Tailwind + shadcn/ui**, `next-themes` (dark/light), Inter font, **ExcelJS** for timetable import. Docker deployment. |
| D2 | All data access happens in `src/server/**` domain services (`server-only`). UI and routes are thin, and every service receives the server-resolved actor and runs `authz` checks plus **scoped queries**. |
| D3 | **Server-side sessions** (opaque 256-bit token, stored hashed in the DB, `__Host-` cookie, HttpOnly/Secure/SameSite=Strict), **argon2id** passwords, DB-backed login throttling. No JWTs. |
| D4 | **DIRIGINTE is derived** from an active `HomeroomAssignment`, not a stored role. Stored roles: `ADMINISTRATOR`, `COMANDANT_UNITATE` (displayed "COMANDANT UNITATE"), `PROFESOR`, `ELEV`. One role per account. |
| D5 | **Nothing academic is ever physically deleted.** Grades are soft-deleted with a reason, each grade has an immutable revision history, and all historical foreign keys use `ON DELETE RESTRICT`. Users are deactivated or "deleted" (login removed) while the row and name stay. |
| D6 | **AuditLog is append-only**, enforced by a DB trigger and DB grants, with a hash chain for tamper evidence. It is written in the same transaction as the change and readable only by ADMINISTRATOR and COMANDANT UNITATE. |
| D7 | **Class-per-year model:** `ClassSection` (per academic year) plus `Cohort` (links 112 → 212). Students are linked through `Enrollment`. Promotion creates new rows and never rewrites old ones. |
| D8 | **Averaging rules are versioned JSON rule sets** interpreted by an engine. Closed modules store a `ModuleResult` snapshot together with the rule-set version used. |
| D9 | **Timetable:** versioned, published `TimetableVersion`s imported from a versioned Excel template (validate → preview → publish), plus date overrides. Timetable display is scope-filtered. |
| D10 | Out-of-scope resources return **404**. The client receives capability flags only, never role names. |

## Database entities (summary)
- **Identity:** User, Rank, Session, LoginAttempt
- **Academic:** AcademicYear, Specialization, Cohort, ClassSection, Student, Enrollment
- **Curriculum:** Subject (GENERAL / SPECIALIZATION / PRACTICAL_TRAINING / CONDUCT), Module, ModuleSubject
- **Assignments:** TeachingAssignment, HomeroomAssignment (end-dated, never deleted)
- **Grades:** GradeReason, Grade, GradeRevision, GradeCorrectionRequest
- **Results:** AveragingRuleSet, ModuleResult, ModuleResultLine
- **Timetable:** TimeSlot, TimetableVersion, TimetableEntry, TimetableOverride, TimetableImport
- **System:** AuditLog, SystemSetting
- **Future:** AttendanceRecord, and student accounts through `Student.userId`

## Roles
- **ADMINISTRATOR** (1–2): users, passwords, structure, assignments, timetable, configuration, audit. **Cannot create, modify or delete grades.** The role is visible only to admins.
- **COMANDANT UNITATE:** reads all academic data and the full audit, and approves or rejects correction and deletion requests. Does not edit grades. The role is hidden from normal users.
- **PROFESOR:** only their own timetable, assigned class+subject pairs and those students. Enters grades there, and edits or deletes their own grades with a mandatory reason within the edit window.
- **DIRIGINTE** (derived): all academic data of their own class, plus the conduct grade. Teacher permissions apply only to their assigned subjects.
- **ELEV** (future): own grades, current info, weekly timetable. No audit access.

## Permissions (key rules)
- Every check runs on the server. Scope is resolved from the database on each request.
- Grade creation requires an active TeachingAssignment (or a homeroom assignment for conduct), an open module, an active enrollment and a valid value (1–10) with a reason.
- After the edit window, after the module closes, or when the author has left, changes go through a correction request that the COMANDANT UNITATE approves.
- Audit: ADMINISTRATOR and COMANDANT UNITATE only. Viewing the audit is itself audited.
- Normal users never see role names, including their own.

## Completed work
- [x] Repository inspection (empty repository)
- [x] Technology stack, application architecture, domain model, permission model, grade/audit model, rollover model, timetable design, security plan (in `docs/ARCHITECTURE.md`)

## Pending work (roadmap)
1. **Phase 1 – Foundation (next):** project scaffolding, Postgres via docker-compose, identity + session + audit schema, login/logout/password change, rate limiting, security headers, `authz` skeleton, Romanian app shell with dark/light theme, admin user management, first-admin CLI seed, CI (lint, typecheck, tests).
2. **Phase 2 – Academic structure:** academic years, specializations, cohorts, classes, students, enrollments, subjects, modules, assignments (admin UI).
3. **Phase 3 – Grades:** catalog views per role, grade entry/edit/delete with revisions and audit, grade reasons, conduct grade.
4. **Phase 4 – Correction requests** and the COMANDANT UNITATE review workflow, plus the audit viewer.
5. **Phase 5 – Timetable:** Excel template, import pipeline, weekly view.
6. **Phase 6 – Module results:** averaging engine, module closing, class result tables, PDF/Excel reports.
7. **Phase 7 – Year rollover** (preview + execution), graduate archive.
8. **Later:** student accounts, attendance, two-factor authentication, deployment hardening and backups.

## Important decisions for reviewers
- Grades, revisions, assignments, enrollments and audit rows are **never hard-deleted**.
- An admin **cannot** assign classes to themselves or hold a teacher role on the same account (separation of duties).
- The rollover defaults to **admin-confirmed** (preview in August, run on September 1). It can be switched to fully automatic.
- Two-factor authentication for ADMINISTRATOR and COMANDANT UNITATE is strongly recommended before the application goes online.

## Known uncertainties (keep configurable / to clarify with the school)
1. Averaging formulas: subject average, final exam weight, rounding, whether conduct and practical training count in the module average, minimum number of grades.
2. Number of modules per year, their dates, and whether they differ by specialization.
3. Meaning of class suffixes 11–15 vs 24–25 (specialization?), and whether the class list changes each year.
4. Teacher edit window (days? until the module closes?).
5. Conduct grade frequency (per module or per year) and its default value.
6. Integer-only or decimal grades (e.g. exams).
7. Repeaters, withdrawals, transfers between classes, and re-examinations before promotion.
8. Rollover: fully automatic on September 1, or admin-confirmed.
9. Final Excel timetable template: week parity, half-class groups, rooms.
10. Whether the ADMINISTRATOR may view grades read-only.
11. Delegation when the COMANDANT UNITATE is unavailable.
12. Hosting (on-premise vs EU cloud), MApN security requirements, GDPR retention for graduates.
13. How students will authenticate once student accounts are enabled.
14. Official list of military ranks and report formats (PDF/Excel layout).

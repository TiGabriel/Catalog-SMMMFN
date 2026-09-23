# PROJECT_STATUS – Catalog electronic SMMMFN

Electronic gradebook for **Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”**. The UI is entirely in Romanian.
The full design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

_Last updated: 2026-09-23. Phase: **1 – Foundation (completed)**_

## Current state
- Next.js 16 (App Router) + TypeScript, PostgreSQL 16 with Prisma 7 (`@prisma/adapter-pg`), Zod 4, argon2id, Vitest 5.
- The backend foundation is complete: database schema, integrity triggers, authentication, sessions, RBAC with scope, audit, and administrator/catalog APIs.
- There are no UI pages yet (API only). The Romanian UI comes in the following phases.

## How to run locally
```bash
cp .env.example .env            # fill in the connection strings
npm install                     # also runs `prisma generate`
npm run db:migrate              # migrations + least-privilege grants for the application role
npm run db:seed                 # base structure (companies, classes, subjects, grade reasons, ranks, time slots)
npm run creeaza-admin           # first administrator (CLI only)
npm run db:seed:demo            # optional: demo data (never in production)
npm test                        # rebuilds the catalog_test database and runs all tests
```
Two PostgreSQL roles are used: `catalog_owner` (migrations) and `catalog_app` (the application, least privilege).

## Architecture decisions
| # | Decision |
|---|---|
| D1 | Next.js + TypeScript monolith. **PostgreSQL + Prisma**, Zod, Tailwind (UI in the next phases). |
| D2 | All DB access happens in `src/server/**` (`server-only`, enforced by an ESLint rule). Routes are thin. Every service receives the server-resolved `Actor` and calls `authz` before any data access. |
| D3 | **Server-side sessions**: a 256-bit token in the `__Host-sesiune` cookie (HttpOnly, Secure, SameSite=Strict); only its SHA-256 hash is stored in the DB. Idle timeout 30 min, absolute timeout 12 h. |
| D4 | **DIRIGINTE is derived** from an active `HomeroomAssignment`. Stored roles: ADMINISTRATOR, COMANDANT_UNITATE, PROFESOR, ELEV. |
| D5 | **Nothing historical is physically deleted**: every FK uses `ON DELETE RESTRICT`, plus DB triggers that reject DELETE/TRUNCATE on historical tables. |
| D6 | **Append-only, hash-chained audit**: the DB trigger sets `id`, `occurred_at`, `prev_hash` and `hash`; UPDATE/DELETE/TRUNCATE are rejected even for the owner; the app role has no UPDATE/DELETE grants. |
| D7 | Class-per-year model: `ClassSection` + `Cohort` (promoție). 112 → 212 share one cohort. |
| D8 | Role → permission matrix in **code** (`src/server/authz/permissions.ts`), reviewed and tested and not editable at runtime. Roles are stored per user in the DB. |
| D9 | Out-of-scope resources return **404**, and every denial is audited (`ACCESS_DENIED`). |
| D10 | The client receives only capability flags (`/api/auth/me`), never the role name. |

## Database entities (implemented – `prisma/schema.prisma`)
- **Identity:** `User` (firstName, lastName, rank?, username, passwordHash, role, status ACTIVE/INACTIVE/DELETED, mustChangePassword), `Rank`, `Session`, `LoginAttempt`
- **Structure:** `AcademicYear` (PLANNED/ACTIVE/CLOSED, only one active), `Company` (Compania 1 = anul II, Compania 2 = anul I), `Specialization`, `Cohort` (promoție), `ClassSection`, `Student` (optional link to `User`), `Enrollment`, `YearRollover`
- **Curriculum:** `Subject` (GENERAL / SPECIALIZATION / PRACTICAL_TRAINING / CONDUCT), `Module`, `ModuleSubject`
- **Assignments:** `TeachingAssignment` (kind: SUBJECT_TEACHING / PRACTICAL_TRAINING / MODULE_EXAM), `HomeroomAssignment` (one active per class). They are ended, never deleted.
- **Grades:** `GradeReason` (configurable), `Grade` (1–10, CHECK constraint; original author immutable; soft delete), `GradeRevision` (immutable), `GradeCorrectionRequest`
- **Timetable:** `TimeSlot`, `TimetableVersion`, `TimetableEntry`, `TimetableOverride`, `TimetableImport`
- **System:** `AuditLog`, `SystemSetting` (keys whitelisted and validated)
- DB integrity (migration `20260923200500_integrity`): CHECK constraints, no-delete triggers, immutable revisions, grade identity (author/student/class/subject) immutable, single active year / enrollment / homeroom teacher, audit hash chain + `audit_log_verify_chain()`.

## Initial structure (seed)
- Compania 1 (anul II): 211, 212, 213, 214, 215, 224, 225. Compania 2 (anul I): 111, 112, 113, 114, 115, 124, 125.
- Academic year 2026–2027 (active), system subject „Purtare”, „Instruire practică”, grade reasons (Testare, Ascultare, Activitate la clasă, Caiet, Proiect, Altă activitate + Examen final de modul, Notă la purtare), military ranks, 7 time slots.

## Authentication
- `POST /api/auth/login`: generic message for every failure (unknown user, wrong password, inactive account, student accounts disabled); dummy argon2 verification for unknown users (uniform timing).
- Throttling: 5 failures per username / 15 min (counted even for nonexistent usernames), 20 failures per IP, then 429. Everything is recorded in `LoginAttempt` + audit.
- Password: min. 8 characters, uppercase, digit, special character, max. 128, must not contain the username; argon2id (19 MiB, t=2).
- `mustChangePassword` after creation/reset: every endpoint except me/logout/change-password returns 403 until the password is changed.
- Reset/deactivation/role change → all of the user's sessions are revoked. A password change revokes the other sessions.
- CSRF: exact `Origin` check + `application/json` required for mutations, plus SameSite=Strict.

## Authorization matrix (enforced on the server)
| Capability | ADMIN | COMANDANT | PROFESOR | DIRIGINTE (own class) | ELEV |
|---|---|---|---|---|---|
| Users, passwords | ✅ | ❌ | ❌ | ❌ | ❌ |
| Years, classes, subjects, modules, students | ✅ manage | read | ❌ | ❌ | ❌ |
| Teaching/homeroom assignments | ✅ (not to self) | read | ❌ | ❌ | ❌ |
| Configuration | ✅ | read | ❌ | ❌ | ❌ |
| Class roster | ✅ | ✅ | assigned classes | own class | ❌ |
| Grade reading | ❌ | ✅ all | assigned class+subject | all subjects of own class | own grades |
| Grade creation | ❌ | ❌ | assigned class+subject (+kind: teaching / practical / module exam) | conduct only in own class | ❌ |
| Audit | ✅ | ✅ | ❌ | ❌ | ❌ |
| Timetable | all | all | own lessons | + own class | own class |

## Implemented API
`/api/auth/{login,logout,me,change-password}` · `/api/admin/{users,users/[id],users/[id]/status,users/[id]/reset-password,ranks,companies,specializations,teachers,academic-years,academic-years/[id]/status,classes,classes/[id],subjects,subjects/[id],modules,modules/[id],students,assignments,assignments/[id]/end,homeroom-assignments,homeroom-assignments/[id]/end,settings,settings/[key],grade-reasons,grade-reasons/[id]}` · `/api/classes`, `/api/classes/[classId]`, `/api/classes/[classId]/subjects/[subjectId]/grades`, `/api/students/[studentId]`, `/api/grades` (POST), `/api/grade-reasons`, `/api/timetable`, `/api/me/grades`, `/api/audit`, `/api/audit/verify`.

## Tests (67, all passing – `npm test`)
- `tests/unit`: password policy, permission matrix.
- `tests/integration/auth.test.ts`: valid/invalid login, unknown user, inactive user, brute force → 429, logout, forged/expired cookie, CSRF, mandatory password change, admin reset, deactivation revokes sessions, student accounts disabled, no password hashes in responses.
- `tests/integration/authorization.test.ts`: teacher own class / another class / another subject / another student / another teacher in the timetable; diriginte own class / other class / conduct / subjects; administrator (management, no grades, no self-assignment); commander (global read, no writes); student isolation; losing access when an assignment ends.
- `tests/integration/db-integrity.test.ts`: append-only audit (app role and owner), tamper detection, no deletion of historical data, grade identity immutable, 1–10 constraint, single active year/enrollment.

## Pending work (roadmap)
2. **Gradebook core:** modify/delete grades with reason, correction requests, module results (configurable), catalog UI.
3. **Academic years and timetable:** automatic promotion (idempotent), history, Excel import, weekly timetable.
4. **UI/UX, dashboards, reports** (Excel/PDF/print), audit pages.
5. **Security audit** + SECURITY.md.

## Important security decisions
- The permission matrix lives in code, not in the DB (it cannot be escalated through configuration).
- The administrator has no grade permission. They cannot assign themselves classes, change their own role, or deactivate the last administrator.
- IP-based limits apply only behind a trusted reverse proxy (`TRUST_PROXY=true`, right-most `X-Forwarded-For` entry). Without a proxy, only the per-username limit applies.
- In production, `COOKIE_SECURE=false` is rejected at startup.
- The first administrator is created only from the CLI (`npm run creeaza-admin`).

## Known uncertainties
1. Averaging formulas, number/dates of modules, specializations of the 1x/2x classes.
2. Teacher edit window (default 7 days, configurable), integer vs. decimal grades (default integers).
3. Official rank list and bell schedule (seed values are provisional).
4. Hosting (on-premise vs. EU cloud), MApN requirements, 2FA before going online.
5. `npm audit` reports 4 high-severity vulnerabilities in the Prisma CLI's dev dependencies (`mysql2`, `deepmerge-ts`). They are not used at runtime; to be re-evaluated when Prisma updates.

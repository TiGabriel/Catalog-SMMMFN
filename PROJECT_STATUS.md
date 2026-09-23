# PROJECT_STATUS – Catalog electronic SMMMFN

Electronic gradebook for **Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”**. The UI is entirely in Romanian.
The full design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

_Last updated: 2026-09-23. Phase: **4 – Dashboards, reports and final UI (completed)**_

## Current state
- Next.js 16 (App Router) + TypeScript, PostgreSQL 16 with Prisma 7 (`@prisma/adapter-pg`), Zod 4, argon2id, Vitest 5.
- Phase 1 (foundation): database schema, integrity triggers, authentication, sessions, RBAC with scope, audit, administrator/catalog APIs.
- Phase 2 (gradebook core): complete grade lifecycle (create/modify/delete with reason, history), special correction workflow, conduct / practical training / module exam, module plans, configurable results engine, Romanian UI (catalog, grade entry, history, results, corrections, administration of subjects/modules/assignments/students).

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
- **Results:** `AveragingRuleSet` (versioned, frozen after activation), `ModuleResultSnapshot` (immutable)
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
Phase 2: `/api/grades/[id]` (GET history, PATCH), `/api/grades/[id]/delete`, `/api/grades/mine`, `/api/corrections` (GET/POST), `/api/corrections/[id]`, `/api/corrections/[id]/review`, `/api/corrections/[id]/cancel`, `/api/classes/[id]/modules/[moduleId]/results`, `/api/admin/modules/[id]/subjects`, `/api/admin/module-subjects/[id]`, `/api/admin/students/[id]`, `/api/admin/subjects/[id]` (GET), `/api/admin/rule-sets`, `/api/admin/rule-sets/[id]/activate`.
Phase 1: `/api/auth/{login,logout,me,change-password}` · `/api/admin/{users,users/[id],users/[id]/status,users/[id]/reset-password,ranks,companies,specializations,teachers,academic-years,academic-years/[id]/status,classes,classes/[id],subjects,subjects/[id],modules,modules/[id],students,assignments,assignments/[id]/end,homeroom-assignments,homeroom-assignments/[id]/end,settings,settings/[key],grade-reasons,grade-reasons/[id]}` · `/api/classes`, `/api/classes/[classId]`, `/api/classes/[classId]/subjects/[subjectId]/grades`, `/api/students/[studentId]`, `/api/grades` (POST), `/api/grade-reasons`, `/api/timetable`, `/api/me/grades`, `/api/audit`, `/api/audit/verify`.

## Tests (120, all passing – `npm test`)
- `tests/integration/reports-audit.test.ts`: reports per role (teacher only own classes/subjects, including Excel; diriginte own class; commander everything; administrator no grades; student only their own record sheet), invalid parameters, formula injection in Excel; audit: 403 for normal users, the commander only academic and without technical data, the administrator complete, all filters.
- `tests/integration/rollover.test.ts`: 1xy→2xy mapping with the same cohort, promotion exactly once (concurrent runs), not before 1 September / only by admin, graduation + account deactivation, history preserved (grades, revisions, assignments, snapshots, audit), history access (commander yes, teacher no, new assignments do not change the past).
- `tests/integration/timetable.test.ts`: template, row-level validation (class/day/slot/subject/teacher/inactive teacher/conflicts/formulas/odd-even), non-Excel files, missing columns, macros and zip bombs, dates outside the year, resolution per week, odd/even weeks, teacher isolation, versions (a new upload does not destroy, archive restores, republish), authorization (403 for non-admins, foreign Origin).
Each integration file starts from a fresh copy of a template database (`tests/db.ts`), so the tests are independent of each other.
- `tests/unit/results-engine.test.ts`: rounding, weighted mean with the exam, missing items, rules changed without code.
- `tests/integration/gradebook.test.ts`: valid/invalid grade, other class/subject, modify/delete with mandatory reason + audit + revisions, optimistic versioning, another teacher's grade (403/404), edit window → correction, conduct only by the class diriginte, practical training only by the assigned teacher, exam only by the designated examiner, correction workflow (approve/reject/cancel/delete), commander and administrator cannot edit/approve directly, module plan, closing a module → snapshot + grading blocked, conflicting assignments, students cannot be moved.
- `tests/unit`: password policy, permission matrix.
- `tests/integration/auth.test.ts`: valid/invalid login, unknown user, inactive user, brute force → 429, logout, forged/expired cookie, CSRF, mandatory password change, admin reset, deactivation revokes sessions, student accounts disabled, no password hashes in responses.
- `tests/integration/authorization.test.ts`: teacher own class / another class / another subject / another student / another teacher in the timetable; diriginte own class / other class / conduct / subjects; administrator (management, no grades, no self-assignment); commander (global read, no writes); student isolation; losing access when an assignment ends.
- `tests/integration/db-integrity.test.ts`: append-only audit (app role and owner), tamper detection, no deletion of historical data, grade identity immutable, 1–10 constraint, single active year/enrollment.

## Phase 2 – Gradebook core (implemented)
**Relationships:** Teacher → Subject → Module → Class → Academic year = `TeachingAssignment` (kind SUBJECT_TEACHING / PRACTICAL_TRAINING / MODULE_EXAM; `moduleId` null = all modules). A teacher can have any number of subjects/classes/modules. Conflicts rejected: one responsible teacher per (class, subject, kind, module scope); an "all modules" assignment overlaps module-specific ones. Substitutes: prepared through bounded validity (`validFrom/validTo`); a future `role = SUBSTITUTE` field will not change the model.
**Module plan:** `ModuleSubject` (subject in module, `hasFinalExam`, weight, hours). A grade requires a valid module (same year and year of study as the class, OPEN) and a subject in the module plan (except conduct, which belongs to every module).
**Grade rules (server):**
- Create: an active assignment of exactly the required type (predare/practică/examinator for that module; diriginte for conduct) + an active enrollment of the student in the class + value 1–10 (integer by default) + valid reason for the grade type + date within the year and not in the future. Conduct and the module exam: one active grade per student/module.
- Modify / delete: **only the author**, still assigned, open module, active year, within the `grades.editWindowDays` window (default 7) and with optimistic versioning. A **mandatory reason**. Deletion = soft delete (`status=DELETED`, who/when/why). Each change → immutable `GradeRevision` + audit with old/new value, student, class, subject, module, IP, user agent, session, request id.
- Otherwise → **correction request** (409 `CORECTIE_NECESARA`).
**Correction workflow:** the teacher who holds the assignment → `MODIFY`/`DELETE` request with justification (one pending request per grade) → **COMANDANT UNITATE** approves/rejects. The approval applies *exactly* the proposed value, atomically, through the same revision/audit path (the request is "claimed" atomically, so it cannot be applied twice). The commander cannot choose another value and has no direct editing endpoint. **The ADMINISTRATOR does not take part in the workflow** (the architecture does not require it): they have neither editing nor approval rights. Audit: `CORRECTION_REQUEST_CREATE/APPROVE/REJECT/CANCEL` + `GRADE_UPDATE/DELETE` with `approvedById`.
**Results (configurable):** `src/server/results/engine.ts` (pure calculation) + `AveragingRuleSet` (versioned JSON, frozen after activation). Parameters: rounding, subject final (mean / weighted with exam, exam weight, minimum grades), conduct (last/mean, included or not), practical training (included or not), module average (simple mean / weighted by `ModuleSubject.weight`). The seed activates **provisional rules** (marked in the UI). Closing a module → immutable `ModuleResultSnapshot` for every class. Results visible to: commander (all), diriginte (own class).
**Students:** create with enrollment, edit identity data; **there is no endpoint for moving between classes** (fields other than identity are rejected).

## Phase 2 – UI (Romanian, responsive, light/dark)
Next.js App Router + Tailwind 4, self-hosted Inter font, navy/gold identity, nonce-based CSP per request (`src/proxy.ts`). Pages: `/autentificare`, `/schimbare-parola`, `/panou` (by role), `/catalog`, `/catalog/clase/[id]`, `/catalog/clase/[id]/materii/[subjectId]` (grades + entry), `/catalog/note/[id]` (details, history, modify/delete/correction request), `/catalog/elevi/[id]`, `/catalog/clase/[id]/rezultate/[moduleId]` (print-ready), `/catalog/notele-mele`, `/cereri-corectie`, `/elev`, `/administrare/{elevi,materii,module,repartizari}`. Navigation is generated on the server from capabilities; pages call the services (the same authorization as the API) and turn 403/404 into a 404 page.

## Phase 3 – Academic years, promotion, history, timetable (implemented)
**Academic years:** persistent (`2026–2027`, `2027–2028`, …), PLANNED → ACTIVE → CLOSED; every grade/enrollment/assignment/class belongs to a year. Closed years are read-only.
**Automatic transition (`src/server/domain/rollover.ts`):**
- On **1 September** (Europe/Bucharest time, independent of the server's timezone): 111→211, 112→212, 113→213, 114→214, 115→215, 124→224, 125→225 (new classes in the new year, **same cohort/promoție**); year I students → `PROMOTED` + active enrollment in 2xy; year II → `GRADUATED` (student `GRADUATED`, student account `INACTIVE` + sessions revoked); new, empty year I classes (suffixes from `school.classSuffixes`); still-open modules are closed with **result snapshots**; the old year's assignments are ended (not deleted); the old year → `CLOSED`, the new one → `ACTIVE`. Repeating students (`REPEATING` enrollment) stay in the same year of study.
- **Server-side, not in the browser:** in-process scheduler (`src/instrumentation.ts` → `src/server/jobs/scheduler.ts`, hourly) in `AUTO` mode (default; `MANUAL_CONFIRM` configurable) + CLI `npm run an-nou` for an OS cron/systemd timer + manual execution from the administrator UI (only after 1 September).
- **Idempotent:** advisory lock, refusal before the date, a unique `year_rollovers(from,to)` record, and no re-enrollment of students who already have an enrollment in the new year. Two concurrent runs → exactly one executes (tested).
**History:** the commander selects any academic year in the catalog; the administrator views classes/students/modules for any year. Historical classes show their own roster (promoted/graduated), teachers and diriginte **from that year** (assignments are tied to the class of that year, so they never inherit later assignments). Teachers have no historical access (scope = active year only). Grades, revisions, snapshots and audit remain linked to the old year.
**Timetable:** Excel template v1 (`docs/ORAR_IMPORT.md`, downloadable with reference sheets) → upload (multipart, Origin check, ≤ 2 MB, ZIP/zip-bomb/VBA-macro check before parsing, no formulas) → report with **row + column** for every error (unknown class/teacher/subject/day/time slot, inactive teacher, class/teacher conflicts with odd/even weeks and groups) and warnings (teacher without an assignment, room occupied) → draft version → **preview with diff** → publishing. **Versioning without loss:** for each week, the published version with the latest start date covering it; archiving restores the previous version; republishing is possible; the files are kept (SHA-256). Weekly view `/orar`: previous/current/next week + date picker, odd/even weeks; teacher = own lessons only (+ homeroom class), admin/commander = everything with class/teacher filters, student = own class.
**UI:** `/orar`, `/administrare/orar`, `/administrare/orar/[id]`, `/administrare/ani-scolari` (transition preview, manual execution, history), `/administrare/clase` (by year), year selector in `/catalog` (commander) and `/administrare/elevi`.
**Dependencies:** `exceljs` (with the `uuid` override to a patched version). Overrides for `deepmerge-ts`/`mysql2` (transitive dependencies of the Prisma CLI) → `npm audit`: 0 vulnerabilities.

## Pending work (roadmap)
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
5. The official bell schedule and the final timetable template format (v1 is documented and versioned; extra columns can be added without breaking).
6. Repeating students: the model supports them (`REPEATING` enrollment), but there is no UI for marking them yet.

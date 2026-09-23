# Arhitectura – Catalog electronic SMMMFN

Detailed design for the electronic gradebook of **Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”**.
This is the reference design. `PROJECT_STATUS.md` holds the short summary and progress tracking.

> Documentation is in English for developers. **All user-facing UI text is in Romanian.**
>
> This is the original (phase 0) design. Deviations made during implementation are recorded in `PROJECT_STATUS.md`. The main ones: the year transition runs automatically on 1 September by default, the commander's audit view is limited to academic events plus oversight of grading-relevant administrator actions, and PDF output comes from print-optimized pages.

---

## 1. Technology stack

| Concern | Choice | Reason |
|---|---|---|
| Language | **TypeScript** (strict) everywhere | One language on client and server, typed domain model |
| Web framework | **Next.js (App Router)**, server-rendered | Full-stack monolith. Data is loaded and authorized on the server, and React Server Components keep secrets and queries off the client |
| Database | **PostgreSQL 16+** | Relational integrity, CHECK constraints, triggers for append-only audit, JSONB for configurable rules, `timestamptz` |
| ORM / migrations | **Prisma** (parameterized queries only; raw SQL only through tagged `Prisma.sql`) | Safe against SQL injection, versioned migrations, raw SQL migrations for triggers/grants |
| Validation | **Zod** (shared schemas, always re-validated on the server) | One source of truth for input rules |
| Auth | **Custom server-side sessions** (opaque token, DB-stored, hashed) + **argon2id** (`@node-rs/argon2`) | Instant revocation (deactivation, password reset), no JWTs in the browser |
| UI | **Tailwind CSS** + **shadcn/ui** (Radix primitives) + `next-themes` | Accessible components, dark/light mode, rounded cards, subtle shadows/animations |
| Font | **Inter** (or Source Sans 3), latin-ext subset | Clean sans-serif with full Romanian diacritics (ă â î ș ț) |
| Excel | **ExcelJS** | Timetable import template and report export |
| PDF reports | server-side HTML→PDF (Playwright) or `pdfmake` (to be decided) | Module result tables |
| Logging | **pino** (structured app logs, kept separate from the audit log) | Operations/debugging |
| Tests | **Vitest** (unit/integration against a real Postgres), **Playwright** (e2e + authorization matrix) | Security regressions must be caught automatically |
| Runtime / deploy | Node 22 LTS, **Docker** + docker-compose (app + Postgres), reverse proxy with TLS (Caddy/Nginx) | Simple to host on-premise or on an EU VPS |

**Scale:** 5–7 concurrent users. A single app instance plus one Postgres is enough. Rate limiting and sessions are stored in the database, so the app can later run on several instances without Redis. Redis can be added if load ever requires it.

## 2. Application architecture

Modular monolith with strict layering. Only the server layer touches the database.

```
src/
  app/                      # Next.js routes (Romanian URLs), UI only
    (public)/autentificare
    (app)/panou             # dashboard
    (app)/catalog/...       # classes, students, grades
    (app)/orar
    (app)/cereri-corectie
    (app)/rapoarte
    (app)/audit             # ADMIN + COMANDANT only
    (app)/administrare/...  # ADMIN only: utilizatori, clase, materii, module, repartizari, ani-scolari, orar, configurare
  server/                   # `import "server-only"` – never bundled to the client
    db/                     # Prisma client (the only import site of Prisma)
    auth/                   # password hashing, sessions, login throttling
    authz/                  # permissions, scope resolution, policy checks
    audit/                  # append-only audit writer
    domain/<module>/        # services: users, academic, grades, corrections, timetable, results, rollover
    jobs/                   # scheduled jobs (year rollover, session cleanup)
  lib/validation/           # Zod schemas
  i18n/ro.ts                # all UI strings (Romanian)
  components/               # UI components (shadcn/ui based)
```

Rules:
1. **Every mutation and every read of academic data goes through a domain service** that receives the `actor` (resolved from the session on the server). Services call `authz` before touching data **and** build scoped queries, for example `WHERE classSectionId IN (actor's classes)`. They never load everything and filter afterwards.
2. Server Actions and Route Handlers are thin. They validate input with Zod, resolve the session, call a service, and map errors to generic Romanian messages.
3. A resource outside the actor's scope returns **404 (Nu a fost găsit)**, not 403, so resource IDs cannot be enumerated.
4. The client receives only **capability flags** computed on the server (for example `poateAdaugaNote`), never the internal role name. The UI hides actions for convenience, and the server enforces them.
5. The audit record is written **in the same DB transaction** as the change it describes.
6. An ESLint rule (`no-restricted-imports`) forbids importing `server/db` outside `src/server`.

## 3. Domain / database model

Conventions: UUID primary keys (audit uses `bigserial`), `createdAt/updatedAt` as `timestamptz` (UTC; displayed in Europe/Bucharest), foreign keys `ON DELETE RESTRICT` on all historical data (**no cascade deletes of academic data**), soft deactivation instead of deletion.

### 3.1 Identity and accounts
- **User**: `id, firstName, lastName, rankId?` (null = civilian contract staff), `username` (unique, case-insensitive), `passwordHash, role` (`ADMINISTRATOR | COMANDANT_UNITATE | PROFESOR | ELEV`), `status` (`ACTIVE | INACTIVE | DELETED`), `mustChangePassword, passwordChangedAt, lastLoginAt, failedLoginCount, lockedUntil`.
  - `DELETED` means the login is permanently removed: password hash cleared, sessions revoked, username freed by renaming. **The row and the name stay**, so grades and audit entries keep pointing to the real historical identity.
  - Display labels: `ADMINISTRATOR` → "Administrator", `COMANDANT_UNITATE` → **"COMANDANT UNITATE"** (exact).
- **Rank** (grad militar): configurable list `code, label, category (ofițer/maistru/subofițer/…), sortOrder, active`.
- **Session**: `idHash` (SHA-256 of the random token), `userId, createdAt, lastSeenAt, expiresAt, ip, userAgent, revokedAt, revokeReason`.
- **LoginAttempt**: `username, ip, at, success`, used for throttling and security review.

**DIRIGINTE is not a stored role.** It is derived from an active `HomeroomAssignment` of a `PROFESOR`. This scopes it to one class and one academic year automatically, and it disappears when the assignment ends. See §4.

### 3.2 Academic structure and history
- **AcademicYear** (an școlar): `name` ("2026–2027"), `startDate` (01.09), `endDate` (31.08), `status` (`PLANNED | ACTIVE | CLOSED`). Exactly one is `ACTIVE`, and a `CLOSED` year is read-only.
- **Specialization** (specializare): configurable. It is probably tied to the class suffix; see uncertainties.
- **Cohort** (promoție): `entryYearId, suffix` (e.g. `"12"`, `"24"`), `specializationId?`. It follows the same group of students across both years.
- **ClassSection** (clasa within one academic year): `academicYearId, cohortId, yearOfStudy (1|2), code` (`"112"` = yearOfStudy + suffix), `status`. Unique on `(academicYearId, code)`.
  - Year I (Compania 2): 111, 112, 113, 114, 115, 124, 125. Year II (Compania 1): 211 … 225.
  - Company = f(yearOfStudy), kept in a config mapping (`{2: "Compania 1", 1: "Compania 2"}`).
  - Class 112 in 2026–27 and class 212 in 2027–28 are **two rows sharing one cohort**. Old classes therefore stay intact forever.
- **Student** (elev): `firstName, lastName, rankId?, registryNumber` (nr. matricol), `status` (`ACTIVE | GRADUATED | WITHDRAWN | …`), `userId?`. The **optional login account is separate**, so it can be deleted after graduation while the Student record stays.
- **Enrollment**: `studentId, classSectionId, academicYearId, status` (`ACTIVE | PROMOTED | GRADUATED | REPEATING | TRANSFERRED | WITHDRAWN`), `startDate, endDate`. A class change ends one enrollment and opens another.

### 3.3 Curriculum
- **Subject** (materie): `name, shortName, type` (`GENERAL` cultură generală | `SPECIALIZATION` de specialitate | `PRACTICAL_TRAINING` instruire practică | `CONDUCT` purtare), `isSystem, active`. "Purtare" is a system subject of type `CONDUCT`, so every grade row has a subject.
- **Module** (modul): `academicYearId, yearOfStudy` (optionally `specializationId`), `name, order, startDate, endDate, status` (`PLANNED | OPEN | CLOSED`).
- **ModuleSubject** (planul modulului): `moduleId, subjectId, specializationId?, hasFinalExam, weight/credits, hoursPerWeek`. It defines what is graded in each module and gives parameters to the averaging engine.

### 3.4 Assignments (never deleted, only end-dated)
- **TeachingAssignment**: `teacherId, classSectionId, subjectId, academicYearId, moduleId?, validFrom, validTo?, createdById`. This row grants a PROFESOR access to that class and subject.
- **HomeroomAssignment**: `teacherId, classSectionId, validFrom, validTo?`. This row grants DIRIGINTE access to that class.

### 3.5 Grades
- **GradeReason** (motiv/tip notă): configurable `code, label, appliesTo[]` (grade kinds), `sortOrder, active`. Seed values: Testare, Ascultare, Activitate la clasă, Caiet, Proiect, Altă activitate.
- **Grade**: `studentId, enrollmentId, classSectionId` (historical class), `subjectId, moduleId, academicYearId, kind` (`CURRENT` notă curentă | `MODULE_EXAM` examen final de modul | `FINAL` notă finală directă, e.g. conduct), `value` NUMERIC(4,2) with `CHECK (value BETWEEN 1 AND 10)` (integers only, enforced by a configurable policy), `reasonId, note?, gradeDate, authorId` (original author, **never changes**), `teachingAssignmentId?, status` (`ACTIVE | DELETED`), `version` (optimistic locking), `createdAt`.
  - Grades are **never physically deleted**. A deletion sets `status = DELETED` together with `deletedById, deletedAt, deletionReason, correctionRequestId?`.
- **GradeRevision**: an immutable row for every state of a grade (`CREATE | UPDATE | DELETE | RESTORE`). It stores the full value snapshot, `changedById, changeReason, changedAt, correctionRequestId?`. This is the business history shown in the UI, and the audit log is the security record.
- **GradeCorrectionRequest** (cerere specială de corecție/ștergere): `type` (`MODIFY | DELETE | ADD_LATE`), `gradeId?, proposedValue?, proposedReasonId?, justification, requestedById, status` (`PENDING | APPROVED | REJECTED | CANCELLED`), `reviewedById, reviewedAt, reviewComment, appliedAt`.

### 3.6 Results and averaging (configurable)
- **AveragingRuleSet**: `name, version, scope` (academic year / yearOfStudy / specialization), `definition` JSONB, `status` (`DRAFT | ACTIVE | ARCHIVED`), `effectiveFrom`. It is **versioned and immutable once activated**. A change creates a new version.
- **ModuleResult** / **ModuleResultLine**: snapshot per student and module containing each subject's final grade, conduct, practical training, module average, `ruleSetId`/version used, `computedAt, closedById`. The snapshot is written when a module is closed, so later rule changes never rewrite history.

### 3.7 Timetable – see §7
`TimeSlot, TimetableVersion, TimetableEntry, TimetableOverride, TimetableImport`.

### 3.8 System
- **AuditLog**: see §5.
- **SystemSetting**: `key, value` JSONB, `updatedById`. Changes are audited. Examples: password policy, edit window, session timeouts, company mapping, rollover mode.

## 4. Roles and permissions

Two layers enforced **on the server**:
1. **RBAC**: role → set of permissions (e.g. `grade.create`, `user.manage`, `audit.read`).
2. **Scope (relationship-based)**: for PROFESOR, DIRIGINTE and ELEV, every permission is limited to resources reachable through active assignments or the student's own enrollment in the relevant academic year.

`authz.assert(actor, permission, resource)` is the single entry point. It resolves scope from the DB on every request, so access is never taken from client state.

| Capability | ADMINISTRATOR | COMANDANT UNITATE | PROFESOR | DIRIGINTE (own class) | ELEV (future) |
|---|---|---|---|---|---|
| Manage users, reset passwords | ✅ | – | – | – | – |
| Manage years, classes, subjects, modules, assignments | ✅ | – | – | – | – |
| Manage timetable / import | ✅ | – | – | – | – |
| System configuration (grade reasons, rules, settings) | ✅ | view | – | – | – |
| View grades | read-only* | all | assigned class+subject | all subjects of own class | own grades |
| Create grades | ❌ | ❌ | assigned class+subject, open module | conduct for own class (+ own subjects as PROFESOR) | – |
| Modify/delete own grade (with reason, within edit window) | ❌ | ❌ | ✅ | ✅ (conduct) | – |
| Create correction request | – | – | ✅ | ✅ | – |
| Approve/reject correction request | ❌ | ✅ | – | – | – |
| Audit log | ✅ | ✅ | ❌ | ❌ | ❌ |
| Reports | technical | all | own classes/subjects | own class | – |
| Timetable view | all | all | own | own + own class | own class |
| See role names | ✅ (all) | ✅ (except ADMINISTRATOR) | ❌ (not even own) | ❌ | ❌ |

\* Admin read access to grades is a pending decision (the audit log already exposes grade values to admins).

Key rules:
- An ADMINISTRATOR **cannot** create, modify or delete grades, even through the API. The permission does not exist for that role.
- **Separation of duties:** an admin cannot give a teaching assignment to themselves, and one account holds exactly one role. An admin who also teaches uses a separate PROFESOR account.
- A PROFESOR who is also a DIRIGINTE gets the **union** of both scopes, and only for the classes those assignments cover.
- Role and user lists are visible only to admins. The COMANDANT UNITATE and ADMINISTRATOR roles never appear in any list that normal users can see. The session/profile endpoint returns only capability flags.
- Closed academic years and closed modules are read-only for everyone. Changes go only through approved correction requests.

## 5. Grade and audit model

### Grade lifecycle
1. **Create:** the PROFESOR has an active TeachingAssignment for the class and subject. The module is `OPEN`, the student has an active enrollment in that class, the value passes validation, and a reason is chosen. This writes Grade + GradeRevision(CREATE) + AuditLog(`GRADE_CREATE`).
2. **Modify/delete by author:** allowed only for the grade's own `authorId`, while the module is open and within `grades.editWindowDays` (configurable). A **reason is mandatory**. Optimistic locking uses `version`. This writes GradeRevision + AuditLog(`GRADE_UPDATE`/`GRADE_DELETE`) with old/new values.
3. **Outside the window, closed module, or the author has left:** the teacher submits a GradeCorrectionRequest. The COMANDANT UNITATE approves or rejects it. On approval the system applies the change atomically, recording `correctionRequestId`, the requester and the approver. Every step is audited (`CORRECTION_REQUEST_CREATE/APPROVE/REJECT`, then `GRADE_UPDATE/DELETE`).
4. `authorId` never changes, so modifications by others appear as revisions.

### AuditLog (append-only)
Columns: `id` (bigserial), `occurredAt, actorId, actorSnapshot` (name, rank, role at that moment), `action, outcome` (`SUCCESS | FAILURE | DENIED`), `entityType, entityId, studentId?, classSectionId?, subjectId?, academicYearId?, before` JSONB, `after` JSONB, `reason?, correctionRequestId?, approvedById?, ip, userAgent, sessionRef` (hashed), `requestId, prevHash, hash`.

Actions (minimum): `LOGIN, LOGIN_FAILED, LOGOUT, SESSION_EXPIRED, PASSWORD_CHANGE, PASSWORD_RESET, USER_CREATE, USER_UPDATE, USER_DEACTIVATE, USER_DELETE, ASSIGNMENT_CREATE/END, HOMEROOM_CREATE/END, GRADE_CREATE, GRADE_UPDATE, GRADE_DELETE, CORRECTION_REQUEST_CREATE/APPROVE/REJECT/CANCEL, MODULE_OPEN/CLOSE, TIMETABLE_IMPORT/PUBLISH/UPDATE, CONFIG_UPDATE, RULESET_ACTIVATE, YEAR_ROLLOVER, ACCESS_DENIED` (authorization failures on the server).

Integrity guarantees:
- A Postgres trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log`. The application's DB role has only `INSERT, SELECT` on it, and migrations run under a separate owner role.
- A **hash chain** (`hash = SHA-256(prevHash ‖ canonical row)`) makes tampering detectable. A verification job and an admin page check the chain.
- There is no retention purge. Archiving, if ever needed, copies records and never deletes them.
- Access is allowed only for ADMINISTRATOR and COMANDANT UNITATE, and every audit view or export is itself audited.

## 6. Academic year and history model (rollover)

**`YearRolloverService`** is idempotent and runs in one transaction with a dry-run preview.
- **Mode:** `rollover.mode` = `MANUAL_CONFIRM` (recommended default: the admin reviews the preview in August and the job runs on September 1) or `AUTO` (cron on 01.09, 00:05 Europe/Bucharest).
- **Steps:**
  1. Refuse to run if any module in the old year is still open or correction requests are pending, unless forced with a warning.
  2. Set the old AcademicYear to `CLOSED` (read-only) and the new one to `ACTIVE`.
  3. For each Year I ClassSection `1xy`, create ClassSection `2xy` in the new year with the same Cohort.
  4. For each active Year I enrollment, mark the old enrollment `PROMOTED` and create an enrollment in `2xy`. Students flagged as repeating or withdrawn are handled by their own status.
  5. Mark Year II enrollments `GRADUATED` and set Student.status to `GRADUATED`. Their optional login accounts become `INACTIVE` and can later be `DELETED`, while the Student and all grades remain.
  6. Create the empty Year I classes for the new intake from the configured suffix list.
  7. Old assignments stay attached to the old year's classes, so the admin creates new ones for the new year. A "copy from last year" helper can speed this up.
  8. Write the `YEAR_ROLLOVER` audit entry with a summary.
- Nothing is deleted. History views filter by academic year.

## 7. Timetable architecture

- **TimeSlot** (bell schedule): `index, startTime, endTime`, configurable, with optional versions per year.
- **TimetableVersion**: `academicYearId, validFrom, validTo?, status` (`DRAFT | PUBLISHED | ARCHIVED`), `importId?, weekPattern` (`ALL`, or A/B parity if needed).
- **TimetableEntry**: `versionId, classSectionId, dayOfWeek, timeSlotId, subjectId, teacherId, room?, group?` (half-class), `weekParity?`.
- **TimetableOverride**: one-off changes for a specific date (replacement teacher, cancelled lesson).
- **TimetableImport**: the uploaded file (bytes/hash), `uploadedById, status` (`UPLOADED | VALIDATED | FAILED | PUBLISHED`), validation report JSON.

**Import pipeline:** upload `.xlsx` (size limit, magic-byte check, `.xlsm` and macros rejected) → parse with ExcelJS using the **predefined template** (versioned, e.g. sheet per class or one flat sheet: `Clasa | Ziua | Ora | Materie (cod) | Profesor (utilizator) | Sala | Săptămâna`) → validate (unknown class/subject/teacher, teacher double-booked, class double-booked, entry without a matching TeachingAssignment → warning) → preview diff against the current version → publish (audited). The template version is stored so the format can evolve.

**Display:** for the selected ISO week, resolve the published version whose validity covers that week, apply parity and overrides, then **filter by scope**. A PROFESOR sees their own entries, a DIRIGINTE also sees their class, a student sees their class, and admin/comandant see everything. Timetable entries become the future anchor for attendance ("lessons").

## 8. Security-critical components

1. **Authentication:** argon2id (OWASP parameters). Password policy: min 8 characters, ≥1 uppercase, ≥1 digit, ≥1 special character, with the length configurable upward. `mustChangePassword` after an admin reset. Generic Romanian error "Nume de utilizator sau parolă incorecte". Constant-time comparison, and a dummy hash is checked for unknown users so timing does not reveal valid usernames.
2. **Brute force / rate limiting:** DB-backed throttling per username and per IP (e.g. 5 failures → progressive lockout from 15 min), a global per-IP limit, and a general per-session limit on mutations.
3. **Sessions:** 256-bit random token in a cookie `__Host-sesiune` (`HttpOnly; Secure; SameSite=Strict; Path=/`), stored hashed. Idle timeout (~30 min) and absolute timeout (~12 h). The token is rotated on login and privilege change. Every session is revoked on password reset, deactivation or role change.
4. **Authorization:** central `authz` and scoped queries (§2, §4). An automated **authorization test matrix** checks every role against every endpoint, including out-of-scope IDs.
5. **CSRF:** SameSite=Strict, the built-in Origin check of Next.js Server Actions, and an explicit Origin/Host check on Route Handlers. No state change through GET.
6. **XSS:** React escaping, no `dangerouslySetInnerHTML`, and a strict nonce-based CSP. **Spreadsheet export** escapes formula injection (`= + - @`).
7. **Injection:** Prisma parameterization, Zod validation of every input (IDs as UUIDs, grade 1–10, text length limits).
8. **Headers:** HSTS, CSP, `X-Frame-Options: DENY`/`frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy`.
9. **Error handling:** generic Romanian messages with a request ID. Stack traces and details go only to server logs.
10. **Secrets and config:** only environment variables (`.env` git-ignored, `.env.example` committed). Nothing sensitive in client bundles (`server-only`), and no `NEXT_PUBLIC_*` secrets.
11. **Database hardening:** a least-privilege app role, the append-only audit trigger, CHECK constraints, `ON DELETE RESTRICT`, and encrypted daily backups with a tested restore.
12. **Bootstrap:** the first administrator is created with a CLI seed command (`npm run creeaza-admin`), never through a public endpoint.
13. **Future hardening:** TOTP two-factor authentication for ADMINISTRATOR and COMANDANT UNITATE (strongly recommended before going online), and an IP allow-list for the administration area.

## 9. UI/UX guidelines

- Romanian everywhere, with all strings in `src/i18n/ro.ts` (ready for i18n but only `ro` for now). Dates use `dd.MM.yyyy` and timezone Europe/Bucharest.
- Institutional palette: dark navy (`#0B1F3A` / `#132B4F`), naval blue accent, gold/brass secondary for highlights. Dark and light themes are built on CSS variables, with a theme switch and the system preference as the default.
- Rounded cards and buttons (`rounded-2xl`), subtle shadows, restrained hover and focus transitions, and `prefers-reduced-motion` support.
- Inter (sans-serif) only, with tabular numerals for grade tables but **no monospace** fonts.
- Readable tables: sticky header and first column (student name), zebra rows, and a card layout on mobile.
- Accessibility: WCAG 2.1 AA contrast in both themes, keyboard navigation, visible focus, ARIA through Radix, and labels on every form field.
- Responsive from 360 px mobile to desktop, with a collapsible sidebar and a mobile drawer.

## 10. Configurable items (must not be hard-coded)

Averaging rules (per subject, exam weight, conduct and practical weight, rounding, minimum number of grades), grade reasons, edit window, integer vs decimal grades, class suffixes and specializations, company mapping, modules and dates, rank list, time slots, timetable template version, password policy parameters, session timeouts, lockout thresholds, rollover mode.

## 11. Future extensions (the design leaves room)

- **Student accounts (ELEV):** `Student.userId` and the ELEV role/scope already exist. Enabling them means creating accounts and turning on the student views.
- **Attendance (absențe):** add `AttendanceRecord(studentId, enrollmentId, date, timeSlotId, timetableEntryId?, subjectId, status, excused, excusedById)`, reusing the scope/authz pattern and the audit pipeline. No existing table needs to change.
- **Two-factor authentication**, an IP allow-list, and SSO/AD integration if MApN infrastructure requires it.
- Extra supervisory roles (e.g. company commander) as new role → permission and scope mappings.
- PDF/Excel exports of module tables, digital signing and archiving of closed module reports, and notifications.

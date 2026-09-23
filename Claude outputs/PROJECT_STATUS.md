# PROJECT_STATUS – Catalog electronic SMMMFN

Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”
Last updated: **2026-09-23** · Phase: **0 – Architecture (no application code yet)**
Full design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## 1. Current state

- Local project folder and GitHub repo (`TiGabriel/Catalog-SMMMFN`) were **empty** – designed from scratch.
- Repository initialized with documentation only (this file, `docs/ARCHITECTURE.md`, `README.md`, `.gitignore`, `.gitattributes`).
- No code, no database, no dependencies, no environment files yet.

## 2. Architecture decisions

| Area | Decision |
|---|---|
| Language | TypeScript (strict), pnpm monorepo: `apps/api`, `apps/web`, `packages/shared` |
| Backend | Node.js 22 LTS + Fastify 5, Zod validation, Prisma ORM |
| Database | PostgreSQL 16+ (constraints, triggers for append-only audit, JSONB) |
| Frontend | React + Vite SPA, React Router, TanStack Query, Tailwind + Radix/shadcn-style components, Inter font |
| Auth | Username + password, Argon2id, server-side sessions in DB, `__Host-` HttpOnly/Secure/SameSite=Strict cookie |
| Authorization | Server-side only: static role→permission map in code + per-request **scope** from assignments + state checks; deny by default; 404 when out of scope |
| Audit | Append-only `audit_log`, written in the same transaction as the change, DB-level UPDATE/DELETE block, hash chain |
| History | No hard deletes; identity (`staff_members`, `students`) separated from login (`users`); per-year `class_sections` linked by `cohorts` (112 → 212) |
| Averages | Configurable, versioned rule sets + strategy registry; final results frozen as snapshots |
| Timetable | Admin uploads structured `.xlsx` template → validate → preview → publish; base weekly version + per-week overrides |
| Deployment | Docker Compose: Caddy (TLS, SPA) + API + PostgreSQL, same origin (`/api`) |
| Language of UI | Romanian only, all strings centralized in `apps/web/src/i18n/ro.ts` |

## 3. Database entities (summary)

- **People & access:** `staff_members`, `students`, `users`, `user_roles`, `sessions`, `password_history`
- **Structure:** `school_years`, `companies`, `specializations`, `cohorts`, `class_sections`, `enrollments`, `subjects`, `module_definitions`, `module_subjects`, `module_instances`
- **Assignments:** `teaching_assignments`, `homeroom_assignments` (versioned by `valid_from/valid_to`)
- **Grades:** `grade_types`, `grades` (categories: SUBJECT / CONDUCT / PRACTICAL_TRAINING / MODULE_EXAM), `grade_revisions`, `grade_change_requests`
- **Results:** `averaging_rule_sets`, `result_snapshots`, `result_lines`
- **Timetable:** `time_slots`, `rooms`, `timetable_imports`, `timetable_versions`, `timetable_entries`
- **System:** `audit_log`, `system_settings`
- **Future:** `lesson_occurrences`, `attendance_records`

## 4. Roles

| Internal role | Stored? | Notes |
|---|---|---|
| `ADMINISTRATOR` | yes | 1–2 IT admins; manages users, structure, assignments, timetable, config; **no grade writes** |
| `COMANDANT_UNITATE` (display: "COMANDANT UNITATE") | yes | Read-all, full audit, approves/rejects special requests; no direct grade edits; hidden from normal users |
| `PROFESOR` | yes | Scoped to own teaching assignments |
| DIRIGINTE | **derived** from active homeroom assignment | Full read on own homeroom class, enters conduct grade |
| `ELEV` | yes (inactive in v1) | Own grades, current info, timetable; no audit |

Normal users never see role names (the API returns only capabilities for building menus).

## 5. Permissions (summary)

- Admin: users/passwords, structure, assignments, timetable, configuration, audit read. No grade create/update/delete; grade read denied by default.
- Commandant: read all academic data + reports + audit; review special requests.
- Profesor: own timetable; assigned classes × subjects; create grades there; modify/delete **own** grades with mandatory reason inside the edit window; otherwise special request.
- Diriginte: everything academic for the homeroom class (read), conduct grade (write), plus teacher rights where assigned.
- Elev (future): own data only.
- Audit: **only** Admin and Commandant – enforced by the API, not by hiding UI.

Full matrix: `docs/ARCHITECTURE.md` §5.2.

## 6. Completed work

- [x] Inspected local folder and GitHub repo (both empty)
- [x] Recommended stack
- [x] Architecture, domain model, role/permission model, grade/audit model, history model, timetable design, security plan
- [x] Open questions documented
- [x] Git repository initialized, remote `origin` set to GitHub

## 7. Pending work (next phases)

**Phase 1 – Foundation (next):**
1. Monorepo scaffold (pnpm, TS strict, ESLint/Prettier, Vitest), `.env.example`, Docker Compose (Postgres) for dev.
2. Prisma schema for people/access, structure, assignments, `audit_log`, `system_settings` + raw SQL migration for audit immutability and DB roles.
3. Auth: login/logout, Argon2id, password policy, sessions, CSRF, rate limiting, lockout, forced password change; audit of auth events.
4. `authz` module (permissions, ScopeService, policy helpers) + authorization test harness.
5. Web shell: Romanian i18n, theme (navy, dark/light), layout, login page, capability-based menu.
6. Seed/CLI: create first ADMINISTRATOR; seed the 14 classes, study years, companies, default grade types.
7. GitHub Actions CI (lint, typecheck, test, audit).

**Phase 2:** admin CRUD (users, staff, students, subjects, modules, classes, assignments, homeroom).
**Phase 3:** grades (entry, edit/delete with reason, revisions), grade change requests + commandant review, audit viewer.
**Phase 4:** timetable template/import/publish/view.
**Phase 5:** results engine + module class table report (XLSX/PDF).
**Phase 6:** school-year rollover job (dry run + execution).
**Later:** student accounts, attendance, 2FA, PDF catalog printouts.

## 8. Important decisions (rationale)

1. Separate API + SPA → one place for authorization; frontend never trusted.
2. DIRIGINTE derived from assignment, not a static role → access follows the current school year automatically.
3. Class per school year + cohort link → 112→212 without rewriting history.
4. Grades reference enrollment + author staff member → history survives account deletion and promotions.
5. Soft delete + revisions + append-only audit → no silent loss of data.
6. Averaging rules as versioned configuration, results frozen when finalized.
7. Role→permission mapping in code (Git-reviewed), not editable in UI.

## 9. Known uncertainties (need school input)

1. Averaging formulas and rounding (subject, module exam, conduct, practical training, module average).
2. Exact meaning/structure of modules (periods vs subject groups, count per year, which have exams).
3. Conduct grade frequency (per module / semester / year).
4. How practical training is graded and by whom.
5. Meaning of class codes x1y vs x2y (specializations?).
6. Integer vs decimal grades per category.
7. Teacher edit window length; edits of a predecessor's grades.
8. Whether Admin may read grades; whether one person may hold multiple roles.
9. Repeating/failing students at rollover; automatic vs confirmed rollover.
10. Final timetable Excel layout (sample of the current timetable needed), A/B weeks, rooms.
11. Hosting environment and data-protection/security accreditation requirements.

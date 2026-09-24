# PROJECT_STATUS – Catalog electronic SMMMFN

Electronic gradebook for **Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”**. The UI is entirely in Romanian.

_Last updated: 2026-09-24 · Status: **ready for production deployment** (phases 0–6 completed, full end-to-end functionality check passed)_

Related documents: [`README.md`](README.md) (development) · [`DEPLOYMENT.md`](DEPLOYMENT.md) (production) · [`SECURITY.md`](SECURITY.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/ORAR_IMPORT.md`](docs/ORAR_IMPORT.md)

## 1. Current status
- All planned functionality is implemented, tested and documented. The production build succeeds without secrets, `npm audit` reports 0 known vulnerabilities, and 134 automated tests + 189 end-to-end browser checks (every role, every page, every main flow) pass.
- Installation was rehearsed from scratch (fresh DB → migrations → grants → seed → admin CLI → production start), and a backup → restore cycle was verified (identical data, intact audit chain).
- Still open: official data from the school (averaging rules, bell schedule, ranks, specializations) and the recommended hardening before exposure to the Internet (2FA, network restriction – see §8).

## 2. Architecture (summary)
| Area | Decision |
|---|---|
| Stack | Next.js 16 (App Router, server-rendered) + TypeScript, PostgreSQL 16, Prisma 7 (`@prisma/adapter-pg`), Zod 4, argon2id, Tailwind 4, ExcelJS |
| Layering | All data access is in `src/server/**` (`server-only`, ESLint rule). Pages and API routes call services that receive the server-resolved `Actor` and run authorization + scoped queries |
| Sessions | Server-side, 256-bit token in the `__Host-sesiune` cookie (HttpOnly/Secure/SameSite=Strict), hash in the DB, idle 30 min / absolute 12 h |
| Authorization | Role → permission matrix in code + relationship scope (assignments, homeroom, own enrollment) from the DB; 404 for out-of-scope objects, denials audited |
| History | Nothing academic is physically deleted (FK `RESTRICT` + triggers). Class per year + cohort (112 → 212). Revisions, snapshots and audit are immutable |
| Audit | Append-only, SHA-256 hash chain set by a DB trigger, verifiable (`audit_log_verify_chain()`) |
| Averages | Versioned rule sets (JSON), pure calculation engine, frozen snapshots when a module closes |
| Background work | In-process scheduler + CLI/systemd timer for the idempotent year transition on 1 September |

## 3. Implemented features
**Roles:** ADMINISTRATOR, COMANDANT UNITATE, PROFESOR, DIRIGINTE (derived from homeroom assignment), ELEV (optional, disabled by default).

- **Authentication:** login/logout, argon2id, password policy (length, uppercase, digit, special, no username, no common words), mandatory change of temporary passwords, per-username/IP throttling (serialized), session rotation, deactivation revokes sessions, first administrator only through the CLI.
- **Administration:** users (create, edit, role, reset password, deactivate/delete with reason), academic years, classes, students (identity + enrollment history; no transfers), subjects, modules + module plans (subject, final exam, weight), teaching/practical-training/examiner assignments (module-scoped, conflict-checked), homeroom teachers, configuration (settings, grade reasons, versioned averaging rules), timetable import.
- **Grades:** 1–10 (integers by default), reason/type from a configurable list, module, class, year, original author, timestamps. Modify/delete only by the author within the configurable window, with a mandatory reason, optimistic versioning, immutable revisions, soft delete and full audit.
- **Special categories:** conduct (only the class's homeroom teacher, one per module), practical training (only the assigned instructor), module exam (only the designated examiner, one per module).
- **Correction workflow:** teacher request (MODIFY/DELETE, justification) → COMANDANT UNITATE approves/rejects. Approval applies exactly the proposal, atomically and audited. The administrator has no role in it.
- **Module results:** per-subject final, exam, practical training, conduct and module average. The rules are configurable and currently marked provisional in the UI. Snapshot on closing.
- **Academic years:** automatic transition on 1 September (111→211 … 125→225, same cohort), graduation (accounts deactivated, history kept), new year I classes, old modules closed, old assignments ended. Idempotent. History can be viewed by year.
- **Timetable:** versioned Excel template, validation with row/column, draft → preview (diff) → publish, archive/restore without loss, weekly view (previous/current/next week, date picker, odd/even weeks); teachers see only their own lessons.
- **Dashboards** by role; **reports** (class catalog, averages, module results, school-year results, student situation, academic record sheet, general situation) with **Excel export** and **print/PDF** layouts; reports respect the same authorization.
- **Audit UI:** administrator = complete system audit; commander = academic audit + oversight of administrator actions that affect grading (without technical data); filters by date, user, student, class, subject, action, year; integrity check.
- **UI:** Romanian, responsive (mobile/tablet/desktop), light/dark/system theme, navy/gold institutional identity, accessible (contrast, focus, ARIA), no monospaced fonts, print styles.
- **Operations:** `/api/health` (availability + DB), backup/restore scripts, systemd units, Caddy/Nginx configurations, production configuration template.

## 4. Database
- Migrations (`prisma/migrations`): `init`, `integrity` (CHECK constraints, triggers, audit chain), `gradebook_results` (rule sets, snapshots, protections), `production_indexes`.
- Foreign keys: all use `ON DELETE RESTRICT`. History protection: DELETE/TRUNCATE rejected on 19 historical tables, immutable revisions/snapshots/audit, immutable grade identity, single active year/enrollment/homeroom teacher.
- Indexes: primary/unique keys + indexes for the heavy queries (grades by class/subject/module/year, enrollments by year, assignments, correction requests, audit filters). Unindexed FKs point only to small lookup tables.
- Transactions: every change + its revision + its audit entry in the same transaction; advisory locks for login, audit chain, year transition and single-grade kinds; optimistic versioning for grades; atomic "claim" for correction review.
- Least privilege: the `catalog_app` role has no DELETE on history and no UPDATE/DELETE on the audit log (`scripts/db-grants.ts`).
- Backup: daily `pg_dump` (custom format, checksum, optional GPG, retention) + restore into an empty database with verification (tested).

## 5. Security audit (phase 5) – summary
Full report: [`SECURITY.md`](SECURITY.md) §8 (audit results) and §8b (production review). All 30 requested areas and all role, audit and history checks were verified and are covered by automated tests (`tests/integration/security.test.ts` + `auth`, `authorization`, `gradebook`, `db-integrity`, `rollover`, `reports-audit`).

**Vulnerabilities found → fixes**
| # | Finding | Fix |
|---|---|---|
| 1 | Brute force: parallel requests bypassed the 5-failure limit | check → verify → record serialized per username (advisory lock) |
| 2 | Session fixation: presented session not revoked at login, token not rotated on password change | revoked at login, rotated on password change |
| 3 | Student sessions survived disabling student accounts | checked on every request |
| 4 | JSON body limit bypassable with chunked requests | 64 KB streaming limit |
| 5 | Zip bomb: declared sizes in .xlsx were trusted | bounded real decompression of every part |
| 6 | No rate limit when the client IP is unknown | per-session limit (240/min) |
| 7 | Prisma errors (with arguments, e.g. a password hash) could reach the logs | sanitized logging |
| 8 | A password typed into the username field was stored in the audit/attempts | redaction + hashing |
| 9 | Administrator could stage a teacher account/assignment without academic oversight | visible in the commander's audit (assignments, teacher password resets, grade settings, rule sets, year status) |
| 10 | No protection against guessable passwords | blocklist of common words (incl. leetspeak) |
| 11 | Race: duplicate conduct/exam grades | lock + re-check in the transaction |
| 12 | Admin CLI showed the password on screen | hidden input |
| 13 | (phase 6) `.env.test` tracked in Git, demo password in code | untracked + template; password only from the environment |

**No vulnerabilities found (verified, with tests):** SQL injection, XSS (nonce CSP, no `dangerouslySetInnerHTML`), CSRF (Origin + JSON + SameSite=Strict), IDOR (404 + audit), privilege escalation, frontend-only authorization, audit tampering (trigger + grants + hash chain), deletion of history, access to previous years, teacher/diriginte/student isolation, grade editing by the commander/administrator, error leakage.

**Remaining risks:** administrator trust (they control identities – mitigated through commander oversight; 2FA recommended), temporary lockout of a known username (DoS), CSP `style-src 'unsafe-inline'`, in-memory limiter per instance, audit retention to be decided, early test credentials remaining in Git history (local values only).

## 6. Tests performed
| Type | Scope | Result |
|---|---|---|
| Unit (`tests/unit`) | password policy, permission matrix, results engine | pass |
| Integration (`tests/integration`, real PostgreSQL, isolated DB per file) | authentication, authorization/IDOR per role, gradebook (entry/modification/deletion/corrections/conduct/practical/exam/modules), DB integrity (append-only audit, no deletion, constraints), year transition (mapping, idempotency, graduation, history), timetable (validation, versions, weeks, isolation), reports + audit (per role, Excel, filters), security (fixation, brute force, zip bomb, body limits, separation of duties, history after deletions) | **134/134 pass** |
| End-to-end functionality check in the browser (production mode, freshly installed DB) | **Start-up:** reachability, assets, `/api/health`, invalid configuration. **Authentication:** valid login, unknown user, wrong password, inactive account, disabled student accounts, cookie flags, persistence (reload/new tab), logout, idle expiry, password validation (client + server), protected URLs without a session. **Administrator:** dashboard, users (create/edit/reset), classes, students (enrol/edit/history), subjects, modules + plan + open, teaching and homeroom assignments (incl. conflict), academic years (transition preview, planned year), timetable (template, import, preview, publish, archive/restore, invalid file), configuration (reasons, rule sets, student accounts), audit (filters, integrity), restrictions. **Commander:** global visibility, grades of any class, student situation, correction approval, grade audit without technical data, cannot create/modify grades, no admin pages. **Teacher:** own timetable only, assigned classes/subjects only, grade entry/validation/modification/deletion with reason, correction request after the edit window, 404 on unrelated classes/subjects, no conduct. **Homeroom teacher:** all subjects of the class, read-only for other teachers' subjects, conduct, module results, other classes only through own assignments. **Student (when enabled):** own grades, own class timetable, 404 elsewhere, mobile layout. Mandatory password change, dark mode, Romanian text on every page | **189/189 pass**, no browser console errors, no unexpected failed requests |
| Operational | build without secrets, start in production mode, `/api/health` (200/503/recovery), security headers, installation from scratch, backup → restore | pass |
| Static | `tsc --noEmit`, ESLint, `prisma validate`, `prisma migrate diff` (no drift), `npm audit` | clean |

Bugs found and fixed during the final checks:
- With a wrong password, the login page reloaded and did not show the error message (the client treated any 401 as an expired session).
- (functionality check) With a missing or invalid environment variable, the server started and answered every request with an empty 500 error. Configuration is now validated at start-up: the process exits with the Romanian message listing the variables (as documented in DEPLOYMENT.md §15).
- (functionality check) After downloading a file (timetable template, report Excel export), in-app links on the same page stopped working until reload: the download buttons were router links (`next/link`) pointing to API routes, which left the client router stuck in a pending navigation. They are now plain download links (`ButtonDownload`).

Observed, not an application bug: the server log shows one `pg` deprecation warning ("client.query() when the client is already executing a query"). It comes from Prisma's internal query interpreter; `pg` 8 queues these queries correctly. `pg` is pinned to `^8`. Upgrading to `pg` 9 must wait for a Prisma adapter release that supports it.

## 7. Deployment requirements (summary – details in DEPLOYMENT.md)
Linux + systemd, Node.js 22, PostgreSQL 16 (roles `catalog_owner`/`catalog_app`), reverse proxy with HTTPS (Caddy/Nginx), domain name, environment variables from `.env.production.example`, daily backup copied off-site, `/api/health` monitoring.

## 8. Known limitations
- The averaging rules, bell schedule, military ranks and specializations are **provisional** (configurable; they must be confirmed by the school).
- No 2FA yet; the administrator controls identities (mitigated through commander audit oversight). Recommended: 2FA + access through the school network/VPN before public exposure.
- PDF only through the browser's print function (print layouts); there is no server-side PDF generation.
- There is no UI for marking repeating students (the model supports `REPEATING`), for one-off timetable changes on a given date (they are displayed if they exist) or for substitute teachers.
- Attendance is not implemented (the architecture leaves room for it). Student accounts exist but are disabled by default.
- The API rate limiter is in memory (per instance); the audit log has no archiving policy (it is permanent by design).
- No Docker image is provided (the deployment is native, systemd + reverse proxy; verified).

## 9. Recommended next steps
1. Confirm the school's data with the school (averaging rules, time slots, ranks, specializations, class list) and configure them in the UI.
2. 2FA (TOTP/WebAuthn) for ADMINISTRATOR and COMANDANT UNITATE; access restricted to the network/VPN.
3. Pilot deployment (one company, one module) with training for administrators and teachers; review the audit after the first weeks.
4. UI for repeating students / withdrawals and for one-off timetable changes; substitute teachers.
5. Attendance module (records linked to timetable lessons).
6. Optional: shared store for rate limiting (multiple instances), WAL/PITR backups, audit shipping to SIEM/WORM, Docker image, CI (GitHub Actions: lint, typecheck, tests against PostgreSQL, build).

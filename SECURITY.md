# SECURITY – Catalog electronic SMMMFN

Security design, audit results and operating assumptions for the electronic gradebook of
**Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”**.

_Last review: 2026-09-24 (phase 5 security audit + phase 6 production-readiness review). 134 automated tests (incl. `tests/integration/security.test.ts`) + 67 end-to-end browser checks._

---

## 1. Security architecture

```
Browser ──TLS──▶ Reverse proxy (TLS, body-size cap, X-Forwarded-For) ──▶ Next.js (Node 22) ──▶ PostgreSQL 16
                                                                 │                              ▲
                                                   src/proxy.ts: CSP nonce,                     │ least-privilege role
                                                   login redirect (convenience only)            │ (catalog_app)
                                                                 │
                                           Route handlers / pages ──▶ src/server/** services ──▶ Prisma
                                                                        │
                                                   authz (role → permission + scope) · audit (append-only)
```

Principles:
- **Never trust the frontend.** All data access goes through `src/server/**` (`server-only`, enforced by an ESLint rule). Every service receives the `Actor` resolved on the server from the session cookie and the database. It checks the permission and builds **scoped queries**. The UI only hides actions for convenience.
- **Deny by default; 404 for out-of-scope objects.** A resource outside the actor's scope is indistinguishable from a missing one, and every denial is written to the audit log (`ACCESS_DENIED`).
- **Defence in depth in the database.** CHECK constraints, triggers that forbid deleting history, immutable revisions and snapshots, an append-only hash-chained audit log, and a non-owner application role without DELETE/UPDATE rights on history.

## 2. Authentication model

| Aspect | Implementation |
|---|---|
| Credentials | Username + password (`POST /api/auth/login`). The first administrator is created only from the CLI (`npm run creeaza-admin`, hidden password input). |
| Password storage | argon2id (19 MiB, t=2, p=1), per-hash random salt. The hash never leaves the server (explicit projections). |
| Password policy | 8–128 characters, uppercase letter, digit, special character, must not contain the username, and a blocklist of trivially guessable fragments (`parola`, `password`, `qwerty`, `123456`, `admin`, `smmmfn`, `murgescu`, … incl. leetspeak). |
| Temporary passwords | Every created or reset account has `mustChangePassword`. All endpoints except me/logout/change-password return 403 until the password is changed. |
| Failure handling | One generic message for unknown user / wrong password / inactive / deleted / student accounts disabled. A dummy argon2 verification runs for unknown users (uniform timing). |
| Brute force | Per username (5 failures / 15 min, counted even for nonexistent usernames) and per IP (20 / 15 min, behind a trusted proxy). The check → verify → record sequence is **serialized per username** with a PostgreSQL advisory lock, so parallel requests cannot bypass the limit. |
| Sessions | Server-side. A 256-bit random token lives in the `__Host-sesiune` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`), and only its SHA-256 is stored. Idle timeout 30 min, absolute timeout 12 h. |
| Session fixation | A session presented at login is revoked (`REPLACED_BY_LOGIN`). The token is **rotated** on password change. Password reset, deactivation, deletion and role change revoke all of the user's sessions. |
| Student accounts | Disabled by default (`features.studentAccounts`). Disabling the feature also invalidates existing student sessions. |

## 3. Authorization model

Two layers, both evaluated on the server for every request:
1. **Role → permission matrix in code** (`src/server/authz/permissions.ts`). It is reviewed in git and covered by tests, and it cannot be changed at runtime or through configuration.
2. **Relationship scope** (`src/server/authz/scope.ts`, `policy.ts`), loaded from the database per request:
   - PROFESOR: only (class, subject, kind, module) pairs from **active** assignments in the **active** year: teaching, practical training or module examiner.
   - DIRIGINTE: not a stored role. A PROFESOR gets it from an active homeroom assignment, which grants the whole own class (read) + the conduct grade. Teacher rights apply only to explicitly assigned subjects.
   - ELEV: own student record only.

| Capability | ADMINISTRATOR | COMANDANT UNITATE | PROFESOR | DIRIGINTE | ELEV |
|---|---|---|---|---|---|
| Users, passwords, structure, assignments, timetable, configuration | ✅ | read (structure/config) | ❌ | ❌ | ❌ |
| Read grades | ❌ | all years | assigned class+subject | whole own class | own |
| Create / modify / delete grades | ❌ | ❌ | author only, within window, with reason | conduct in own class | ❌ |
| Correction requests | ❌ | approve/reject | request (with active assignment) | request | ❌ |
| Reports / exports | ❌ grades | all | own classes & subjects | own class | own record sheet |
| Audit | complete system audit (`audit.read.system`) | academic audit | ❌ | ❌ | ❌ |

Key guarantees (all tested):
- A teacher cannot reach another class, subject, student, teacher's timetable or grade by changing IDs in URLs, query strings or JSON bodies (404 + audit).
- Neither the COMANDANT UNITATE nor the ADMINISTRATOR can create, modify or delete grades. The commander can only approve **exactly** the value a teacher proposed.
- The administrator cannot assign classes to their own account (only ACTIVE PROFESOR accounts can be assigned), cannot change their own role or status, and cannot remove the last administrator.
- Role names are never sent to non-administrators. `/api/auth/me` returns capability flags only.

## 4. Audit model

- **What is recorded:** logins (success, failure, blocked), logout, password change and reset, user create/update/status, structure changes, assignments, grade create/update/delete (old/new value, student, class, subject, module, reason, IP, user agent, session reference, request id), correction requests and their approval/rejection/cancellation, module closing, rule sets, timetable import/publish/archive, year transition, report exports, access denials, audit views.
- **Integrity:** the `audit_log` table is append-only. A trigger rejects UPDATE/DELETE/TRUNCATE (even for the schema owner), the app role has only INSERT/SELECT, and the trigger assigns `id`, `occurred_at` (the application cannot back-date entries) and a **SHA-256 hash chain**. `audit_log_verify_chain()` (UI button "Verifică integritatea") finds the first altered row.
- **Grade history:** `grade_revisions` is immutable, and grades are soft-deleted with who/when/why. The original author never changes (DB trigger).
- **Access:** ADMINISTRATOR gets the complete audit, including technical data. COMANDANT UNITATE gets the academic audit only (grades, corrections, approvals/rejections, module closing, year transition) plus **oversight of administrator actions that affect grading**: assignments, homeroom appointments, averaging rules, grade-related settings, academic-year status and password resets of teacher accounts. The commander sees no IP, device, session, hash, metadata or administrator accounts. Everyone else gets 403.
- **No credentials in the audit:** passwords are never logged, and a value typed into the username field that is not a valid username is stored only as `[format invalid]` (hashed for throttling).

## 5. Data protection and history

- No physical deletion of academic data: triggers forbid DELETE/TRUNCATE on users, students, enrollments, classes, years, subjects, modules, assignments, grades, revisions, correction requests, result snapshots and timetable versions/imports. All foreign keys are `ON DELETE RESTRICT`.
- Deactivating or deleting an account removes the login only. The row, the name and every historical grade/audit link remain (tested for teachers and students).
- The year transition is idempotent (lock + unique record + date guard) and preserves every historical record (tested). Closed years are read-only.
- Timetable publication never overwrites previous versions. Uploaded files are kept with a SHA-256 hash.

## 6. Input handling

- Zod validation on every input: strict objects (unknown fields rejected), UUIDs, grade 1–10 with integer policy, date ranges, text lengths. Malformed IDs → 404.
- **SQL injection:** Prisma parameterized queries only. The few raw SQL statements are tagged templates without string concatenation, and the DB role name in the grants script is validated.
- **XSS:** React escaping everywhere, no `dangerouslySetInnerHTML`, strict per-request **nonce-based CSP** (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'self'`).
- **CSRF:** SameSite=Strict cookie, exact `Origin` match for every non-GET request, and a mandatory `application/json` content type (multipart only for the timetable upload endpoint). GET requests never change state (they only append audit records).
- **Body size:** JSON bodies are capped at 64 KB, also for chunked requests (streaming limit). Uploads require `Content-Length` and are capped at 2 MB.
- **Excel import:** `.xlsx` extension and ZIP signature required. At most 300 parts, no VBA/ActiveX parts, and **every part is actually decompressed with a hard 25 MB output cap** before parsing (declared sizes are not trusted, so a zip bomb is rejected). Formula cells are rejected, rows are capped at 3000, all values are validated against the database, and errors are reported with row and column.
- **Excel export:** strings starting with `= + - @` are prefixed with `'` (formula injection).

## 7. Transport, headers, errors, logging, configuration

- Headers on every route: HSTS (2 years), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy`, CSP (above), `poweredByHeader` off, and `Cache-Control: no-store` on API responses.
- Errors: generic Romanian messages with a request id. No stack traces or database details reach the client. Pages turn 403/404 into a neutral 404.
- Logging: server logs contain no request bodies. Prisma errors are logged by type/code only (they can embed query arguments), and other errors by first message line plus a short stack.
- Rate limits: per session (240 requests/min) and per IP (300/min, behind a trusted proxy), plus the login limits.
- Configuration: validated at start-up. `COOKIE_SECURE=false` is refused in production. Secrets exist only in environment variables (`.env` is git-ignored; `.env.test` contains only local test-database credentials). No `NEXT_PUBLIC_*` secrets.
- Dependencies: `npm audit` reports 0 known vulnerabilities (overrides pin patched transitive versions of `uuid`, `deepmerge-ts`, `mysql2`).

## 8. Security audit – phase 5 results

| # | Area | Finding | Status |
|---|---|---|---|
| 1 | Brute force | Throttle check and attempt recording were not atomic, so parallel requests could exceed the 5-failure limit | **Fixed:** serialized per username (advisory lock). Test: 15 parallel attempts → exactly 5×401, 10×429. |
| 2 | Session fixation | A session presented at login stayed valid, and the token was not rotated on password change | **Fixed:** revoked at login, rotated on password change. |
| 3 | Session handling | Student sessions survived disabling student accounts | **Fixed:** checked on every request. |
| 4 | DoS / input | JSON body limit relied on `Content-Length` (chunked bodies were read fully) | **Fixed:** streaming limit. |
| 5 | Unsafe Excel import | Zip-bomb check trusted sizes declared in the archive | **Fixed:** bounded real decompression. |
| 6 | Rate limiting | No per-client limit without a trusted proxy | **Fixed:** per-session limit. |
| 7 | Insecure logging | Prisma errors (with query arguments, e.g. a password hash) could be written to logs on 500 | **Fixed:** sanitized logging. |
| 8 | Sensitive data in audit | A password typed into the username field was stored in `login_attempts` and the audit | **Fixed:** invalid-format values are stored only hashed/redacted. |
| 9 | Admin bypass of grade workflow | An administrator could stage a teacher account or assignment (or reset a teacher's password) without academic oversight | **Mitigated:** these actions are now visible in the commander's audit (see §10 for the residual risk). |
| 10 | Weak passwords | No protection against trivially guessable passwords | **Fixed:** blocklist of common fragments. |
| 11 | Race condition | Concurrent requests could create two conduct/exam grades for the same module | **Fixed:** lock + re-check in transaction. |
| 12 | Credential exposure (CLI) | `creeaza-admin` echoed the password | **Fixed:** hidden input. |
| – | SQLi, XSS, CSRF, IDOR, privilege escalation, frontend-only authz, audit tampering, deletion of history, student isolation, commander/admin grade editing, error leakage, config handling | Reviewed. No vulnerability found, and existing controls are covered by tests (`auth`, `authorization`, `gradebook`, `db-integrity`, `rollover`, `timetable`, `reports-audit`, `security`). | OK |

## 8b. Production-readiness review (phase 6)

| Area | Finding | Status |
|---|---|---|
| Secrets in Git | `.env.test` (credentials for a local, disposable test database) was tracked; the demo-data password was a constant in code | **Fixed:** `.env.test` untracked (template `.env.test.example`), demo password only from `DEMO_PASSWORD`. Demo data requires `ALLOW_DEMO_DATA=true` and is refused in production. The old test credentials remain in Git history; they were local development values only. Never reuse them. |
| Configuration | No production template | `.env.production.example` added. The build needs no secrets, and the service reads `/etc/catalog/catalog.env` (640, root:catalog). |
| Monitoring endpoint | Needed for uptime checks | `GET /api/health`: public by design, returns only `ok`/`indisponibil` (200/503), no version or internal details. |
| Error pages | The framework's root error page was in English | Romanian `global-error` page without technical details. |
| Login UX | With a wrong password the page reloaded without showing the (generic) error message | **Fixed** in the client (only an expired session redirects). No security impact. |
| Backup/restore | Restore could interfere with audit triggers | Verified: `pg_dump` loads data before recreating triggers; the restored audit keeps ids, timestamps and hashes and the chain verifies intact. Scripts in `deploy/`. |
| Database | Unindexed foreign keys on growing tables | Indexes added (`production_indexes`); all FKs use `ON DELETE RESTRICT`. |
| Service hardening | – | systemd unit with `NoNewPrivileges`, `ProtectSystem=strict`, empty capability set, binding to 127.0.0.1 only. The proxy overwrites `X-Forwarded-For` and limits bodies to 3 MB. |

## 9. Security assumptions

1. The application runs behind a TLS-terminating reverse proxy that the school controls, with `TRUST_PROXY=true` and `client_max_body_size ≈ 3 MB`. Production uses `COOKIE_SECURE=true` and `APP_ORIGIN` set to the public HTTPS origin (see DEPLOYMENT.md).
2. The application connects as the least-privilege role (`catalog_app`). Migrations run as `catalog_owner`, whose credentials are not available to the running application.
3. The database server, backups and the host are administered by trusted personnel; database superusers can bypass application controls, and the hash chain makes such tampering **detectable**, not impossible.
4. Server clock/NTP is correct (sessions, audit timestamps, 1 September transition in Europe/Bucharest).
5. Temporary passwords are handed over on a secure channel (in person); users change them at first login.
6. Low concurrency (5–7 users) and one application instance: the in-memory API limiter is per instance (login throttling is DB-backed and global).

## 10. Known limitations and residual risks

- **Administrator trust:** an administrator manages identities, so they can create or reset a teacher account and log in as it. This is now visible to the commander (account-affecting and assignment events in the academic audit), but not technically prevented. Mitigation today: procedure (two administrators, commander review of the audit). Future: 2FA bound to the person's device, which prevents impersonation after a reset.
- **Login lockout DoS:** anyone can temporarily lock a known username (5 failures / 15 min). This is accepted, because it protects against guessing; administrators can see `LOGIN_BLOCKED` events.
- **CSP `style-src 'unsafe-inline'`** is allowed (framework and inline style attributes). Script execution is nonce-protected.
- **PDF** is produced by the browser's print dialog (print-optimized layouts). There is no server-side PDF rendering.
- **No password history / expiry**, and no session listing/revocation UI for users (sessions are revocable server-side).
- **In-memory API rate limiter** is per instance. Use a shared store (Redis/PostgreSQL) if the app is scaled horizontally.
- The audit log is never purged; retention/archival policies (GDPR) must be decided by the school.
- Git history contains an early `.env.test` with local development test-database credentials (not used anywhere else).

## 11. Future hardening options (the architecture allows them without redesign)

- **2FA (TOTP/WebAuthn)** for ADMINISTRATOR and COMANDANT UNITATE first. The login flow is a single service (`src/server/auth/login.ts`), and the session can carry an "MFA satisfied" flag.
- **Centralized authentication** (LDAP/AD, OIDC/SAML of MApN infrastructure): replace the password verification step, keep sessions, roles and scopes unchanged.
- **Network controls:** VPN-only access, IP allow-lists for `/administrare` and `/audit` at the proxy, network segmentation between the app and DB tiers, DB reachable only from the app host.
- **Device controls:** client certificates (mTLS) at the proxy for administrative workstations.
- **Audit shipping:** periodic export of `audit_log` hashes/rows to WORM storage or a SIEM for external tamper evidence.
- Password history and expiry, session management UI, security alerting (e-mail/SIEM on `LOGIN_BLOCKED`/`ACCESS_DENIED` spikes), and a shared rate-limit store.

## 12. Reporting a vulnerability

Report suspected vulnerabilities directly to the school's IT administrators (not through public channels). Include the affected page or endpoint, steps to reproduce and the time of the observation (to correlate with the audit log).

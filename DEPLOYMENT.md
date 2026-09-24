# DEPLOYMENT – Catalog electronic SMMMFN

How to deploy and operate the electronic gradebook on an online (Internet-facing) server.
Every step in this document was rehearsed on a clean database (install → migrate → seed → administrator → production start → backup → restore). The supporting files are in [`deploy/`](deploy/).

Target layout:

```
Internet ──443/TLS──▶ Caddy or Nginx (reverse proxy, HTTPS, 3 MB body limit)
                          │  127.0.0.1:3000
                          ▼
                 systemd: catalog.service (Node.js 22, Next.js, user "catalog")
                          │  127.0.0.1:5432 (local socket/TCP only)
                          ▼
                 PostgreSQL 16 – database "catalog"
                   roles: catalog_owner (migrations, backups) · catalog_app (application, least privilege)
Timers: catalog-backup (daily 02:30) · catalog-an-nou (daily 00:15, safety net for 1 September)
```

---

## 1. Server requirements

| Item | Minimum | Recommended |
|---|---|---|
| OS | Linux x86-64 with systemd | Ubuntu Server 24.04 LTS or Debian 12 |
| CPU / RAM | 2 vCPU / 2 GB | 2–4 vCPU / 4 GB (argon2 hashing, Excel import/export) |
| Disk | 20 GB | 40 GB SSD + separate storage for backups |
| Node.js | 22 LTS (`.nvmrc`) | 22 LTS from NodeSource or the distribution |
| PostgreSQL | 16 | 16 or newer, same host or a private network |
| Reverse proxy | Caddy 2 or Nginx | Caddy (automatic Let's Encrypt certificates) |
| Network | Ports 80/443 open; outbound 443 for certificates and package updates | Access restricted to the school network / VPN if possible |
| Other | `git`, `gpg` (encrypted backups), `postgresql-client-16` (pg_dump/pg_restore) | NTP enabled (correct time is required for sessions, audit, 1 September) |

A DNS name (e.g. `catalog.exemplu.ro`) must point to the server before HTTPS is enabled.

## 2. Database requirements

- PostgreSQL **16+**, UTF-8 database, `listen_addresses = 'localhost'` (or a private interface only), and `scram-sha-256` authentication in `pg_hba.conf`.
- Two roles, created with [`deploy/postgres-setup.sql`](deploy/postgres-setup.sql):
  - `catalog_owner` owns the schema and is used **only** for migrations, grants, backups and CLI tools;
  - `catalog_app` is the running application. It has SELECT/INSERT/UPDATE, DELETE only on technical tables, no UPDATE/DELETE on the audit log, and it cannot alter or disable the protective triggers.
- The migrations create: all tables, foreign keys (`ON DELETE RESTRICT` everywhere), indexes, CHECK constraints, triggers that forbid deleting history, immutable revisions/snapshots and the hash-chained audit log.
- Size: small (tens of MB per school year). The audit log grows forever by design.

## 3. Environment variables

The template is [`.env.production.example`](.env.production.example). On the server the file is `/etc/catalog/catalog.env` (mode `640`, owner `root:catalog` – readable by the service user only). It is never committed.

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `TZ` | yes | `Europe/Bucharest` |
| `DATABASE_URL` | yes | `postgresql://catalog_app:<password>@127.0.0.1:5432/catalog` – application role |
| `MIGRATION_DATABASE_URL` | yes (tools) | `postgresql://catalog_owner:<password>@127.0.0.1:5432/catalog` – migrations/backups/CLI only |
| `DB_APP_ROLE` | yes | `catalog_app` (receives the grants after each migration) |
| `APP_ORIGIN` | yes | Exact public origin, e.g. `https://catalog.exemplu.ro` (CSRF Origin check) |
| `TRUST_PROXY` | yes | `true` behind the reverse proxy (client IP from `X-Forwarded-For`, per-IP limits) |
| `COOKIE_SECURE` | yes | `true` (the application refuses to start in production otherwise) |
| `DISABLE_SCHEDULER` | no | `false` (default) – keeps the automatic 1 September transition and session clean-up |
| `ALLOW_DEMO_DATA`, `DEMO_PASSWORD` | **never in production** | development/test only |

Generate passwords with `openssl rand -base64 32 | tr -d '/+=' | cut -c1-32`. The application has no other secrets. Sessions use random server-side tokens, so no signing key is needed.

## 4. Installation

```bash
# 4.1 System packages (Ubuntu 24.04)
sudo apt update && sudo apt install -y git postgresql-16 postgresql-client-16 gpg caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo timedatectl set-timezone Europe/Bucharest

# 4.2 Service user and directories
sudo useradd --system --create-home --home-dir /opt/catalog --shell /usr/sbin/nologin catalog
sudo install -d -o catalog -g catalog -m 750 /opt/catalog /var/backups/catalog
sudo install -d -o root -g catalog -m 750 /etc/catalog

# 4.3 Code (use a release tag in production)
sudo -u catalog git clone https://github.com/TiGabriel/Catalog-SMMMFN.git /opt/catalog/app
cd /opt/catalog/app && sudo -u catalog git checkout <tag-or-branch>

# 4.4 Database and roles (replace the passwords)
sudo -u postgres psql -v owner_pw="'<OWNER_DB_PASSWORD>'" -v app_pw="'<APP_DB_PASSWORD>'" -f deploy/postgres-setup.sql

# 4.5 Configuration
sudo cp .env.production.example /etc/catalog/catalog.env
sudo chown root:catalog /etc/catalog/catalog.env && sudo chmod 640 /etc/catalog/catalog.env
sudoedit /etc/catalog/catalog.env        # fill in passwords and APP_ORIGIN

# 4.6 Dependencies and build (devDependencies are needed: build, migrations, CLI tools)
sudo -u catalog npm ci
sudo -u catalog npm run build            # needs no secrets

# 4.7 Database schema, grants, base data (see §5, §6)
sudo -u catalog bash -c 'set -a; . /etc/catalog/catalog.env; set +a; npm run db:migrate && npm run db:seed'

# 4.8 First administrator (see §6)
sudo -u catalog bash -c 'set -a; . /etc/catalog/catalog.env; set +a; npm run creeaza-admin'

# 4.9 Services
sudo cp deploy/catalog.service deploy/catalog-backup.{service,timer} deploy/catalog-an-nou.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now catalog.service catalog-backup.timer catalog-an-nou.timer

# 4.10 HTTPS reverse proxy (see §7)
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudoedit /etc/caddy/Caddyfile   # set the domain
sudo systemctl reload caddy

# 4.11 Check
curl -fsS https://catalog.exemplu.ro/api/health     # {"status":"ok"}
```

> Tip: to run CLI commands with the production configuration, use
> `sudo -u catalog bash -c 'set -a; . /etc/catalog/catalog.env; set +a; <command>'`. The examples below abbreviate this as **`run-env <command>`**.

**Initial school data** (after the first login as administrator): the seed already creates companies 1/2, classes 111–125 / 211–225 for the current school year, the "Purtare" and "Instruire practică" subjects, grade reasons, ranks, time slots and the provisional averaging rules. Then, in the UI: users (teachers, COMANDANT UNITATE) → subjects → modules and module plans → teaching/homeroom assignments → students → timetable (Excel import).

## 5. Database migrations

- `npm run db:migrate` = `prisma migrate deploy` (as `catalog_owner`, applies only the pending migrations from `prisma/migrations`) + `scripts/db-grants.ts` (re-applies least-privilege grants for `catalog_app`). Run it on every installation and update.
- Check the status: `run-env npx prisma migrate status`.
- Migrations are **forward-only and never edited** once committed. Never use `prisma migrate dev`, `migrate reset` or `db push` in production.
- Always take a backup (§8) before applying migrations.

## 6. Initial administrator

```bash
run-env npm run creeaza-admin     # asks for username, first/last name and password (hidden input)
```
- The password must satisfy the policy (≥ 8 characters, uppercase, digit, special character, no common words).
- This is the **only** way to create the first administrator; there is no public sign-up.
- Create a second administrator from the UI (Administrare → Utilizatori) for continuity, and a COMANDANT UNITATE account.
- Every account created or reset from the UI must change its temporary password at first login. Hand temporary passwords over in person.

## 7. HTTPS

- **Caddy** ([`deploy/Caddyfile`](deploy/Caddyfile)): obtains and renews Let's Encrypt certificates automatically, redirects HTTP → HTTPS, limits request bodies to 3 MB, and passes the real client address.
- **Nginx alternative** ([`deploy/nginx-catalog.conf`](deploy/nginx-catalog.conf)) + `certbot --nginx -d catalog.exemplu.ro`. `X-Forwarded-For` is **overwritten** with `$remote_addr` (clients cannot inject addresses).
- The application itself listens only on `127.0.0.1:3000`. It sends HSTS (2 years), a nonce-based CSP and the other security headers. Session cookies are `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`.
- `APP_ORIGIN` must match the public URL exactly, or all state-changing requests are rejected (CSRF protection).
- Firewall: `ufw allow 80,443/tcp` + SSH; do not expose ports 3000 or 5432.

## 8. Backup

- **What:** the whole database (grades, history, audit log, uploaded timetable files, configuration). The code is in Git. Additionally back up `/etc/catalog/catalog.env` and the proxy configuration (store them separately, encrypted).
- **How:** [`deploy/backup.sh`](deploy/backup.sh) runs as the `catalog` user from the systemd timer `catalog-backup.timer` (daily 02:30):
  - `pg_dump --format=custom` with the owner role;
  - integrity check (`pg_restore --list`) + SHA-256 checksum;
  - optional GPG encryption (`BACKUP_GPG_RECIPIENT`);
  - retention of backup files (`BACKUP_RETENTION_DAYS`, default 30). Only backup files are ever deleted, never data.
- **Off-site:** copy `/var/backups/catalog` daily to storage on a different machine or location (e.g. `rsync`/`rclone` to an institutional server), keeping at least 30 daily + 12 monthly copies.
- **Manual backup:** `run-env ./deploy/backup.sh` (always before an update).
- **Check the timer:** `systemctl list-timers catalog-backup.timer`, `journalctl -u catalog-backup`.
- Optional for stricter RPO: PostgreSQL WAL archiving / point-in-time recovery (e.g. pgBackRest).

## 9. Restore

Restore always goes into a **new, empty** database, is verified, and only then is the service switched to it.
```bash
sudo -u postgres psql -c "CREATE DATABASE catalog_restore OWNER catalog_owner"
sudo -u catalog RESTORE_DATABASE_URL="postgresql://catalog_owner:<OWNER_DB_PASSWORD>@127.0.0.1:5432/catalog_restore" \
     ./deploy/restore.sh /var/backups/catalog/catalog-YYYYMMDDTHHMMSSZ.dump
```
[`deploy/restore.sh`](deploy/restore.sh):
- verifies the checksum and decrypts `.gpg` files;
- refuses a non-empty target;
- restores (data is loaded before the triggers are recreated, so audit rows keep their original ids, timestamps and hashes);
- re-applies the grants;
- prints the audit chain verification and the number of migrations.

To switch: stop `catalog.service`, then either point both URLs in `/etc/catalog/catalog.env` to `catalog_restore` or rename the databases (`ALTER DATABASE catalog RENAME TO catalog_old; ALTER DATABASE catalog_restore RENAME TO catalog;`), and start the service. Tested result: identical row counts, audit ids, timestamps and last hash; chain intact; protective triggers and grants active.

Test a restore at least once per quarter (restore into a scratch database, check `/api/health` against it, drop it).

## 10. Update procedure

```bash
cd /opt/catalog/app
run-env ./deploy/backup.sh                          # 1. backup (mandatory)
sudo -u catalog git fetch --tags && sudo -u catalog git checkout <new-tag>   # 2. code
sudo -u catalog npm ci                              # 3. dependencies (+ prisma generate)
sudo -u catalog npm run build                       # 4. build (the old version keeps running)
sudo systemctl stop catalog
run-env npm run db:migrate                          # 5. migrations + grants
sudo systemctl start catalog                        # 6. start
curl -fsS https://catalog.exemplu.ro/api/health && journalctl -u catalog -n 50 --no-pager   # 7. verify
```
- Read `PROJECT_STATUS.md` / the release notes first for new migrations or environment variables.
- Schedule updates outside school hours. Expected downtime is under a minute (steps 5–6).
- Before updating production, run `npm test` on a development machine against a test database (see README).

## 11. Rollback procedure

1. **Code only (no new migration in the release):** `git checkout <previous-tag> && npm ci && npm run build && sudo systemctl restart catalog`.
2. **Release with migrations:** migrations are forward-only. Preferred: fix forward (a new release). If the new schema is unusable, restore the backup taken in step 1 of the update (§9) and deploy the previous tag. **Data entered after that backup would be lost**, so decide deliberately and export anything entered in the meantime (reports/audit) first.
3. After any rollback: check `/api/health`, log in as administrator, verify the audit integrity (Audit → „Verifică integritatea”).

Keep the previous tag's build reproducible (tagged releases, `package-lock.json` committed).

## 12. Logs

| Source | Where | Content |
|---|---|---|
| Application | `journalctl -u catalog` (stdout/stderr) | Start-up, errors with request id (no request bodies, no personal data, Prisma errors by type only), scheduler events |
| Background jobs | `journalctl -u catalog-backup`, `journalctl -u catalog-an-nou` | Backup result, year transition runs |
| Reverse proxy | `/var/log/caddy/catalog-access.log` (or Nginx access/error logs) | Access log with client IPs |
| PostgreSQL | `/var/log/postgresql/` | Database errors, slow queries if enabled |
| **Audit log** | Database table `audit_log`, UI `/audit` | Logins, failures, all grade/user/configuration changes (append-only, hash-chained) |

Retention: configure journald (`SystemMaxUse=1G`) and the proxy log rotation. The audit log is permanent by design; archiving policy is to be decided by the school.
A user reporting an error sees a request id; search it with `journalctl -u catalog | grep <id>`.

## 13. Monitoring

- **Availability:** poll `GET https://<domain>/api/health` every 1–5 min (`200 {"status":"ok"}`, `503` when the database is unreachable) with an uptime monitor (e.g. Uptime Kuma, Zabbix). systemd restarts the service on failure.
- **Backups:** alert if `catalog-backup.service` fails or no new file appears in `/var/backups/catalog` within 26 h.
- **Resources:** disk space (database + backups), memory, PostgreSQL connections.
- **TLS:** certificate expiry (automatic with Caddy/certbot; monitor anyway).
- **Security:**
  - the administrator dashboard warns about many failed logins in 24 h;
  - review the audit weekly (`LOGIN_BLOCKED`, `ACCESS_DENIED`, `PASSWORD_RESET`, `USER_*`);
  - run „Verifică integritatea” monthly, or `SELECT * FROM audit_log_verify_chain();`.
- **1 September:** check `journalctl -u catalog-an-nou` and Administrare → Ani școlari (transition history) on 1 September.

## 14. Go-live checklist

- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, correct `APP_ORIGIN`, `TZ=Europe/Bucharest`
- [ ] Strong, unique DB passwords; `/etc/catalog/catalog.env` readable only by root/catalog
- [ ] Ports 3000/5432 not reachable from outside; HTTPS works; HTTP redirects
- [ ] `npm run db:migrate` applied, `prisma migrate status` clean
- [ ] Two administrators + COMANDANT UNITATE created; demo data **not** loaded (`ALLOW_DEMO_DATA` absent)
- [ ] Backup timer active, first backup copied off-site, restore test done
- [ ] Health monitoring and backup alerts configured
- [ ] Averaging rules, time slots, ranks and subjects reviewed with the school (provisional values are marked in the UI)
- [ ] Recommended: access restricted to the school network/VPN until 2FA is implemented (see SECURITY.md)

## 15. Troubleshooting

| Symptom | Cause / action |
|---|---|
| Service does not start: "COOKIE_SECURE trebuie să fie true în producție" | Set `COOKIE_SECURE=true`. |
| Service does not start: "Configurație invalidă (variabile de mediu): …" | A listed variable is missing or invalid in `/etc/catalog/catalog.env`. |
| Every form returns "Cererea a fost respinsă din motive de securitate" | `APP_ORIGIN` does not match the URL in the browser (scheme/host/port). |
| Login „Prea multe încercări” for many users at once | The proxy does not pass the real client address (all clients appear as one IP): check `X-Forwarded-For` in the proxy configuration. |
| `/api/health` returns 503 | PostgreSQL down or wrong `DATABASE_URL`; check `systemctl status postgresql` and the service log. |
| "permission denied" errors after a migration | Grants not re-applied: run `run-env npm run db:migrate` (it re-applies grants). |

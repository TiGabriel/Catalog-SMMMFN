# Catalog electronic – SMMMFN „Amiral Ion Murgescu”

Catalog electronic pentru **Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”**: note, module, purtare, instruire practică, examene de modul, cereri de corecție, rezultate, orar, rapoarte și audit, cu acces strict pe roluri. Interfața este integral în limba română.

| Document | Conținut |
|---|---|
| [`PROJECT_STATUS.md`](PROJECT_STATUS.md) | Current status, features, tests, limitations, next steps |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Production installation, HTTPS, backup/restore, updates, rollback, logs, monitoring |
| [`SECURITY.md`](SECURITY.md) | Security architecture, authentication/authorization/audit models, audit results |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Original architecture and domain model |
| [`docs/ORAR_IMPORT.md`](docs/ORAR_IMPORT.md) | Excel timetable import format |

## Stack
Next.js 16 (App Router) · TypeScript · PostgreSQL 16 · Prisma 7 · Zod · argon2id · Tailwind CSS 4 · ExcelJS · Vitest.

## Local development

Prerequisites: Node.js 22 (`.nvmrc`), PostgreSQL 16.

```bash
# 1. Database roles and databases (local, example)
sudo -u postgres psql -c "CREATE ROLE catalog_owner LOGIN CREATEDB PASSWORD 'dev_owner'" \
                      -c "CREATE ROLE catalog_app LOGIN PASSWORD 'dev_app'" \
                      -c "CREATE DATABASE catalog OWNER catalog_owner" \
                      -c "CREATE DATABASE catalog_shadow OWNER catalog_owner"

# 2. Configuration (never committed)
cp .env.example .env              # fill in the connection strings, DEMO_PASSWORD

# 3. Install, migrate, seed
npm ci                            # also runs `prisma generate`
npm run db:migrate                # migrations + least-privilege grants for catalog_app
npm run db:seed                   # companies, classes 111–125 / 211–225, subjects, grade reasons, ranks, time slots
npm run creeaza-admin             # first administrator (CLI only)
npm run db:seed:demo              # optional demo data (requires ALLOW_DEMO_DATA=true; never in production)

# 4. Run
npm run dev                       # http://localhost:3000
```

Demo accounts (after `db:seed:demo`, password = `DEMO_PASSWORD`): `admin.demo`, `comandant.demo`, `prof.popescu`, `prof.ionescu` (diriginte 112), `prof.georgescu` (diriginte 113), `elev.marin`.

## Tests

```bash
cp .env.test.example .env.test    # a DISPOSABLE local database "catalog_test" (dropped and recreated by the tests)
sudo -u postgres psql -c "CREATE DATABASE catalog_test OWNER catalog_owner"
npm test                          # 134 unit + integration tests against a real PostgreSQL
npm run lint && npm run typecheck && npm run build
```

## Useful commands

| Command | Purpose |
|---|---|
| `npm run build` / `npm start` | Production build / start |
| `npm run db:migrate` | Apply migrations (as `catalog_owner`) and re-apply grants |
| `npm run creeaza-admin` | Create an administrator from the command line |
| `npm run an-nou` | Year transition (idempotent; executes only from 1 September) |
| `deploy/backup.sh`, `deploy/restore.sh` | Database backup / verified restore |

## Repository hygiene
- `.env`, `.env.*` (except the `*.example` templates), `node_modules/`, `.next/`, `src/generated/` (Prisma client, regenerated on install), coverage, logs, dumps and backups are ignored by Git.
- No passwords, keys or tokens are stored in the code. All credentials come from environment variables.

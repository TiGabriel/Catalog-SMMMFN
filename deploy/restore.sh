#!/usr/bin/env bash
# Restores a backup into an EMPTY database, re-applies grants and verifies the audit hash chain.
#   RESTORE_DATABASE_URL=postgresql://catalog_owner:***@localhost:5432/catalog_restore ./deploy/restore.sh /var/backups/catalog/catalog-XXXX.dump
# The target database must exist, be empty and be owned by the schema owner role.
# Always restore into a NEW database first, verify, then switch the application to it.
set -euo pipefail
DUMP="${1:?usage: restore.sh <file.dump|file.dump.gpg>}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is not set}"
APP_ROLE="${DB_APP_ROLE:-catalog_app}"
cd "$(dirname "$0")/.."

if [[ -f "$DUMP.sha256" ]]; then sha256sum --check "$DUMP.sha256"; fi
if [[ "$DUMP" == *.gpg ]]; then
  TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
  gpg --batch --decrypt --output "$TMP" "$DUMP"
  DUMP="$TMP"
fi

TABLES=$(psql "$RESTORE_DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_schema='public'")
if [[ "$TABLES" != "0" ]]; then
  echo "The target database is not empty – refusing to restore." >&2
  exit 1
fi

# Full restore: data is loaded before the triggers are created, so audit rows keep their
# original ids, timestamps and hashes.
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$DUMP"
MIGRATION_DATABASE_URL="$RESTORE_DATABASE_URL" DB_APP_ROLE="$APP_ROLE" npx tsx scripts/db-grants.ts

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "select 'audit entries checked: ' || checked || ', first invalid: ' || coalesce(first_invalid_id::text, 'none') from audit_log_verify_chain()"
psql "$RESTORE_DATABASE_URL" -tA -c "select 'migrations: ' || count(*) from _prisma_migrations where finished_at is not null"
echo "Restore finished. Point DATABASE_URL/MIGRATION_DATABASE_URL to the restored database and restart the service."

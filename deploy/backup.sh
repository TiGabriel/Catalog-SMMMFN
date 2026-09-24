#!/usr/bin/env bash
# Daily logical backup of the catalog database (run as the service user, e.g. from a systemd timer).
#   BACKUP_DIR=/var/backups/catalog  ./deploy/backup.sh
# Requires: pg_dump (same major version as the server), MIGRATION_DATABASE_URL in the environment
# (the schema owner – it can read every table, including the audit log).
# Optional: BACKUP_GPG_RECIPIENT to encrypt the dump; BACKUP_RETENTION_DAYS (default 30).
set -euo pipefail
: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is not set}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/catalog}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/catalog-$STAMP.dump"

umask 077
mkdir -p "$BACKUP_DIR"
# Custom format: compressed, restorable table by table; triggers are recreated after the data (post-data).
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$MIGRATION_DATABASE_URL"
pg_restore --list "$FILE" > /dev/null   # integrity check of the archive
sha256sum "$FILE" > "$FILE.sha256"

if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$FILE.gpg" "$FILE"
  rm -f "$FILE"
  FILE="$FILE.gpg"
  sha256sum "$FILE" > "$FILE.sha256"
fi

# Retention applies to backup files only – the database itself never deletes history.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'catalog-*' -mtime +"$RETENTION" -delete
echo "Backup OK: $FILE"

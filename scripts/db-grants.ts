/**
 * Applies least-privilege grants for the application's PostgreSQL role.
 * Runs as the schema owner (MIGRATION_DATABASE_URL) after every migration.
 *
 * The application role can SELECT/INSERT/UPDATE, but:
 * - no DELETE except on purely technical tables (sessions, login attempts, draft timetable rows);
 * - no UPDATE on the audit log, grade revisions or login attempts;
 * - no access to Prisma's migration bookkeeping;
 * - it does not own the tables, so it cannot drop or disable the protective triggers.
 */
import "dotenv/config";
import { Client } from "pg";

const DELETABLE = ["sessions", "login_attempts", "timetable_entries", "timetable_overrides", "module_subjects"];
const APPEND_ONLY = ["audit_log", "grade_revisions", "login_attempts"];

export async function applyGrants(connectionString: string, appRole: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(appRole)) throw new Error(`Invalid DB_APP_ROLE: ${appRole}`);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const role = `"${appRole}"`;
    await client.query("BEGIN");
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    for (const t of DELETABLE) await client.query(`GRANT DELETE ON "${t}" TO ${role}`);
    for (const t of APPEND_ONLY) await client.query(`REVOKE UPDATE ON "${t}" FROM ${role}`);
    await client.query(`REVOKE ALL ON "_prisma_migrations" FROM ${role}`);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("db-grants.ts")) {
  const url = process.env.MIGRATION_DATABASE_URL;
  const role = process.env.DB_APP_ROLE ?? "catalog_app";
  if (!url) {
    console.error("MIGRATION_DATABASE_URL lipsește.");
    process.exit(1);
  }
  applyGrants(url, role)
    .then(() => console.log(`Drepturi aplicate pentru rolul ${role}.`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

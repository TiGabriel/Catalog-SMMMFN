/**
 * Test database isolation: the global setup builds a migrated + seeded template
 * database once; every integration test file starts from a fresh copy of it.
 */
import { Client } from "pg";

export const TEMPLATE_DB = "catalog_test_tpl";

function adminUrl(ownerUrl: string, database = "postgres") {
  const u = new URL(ownerUrl);
  u.pathname = `/${database}`;
  return u.toString();
}

export function testDbName(ownerUrl: string) {
  return new URL(ownerUrl).pathname.slice(1);
}

export function withDatabase(url: string, database: string) {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export async function recreateDatabase(ownerUrl: string, name: string, template?: string) {
  if (!/^catalog_test/.test(name)) throw new Error(`Refuz să recreez baza de date ${name}`);
  const c = new Client({ connectionString: adminUrl(ownerUrl) });
  await c.connect();
  try {
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ""}`);
  } finally {
    await c.end();
  }
}

/** Call in `beforeAll` of every integration test file, before touching the DB. */
export async function resetTestDb() {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL!;
  await recreateDatabase(ownerUrl, testDbName(ownerUrl), TEMPLATE_DB);
}

/**
 * Builds the template test database once per run:
 * create → prisma migrate deploy → least-privilege grants → base seed + demo fixtures.
 * Integration test files then copy it (tests/db.ts) so they never depend on each other.
 * Tests connect with the application role (DATABASE_URL), exactly like production.
 */
import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ARGON2_OPTIONS } from "../src/server/auth/argon2-options";
import { seedBase } from "../prisma/seed-lib";
import { DEMO_PASSWORD, seedDemo } from "../scripts/demo-data";
import { applyGrants } from "../scripts/db-grants";
import { TEMPLATE_DB, recreateDatabase, testDbName, withDatabase } from "./db";

export default async function setup() {
  const env = loadEnv({ path: ".env.test", override: true, quiet: true }).parsed ?? {};
  const ownerUrl = env.MIGRATION_DATABASE_URL!;
  const appUrl = env.DATABASE_URL!;
  if (testDbName(ownerUrl) !== "catalog_test" || testDbName(appUrl) !== "catalog_test") {
    throw new Error("Refuz să folosesc o bază de date care nu este baza de test (catalog_test).");
  }
  const tplOwner = withDatabase(ownerUrl, TEMPLATE_DB);
  const tplApp = withDatabase(appUrl, TEMPLATE_DB);

  await recreateDatabase(ownerUrl, TEMPLATE_DB);
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, MIGRATION_DATABASE_URL: tplOwner, DATABASE_URL: tplApp },
  });
  await applyGrants(tplOwner, env.DB_APP_ROLE ?? "catalog_app");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: tplApp }) });
  try {
    await seedBase(prisma);
    await seedDemo(prisma, await hash(DEMO_PASSWORD, ARGON2_OPTIONS));
    await prisma.systemSetting.create({ data: { key: "features.studentAccounts", value: true } });
  } finally {
    await prisma.$disconnect();
  }
  // Also provide a ready copy for any test that does not reset explicitly.
  await recreateDatabase(ownerUrl, testDbName(ownerUrl), TEMPLATE_DB);
}

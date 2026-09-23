/**
 * Rebuilds the test database from scratch before the test run:
 * drop schema → prisma migrate deploy → least-privilege grants → base seed + demo fixtures.
 * Tests then connect with the application role (DATABASE_URL), exactly like production.
 */
import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ARGON2_OPTIONS } from "../src/server/auth/argon2-options";
import { seedBase } from "../prisma/seed-lib";
import { DEMO_PASSWORD, seedDemo } from "../scripts/demo-data";
import { applyGrants } from "../scripts/db-grants";

export default async function setup() {
  const env = loadEnv({ path: ".env.test", override: true, quiet: true }).parsed ?? {};
  const ownerUrl = env.MIGRATION_DATABASE_URL!;
  const appUrl = env.DATABASE_URL!;
  if (!/catalog_test/.test(ownerUrl) || !/catalog_test/.test(appUrl)) {
    throw new Error("Refuz să resetez o bază de date care nu este baza de test (catalog_test).");
  }

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("DROP SCHEMA IF EXISTS public CASCADE");
  await owner.query("CREATE SCHEMA public");
  await owner.end();

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl, DATABASE_URL: appUrl },
  });
  await applyGrants(ownerUrl, env.DB_APP_ROLE ?? "catalog_app");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: appUrl }) });
  try {
    await seedBase(prisma);
    await seedDemo(prisma, await hash(DEMO_PASSWORD, ARGON2_OPTIONS));
    await prisma.systemSetting.create({ data: { key: "features.studentAccounts", value: true } });
  } finally {
    await prisma.$disconnect();
  }
}

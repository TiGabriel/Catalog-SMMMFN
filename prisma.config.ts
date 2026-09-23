import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations run as the schema owner; the application itself connects with the
// least-privilege role from DATABASE_URL (see scripts/db-grants.ts).
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: url!,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});

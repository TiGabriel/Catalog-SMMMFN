import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ARGON2_OPTIONS } from "../src/server/auth/argon2-options";
import { seedBase } from "../prisma/seed-lib";
import { DEMO_PASSWORD, seedDemo } from "./demo-data";

async function main() {
  // Demo data must never reach a real database: explicit opt-in, never in production mode.
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEMO_DATA !== "true") {
    throw new Error("Datele demonstrative se încarcă doar în dezvoltare, cu ALLOW_DEMO_DATA=true.");
  }
  if (!DEMO_PASSWORD) throw new Error("Setați DEMO_PASSWORD în .env (parola conturilor demonstrative).");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    await seedBase(prisma);
    await seedDemo(prisma, await hash(DEMO_PASSWORD, ARGON2_OPTIONS));
    console.log("Date demonstrative încărcate. Utilizatori: admin.demo, comandant.demo, prof.popescu, prof.ionescu (diriginte 112), prof.georgescu (diriginte 113).");
    console.log("Parola conturilor demonstrative este cea din variabila DEMO_PASSWORD.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

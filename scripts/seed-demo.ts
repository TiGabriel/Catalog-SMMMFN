import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ARGON2_OPTIONS } from "../src/server/auth/argon2-options";
import { seedBase } from "../prisma/seed-lib";
import { DEMO_PASSWORD, seedDemo } from "./demo-data";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Datele demonstrative nu pot fi încărcate în producție.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    await seedBase(prisma);
    await seedDemo(prisma, await hash(DEMO_PASSWORD, ARGON2_OPTIONS));
    console.log("Date demonstrative încărcate. Utilizatori: admin.demo, comandant.demo, prof.popescu, prof.ionescu (diriginte 112), prof.georgescu (diriginte 113).");
    console.log(`Parola tuturor conturilor demonstrative: ${DEMO_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedBase } from "./seed-lib";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL lipsește.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const { academicYear } = await seedBase(prisma);
    await prisma.auditLog.create({
      data: { action: "SYSTEM_SEED", metadata: { academicYear: academicYear.name } },
    });
    console.log(`Structura de bază a fost inițializată (an școlar ${academicYear.name}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

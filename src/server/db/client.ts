import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { config } from "@/server/config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: config().databaseUrl });
  return new PrismaClient({ adapter });
}

/** The only Prisma client instance. Import it only from `src/server/**`. */
export const db: PrismaClient = globalForPrisma.prisma ?? createClient();
if (config().env !== "production") globalForPrisma.prisma = db;

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type DbOrTx = PrismaClient | Tx;

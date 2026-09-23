/**
 * Creates the first ADMINISTRATOR account from the command line (never via a public endpoint).
 *   npm run creeaza-admin
 * Values can also be supplied through ADMIN_USERNAME, ADMIN_FIRST_NAME, ADMIN_LAST_NAME, ADMIN_PASSWORD.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ARGON2_OPTIONS } from "../src/server/auth/argon2-options";
import { passwordPolicyErrors } from "../src/lib/validation/password";
import { normalizeUsername, USERNAME_REGEX } from "../src/lib/validation/common";

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (env: string, q: string) => process.env[env] ?? (await rl.question(q)).trim();
  try {
    const username = normalizeUsername(await ask("ADMIN_USERNAME", "Nume de utilizator: "));
    const firstName = await ask("ADMIN_FIRST_NAME", "Prenume: ");
    const lastName = await ask("ADMIN_LAST_NAME", "Nume: ");
    const password = await ask("ADMIN_PASSWORD", "Parolă (minim 8 caractere, majusculă, cifră, caracter special): ");
    if (!USERNAME_REGEX.test(username)) throw new Error("Nume de utilizator invalid.");
    if (!firstName || !lastName) throw new Error("Numele și prenumele sunt obligatorii.");
    const errors = passwordPolicyErrors(password, username);
    if (errors.length) throw new Error(errors.join(" "));

    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
    try {
      const user = await prisma.user.create({
        data: {
          username,
          firstName,
          lastName,
          role: "ADMINISTRATOR",
          passwordHash: await hash(password, ARGON2_OPTIONS),
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        },
      });
      await prisma.auditLog.create({
        data: { action: "ADMIN_BOOTSTRAP", entityType: "User", entityId: user.id, metadata: { username, via: "cli" } },
      });
      console.log(`Administratorul „${username}” a fost creat.`);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

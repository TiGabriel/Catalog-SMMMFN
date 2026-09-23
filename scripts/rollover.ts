/**
 * Year transition from the command line (for an OS cron / systemd timer, e.g. daily at 00:10):
 *   npm run an-nou            → executes if due (idempotent), otherwise reports the date
 * The application's own scheduler does the same; running both is safe.
 */
import "dotenv/config";
import { runAutomaticRollover } from "../src/server/domain/rollover";
import { db } from "../src/server/db/client";

async function main() {
  const res = await runAutomaticRollover("CLI");
  if (res.status === "NOT_DUE") console.log(`Trecerea nu este încă scadentă (începând cu ${res.earliest}).`);
  else if (res.status === "ALREADY_EXECUTED") console.log(`Trecerea ${res.fromYear} → ${res.toYear} a fost deja efectuată.`);
  else if (res.status === "EXECUTED") console.log(`Trecerea ${res.fromYear} → ${res.toYear} a fost efectuată.`, res.summary);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

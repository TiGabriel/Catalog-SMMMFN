import "server-only";
import { db } from "@/server/db/client";
import { runAutomaticRollover } from "@/server/domain/rollover";

/**
 * In-process scheduler of the Node.js server (started from src/instrumentation.ts).
 * It does not depend on any browser request. Every job is idempotent, so running
 * several app instances – or additionally the CLI from an OS cron – is safe.
 */
const HOUR = 3600_000;
let started = false;

async function rolloverJob() {
  try {
    const res = await runAutomaticRollover("AUTO");
    if (res.status === "EXECUTED") console.info(`[jobs] trecerea în anul școlar ${res.toYear} a fost efectuată automat`, res.summary);
  } catch (err) {
    console.error("[jobs] trecerea automată în noul an școlar a eșuat", err);
  }
}

async function housekeepingJob() {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * HOUR);
    await db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
    await db.loginAttempt.deleteMany({ where: { at: { lt: new Date(Date.now() - 180 * 24 * HOUR) } } });
  } catch (err) {
    console.error("[jobs] curățarea sesiunilor expirate a eșuat", err);
  }
}

export function startScheduler() {
  if (started || process.env.DISABLE_SCHEDULER === "true") return;
  started = true;
  const tick = () => {
    void rolloverJob();
    void housekeepingJob();
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, HOUR).unref();
}

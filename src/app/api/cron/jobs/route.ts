import { timingSafeEqual } from "node:crypto";
import { publicApiRoute } from "@/server/http/api";
import { Errors } from "@/server/errors";
import { runScheduledJobs } from "@/server/jobs/scheduler";

/**
 * Scheduled jobs for serverless hosting (Vercel Cron, see vercel.json), where the
 * in-process scheduler cannot run. Vercel sends `Authorization: Bearer <CRON_SECRET>`.
 * Every job is idempotent, so extra or manual calls are safe.
 */
export const GET = publicApiRoute(async ({ req }) => {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) throw Errors.unauthenticated();
  await runScheduledJobs();
  return { ok: true };
});

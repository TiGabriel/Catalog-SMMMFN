/** Next.js server start-up hook: starts the background scheduler in the Node.js runtime only. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/server/jobs/scheduler");
    startScheduler();
  }
}

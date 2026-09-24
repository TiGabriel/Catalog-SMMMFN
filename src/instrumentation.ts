/** Next.js server start-up hook (Node.js runtime only). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast: an invalid/missing configuration stops the server at start-up
    // (visible to systemd) instead of failing every request later.
    const { config } = await import("@/server/config");
    try {
      config();
    } catch (err) {
      console.error(`[config] ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
    const { startScheduler } = await import("@/server/jobs/scheduler");
    startScheduler();
  }
}

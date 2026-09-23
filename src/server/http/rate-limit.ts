import "server-only";

/**
 * Small fixed-window in-memory limiter for API traffic per client IP.
 * Login throttling is DB-backed (see auth/login.ts); this is only a coarse
 * guard against request floods on a single instance.
 */
const windows = new Map<string, { start: number; count: number }>();

export function hitRateLimit(key: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= 60_000) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
    }
    return false;
  }
  w.count += 1;
  return w.count > limitPerMinute;
}

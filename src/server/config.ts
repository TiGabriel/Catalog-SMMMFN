import "server-only";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.url(),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
});

export type AppConfig = {
  env: "development" | "test" | "production";
  databaseUrl: string;
  appOrigin: string;
  trustProxy: boolean;
  cookieSecure: boolean;
};

let cached: AppConfig | undefined;

export function config(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Never print values – only which variables are missing/invalid.
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configurație invalidă (variabile de mediu): ${keys}`);
  }
  const e = parsed.data;
  const cookieSecure = e.COOKIE_SECURE === "true";
  if (e.NODE_ENV === "production" && !cookieSecure) {
    throw new Error("COOKIE_SECURE trebuie să fie true în producție.");
  }
  cached = {
    env: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    appOrigin: new URL(e.APP_ORIGIN).origin,
    trustProxy: e.TRUST_PROXY === "true",
    cookieSecure,
  };
  return cached;
}

/** Security parameters. Kept in code (reviewed, tested); not editable at runtime below these floors. */
export const SECURITY = {
  password: { minLength: 8, maxLength: 128 },
  session: {
    idleTimeoutMinutes: 30,
    absoluteTimeoutHours: 12,
    /** Only persist lastSeenAt when it is older than this, to limit writes. */
    touchIntervalSeconds: 60,
  },
  login: {
    windowMinutes: 15,
    maxFailuresPerUsername: 5,
    maxFailuresPerIp: 20,
  },
  api: {
    /** Coarse per-IP request limit for API routes (requests per minute). */
    requestsPerMinute: 300,
  },
} as const;

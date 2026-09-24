import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Tests always run against the dedicated, disposable test database from .env.test
// (copy .env.test.example; in CI the same variables can come from the environment).
const env = loadEnv({ path: ".env.test", override: true, quiet: true }).parsed ?? {};

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside React Server Components; tests call server code directly.
      "server-only": new URL("./tests/stubs/empty.ts", import.meta.url).pathname,
    },
  },
  test: {
    env: { ...env, NODE_ENV: "test" },
    globalSetup: ["./tests/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

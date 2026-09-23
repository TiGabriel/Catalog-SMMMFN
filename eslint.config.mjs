import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  { ignores: ["src/generated/**", ".next/**", "node_modules/**", "next-env.d.ts"] },
  {
    // Database access is only allowed inside the server layer (and CLI scripts/tests).
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/db/*", "@/generated/prisma/client"], message: "Accesul la baza de date este permis doar în src/server." },
          ],
        },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];

export default config;

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Tournament V2 / League import boundary (Target Architecture §8, D-01).
  // League doesn't live under lib/league/** yet (that reorg is Phase 14+), so this
  // guards the concrete files that exist today: the League Supabase clients.
  {
    files: ["lib/tournament/**/*.{ts,tsx}", "app/api/tournament/**/*.{ts,tsx}", "app/admin/tournament/**/*.{ts,tsx}", "app/(tournament)/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase",
              message: "Tournament code must not import the League Supabase client. Use lib/tournament/db/supabase-tournament.ts instead (D-01).",
            },
            {
              name: "@/lib/supabase-browser",
              message: "Tournament code must not import the League Supabase client. Use lib/tournament/db/supabase-tournament.ts instead (D-01).",
            },
          ],
          patterns: [
            {
              group: ["../supabase", "../supabase-browser", "../../lib/supabase", "../../lib/supabase-browser"],
              message: "Tournament code must not import the League Supabase client. Use lib/tournament/db/supabase-tournament.ts instead (D-01).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["lib/tournament/**/*.{ts,tsx}", "app/api/tournament/**/*.{ts,tsx}", "app/admin/tournament/**/*.{ts,tsx}", "app/(tournament)/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/tournament/**", "*/lib/tournament/**"],
              message: "League code must not import from lib/tournament/**. Tournament V2 is isolated (D-01) — no shared business logic or database access.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;

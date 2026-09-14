import type { Config } from "jest";

/**
 * Real-Postgres tests for the SQL in src/lib. Unlike jest.config.ts this does
 * not load tests/setup.ts, which mocks Prisma. See docs/runbook-tests.md.
 */
const config: Config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "./tsconfig.test.json" }],
  },
  testMatch: ["**/tests/integration/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  setupFiles: ["<rootDir>/tests/integration/setup.ts"],
  // Tests share one database and truncate it; run files one at a time.
  maxWorkers: 1,
};

export default config;

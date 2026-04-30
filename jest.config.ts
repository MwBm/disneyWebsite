import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/api/**/*.test.ts", "**/tests/lib/**/*.test.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  setupFiles: ["<rootDir>/tests/setup.ts"],
  globals: {
    "ts-jest": { tsconfig: "./tsconfig.test.json" },
  },
};

export default config;

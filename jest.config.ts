import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "./tsconfig.test.json" }],
  },
  testMatch: [
    "**/tests/api/**/*.test.ts",
    "**/tests/lib/**/*.test.ts",
    "**/tests/components/**/*.test.tsx",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^next/font/google$": "<rootDir>/tests/__mocks__/next-font-google.ts",
  },
  setupFiles: ["<rootDir>/tests/setup.ts"],
};

export default config;

// Mock Prisma globally so route tests don't need a real DB
jest.mock("@/lib/db", () => ({
  prisma: {
    waitTimeRecord: { upsert: jest.fn(), findMany: jest.fn() },
    dailyForecast: { createMany: jest.fn(), findMany: jest.fn() },
    collectRun: { create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    prediction: { findMany: jest.fn() },
    dateContext: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    $queryRaw: jest.fn(),
  },
}));

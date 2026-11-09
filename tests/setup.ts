// Mock Prisma globally so unit and route tests never need a real DB. List only
// the methods src/ calls; a new call fails loudly until it is added here.
jest.mock("@/lib/db", () => ({
  prisma: {
    collectRun: { findMany: jest.fn() },
    dateContext: { findMany: jest.fn(), upsert: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

import { resolveDatabaseUrl } from "@/lib/database-url";

describe("resolveDatabaseUrl", () => {
  it("uses a valid DATABASE_URL", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgresql://user:pass@db.example.com:5432/app" }))
      .toBe("postgresql://user:pass@db.example.com:5432/app");
  });

  it("normalises copied quotes and a DATABASE_URL assignment", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: ' DATABASE_URL="postgres://u:p@db.example.com/app" ' }))
      .toBe("postgres://u:p@db.example.com/app");
  });

  it("falls back to a direct PostgreSQL URL when DATABASE_URL uses another scheme", () => {
    expect(resolveDatabaseUrl({
      DATABASE_URL: "prisma://accelerate.prisma-data.net/?api_key=example",
      DIRECT_DATABASE_URL: "postgresql://user:pass@db.example.com:5432/app",
    })).toBe("postgresql://user:pass@db.example.com:5432/app");
  });

  it("rejects a missing or malformed connection URL without exposing its value", () => {
    expect(() => resolveDatabaseUrl({ DATABASE_URL: "not a URL" }))
      .toThrow("valid PostgreSQL DATABASE_URL");
  });
});

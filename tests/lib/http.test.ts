import { cacheHeaders, cachedJson } from "@/lib/http";

describe("cacheHeaders", () => {
  it("emits a CDN-cacheable directive with stale-while-revalidate", () => {
    expect(cacheHeaders(1800)["Cache-Control"]).toBe(
      "public, s-maxage=1800, stale-while-revalidate=3600"
    );
  });

  it("scales stale-while-revalidate with the max age", () => {
    expect(cacheHeaders(300)["Cache-Control"]).toContain("stale-while-revalidate=600");
  });

  it("is public, not private — the point is shared CDN caching", () => {
    // `private` would make every viewer a cache miss and defeat the fix.
    expect(cacheHeaders(60)["Cache-Control"]).toMatch(/^public,/);
  });
});

describe("cachedJson", () => {
  it("returns the payload unchanged", async () => {
    const res = cachedJson({ date: "2026-06-01", crowdScore: 42 }, 1800);
    await expect(res.json()).resolves.toEqual({ date: "2026-06-01", crowdScore: 42 });
  });

  it("attaches the cache header", () => {
    const res = cachedJson({ ok: true }, 1800);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=1800, stale-while-revalidate=3600"
    );
  });

  it("defaults to status 200", () => {
    expect(cachedJson({ ok: true }, 60).status).toBe(200);
  });
});

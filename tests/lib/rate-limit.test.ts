import { checkRateLimit, clientKey, rateLimitResponse, _resetRateLimits } from "@/lib/rate-limit";

const CONFIG = { limit: 3, windowMs: 60_000 };
const T0 = 1_700_000_000_000;

beforeEach(() => _resetRateLimits());

describe("checkRateLimit — window behaviour", () => {
  it("allows exactly `limit` requests inside the window", () => {
    for (let i = 0; i < CONFIG.limit; i++) {
      expect(checkRateLimit("a", CONFIG, T0 + i).allowed).toBe(true);
    }
    expect(checkRateLimit("a", CONFIG, T0 + CONFIG.limit).allowed).toBe(false);
  });

  it("reports remaining quota counting down to zero", () => {
    expect(checkRateLimit("a", CONFIG, T0).remaining).toBe(2);
    expect(checkRateLimit("a", CONFIG, T0).remaining).toBe(1);
    expect(checkRateLimit("a", CONFIG, T0).remaining).toBe(0);
  });

  it("slides: a hit leaving the window frees a slot", () => {
    checkRateLimit("a", CONFIG, T0);
    checkRateLimit("a", CONFIG, T0 + 1000);
    checkRateLimit("a", CONFIG, T0 + 2000);
    expect(checkRateLimit("a", CONFIG, T0 + 3000).allowed).toBe(false);

    // Just past the first hit's expiry — one slot, and only one, is back.
    const justAfter = T0 + CONFIG.windowMs + 1;
    expect(checkRateLimit("a", CONFIG, justAfter).allowed).toBe(true);
    expect(checkRateLimit("a", CONFIG, justAfter).allowed).toBe(false);
  });

  it("frees a slot at exactly windowMs (a hit that old has expired)", () => {
    for (let i = 0; i < CONFIG.limit; i++) checkRateLimit("a", CONFIG, T0);
    expect(checkRateLimit("a", CONFIG, T0 + CONFIG.windowMs - 1).allowed).toBe(false);
    expect(checkRateLimit("a", CONFIG, T0 + CONFIG.windowMs).allowed).toBe(true);
  });

  it("keeps counters independent per key", () => {
    for (let i = 0; i < CONFIG.limit; i++) checkRateLimit("a", CONFIG, T0);
    expect(checkRateLimit("a", CONFIG, T0).allowed).toBe(false);
    expect(checkRateLimit("b", CONFIG, T0).allowed).toBe(true);
  });

  it("stays blocked while a caller keeps hammering inside the window", () => {
    for (let i = 0; i < CONFIG.limit; i++) checkRateLimit("a", CONFIG, T0);
    for (let i = 1; i <= 10; i++) {
      expect(checkRateLimit("a", CONFIG, T0 + i * 100).allowed).toBe(false);
    }
    // Rejected attempts must not extend the block past the original window.
    expect(checkRateLimit("a", CONFIG, T0 + CONFIG.windowMs + 1).allowed).toBe(true);
  });
});

describe("checkRateLimit — retryAfterSeconds", () => {
  it("is 0 while allowed", () => {
    expect(checkRateLimit("a", CONFIG, T0).retryAfterSeconds).toBe(0);
  });

  it("counts down toward the oldest hit's expiry", () => {
    for (let i = 0; i < CONFIG.limit; i++) checkRateLimit("a", CONFIG, T0);
    expect(checkRateLimit("a", CONFIG, T0).retryAfterSeconds).toBe(60);
    expect(checkRateLimit("a", CONFIG, T0 + 30_000).retryAfterSeconds).toBe(30);
  });

  it("never returns 0 while blocked (a Retry-After of 0 invites an instant retry)", () => {
    for (let i = 0; i < CONFIG.limit; i++) checkRateLimit("a", CONFIG, T0);
    const almostExpired = T0 + CONFIG.windowMs - 1;
    const res = checkRateLimit("a", CONFIG, almostExpired);
    expect(res.allowed).toBe(false);
    expect(res.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("checkRateLimit — edge cases", () => {
  it("blocks everything when limit is 0", () => {
    expect(checkRateLimit("a", { limit: 0, windowMs: 1000 }, T0).allowed).toBe(false);
  });

  it("treats an empty-string key as a normal key rather than skipping the check", () => {
    for (let i = 0; i < CONFIG.limit; i++) checkRateLimit("", CONFIG, T0);
    expect(checkRateLimit("", CONFIG, T0).allowed).toBe(false);
  });
});

describe("clientKey", () => {
  function req(headers: Record<string, string>): Request {
    return new Request("http://localhost/api/chat", { method: "POST", headers });
  }

  it("uses the leftmost x-forwarded-for entry", () => {
    expect(clientKey(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("trims whitespace around the entry", () => {
    expect(clientKey(req({ "x-forwarded-for": "  1.2.3.4  , 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    expect(clientKey(req({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("falls back to a shared bucket when no IP header is present", () => {
    // A shared bucket over-limits; a per-request unique value would never limit.
    expect(clientKey(req({}))).toBe("unknown");
  });

  it("ignores an empty x-forwarded-for and falls through", () => {
    expect(clientKey(req({ "x-forwarded-for": "", "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });
});

describe("rateLimitResponse", () => {
  function req(ip: string) {
    return new Request("http://localhost/api/x", { headers: { "x-forwarded-for": ip } });
  }

  it("returns null while the client is under its limit", () => {
    for (let i = 0; i < CONFIG.limit; i++) {
      expect(rateLimitResponse(req("1.1.1.1"), CONFIG)).toBeNull();
    }
  });

  it("returns a 429 with Retry-After and a JSON error once over the limit", async () => {
    for (let i = 0; i < CONFIG.limit; i++) rateLimitResponse(req("1.1.1.1"), CONFIG);

    const res = rateLimitResponse(req("1.1.1.1"), CONFIG)!;

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toEqual({ error: "Too many requests. Please slow down." });
  });

  it("counts each client separately", () => {
    for (let i = 0; i < CONFIG.limit; i++) rateLimitResponse(req("1.1.1.1"), CONFIG);

    expect(rateLimitResponse(req("1.1.1.1"), CONFIG)).not.toBeNull();
    expect(rateLimitResponse(req("2.2.2.2"), CONFIG)).toBeNull();
  });
});

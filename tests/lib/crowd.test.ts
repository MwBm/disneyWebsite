import { crowdLabel, deriveCrowdScore, MAX_WAIT, EXPECTED_RIDES } from "@/lib/crowd";

describe("crowdLabel", () => {
  it("returns Light at boundary 25", () => {
    expect(crowdLabel(25).label).toBe("Light");
  });
  it("returns Moderate at 26", () => {
    expect(crowdLabel(26).label).toBe("Moderate");
  });
  it("returns Moderate at boundary 50", () => {
    expect(crowdLabel(50).label).toBe("Moderate");
  });
  it("returns Busy at 51", () => {
    expect(crowdLabel(51).label).toBe("Busy");
  });
  it("returns Busy at boundary 75", () => {
    expect(crowdLabel(75).label).toBe("Busy");
  });
  it("returns Very Busy at 76", () => {
    expect(crowdLabel(76).label).toBe("Very Busy");
  });
  it("returns Light at 0", () => {
    expect(crowdLabel(0).label).toBe("Light");
  });
  it("returns Very Busy at 100", () => {
    expect(crowdLabel(100).label).toBe("Very Busy");
  });
  it("includes color and description for each label", () => {
    const labels = [0, 26, 51, 76].map((s) => crowdLabel(s));
    for (const l of labels) {
      expect(l.color).toBeTruthy();
      expect(l.description).toBeTruthy();
    }
  });
});

describe("deriveCrowdScore", () => {
  describe("base score (no tier, no openRideCount)", () => {
    it("returns 50 for avgWait = MAX_WAIT / 2", () => {
      expect(deriveCrowdScore(MAX_WAIT / 2)).toBe(50);
    });
    it("returns 100 for avgWait = MAX_WAIT", () => {
      expect(deriveCrowdScore(MAX_WAIT)).toBe(100);
    });
    it("caps at 100 when avgWait exceeds MAX_WAIT", () => {
      expect(deriveCrowdScore(200)).toBe(100);
    });
    it("returns 0 for avgWait = 0", () => {
      expect(deriveCrowdScore(0)).toBe(0);
    });
    it("rounds fractional scores", () => {
      // 1 min → (1/120)*100 = 0.833... → rounds to 1
      expect(deriveCrowdScore(1)).toBe(1);
    });
  });

  describe("tier multiplier", () => {
    // tier multiplier = 1.0 + tier * 0.08; base = 50 (avgWait = MAX_WAIT/2)
    it("tier 0 applies 1.0x multiplier", () => {
      expect(deriveCrowdScore(MAX_WAIT / 2, 0)).toBe(50);
    });
    it("tier 5 applies 1.4x multiplier", () => {
      expect(deriveCrowdScore(MAX_WAIT / 2, 5)).toBe(70);
    });
    it("tier 1 applies 1.08x multiplier", () => {
      // 50 * 1.08 = 54
      expect(deriveCrowdScore(MAX_WAIT / 2, 1)).toBe(54);
    });
    it("tier 3 applies 1.24x multiplier", () => {
      // 50 * 1.24 = 62
      expect(deriveCrowdScore(MAX_WAIT / 2, 3)).toBe(62);
    });
    it("tier multiplier does not push score above 100", () => {
      // avgWait=120 → base=100; tier=5 → 100*1.4=140 → capped at 100
      expect(deriveCrowdScore(MAX_WAIT, 5)).toBe(100);
    });
    it("undefined tier behaves same as tier 0", () => {
      expect(deriveCrowdScore(MAX_WAIT / 2, undefined)).toBe(
        deriveCrowdScore(MAX_WAIT / 2, 0)
      );
    });
  });

  describe("open ride count adjustment", () => {
    // rideRatio = min(openRideCount / EXPECTED_RIDES, 1.0)
    // effectiveWait = avgWait * rideRatio
    it("full complement (EXPECTED_RIDES) applies no reduction", () => {
      expect(deriveCrowdScore(MAX_WAIT / 2, undefined, EXPECTED_RIDES)).toBe(50);
    });
    it("half rides open halves the effective wait → 25", () => {
      // EXPECTED_RIDES=24, half=12, rideRatio=0.5, effectiveWait=30, base=25
      expect(deriveCrowdScore(MAX_WAIT / 2, undefined, EXPECTED_RIDES / 2)).toBe(25);
    });
    it("more than EXPECTED_RIDES open does not push score above no-adjustment baseline", () => {
      expect(deriveCrowdScore(MAX_WAIT / 2, undefined, EXPECTED_RIDES + 10)).toBe(50);
    });
    it("zero rides open returns 0", () => {
      expect(deriveCrowdScore(MAX_WAIT / 2, undefined, 0)).toBe(0);
    });
    it("undefined openRideCount applies no adjustment", () => {
      expect(deriveCrowdScore(MAX_WAIT / 2, 0, undefined)).toBe(
        deriveCrowdScore(MAX_WAIT / 2, 0)
      );
    });
  });

  describe("combined tier + openRideCount", () => {
    it("applies tier multiplier after ride-count adjustment", () => {
      // half rides: effectiveWait=30, base=25, tier=5 (×1.4): 25*1.4=35
      expect(deriveCrowdScore(MAX_WAIT / 2, 5, EXPECTED_RIDES / 2)).toBe(35);
    });
  });

  describe("output is always an integer in [0, 100]", () => {
    const cases = [
      [0, 0, 0],
      [60, 2, 10],
      [200, 5, 30],
      [30, undefined, undefined],
    ] as const;
    it.each(cases)("deriveCrowdScore(%s, %s, %s) in [0,100]", (w, t, r) => {
      const score = deriveCrowdScore(w, t as number | undefined, r as number | undefined);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
    });
  });
});

import {
  CROWD_FALLBACK_WAIT_ANCHORS,
  calibrateCrowdIndex,
  crowdLabel,
  deriveCrowdScore,
  HISTORICAL_TIER_BONUS,
} from "@/lib/crowd";

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
  it("maps the historically typical fallback wait to 50, not half of an arbitrary cap", () => {
    expect(deriveCrowdScore(CROWD_FALLBACK_WAIT_ANCHORS[1])).toBe(50);
  });

  it("maps busier fallback waits through the calibrated anchors", () => {
    expect(deriveCrowdScore(CROWD_FALLBACK_WAIT_ANCHORS[2])).toBe(75);
    expect(deriveCrowdScore(CROWD_FALLBACK_WAIT_ANCHORS[4])).toBe(100);
  });

  it("interpolates between anchors and clamps outside the scale", () => {
    expect(calibrateCrowdIndex(0)).toBe(0);
    expect(calibrateCrowdIndex(37.5)).toBe(63);
    expect(calibrateCrowdIndex(500)).toBe(100);
  });

  it("uses a small additive ticket-tier correction for historical-only data", () => {
    expect(deriveCrowdScore(30, 5)).toBe(50 + 5 * HISTORICAL_TIER_BONUS);
    expect(deriveCrowdScore(100, 5)).toBe(100);
  });

  describe("output is always an integer in [0, 100]", () => {
    const cases = [
      [0, 0],
      [60, 2],
      [200, 5],
      [30, undefined],
    ] as const;
    it.each(cases)("deriveCrowdScore(%s, %s) in [0,100]", (w, t) => {
      const score = deriveCrowdScore(w, t as number | undefined);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Shared crowd scale
// ---------------------------------------------------------------------------

import {
  CROWD_BANDS,
  NO_DATA_COLOR,
  SEVERITY_COLORS,
  crowdBand,
  crowdBgOpacity,
  crowdColor,
  crowdLabelText,
  crowdLegend,
  waitColor,
} from "@/lib/crowd";

describe("crowdBand — threshold boundaries", () => {
  it.each([
    [0, "Light"],
    [25, "Light"],
    [26, "Moderate"],
    [28, "Moderate"],
    [50, "Moderate"],
    [51, "Busy"],
    [75, "Busy"],
    [76, "Very Busy"],
    [100, "Very Busy"],
  ])("scores %i as %s", (score, label) => {
    expect(crowdBand(score).label).toBe(label);
  });

  it("bands are contiguous and ascending", () => {
    for (let i = 1; i < CROWD_BANDS.length; i++) {
      expect(CROWD_BANDS[i].max).toBeGreaterThan(CROWD_BANDS[i - 1].max);
    }
  });

  it("the final band is unbounded so no score falls through", () => {
    expect(CROWD_BANDS[CROWD_BANDS.length - 1].max).toBe(Infinity);
  });

  it("returns the top band for a non-finite score instead of undefined", () => {
    // A band of undefined would reach a style attribute as "undefined".
    expect(crowdBand(NaN).label).toBe("Very Busy");
    expect(crowdBand(Infinity).label).toBe("Very Busy");
  });

  it("handles an out-of-range score below zero", () => {
    expect(crowdBand(-10).label).toBe("Light");
  });
});

describe("crowdColor / crowdLabelText / crowdBgOpacity — null handling", () => {
  it("renders a distinct no-data colour rather than a severity colour", () => {
    expect(crowdColor(null)).toBe(NO_DATA_COLOR);
    expect(Object.values(SEVERITY_COLORS)).not.toContain(crowdColor(null));
  });

  it('labels a missing score "No data"', () => {
    expect(crowdLabelText(null)).toBe("No data");
    expect(crowdLabelText(30)).toBe("Moderate");
  });

  it("uses zero background tint for a missing score", () => {
    expect(crowdBgOpacity(null)).toBe(0);
    expect(crowdBgOpacity(10)).toBeGreaterThan(0);
  });

  it("tints more heavily as the score rises", () => {
    const tints = [10, 40, 60, 90].map(crowdBgOpacity);
    expect(tints).toEqual([...tints].sort((a, b) => a - b));
  });
});

describe("crowdLegend", () => {
  it("derives one row per band", () => {
    expect(crowdLegend()).toHaveLength(CROWD_BANDS.length);
  });

  it("renders ranges that abut without gaps or overlaps", () => {
    expect(crowdLegend().map((r) => r.range)).toEqual([
      "0–25",
      "26–50",
      "51–75",
      "76+",
    ]);
  });

  it("uses the same colours the bands do, so the legend cannot drift", () => {
    expect(crowdLegend().map((r) => r.color)).toEqual(CROWD_BANDS.map((b) => b.color));
  });
});

describe("waitColor — minutes, a separate axis from the crowd score", () => {
  it.each([
    [0, SEVERITY_COLORS.low],
    [20, SEVERITY_COLORS.low],
    [21, SEVERITY_COLORS.moderate],
    [45, SEVERITY_COLORS.moderate],
    [46, SEVERITY_COLORS.high],
    [75, SEVERITY_COLORS.high],
    [76, SEVERITY_COLORS.severe],
    [300, SEVERITY_COLORS.severe],
  ])("colours a %i-minute wait", (minutes, color) => {
    expect(waitColor(minutes)).toBe(color);
  });

  it("uses different thresholds from the crowd scale", () => {
    // 30 is "Moderate" on the crowd scale but still amber on the wait scale;
    // the two axes share a palette, not a set of cut-offs.
    expect(waitColor(30)).toBe(SEVERITY_COLORS.moderate);
    expect(crowdBand(30).color).toBe(SEVERITY_COLORS.moderate);
    expect(waitColor(60)).toBe(SEVERITY_COLORS.high);
    expect(crowdBand(60).color).toBe(SEVERITY_COLORS.high);
  });

  it("returns the severe colour for a non-finite wait", () => {
    expect(waitColor(NaN)).toBe(SEVERITY_COLORS.severe);
  });
});

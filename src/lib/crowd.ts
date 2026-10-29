import rideConfig from "./ride-config.json";

export const CROWD_FALLBACK_WAIT_ANCHORS: readonly number[] = rideConfig.crowdFallbackWaitAnchors;
export const CROWD_CALIBRATION_SCORES: readonly number[] = rideConfig.crowdCalibrationScores;
export const HISTORICAL_TIER_BONUS: number = rideConfig.historicalTierBonus;
export const HISTORICAL_FALLBACK_CONFIDENCE = 0.25;

/**
 * Convert a wait index to the public crowd scale. The training job replaces
 * these fallback anchors with percentiles calculated from its full history;
 * this version keeps historical-only API responses on the same shape.
 */
export function calibrateCrowdIndex(
  waitIndex: number,
  anchors: readonly number[] = CROWD_FALLBACK_WAIT_ANCHORS
): number {
  if (!Number.isFinite(waitIndex) || waitIndex <= 0) return 0;

  let previousWait = 0;
  let previousScore = 0;
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const score = CROWD_CALIBRATION_SCORES[i];
    if (anchor <= previousWait) continue;
    if (waitIndex <= anchor) {
      const fraction = (waitIndex - previousWait) / (anchor - previousWait);
      return Math.round(previousScore + fraction * (score - previousScore));
    }
    previousWait = anchor;
    previousScore = score;
  }
  return 100;
}

export function deriveCrowdScore(
  avgWait: number,
  tier?: number
): number {
  const base = calibrateCrowdIndex(avgWait);
  // The historical fallback only has a same-weekday wait average, not the
  // date-specific features used by the ML model. Ticket tier is a small,
  // additive correction here rather than the old compounding multiplier.
  const tierBonus = Math.max(0, tier ?? 0) * HISTORICAL_TIER_BONUS;
  return Math.min(base + tierBonus, 100);
}

/**
 * Shared severity palette. Two different axes use it — a 0–100 crowd score and
 * a wait in minutes — so the colors live here once and each axis keeps its own
 * thresholds below.
 *
 * These four are Tailwind green-500 / amber-500 / orange-500 / red-500, which
 * is what the rest of the UI already uses.
 */
export const SEVERITY_COLORS = {
  low: "#22c55e",
  moderate: "#f59e0b",
  high: "#f97316",
  severe: "#ef4444",
} as const;

/** Rendered for a day with no score at all — not part of the severity ramp. */
export const NO_DATA_COLOR = "#1e2235";

export type CrowdBand = {
  /** Inclusive upper bound of the band. */
  max: number;
  label: string;
  color: string;
  description: string;
  /** Tint strength when the band is used as a cell background. */
  bgOpacity: number;
};

/**
 * The one crowd scale: even quarters of 0–100. Anything that labels or colors a
 * crowd score reads this array.
 */
export const CROWD_BANDS: readonly CrowdBand[] = [
  { max: 25,       label: "Light",     color: SEVERITY_COLORS.low,      description: "Great day to visit",    bgOpacity: 0.12 },
  { max: 50,       label: "Moderate",  color: SEVERITY_COLORS.moderate, description: "Typical weekday",       bgOpacity: 0.15 },
  { max: 75,       label: "Busy",      color: SEVERITY_COLORS.high,     description: "Expect longer waits",   bgOpacity: 0.18 },
  { max: Infinity, label: "Very Busy", color: SEVERITY_COLORS.severe,   description: "Holiday crowd levels",  bgOpacity: 0.22 },
] as const;

export function crowdBand(score: number): CrowdBand {
  // Non-finite input would fall through every comparison; treat it as the top
  // band rather than returning undefined into a style attribute.
  if (!Number.isFinite(score)) return CROWD_BANDS[CROWD_BANDS.length - 1];
  return CROWD_BANDS.find((b) => score <= b.max) ?? CROWD_BANDS[CROWD_BANDS.length - 1];
}

export function crowdLabel(score: number): {
  label: string;
  color: string;
  description: string;
} {
  const { label, color, description } = crowdBand(score);
  return { label, color, description };
}

/** Null-tolerant helpers for the calendar grid, where a day may have no score. */
export function crowdColor(score: number | null): string {
  return score === null ? NO_DATA_COLOR : crowdBand(score).color;
}

export function crowdLabelText(score: number | null): string {
  return score === null ? "No data" : crowdBand(score).label;
}

export function crowdBgOpacity(score: number | null): number {
  return score === null ? 0 : crowdBand(score).bgOpacity;
}

/** Legend rows, derived so a threshold change can't leave the legend stale. */
export function crowdLegend(): { label: string; range: string; color: string }[] {
  return CROWD_BANDS.map((band, i) => {
    const lower = i === 0 ? 0 : CROWD_BANDS[i - 1].max + 1;
    return {
      label: band.label,
      range: band.max === Infinity ? `${lower}+` : `${lower}–${band.max}`,
      color: band.color,
    };
  });
}

/**
 * The calendar needs more resolution than the four semantic labels above. A
 * 38 and a 48 are both "Moderate" days, but a month view should still make
 * their difference visible at a glance. This visual-only scale is deliberately
 * separate so copy elsewhere can stay on the useful Light/Moderate/Busy labels.
 */
export type CalendarCrowdBand = {
  max: number;
  color: string;
  bgOpacity: number;
};

export const CALENDAR_CROWD_BANDS: readonly CalendarCrowdBand[] = [
  { max: 9,        color: "#3fc47b", bgOpacity: 0.10 },
  { max: 19,       color: "#6bce78", bgOpacity: 0.11 },
  { max: 29,       color: "#9bd378", bgOpacity: 0.12 },
  { max: 39,       color: "#c4d475", bgOpacity: 0.13 },
  { max: 49,       color: "#dfbe6e", bgOpacity: 0.14 },
  { max: 59,       color: "#e6a563", bgOpacity: 0.15 },
  { max: 69,       color: "#e78a5d", bgOpacity: 0.16 },
  { max: 79,       color: "#e56d5d", bgOpacity: 0.18 },
  { max: 89,       color: "#db5965", bgOpacity: 0.20 },
  { max: Infinity, color: "#c94d6b", bgOpacity: 0.22 },
] as const;

export function calendarCrowdBand(score: number): CalendarCrowdBand {
  if (!Number.isFinite(score)) return CALENDAR_CROWD_BANDS[CALENDAR_CROWD_BANDS.length - 1];
  return CALENDAR_CROWD_BANDS.find((band) => score <= band.max) ?? CALENDAR_CROWD_BANDS[CALENDAR_CROWD_BANDS.length - 1];
}

export function calendarCrowdColor(score: number | null): string {
  return score === null ? NO_DATA_COLOR : calendarCrowdBand(score).color;
}

export function calendarCrowdBgOpacity(score: number | null): number {
  return score === null ? 0 : calendarCrowdBand(score).bgOpacity;
}

export function calendarCrowdLegend(): { range: string; color: string }[] {
  return CALENDAR_CROWD_BANDS.map((band, index) => {
    const lower = index === 0 ? 0 : CALENDAR_CROWD_BANDS[index - 1].max + 1;
    return {
      range: band.max === Infinity ? `${lower}+` : `${lower}–${band.max}`,
      color: band.color,
    };
  });
}

/**
 * Predicted wait in minutes — a different axis from the crowd score, sharing
 * the same palette. Kept separate and separately named so neither set of
 * thresholds can be edited in the belief it governs the other.
 */
export const WAIT_BANDS: readonly { max: number; color: string }[] = [
  { max: 20,       color: SEVERITY_COLORS.low },
  { max: 45,       color: SEVERITY_COLORS.moderate },
  { max: 75,       color: SEVERITY_COLORS.high },
  { max: Infinity, color: SEVERITY_COLORS.severe },
] as const;

export function waitColor(minutes: number): string {
  if (!Number.isFinite(minutes)) return SEVERITY_COLORS.severe;
  return (WAIT_BANDS.find((b) => minutes <= b.max) ?? WAIT_BANDS[WAIT_BANDS.length - 1]).color;
}

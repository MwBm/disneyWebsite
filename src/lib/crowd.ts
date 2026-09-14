import rideConfig from "./ride-config.json";

export const MAX_WAIT: number = rideConfig.crowdMaxWait;
export const EXPECTED_RIDES: number = rideConfig.crowdExpectedRides;
export const TIER_MULTIPLIER_STEP: number = rideConfig.tierMultiplierStep;
export const HISTORICAL_FALLBACK_CONFIDENCE = 0.25;

export function deriveCrowdScore(
  avgWait: number,
  tier?: number,
  openRideCount?: number
): number {
  const rideRatio =
    openRideCount !== undefined ? Math.min(openRideCount / EXPECTED_RIDES, 1.0) : 1.0;
  const effectiveWait = avgWait * rideRatio;
  const base = Math.min((effectiveWait / MAX_WAIT) * 100, 100);
  const tierMultiplier = tier !== undefined ? 1.0 + tier * TIER_MULTIPLIER_STEP : 1.0;
  return Math.round(Math.min(base * tierMultiplier, 100));
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

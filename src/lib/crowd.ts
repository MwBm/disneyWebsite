export const MAX_WAIT = 120; // minutes at which crowd score = 100
export const EXPECTED_RIDES = 24; // nominal full complement for ride-count adjustment
export const TIER_MULTIPLIER_STEP = 0.08; // per-tier increment: tier 0 → 1.0×, tier 5 → 1.4×
export const HISTORICAL_FALLBACK_CONFIDENCE = 0.25;

// Sync contract: CROWD_MAX_WAIT, CROWD_EXPECTED_RIDES, TIER_MULTIPLIER_STEP must match
// the constants of the same names in ml-service/model.py.

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

export function crowdLabel(score: number): {
  label: string;
  color: string;
  description: string;
} {
  if (score <= 25)
    return { label: "Light", color: "#22c55e", description: "Great day to visit" };
  if (score <= 50)
    return { label: "Moderate", color: "#f59e0b", description: "Typical weekday" };
  if (score <= 75)
    return { label: "Busy", color: "#f97316", description: "Expect longer waits" };
  return { label: "Very Busy", color: "#ef4444", description: "Holiday crowd levels" };
}
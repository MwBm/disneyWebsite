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
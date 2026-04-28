import { z } from "zod";

const RideForecastSchema = z.object({
  ride_id: z.number(),
  predicted_wait: z.number(),
  confidence: z.number(),
});

const PredictResponseSchema = z.object({
  forecasts: z.array(RideForecastSchema),
  crowd_score: z.number().min(0).max(100),
});

export type MLForecast = z.infer<typeof RideForecastSchema>;
export type MLPredictResponse = z.infer<typeof PredictResponseSchema>;

type RideHistory = {
  ride_id: number;
  ride_name: string;
  land_name: string;
  wait_time: number;
  is_open: boolean;
  recorded_at: string;
};

export async function requestMLForecast(
  rides: RideHistory[],
  targetDate: Date,
  fullRetrain = false
): Promise<MLPredictResponse | null> {
  const url = process.env.ML_SERVICE_URL;
  if (!url) {
    console.error("ML_SERVICE_URL not set");
    return null;
  }

  try {
    const res = await fetch(`${url}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rides,
        target_date: targetDate.toISOString(),
        full_retrain: fullRetrain,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      console.error(`ML service returned ${res.status}`);
      return null;
    }

    const json = await res.json();
    const parsed = PredictResponseSchema.safeParse(json);

    if (!parsed.success) {
      console.error("Unexpected ML service response shape:", parsed.error.message);
      return null;
    }

    return parsed.data;
  } catch (err) {
    console.error("ML service unreachable:", err);
    return null;
  }
}

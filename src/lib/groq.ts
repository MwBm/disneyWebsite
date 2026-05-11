import Groq from "groq-sdk";
import { crowdLabel } from "./crowd";
import { format } from "date-fns";

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  return new Groq({ apiKey });
}

type RideForecast = {
  rideName: string;
  landName: string;
  predictedWait: number;
};

export async function narrateForecast(
  crowdScore: number,
  forecasts: RideForecast[],
  date: Date
): Promise<string> {
  const groq = getGroqClient();
  const { label } = crowdLabel(crowdScore);
  const dateStr = format(date, "MMMM d, yyyy");
  const top5 = [...forecasts]
    .sort((a, b) => b.predictedWait - a.predictedWait)
    .slice(0, 5)
    .map((f) => `${f.rideName} (~${f.predictedWait} min)`)
    .join(", ");

  const msg = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `You are a Disneyland analytics expert. Write a 2–3 sentence plain-English forecast for visiting Disneyland on ${dateStr}.

Crowd score: ${crowdScore}/100 (${label})
Top predicted waits: ${top5}

Be specific and actionable. Mention the crowd score label and give one timing tip.`,
      },
    ],
  });

  return msg.choices[0]?.message?.content ?? "";
}

export function buildChatSystemPrompt(
  liveWaits: { name: string; waitTime: number; isOpen: boolean }[],
  crowdScore: number | null,
  date: Date
): string {
  const dateStr = format(date, "EEEE, MMMM d, yyyy h:mm a");
  const { label } = crowdScore !== null ? crowdLabel(crowdScore) : { label: "Unknown" };

  const openRides = liveWaits
    .filter((r) => r.isOpen)
    .sort((a, b) => b.waitTime - a.waitTime)
    .slice(0, 10)
    .map((r) => `${r.name}: ${r.waitTime} min`)
    .join("\n");

  return `You are a helpful Disneyland trip planning assistant with access to real-time park data.

Current date/time: ${dateStr}
Today's crowd score: ${crowdScore ?? "N/A"}/100 (${label})

Current top wait times:
${openRides}

Answer questions about wait times, ride recommendations, itinerary planning, and park tips. Be concise and specific. Always ground advice in the current data when relevant.`;
}

export async function narrateForecastNoDataWithScore(
  date: Date
): Promise<{ score: number; narration: string }> {
  const groq = getGroqClient();
  const dateStr = format(date, "EEEE, MMMM d, yyyy");
  const msg = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 300,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `You are a Disneyland crowd analytics expert. For visiting Disneyland on ${dateStr}, provide:
1. A crowd score estimate (0–100 integer, where 0=empty, 100=maximum capacity)
2. A 2–3 sentence crowd forecast

No historical data exists for this specific date. Base your estimate on general crowd patterns for this day of week and time of year. Be upfront that this is a general estimate. Give one actionable timing tip.

Return ONLY valid JSON: {"score": <integer 0-100>, "narration": "<2-3 sentences>"}`,
      },
    ],
  });
  const content = msg.choices[0]?.message?.content ?? '{"score":50,"narration":""}';
  try {
    const parsed = JSON.parse(content);
    return {
      score: Math.round(Math.max(0, Math.min(100, Number(parsed.score) || 50))),
      narration: String(parsed.narration || ""),
    };
  } catch {
    return { score: 50, narration: "" };
  }
}

export async function estimateDowCrowdScores(): Promise<Map<number, number>> {
  const groq = getGroqClient();
  const msg = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 120,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `You are a Disneyland crowd expert. Estimate typical Disneyland crowd scores for each day of the week on a 0–100 scale (0=empty, 100=maximum capacity). Return ONLY a JSON object with integer keys 0–6 (0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday) and integer values. Example: {"0":70,"1":45,"2":45,"3":50,"4":55,"5":75,"6":85}`,
      },
    ],
  });

  const content = msg.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  const map = new Map<number, number>();
  for (let d = 0; d <= 6; d++) {
    const val = parsed[String(d)];
    if (typeof val === "number") {
      map.set(d, Math.round(Math.max(0, Math.min(100, val))));
    }
  }
  return map;
}

export type CrowdAdjustmentContext = {
  date: string;           // YYYY-MM-DD
  tier: number;           // 0–5
  isHoliday: boolean;
  isSchoolBreak: boolean;
  specialEvent: string | null;
  tempHigh: number | null;
  isRainy: boolean;
  mlCrowdScore: number;   // 0–100 from XGBoost
};

export type CrowdAdjustmentResult = {
  adjustment: number;     // integer ∈ [-35, 35]
  reasoning: string | null;
};

export async function adjustCrowdScore(
  ctx: CrowdAdjustmentContext
): Promise<CrowdAdjustmentResult> {
  try {
    const groq = getGroqClient();
    const eventStr = ctx.specialEvent ? `specialEvent="${ctx.specialEvent}"` : "specialEvent=none";
    const msg = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 80,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `You are a Disneyland crowd analytics expert. Given the ML crowd score and date context below, return an integer adjustment (-35 to +35) representing how many points to add to the ML crowd score. The ML model is still building its dataset and may significantly underestimate crowds. Apply larger adjustments when strong signals (high tier, holiday, popular events, school breaks) suggest the crowd will be heavier than the model predicts.

date=${ctx.date}, tier=${ctx.tier}, isHoliday=${ctx.isHoliday}, isSchoolBreak=${ctx.isSchoolBreak}, ${eventStr}, tempHigh=${ctx.tempHigh ?? "unknown"}F, isRainy=${ctx.isRainy}, mlCrowdScore=${ctx.mlCrowdScore}

Return ONLY valid JSON: {"adjustment": <integer -35 to 35>, "reasoning": "<one sentence>"}`,
        },
      ],
    });
    const content = msg.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    const adjustment = Math.round(Math.max(-35, Math.min(35, Number(parsed.adjustment) || 0)));
    return { adjustment, reasoning: String(parsed.reasoning || "") || null };
  } catch {
    return { adjustment: 0, reasoning: null };
  }
}

export async function buildItinerary(
  arrival: string,
  departure: string,
  priorities: string[],
  forecasts: RideForecast[]
): Promise<string> {
  const groq = getGroqClient();
  const forecastList = forecasts
    .sort((a, b) => a.predictedWait - b.predictedWait)
    .map((f) => `${f.rideName} (${f.landName}): ~${f.predictedWait} min wait`)
    .join("\n");

  const msg = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: `Create an optimized Disneyland itinerary.

Arrival: ${arrival}
Departure: ${departure}
Priority rides: ${priorities.join(", ") || "none specified"}

Predicted wait times:
${forecastList}

Group rides by land to minimize walking. Include estimated times. Keep it practical and scannable.`,
      },
    ],
  });

  return msg.choices[0]?.message?.content ?? "";
}

import Groq from "groq-sdk";
import { crowdLabel } from "./crowd";
import { format } from "date-fns";
import { GROQ_TEXT_MODEL } from "./groq-models";
import { PARK_TIME_ZONE } from "./park-time";

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  return new Groq({ apiKey });
}

export type ChatForecast = {
  rideName: string;
  landName: string;
  avgWait: number;
  peakWait: number;
};

export type ChatForecastSource = "ml" | "historical" | "unavailable";

export type ChatSystemContext = {
  liveWaits: { name: string; waitTime: number; isOpen: boolean }[];
  crowdScore: number | null;
  now: Date;
  visitDate: string;
  visitForecasts: ChatForecast[];
  visitForecastSource: ChatForecastSource;
};

function formatParkNow(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PARK_TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatVisitDate(dateKey: string): string {
  // Noon UTC always remains the same calendar date in Pacific time. Formatting
  // it in UTC also prevents a server's own timezone from changing the label.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

export async function narrateForecast(
  crowdScore: number,
  forecasts: { rideName: string; peakWait: number }[],
  date: Date
): Promise<string> {
  const groq = getGroqClient();
  const { label } = crowdLabel(crowdScore);
  const dateStr = format(date, "MMMM d, yyyy");
  const top5 = [...forecasts]
    .sort((a, b) => b.peakWait - a.peakWait)
    .slice(0, 5)
    .map((f) => `${f.rideName} (peak ~${f.peakWait} min)`)
    .join(", ");

  const msg = await groq.chat.completions.create({
    model: GROQ_TEXT_MODEL,
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

export function buildChatSystemPrompt({
  liveWaits,
  crowdScore,
  now,
  visitDate,
  visitForecasts,
  visitForecastSource,
}: ChatSystemContext): string {
  const currentDateTime = formatParkNow(now);
  const visitDateStr = formatVisitDate(visitDate);
  const { label } = crowdScore !== null ? crowdLabel(crowdScore) : { label: "Unknown" };

  const openRides = liveWaits
    .filter((r) => r.isOpen)
    .sort((a, b) => b.waitTime - a.waitTime)
    .slice(0, 10)
    .map((r) => `${r.name}: ${r.waitTime} min`)
    .join("\n");

  const topForecasts = [...visitForecasts]
    .sort((a, b) => b.peakWait - a.peakWait)
    .slice(0, 10)
    .map((r) => `${r.rideName} (${r.landName}): avg ~${r.avgWait} min, peak ~${r.peakWait} min`)
    .join("\n");

  const lowestForecasts = [...visitForecasts]
    .sort((a, b) => a.avgWait - b.avgWait)
    .slice(0, 10)
    .map((r) => `${r.rideName} (${r.landName}): avg ~${r.avgWait} min, peak ~${r.peakWait} min`)
    .join("\n");

  const visitData =
    visitForecastSource === "ml"
      ? "ML predictions for the selected date"
      : visitForecastSource === "historical"
        ? "historical same-weekday averages for the selected date"
        : "no date-specific wait forecast is available";

  return `You are a helpful Disneyland trip planning assistant with current park data and a selected trip date.

Current park date/time (America/Los_Angeles): ${currentDateTime}
Selected visit date: ${visitDateStr}
Selected-date crowd score: ${crowdScore ?? "N/A"}/100 (${label})
Selected-date forecast source: ${visitData}

Selected-date top ride forecasts:
${topForecasts || "No per-ride forecast is available for this date."}

Selected-date lowest-wait ride forecasts:
${lowestForecasts || "No per-ride forecast is available for this date."}

Current top wait times (these are live now, not a prediction for the selected date):
${openRides}

Answer questions about wait times, ride recommendations, itinerary planning, and park tips. Use selected-date forecasts for future-date planning and live waits only for advice about right now. When selected-date data is unavailable, say that clearly but still offer general, date-aware planning guidance. Do not claim that you only have data for today.

Reply style:
- Lead with a direct answer or recommendation. Do not open with a greeting, restate the question, list your capabilities, or give a generic crowd-score recap unless it answers the question.
- Use concise Markdown that is easy to scan: a short heading only when useful, then 2–5 bullets. Use **bold** for ride names, wait times, and the single most important takeaway.
- Ground suggestions in the provided forecast data. Name specific rides and timing tradeoffs instead of vague advice.
- For itinerary questions, group recommendations by land and give an ordered next move. If arrival time, group needs, or must-do rides would materially change the plan, ask one focused follow-up question after giving a useful starting strategy.
- Never invent operating hours, ride closures, showtimes, Lightning Lane availability, or live wait times that are not in the supplied data.`;
}

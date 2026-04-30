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
    model: "llama-3.1-8b-instant",
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
    model: "llama-3.1-8b-instant",
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

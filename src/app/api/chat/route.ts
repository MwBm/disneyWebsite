import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Groq from "groq-sdk";
import { fetchLiveRides } from "@/lib/queue-times";
import { getCrowdScoreForDate } from "@/lib/forecast";
import { deriveCrowdScore } from "@/lib/crowd";
import { buildChatSystemPrompt, type ChatForecast, type ChatForecastSource } from "@/lib/groq";
import { rateLimitResponse } from "@/lib/rate-limit";
import { GROQ_CHAT_MODEL } from "@/lib/groq-models";
import { getHistoricalRideWaitsForDate, getRideForecastsForDate } from "@/lib/forecast-queries";
import { parkDateKey } from "@/lib/park-time";
import { isValid, parseISO } from "date-fns";

/** This route spends money on every request, so it is metered per client. */
const RATE_LIMIT = { limit: 10, windowMs: 60_000 };

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  return new Groq({ apiKey });
}

const BodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(4000),
    })
  ).min(1).max(50),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => isValid(parseISO(v)), { message: "Invalid date" })
    .optional(),
});

export async function POST(req: NextRequest) {
  // Cheapest rejections first: config, then quota, then payload shape — none of
  // them should pay for the upstream fetches below.
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { error: "Chat is unavailable: GROQ_API_KEY is not configured" },
      { status: 503 }
    );
  }

  const limited = rateLimitResponse(req, RATE_LIMIT);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const now = new Date();
  const visitDate = parsed.data.date ?? parkDateKey(now);
  const [liveRides, crowdScore, mlForecasts] = await Promise.allSettled([
    fetchLiveRides(),
    getCrowdScoreForDate(visitDate),
    getRideForecastsForDate(visitDate),
  ]);

  const rides = liveRides.status === "fulfilled" ? liveRides.value : [];
  let forecasts: ChatForecast[] =
    mlForecasts.status === "fulfilled" ? mlForecasts.value : [];
  let forecastSource: ChatForecastSource = forecasts.length > 0 ? "ml" : "unavailable";
  let score = crowdScore.status === "fulfilled" ? crowdScore.value : null;

  if (forecasts.length === 0) {
    try {
      forecasts = await getHistoricalRideWaitsForDate(visitDate);
      if (forecasts.length > 0) {
        forecastSource = "historical";
        score = deriveCrowdScore(
          forecasts.reduce((sum, ride) => sum + ride.avgWait, 0) / forecasts.length
        );
      }
    } catch (err) {
      console.error("chat historical forecast lookup failed", err);
    }
  }

  const systemPrompt = buildChatSystemPrompt({
    liveWaits: rides,
    crowdScore: score,
    now,
    visitDate,
    visitForecasts: forecasts,
    visitForecastSource: forecastSource,
  });
  const groq = getGroqClient();

  const stream = await groq.chat.completions.create({
    model: GROQ_CHAT_MODEL,
    max_tokens: 600,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...parsed.data.messages,
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) controller.enqueue(encoder.encode(text));
        }
        controller.close();
      } catch (err) {
        // Must error() the stream, not close() it. A close() after a mid-stream
        // failure looks exactly like a complete response to the browser, so the
        // user silently reads a truncated answer as if it were finished.
        controller.error(err);
      }
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

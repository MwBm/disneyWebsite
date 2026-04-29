import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Groq from "groq-sdk";
import { fetchLiveRides } from "@/lib/queue-times";
import { getCrowdScoreForDate } from "@/lib/forecast";
import { buildChatSystemPrompt } from "@/lib/claude";

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
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const [liveRides, crowdScore] = await Promise.allSettled([
    fetchLiveRides(),
    getCrowdScoreForDate(new Date()),
  ]);

  const rides = liveRides.status === "fulfilled" ? liveRides.value : [];
  const score = crowdScore.status === "fulfilled" ? crowdScore.value : null;
  const systemPrompt = buildChatSystemPrompt(rides, score, new Date());
  const groq = getGroqClient();

  const stream = await groq.chat.completions.create({
    model: "llama3-8b-8192",
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
      } finally {
        controller.close();
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

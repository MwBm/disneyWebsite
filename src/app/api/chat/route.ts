import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { fetchLiveRides } from "@/lib/queue-times";
import { getCrowdScoreForDate, crowdLabel } from "@/lib/forecast";
import { buildChatSystemPrompt } from "@/lib/claude";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: systemPrompt,
    messages: parsed.data.messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
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

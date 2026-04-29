# Runbook: Service Layer (`src/lib/`)

All shared business logic lives here. API routes are thin adapters; lib owns all I/O.

---

## `db.ts` — Prisma Singleton

Exports a single `PrismaClient` instance. Uses `global` cache to survive Next.js hot-reload in dev (avoids "too many connections" error).

```ts
import { db } from "@/lib/db";
const rows = await db.waitTimeRecord.findMany();
```

---

## `queue-times.ts` — External Data Fetch

**`fetchLiveRides()`** — fetches `https://queue-times.com/en-US/parks/16/queue_times.json`, Zod-validates the response shape, returns flat `Ride[]` with `landName` added.

**`roundToWindow(date: Date)`** — rounds to nearest 30-min boundary. Used for deduplication key `windowedAt`.

Throws `QueueTimesError` on network failure or invalid response shape. Callers (`/api/collect`, `/api/live`) catch and handle gracefully.

---

## `forecast.ts` — DB Read Helpers

| Function | Returns |
|---|---|
| `getForecastForDate(date)` | `DailyForecast[]` for a given date |
| `getCrowdScoreForDate(date)` | Average `crowdScore` across all rides for date |
| `crowdLabel(score)` | `{ label, color }` — maps 0–100 score to human label |
| `getRecentCollectRuns(n)` | Last `n` `CollectRun` rows (for data-quality indicator) |

`crowdLabel` thresholds:
- 0–25 → "Light" (green)
- 26–50 → "Moderate" (yellow)
- 51–75 → "Busy" (orange)
- 76–100 → "Very Busy" (red)

---

## `ml-client.ts` — Python Service Client

**`requestMLForecast(rides, targetDate)`** — POSTs last-90-days ride history to the Python ML service. Returns `DailyForecast[]` on success, `null` on any failure (network error, timeout, bad response shape). Callers treat `null` as "skip writing forecasts, use existing DB rows."

Zod-validates the Python service response before returning.

---

## `claude.ts` — AI (Groq) Helpers

Uses `groq-sdk` with `llama3-8b-8192`.

| Function | Purpose |
|---|---|
| `narrateForecast(crowdScore, forecasts, date)` | 2–3 sentence crowd forecast for `/api/forecast` |
| `buildChatSystemPrompt(liveWaits, crowdScore, date)` | System prompt with injected live park data for `/api/chat` |
| `buildItinerary(arrival, departure, priorities, forecasts)` | Optimized park itinerary |

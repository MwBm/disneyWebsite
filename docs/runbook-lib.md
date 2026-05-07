# Runbook: Service Layer (`src/lib/`)

All shared business logic lives here. API routes are thin adapters; lib owns all I/O.

---

## `db.ts` — Prisma Singleton

Exports a single `PrismaClient` instance. Uses `global` cache to survive Next.js hot-reload in dev (avoids "too many connections" error). Also exports `prisma` as an alias.

```ts
import { prisma } from "@/lib/db";
const rows = await prisma.waitTimeRecord.findMany();
```

---

## `queue-times.ts` — External Data Fetch

**`fetchLiveRides()`** — fetches `https://queue-times.com/en-US/parks/16/queue_times.json`, Zod-validates the response shape, returns flat `Ride[]` with `landName` added.

**`roundToWindow(date: Date)`** — rounds to nearest 30-min boundary. Used for deduplication key `windowedAt`.

Throws `QueueTimesError` on network failure or invalid response shape. Callers (`/api/live`) catch and handle gracefully. The Python `collect.py` cron has its own queue-times fetcher.

---

## `crowd.ts` — Crowd Score Utilities

| Export | Purpose |
|---|---|
| `MAX_WAIT = 120` | Wait minutes where crowd score = 100 (must match `model.py` `CROWD_MAX_WAIT`) |
| `EXPECTED_RIDES = 24` | Nominal full ride complement (must match `model.py` `CROWD_EXPECTED_RIDES`) |
| `HISTORICAL_FALLBACK_CONFIDENCE = 0.25` | `mlConfidence` value for historical-fallback forecasts |
| `deriveCrowdScore(avgWait, tier?, openRideCount?)` | Compute 0–100 crowd score from wait time + tier + open ride count |
| `crowdLabel(score)` | Returns `{ label, color, description }` for a score |

`crowdLabel` thresholds:
- 0–25 → "Light" (green, `#22c55e`)
- 26–50 → "Moderate" (amber, `#f59e0b`)
- 51–75 → "Busy" (orange, `#f97316`)
- 76–100 → "Very Busy" (red, `#ef4444`)

**Critical:** `MAX_WAIT` and `EXPECTED_RIDES` must stay in sync with `ml-service/model.py` constants. A drift causes Python and TypeScript crowd scores to silently diverge.

---

## `forecast.ts` — DB Read Helpers

| Function | Returns |
|---|---|
| `getForecastForDate(date)` | `DailyForecast[]` for a given date |
| `getCrowdScoreForDate(date)` | Average `crowdScore` across all rides for date |
| `getRecentCollectRuns(n)` | Last `n` `CollectRun` rows (for data-quality indicator) |
| `getHistoricalMeansForDate(date)` | Same-DOW hour-means from `WaitTimeRecord` (historical fallback) |
| `getCrowdScoresForMonth(year, month)` | Full month of `DayCrowdScore` for calendar view |

`getCrowdScoresForMonth` sources per day (in priority order): ML forecasts → same-DOW historical means from `HourlyWaitSummary` → `"unavailable"` beyond ML window.

---

## `date-context.ts` — Date Context Sync

| Export | Purpose |
|---|---|
| `isHolidayDate(date)` | US/CA holiday detection (fixed + floating; Easter weekend included) |
| `isSchoolBreakDate(date)` | SoCal school break detection (winter, spring, summer, Thanksgiving) |
| `fetchDateSchedule(start, end)` | ThemeParks.wiki park schedule → tier + special events |
| `syncDateContext(days)` | Full sync: schedule + weather + holiday/break flags → upsert `DateContext` |
| `syncGroqAdjustments(days)` | Call Groq adjuster for dates missing `groqAdjustment`; store result |
| `DateScheduleInfo` | `{ date, tier, specialEvent }` |

**Weather:** `syncDateContext` calls Open-Meteo for the 16-day forecast window (Anaheim, lat=33.8366, lon=-117.9143), then falls back to `ANAHEIM_MONTHLY_NORMALS` (NOAA 30-year climatological means) for dates beyond 16 days.

**Groq adjuster:** `syncGroqAdjustments` queries average crowd score from `DailyForecast` per date (falls back to 50), calls `adjustCrowdScore`, and stores `groqAdjustment` ± 20 + `groqReasoning`. Non-fatal per date.

---

## `groq.ts` — AI (Groq) Helpers

Uses `groq-sdk` with `llama-3.3-70b-versatile`.

| Function | Purpose |
|---|---|
| `narrateForecast(crowdScore, forecasts, date)` | 2–3 sentence crowd forecast for `/api/forecast` |
| `narrateForecastNoDataWithScore(date)` | JSON `{score, narration}` when no ML/historical data exists |
| `buildChatSystemPrompt(liveWaits, crowdScore, date)` | System prompt with injected live park data for `/api/chat` |
| `buildItinerary(arrival, departure, priorities, forecasts)` | Optimized park itinerary |
| `estimateDowCrowdScores()` | Map<DOW, score> general estimate by day-of-week (cached in `DateContext.groqDowEstimate`) |
| `adjustCrowdScore(ctx)` | Post-process adjuster: returns `{adjustment: ±20, reasoning}` given ML score + context |

`adjustCrowdScore` is non-fatal — returns `{adjustment: 0, reasoning: null}` on any error.

---

## `park-time.ts` — Timezone Utilities

Utilities for Disneyland local time (America/Los_Angeles). All date arithmetic in this project uses UTC midnight for `DateContext` dates.

| Export | Purpose |
|---|---|
| `parkDateKey(date)` | `"YYYY-MM-DD"` in park local time |
| `parkDateRangeUtc(dateKey)` | `{ start, endExclusive }` UTC range for a park-local date |
| `parkMonthRangeUtc(year, month)` | UTC range for a full park-local month |
| `parkDateDow(dateKey)` | Day-of-week (0=Sunday) in park local time |
| `normalizeParkDateKey(date)` | Accepts `Date` or string, returns `"YYYY-MM-DD"` |

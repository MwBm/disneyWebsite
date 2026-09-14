# Runbook: Service Layer (`src/lib/`)

Shared logic and all I/O. API routes are thin adapters over these modules.

---

## `db.ts`: Prisma client

Exports `prisma`, a `PrismaClient` using `@prisma/adapter-pg` on `DATABASE_URL`. It throws at import when the variable is unset. Outside production the client is cached on `globalThis`, so hot reload doesn't open new connections.

```ts
import { prisma } from "@/lib/db";
```

---

## `forecast-queries.ts`: forecast SQL

Every aggregate happens in Postgres, because each returned row counts against the egress quota. Unit tests mock this module, and `tests/integration/forecast-queries.test.ts` runs every query against real Postgres.

| Export | Returns |
|---|---|
| `getRideForecastsForDate(date)` | `RideDayForecast[]`: one per ride, `avgWait`/`peakWait`/`mlConfidence` over the Pacific day, latest ride name |
| `getDailyMlCrowdScores(start, endExclusive)` | `Map<"YYYY-MM-DD", score>`: rounded mean `crowdScore` per Pacific date |
| `getHistoricalRideWaitsForDate(date)` | `HistoricalRideWaits[]`: per-ride average and peak of typical hourly waits on that weekday, last 2 years of `HourlyWaitSummary`, from 08:00; each name comes from a `LATERAL` probe on the `(rideId, date, hour)` index |
| `getHistoricalDowMeanWaits(month)` | `Map<dow, meanWait>` for the month over 3 years, last year weighted 2× |
| `getRecentCollectRuns(limit = 3)` | Newest `CollectRun` rows with `job = 'collect'` |
| `FORECAST_FIRST_LOCAL_HOUR` | `8`: must match `PARK_CLOSED_LOCAL_HOURS` in `ml-service/pipeline.py` (a pytest checks) |
| `HISTORICAL_LOOKBACK_YEARS` | `2` |
| `RideDayForecast`, `HistoricalRideWaits` | Row types |

## `forecast.ts`: crowd-score logic

| Export | Returns |
|---|---|
| `getCrowdScoreForDate(date)` | Mean ML crowd score for the Pacific date, or null |
| `getCrowdScoresForMonth(year, month)` | `DayCrowdScore[]` for every day of the month, used by the calendar |
| `resolveCrowdScore({ mlScore, historicalScore, groqScore, isBeyondWindow })` | Best available score: ML → historical → Groq; `"unavailable"` beyond the window |
| `ML_FORECAST_DAYS` | `30` |
| `DayCrowdScore` | `{ date, crowdScore, source, tier, specialEvent, isHoliday }` |

---

## `crowd.ts`: crowd scale and colors

`MAX_WAIT`, `EXPECTED_RIDES` and `TIER_MULTIPLIER_STEP` are read from `ride-config.json`, the same file `ml-service/model.py` reads, so the two crowd scores cannot drift.

| Export | Purpose |
|---|---|
| `deriveCrowdScore(avgWait, tier?, openRideCount?)` | 0–100 score from a mean wait, scaled by open rides and `1 + tier × TIER_MULTIPLIER_STEP` |
| `HISTORICAL_FALLBACK_CONFIDENCE` | `0.25`: `mlConfidence` on historical-fallback rides |
| `CROWD_BANDS`, `crowdBand(score)` | The one crowd scale: 0–25 Light, 26–50 Moderate, 51–75 Busy, 76+ Very Busy |
| `crowdLabel(score)` | `{ label, color, description }` |
| `crowdColor`, `crowdLabelText`, `crowdBgOpacity` | Null-tolerant helpers for the calendar grid |
| `crowdLegend()` | Legend rows derived from `CROWD_BANDS` |
| `WAIT_BANDS`, `waitColor(minutes)` | Wait-time colors: ≤20, ≤45, ≤75, above |
| `SEVERITY_COLORS`, `NO_DATA_COLOR` | The shared palette |

---

## `groq.ts` and `groq-models.ts`: AI

Model IDs live only in `groq-models.ts` (`GROQ_TEXT_MODEL`, `GROQ_CHAT_MODEL`). When Groq retires a model, edit that file. Reasoning models (`openai/gpt-oss-*`) fail JSON mode, so they are not drop-in replacements.

| Export | Purpose |
|---|---|
| `narrateForecast(crowdScore, forecasts, date)` | 2–3 sentence forecast naming the five highest peak waits |
| `narrateForecastNoDataWithScore(date)` | `{ score, narration }` when there is no ML or historical data |
| `buildChatSystemPrompt(liveWaits, crowdScore, date)` | Chat system prompt with the 10 longest current waits |
| `estimateDowCrowdScores()` | `Map<dow, score>` general estimate; an empty map on unparseable output |
| `adjustCrowdScore(ctx)` | `{ adjustment: -35..35, reasoning }`; `{ 0, null }` on any error (logged) |
| `clampParsedNumber(value, { min, max, fallback })` | Clamp an LLM-parsed number; 0 stays 0 |
| `buildItinerary(...)` | Not called anywhere |

---

## `date-context.ts`: date-context sync

Re-exports `isHolidayDate` and `isSchoolBreakDate` from `./calendar`, and `fetchDateSchedule` from `./park-schedule`.

| Export | Purpose |
|---|---|
| `syncDateContext(days)` | Schedule, tier, weather and holiday/break flags → upsert `DateContext`; skips dates whose tier was fetched in the last 24 h. Returns `{ synced, skipped }` |
| `syncGroqAdjustments(days)` | For dates with no adjustment or one older than 7 days: daily ML crowd score (50 when none) → `adjustCrowdScore` → store `groqAdjustment`, `groqReasoning`, `groqAdjustedAt`. Returns `{ adjusted }` |

Both run at most 5 dates at a time through `mapWithConcurrency`, and one failed date doesn't stop the rest. Weather comes from `fetchWeatherForecast` for the first 16 days and `climatologicalWeather` beyond; a forecast failure falls back to normals.

## `park-schedule.ts`: ThemeParks.wiki schedule

`fetchDateSchedule(start, end)` → `DateScheduleInfo[]` (`{ date, tier, specialEvent }`) for Disneyland. The tier (0–5) comes from the Lightning Lane Multi Pass price when listed, else from operating hours, else defaults to 2. `specialEvent` is the ticketed event's description.

## `calendar.ts`: holidays and school breaks

| Export | Purpose |
|---|---|
| `isHolidayDate(date)` | Fixed and floating US/CA holidays, plus Good Friday through Easter Monday |
| `isSchoolBreakDate(date)` | SoCal winter, spring and summer breaks, and Thanksgiving week |

## `weather.ts`: Anaheim weather

| Export | Purpose |
|---|---|
| `fetchWeatherForecast(start, end)` | Open-Meteo daily forecast → `Map<date, WeatherDay>` |
| `climatologicalWeather(dateStr)` | NOAA 30-year monthly normal; a mild default day for a malformed date |
| `weatherEmoji(code)`, `weatherLabel(code)` | Display helpers for a WMO weather code |
| `WeatherDay` | `{ date, tempHigh, tempLow, precipMm, isRainy, weatherCode, precipProb }` |
| `ANAHEIM_LAT`, `ANAHEIM_LON`, `FORECAST_HORIZON_DAYS` (16), `RAINY_PRECIP_MM` (2.5) | Constants |

---

## `queue-times.ts`: live wait times

`fetchLiveRides()` fetches every park in `ride-config.json` in parallel, validates each response with Zod and drops excluded rides. It returns a flat `RideData[]` (`{ id, name, landName, isOpen, waitTime, lastUpdated }`). If any park fails or changes shape, it throws `QueueTimesError` rather than return a partial list. `ml-service/collect.py` parses the same schema.

`roundToWindow(date)` rounds to the nearest 30-minute boundary.

## `park-time.ts`: park-local dates

All in `America/Los_Angeles` (`PARK_TIME_ZONE`).

| Export | Purpose |
|---|---|
| `parkDateKey(date)` | `"YYYY-MM-DD"` of a `Date` in park time |
| `normalizeParkDateKey(date)` | Accepts a `Date` or a date key; returns the key |
| `parkDateDow(date)` | Day of week of the park date, 0 = Sunday |
| `parkDateRangeUtc(date)` | `{ start, endExclusive }` UTC bounds of the park day (23 or 25 hours on DST days) |
| `parkMonthRangeUtc(year, month)` | UTC bounds of a park-local month |
| `dateContextMonthRangeUtc(year, month)` | Bounds for `DateContext.date`, which is stored as midnight UTC |

## `parks.ts`: park names

`getParkName(landName)` maps a land to `"Disneyland"` or `"Disney California Adventure"` (unknown lands → Disneyland). It also exports `DISNEYLAND`, `DCA` and `CONFIGURED_PARKS`.

## `accuracy-filters.ts`: accuracy table

`filterAndSortRides(rides, parkFilter, search, sortKey)` filters and sorts the accuracy page's ride table in the browser. It also exports the types `PerRide`, `ParkFilter` and `SortKey` (`"mae-asc" | "mae-desc" | "alpha" | "samples-desc"`).

---

## `auth.ts`: bearer guard

`requireBearer(req)` returns a response to send back (401, or 500 when `CRON_SECRET` is unset), or null when authorized. The comparison runs in constant time.

```ts
const denied = requireBearer(req);
if (denied) return denied;
```

## `rate-limit.ts`: rate limiting

An in-memory sliding window, kept per serverless instance, so limits are best-effort.

| Export | Purpose |
|---|---|
| `rateLimitResponse(req, config)` | 429 `NextResponse` with `Retry-After`, or null |
| `checkRateLimit(key, config)` | `{ allowed, remaining, retryAfterSeconds }` |
| `clientKey(req)` | Leftmost `x-forwarded-for`, else one shared bucket |

## `http.ts`: CDN caching

`cachedJson(data, seconds)` is `NextResponse.json` plus `Cache-Control: public, s-maxage=N, stale-while-revalidate=2N`. `cacheHeaders(seconds)` returns just the header.

## `concurrency.ts`

`mapWithConcurrency(items, limit, fn)` runs `fn` over `items` with at most `limit` in flight. It returns `PromiseSettledResult`s in input order.

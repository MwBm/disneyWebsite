# Runbook: Service Layer (`src/lib/`)

Shared logic and all I/O. API routes are thin adapters over these modules.

---

## `db.ts`: Prisma client

Exports `prisma`, a `PrismaClient` using `@prisma/adapter-pg` on the URL from `resolveDatabaseUrl()` (`database-url.ts`). Outside production the client is cached on `globalThis`, so hot reload doesn't open new connections.

`resolveDatabaseUrl(env = process.env)` returns the first valid `postgres://` or `postgresql://` URL from `DATABASE_URL`, `DIRECT_DATABASE_URL`, `DIRECT_URL`, `POSTGRES_URL` or `POSTGRES_URL_NON_POOLING`, after trimming whitespace, surrounding quotes and a pasted `DATABASE_URL=` prefix. It throws at import when none is valid.

```ts
import { prisma } from "@/lib/db";
```

---

## `forecast-queries.ts`: forecast SQL

Every aggregate happens in Postgres, because each returned row counts against the egress quota. Unit tests mock this module, and `tests/integration/forecast-queries.test.ts` runs every query against real Postgres.

| Export | Returns |
|---|---|
Every query takes an optional `parkId` (default 16, Disneyland).

| Export | Returns |
|---|---|
| `getRideForecastsForDate(date, parkId?)` | `RideDayForecast[]`: one per active ride from the `RideDayForecast` projection, with names from `RideCatalog` |
| `getRideForecastHoursForDate(date, rideId, parkId?)` | `RideForecastHour[]`: `DailyForecast` slots averaged into one point per Pacific hour |
| `getDailyMlCrowdScores(start, endExclusive, parkId?)` | `Map<"YYYY-MM-DD", score>` from `ParkDayForecast` |
| `getHistoricalRideWaitsForDate(date, parkId?)` | `HistoricalRideWaits[]`: per-ride average and peak of typical open hourly waits on that weekday, last 2 years of `HourlyWaitSummary`, from 08:00, active rides only; each name comes from a `LATERAL` probe on the `(rideId, date, hour)` index |
| `getHistoricalRideForecastHoursForDate(date, rideId, parkId?)` | `RideForecastHour[]`: same-weekday historical hourly points for a selected ride when ML data is absent |
| `getHistoricalDowMeanWaits(month, parkId?)` | `Map<dow, meanWait>` for the month over 3 years, last year weighted 2× |
| `getRecentCollectRuns(limit = 3)` | Newest `CollectRun` rows with `job = 'collect'` |
| `FORECAST_FIRST_LOCAL_HOUR` | `8`: must match `PARK_CLOSED_LOCAL_HOURS` in `ml-service/pipeline.py` (a pytest checks) |
| `HISTORICAL_LOOKBACK_YEARS` | `2` |
| `RideDayForecast`, `HistoricalRideWaits`, `RideForecastHour` | Row types |

## `forecast.ts`: crowd-score logic

| Export | Returns |
|---|---|
| `getCrowdScoreForDate(date, parkId?)` | The park date's ML crowd score (`ParkDayForecast`), or null |
| `getCrowdScoresForMonth(year, month, parkId?)` | `DayCrowdScore[]` for every day of the month, used by the calendar |
| `resolveCrowdScore({ mlScore, historicalScore, isBeyondWindow })` | Best available score: ML → historical (inside the window only); `"unavailable"` beyond the window, `null` source when neither exists |
| `ML_FORECAST_DAYS` | `30` |
| `DayCrowdScore` | `{ date, crowdScore, source, tier, specialEvent, isHoliday }`, where `source` is `"ml" \| "historical" \| "unavailable" \| null`. The calendar page imports this type rather than redeclaring it |

---

## `crowd.ts`: crowd scale and colors

The shared fallback calibration anchors and score targets are read from
`ride-config.json`. The training job replaces those anchors with its observed
historical daytime percentiles before it writes ML forecast scores.

| Export | Purpose |
|---|---|
| `calibrateCrowdIndex(waitIndex)` | Maps a historical-only wait index through the fallback percentile anchors |
| `deriveCrowdScore(avgWait, tier?)` | Historical-only score with a small additive ticket-tier correction; it does not penalize partial ride coverage |
| `HISTORICAL_FALLBACK_CONFIDENCE` | `0.25`: `mlConfidence` on historical-fallback rides |
| `CROWD_BANDS`, `crowdBand(score)` | The one crowd scale: 0–25 Light, 26–50 Moderate, 51–75 Busy, 76+ Very Busy |
| `crowdLabel(score)` | `{ label, color, description }` |
| `crowdLabelText(score \| null)` | The band label, or `"No data"` for null |
| `crowdLegend()` | Legend rows derived from `CROWD_BANDS` |
| `CALENDAR_CROWD_BANDS`, `calendarCrowdBand(score)` | Visual-only 10-point scale for calendar cells (ten colors), separate from the four labels |
| `calendarCrowdColor`, `calendarCrowdBgOpacity`, `calendarCrowdLegend()` | Null-tolerant calendar cell helpers and legend |
| `WAIT_BANDS`, `waitColor(minutes)` | Wait-time colors: ≤20, ≤45, ≤75, above |
| `SEVERITY_COLORS`, `NO_DATA_COLOR` | The shared palette |

---

## `groq.ts` and `groq-models.ts`: AI

Model IDs live only in `groq-models.ts` (`GROQ_TEXT_MODEL`, `GROQ_CHAT_MODEL`). When Groq retires a model, edit that file. Reasoning models (`openai/gpt-oss-*`) return empty content at small token budgets, so they are not drop-in replacements.

Groq is used only for the optional narration and the chat assistant. It never changes a crowd score.

| Export | Purpose |
|---|---|
| `narrateForecast(crowdScore, forecasts, date)` | 2–3 sentence forecast naming the crowd label and the five highest peak waits. Throws when `GROQ_API_KEY` is unset |
| `buildChatSystemPrompt({ liveWaits, crowdScore, now, visitDate, visitForecasts, visitForecastSource })` | Chat system prompt: the 10 longest live waits, the selected date's 10 highest-peak and 10 lowest-average rides, and reply-style rules |
| `ChatForecast`, `ChatForecastSource`, `ChatSystemContext` | Prompt input types |

---

## `date-context.ts`: date-context sync

| Export | Purpose |
|---|---|
| `syncDateContext(days)` | For both parks: schedule, tier, weather and holiday/break flags → upsert `DateContext`; skips dates whose tier was fetched in the last 24 h. Returns `{ synced, skipped }` |

Upserts run at most 5 at a time through `mapWithConcurrency`, and one failed date doesn't stop the rest. Weather comes from `fetchWeatherForecast` for the first 16 days and `climatologicalWeather` beyond; a forecast failure falls back to normals.

The `DateContext` columns `groqDowEstimate`, `groqAdjustment`, `groqReasoning` and `groqAdjustedAt` still exist in the schema but nothing reads or writes them (see [runbook-database.md](runbook-database.md#datecontext)).

## `park-schedule.ts`: ThemeParks.wiki schedule

`fetchParkDateSchedules(start, end)` → `ParkDateScheduleInfo[]` (`{ parkId, date, tier, specialEvent }`) for both parks, fetched in parallel. `fetchDateSchedule(start, end)` is the Disneyland-only form, kept as a test seam. The tier (0–5) comes from the Lightning Lane Multi Pass price when listed, else from operating hours, else defaults to 2. `specialEvent` is the ticketed event's description.

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
| `ANAHEIM_LAT`, `ANAHEIM_LON`, `FORECAST_HORIZON_DAYS` (16), `RAINY_PRECIP_MM` (2.5), `WMO_CLEAR`, `WMO_RAIN` | Constants |

---

## `queue-times.ts`: live wait times

`fetchLiveRides()` fetches every park in `ride-config.json` in parallel, validates each response with Zod and drops excluded rides. It returns a flat `RideData[]` (`{ id, name, landName, isOpen, waitTime, lastUpdated }`). If any park fails or changes shape, it throws `QueueTimesError` rather than return a partial list. `ml-service/collect.py` parses the same schema; the 30-minute window rounding lives only in `collect.py`.

## `park-time.ts`: park-local dates

All in `America/Los_Angeles` (`PARK_TIME_ZONE`).

| Export | Purpose |
|---|---|
| `parkDateKey(date)` | `"YYYY-MM-DD"` of a `Date` in park time |
| `addParkDays(dateKey, days)` | Date key `days` later (or earlier) |
| `dateContextDate(dateKey)` | Midnight UTC `Date` used as the stored key in `DateContext` and the projection tables |
| `normalizeParkDateKey(date)` | Accepts a `Date` or a date key; returns the key |
| `parkDateDow(date)` | Day of week of the park date, 0 = Sunday |
| `parkDateRangeUtc(date)` | `{ start, endExclusive }` UTC bounds of the park day (23 or 25 hours on DST days) |
| `parkMonthRangeUtc(year, month)` | UTC bounds of a park-local month |
| `dateContextMonthRangeUtc(year, month)` | Bounds for `DateContext.date`, which is stored as midnight UTC |

## `parks.ts`: park identity

| Export | Purpose |
|---|---|
| `DISNEYLAND_PARK_ID` (16), `DCA_PARK_ID` (17), `PARK_IDS`, `ParkId` | queue-times.com park IDs |
| `isParkId(n)` | Type guard used by every route's `park` validation |
| `PARK_LABELS`, `DISNEYLAND`, `DCA`, `ParkName` | Display names |
| `getParkName(landName)` | Maps a land to a park name (unknown lands → Disneyland); the accuracy route's fallback when `parkId` has no label |

## `startup-data.ts`: client cache warmup

Client-only (`"use client"`). `preloadStartupData()` runs once, from the loading screen, and fetches today's forecast and this month's calendar for both parks, `/api/weather`, `/api/accuracy`, and the chart for the first ride in the accuracy list. `getStartupData(url)` returns a warmed response for that exact URL, and `waitForStartupData()` lets a page wait for the warmup. A failed preload is ignored; pages fall back to their own fetch.

## `accuracy-filters.ts`: accuracy table

`filterAndSortRides(rides, parkFilter, search, sortKey)` filters and sorts the accuracy page's ride table in the browser, and `groupRidesByPark` groups the result. It also exports the types `PerRide`, `ParkFilter`, `SortKey` (`"mae-asc" | "mae-desc" | "alpha" | "samples-desc"`) and `RideGroup`.

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
| `clientKey(req)` | Leftmost `x-forwarded-for`, else `x-real-ip`, else one shared `"unknown"` bucket |

## `http.ts`: CDN caching

`cachedJson(data, seconds)` is `NextResponse.json` plus `Cache-Control: public, s-maxage=N, stale-while-revalidate=2N`. `cacheHeaders(seconds)` returns just the header.

## `concurrency.ts`

`mapWithConcurrency(items, limit, fn)` runs `fn` over `items` with at most `limit` in flight. It returns `PromiseSettledResult`s in input order.

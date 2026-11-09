# Runbook: API Routes (`src/app/api/`)

## Overview

All routes are Next.js App Router route handlers with no shared state between requests, except each instance's in-memory rate-limit counters.

- **Caching:** cached routes send `Cache-Control: public, s-maxage=N, stale-while-revalidate=2N` through `cachedJson` (`src/lib/http.ts`). Vercel's CDN caches per full URL. `export const revalidate` is not used: Next ignores it in routes that read search params.
- **Rate limits:** `rateLimitResponse` (`src/lib/rate-limit.ts`) returns 429 with `Retry-After` once a client goes over. The limits are per serverless instance and best-effort.
- **Validation:** bad input returns 400 with `{ error }` (Zod field errors where a schema applies).
- **Park:** every forecast, calendar and per-ride route takes an optional `?park=16|17` (16 = Disneyland, 17 = Disney California Adventure; default 16). Any other value returns 400.
- **Data collection** is not an API route: the Python jobs write the database directly. See [runbook-cron.md](runbook-cron.md) and [runbook-ml-service.md](runbook-ml-service.md).
- **Groq** is called only by `/api/forecast/narration` and `/api/chat`. No route puts an LLM on the numeric forecast path.

| Route | Method | Auth | Rate limit | CDN cache |
|---|---|---|---|---|
| `/api/forecast` | GET | none | 30/min | 30 min |
| `/api/forecast/narration` | GET | none | 10/min | 30 min |
| `/api/forecast/rides/[rideId]` | GET | none | 30/min | 30 min |
| `/api/calendar` | GET | none | 30/min | 1 h |
| `/api/accuracy` | GET | none | none | 30 min |
| `/api/accuracy/rides/[rideId]` | GET | none | none | 30 min |
| `/api/chat` | POST | none | 10/min | none (stream) |
| `/api/live` | GET | none | none | 5 min |
| `/api/weather` | GET | none | 30/min | 1 h |
| `/api/cron/sync-date-context` | GET | Bearer `CRON_SECRET` | none | none |
| `/api/admin/date-context` | GET | Bearer `CRON_SECRET` | none | none |

---

## `/api/forecast`: forecast for one date

**Query:** `?date=YYYY-MM-DD` (required), `?park=` (optional).

**Logic** (queries in `src/lib/forecast-queries.ts`, all aggregated in Postgres):
1. In parallel (`Promise.all`, so any failure is a 500):
   - per-ride average and peak for the park date, from the `RideDayForecast` projection joined to active `RideCatalog` rides (`getRideForecastsForDate`);
   - the date's ML crowd score from `ParkDayForecast` (`getCrowdScoreForDate`);
   - the last 3 `collect` runs.
2. **ML forecasts exist** → `source: "ml"` with the stored crowd score.
3. **Else, `HourlyWaitSummary` has history** → `source: "historical"`:
   - per-ride average and peak of typical open-ride waits on that weekday over the last 2 years, 08:00 onwards (`getHistoricalRideWaitsForDate`);
   - crowd score from `deriveCrowdScore` on the mean of the rides' `avgWait`;
   - `mlConfidence: 0.25` on each ride.
4. **Else** → `source: "unavailable"`, `crowdScore: null`, `forecasts: []`.

`forecasts` has one entry per ride. `avgWait` is the mean predicted wait over the day's slots (08:00–23:30 Pacific) and `peakWait` the highest. `crowdNarration` is always `null` here: narration comes from `/api/forecast/narration`, which the page calls after the numbers render.

**Response (ML path):**
```json
{
  "date": "2026-07-04",
  "parkId": 16,
  "dataQualityOk": true,
  "lastCollectedAt": "2026-07-03T22:00:00.000Z",
  "crowdScore": 87,
  "crowdNarration": null,
  "forecasts": [
    {
      "rideId": 1,
      "rideName": "Matterhorn Bobsleds",
      "landName": "Fantasyland",
      "avgWait": 48,
      "peakWait": 65,
      "mlConfidence": 0.78
    }
  ],
  "source": "ml"
}
```

- `dataQualityOk` is true only when a successful collect run exists within the last 90 minutes. `lastCollectedAt` is that successful run, never a failed attempt.
- `crowdScore` can be null on the ML path if the date has ride forecasts but no `ParkDayForecast` row.

### `/api/forecast/narration`: optional planning tip

**Query:** `?date=YYYY-MM-DD` (required), `?park=` (optional). **Returns:** `{ date, parkId, narration }`.

Loads the same ML forecasts and crowd score as `/api/forecast` (or the historical fallback), then asks Groq (`narrateForecast`) for 2–3 sentences mentioning the crowd label, the five highest peak waits and one timing tip. `narration` is `null` when there is no data or when Groq fails; the failure is logged and the null response is still cached for 30 minutes.

### `/api/forecast/rides/[rideId]`: hourly ride forecast

**Query:** `?date=YYYY-MM-DD` (required), `?park=` (optional). Returns the selected ride's hourly
wait points in Pacific park time: `{ rideId, date, parkId, source, rows }`, where each
row is `{ hour, predictedWait }`. It averages the model's 30-minute `DailyForecast` slots
within each local hour. If the ML window does not cover the date, it returns
same-weekday historical hourly waits for that ride (`source: "historical"`); `source: "unavailable"`
means neither source has points. A non-positive or non-numeric `rideId` returns 400.

---

## `/api/calendar`: monthly crowd scores

**Query:** `?year=2026&month=7` (both required; year 2020–2030, month 1–12), `?park=` (optional).

**Returns:** `{ year, month, parkId, days }`, where each day is `{ date, crowdScore, source, tier, specialEvent, isHoliday }`.

`source` per day, in priority order (`resolveCrowdScore` in `src/lib/forecast.ts`):
1. `"ml"`: the day's `ParkDayForecast.crowdScore`, which `train.py` sets to the 75th percentile of that day's slot scores
2. `"historical"`: same-weekday mean from `HourlyWaitSummary` for that month (last 3 years, last year weighted 2×), mapped through the fallback calibration anchors plus `tier × historicalTierBonus` (`deriveCrowdScore`). Only within the 30-day ML window
3. `"unavailable"`: beyond the 30-day window with no ML score
4. `null`: inside the window with neither source

---

## `/api/accuracy`: prediction accuracy

Two aggregate queries over `DailyForecast` × `WaitTimeRecord`, across both parks:
- joined on `parkId`, `rideId` and `windowedAt = forecastFor`, both 30-minute-aligned UTC;
- only open rides, and only rides active in `RideCatalog`;
- only slots in the last 30 days that have already happened.

`force-dynamic`, so `next build` never queries the database.

**Returns:**
```json
{
  "summary": { "mae": 8.3, "within5": 0.41, "within10": 0.68, "within15": 0.82, "totalPredictions": 1240 },
  "perRide": [{
    "parkId": 16,
    "rideId": 1,
    "rideName": "Matterhorn Bobsleds",
    "landName": "Fantasyland",
    "parkName": "Disneyland",
    "mae": 6.1,
    "within10": 0.74,
    "sampleCount": 48
  }]
}
```

`perRide` is sorted by MAE, best first. `parkName` comes from `PARK_LABELS[parkId]`, falling back to `getParkName(landName)`. With no data: `{ "summary": null, "perRide": [] }`.

## `/api/accuracy/rides/[rideId]`: chart points for one ride

**Query:** `?limit=N` (optional; default 48, max 500), `?park=` (optional).

**Returns:** `{ rideId, parkId, rows: [{ predictedFor, predictedWait, actualWait, absError }] }`: the most recent `limit` matched slots in the last 30 days, in chronological order. A non-positive or non-numeric `rideId` returns 400.

---

## `/api/chat`: AI chat

**Body:**
```json
{
  "date": "2026-07-04",
  "messages": [{ "role": "user", "content": "Should I visit Saturday?" }]
}
```

`date` is optional (`YYYY-MM-DD`); it defaults to the current Disneyland park date. There are 1–50 messages, each with `role` `user` or `assistant` and 1–4000 characters of `content`.

**Response:** a plain-text stream (`text/plain; charset=utf-8`). An upstream failure mid-stream errors the stream rather than closing it, so a truncated answer never looks complete.

**Context injected** (`buildChatSystemPrompt` in `src/lib/groq.ts`):
- the 10 longest current waits across both parks, explicitly marked as live now;
- the selected date's Disneyland crowd score, its 10 highest-peak rides and its 10 lowest-average rides. The route has no `park` parameter, so date forecasts are always Disneyland's;
- when no ML forecast exists, same-weekday historical per-ride averages and a `deriveCrowdScore` score instead.

The three data lookups run with `Promise.allSettled`, so a failed one leaves its part of the prompt empty instead of failing the chat. The assistant is instructed not to treat current waits as a future forecast.

The route returns 503 when `GROQ_API_KEY` is unset. It checks config, then rate limit, then body, before any upstream call. A Groq error before streaming starts is unhandled and returns 500.

---

## `/api/live`: live wait times

**Returns:** `{ rides, fetchedAt }`, with every non-excluded ride from both parks: `{ id, name, landName, isOpen, waitTime, lastUpdated }`. Returns 502 with `{ error }` when queue-times.com fails or changes shape.

---

## `/api/weather`: 16-day Anaheim forecast

Takes no parameters, so one cache entry serves every visitor. **Returns:** `{ days: WeatherDay[] }` from Open-Meteo, or 502 with `{ error }`.

---

## `/api/cron/sync-date-context`: date-context sync

**Auth:** `Authorization: Bearer $CRON_SECRET`. The route returns 500 when the secret is unset.

Called monthly by `sync-date-context.yml`, or on demand. It runs `syncDateContext(365)` (`src/lib/date-context.ts`) for both parks:
- fetches ThemeParks.wiki park hours, Lightning Lane prices and ticketed events, and turns them into a tier (0–5);
- fetches Open-Meteo weather for the first 16 days, with climatological normals beyond (a weather failure falls back to normals for every date);
- computes holiday and school-break flags;
- upserts `DateContext` (5 at a time), skipping dates whose tier was fetched in the last 24 h.

**Returns:**
```json
{ "ok": true, "synced": 42, "skipped": 323 }
```

Failed upserts are logged and left out of `synced`. A schedule failure returns 500 with `{ error }`.

---

## `/api/admin/date-context`: inspect `DateContext`

**Auth:** `Authorization: Bearer $CRON_SECRET`.

Read-only. **Query:** `?days=N` (1–365, default 90; non-numeric falls back to 90). **Returns:** `{ count, days, rows }`: the `DateContext` rows for both parks from today forward, each with `date, tier, specialEvent, isHoliday, isSchoolBreak, tierFetchedAt, tierSource` (no `parkId`, so the two parks' rows for a date look alike).

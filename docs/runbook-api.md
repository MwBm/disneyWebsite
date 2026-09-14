# Runbook: API Routes (`src/app/api/`)

## Overview

All routes are Next.js App Router route handlers with no shared state between requests, except each instance's in-memory rate-limit counters.

- **Caching:** cached routes send `Cache-Control: public, s-maxage=N, stale-while-revalidate=2N` through `cachedJson` (`src/lib/http.ts`). Vercel's CDN caches per full URL. `export const revalidate` is not used: Next ignores it in routes that read search params.
- **Rate limits:** `rateLimitResponse` (`src/lib/rate-limit.ts`) returns 429 with `Retry-After` once a client goes over. The limits are per serverless instance and best-effort.
- **Validation:** bad input returns 400 with `{ error }` (Zod field errors where a schema applies).
- **Data collection** is not an API route: the Python jobs write the database directly. See [runbook-cron.md](runbook-cron.md) and [runbook-ml-service.md](runbook-ml-service.md).

| Route | Method | Auth | Rate limit | CDN cache |
|---|---|---|---|---|
| `/api/forecast` | GET | none | 30/min | 30 min |
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

**Query:** `?date=YYYY-MM-DD` (required).

**Logic** (queries in `src/lib/forecast-queries.ts`, all aggregated in Postgres):
1. In parallel:
   - per-ride average and peak for the Pacific date (`getRideForecastsForDate`);
   - the date's mean ML crowd score (`getCrowdScoreForDate`);
   - the last 3 `collect` runs;
   - `DateContext.groqAdjustment` / `groqReasoning`.
2. **ML forecasts exist** → `source: "ml"`:
   - the crowd score plus `groqAdjustment`, rounded and clamped to 0–100;
   - Groq narration.
3. **Else, `HourlyWaitSummary` has history** → `source: "historical"`:
   - per-ride average and peak of typical waits on that weekday over the last 2 years, 08:00 onwards (`getHistoricalRideWaitsForDate`);
   - crowd score from the mean of the rides' `avgWait`;
   - `mlConfidence: 0.25` on each ride.
4. **Else** → `source: "groq"`: a Groq general estimate for the score and narration, with `forecasts: []`.

`forecasts` has one entry per ride on every path. `avgWait` is the mean predicted wait over the day's slots (08:00–23:30 Pacific) and `peakWait` the highest. The narration lists the five highest peaks. A narration failure is logged and returns `crowdNarration: null`; the forecast is still returned.

**Response (ML path):**
```json
{
  "date": "2026-07-04",
  "dataQualityOk": true,
  "lastCollectedAt": "2026-07-03T22:00:00.000Z",
  "crowdScore": 87,
  "groqAdjustment": 5,
  "groqReasoning": "Holiday surge exceeds model baseline",
  "crowdNarration": "July 4th will be extremely crowded...",
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

- `groqAdjustment` and `groqReasoning` are omitted when there is no adjustment.
- `dataQualityOk` is true when at least one of the last 3 collect runs succeeded.
- `crowdScore` can be null if the date has ride forecasts but no daily score, or on the groq path if Groq fails.

---

## `/api/calendar`: monthly crowd scores

**Query:** `?year=2026&month=7` (both required; year 2020–2030, month 1–12).

**Returns:** `{ year, month, days }`, where each day is `{ date, crowdScore, source, tier, specialEvent, isHoliday }`.

`source` per day, in priority order:
1. `"ml"`: mean `DailyForecast.crowdScore` for the park date, plus the stored Groq adjustment
2. `"historical"`: same-weekday mean from `HourlyWaitSummary` for that month (last 3 years, last year weighted 2×), scaled by the date's tier. Only within the 30-day ML window
3. `"groq"`: Groq's day-of-week estimate for days still empty. It is cached in `DateContext.groqDowEstimate` for 7 days, and a Groq failure leaves the days null
4. `"unavailable"`: beyond the ML window with no ML score

---

## `/api/accuracy`: prediction accuracy

Two aggregate queries over `DailyForecast` × `WaitTimeRecord`:
- joined on `rideId` and `windowedAt = forecastFor`, both 30-minute-aligned UTC;
- only open rides;
- only slots in the last 30 days that have already happened.

`force-dynamic`, so `next build` never queries the database.

**Returns:**
```json
{
  "summary": { "mae": 8.3, "within5": 0.41, "within10": 0.68, "within15": 0.82, "totalPredictions": 1240 },
  "perRide": [{
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

`perRide` is sorted by MAE, best first, and `parkName` comes from `getParkName(landName)`. With no data: `{ "summary": null, "perRide": [] }`.

## `/api/accuracy/rides/[rideId]`: chart points for one ride

**Query:** `?limit=N` (optional; default 48, max 500).

**Returns:** `{ rideId, rows: [{ predictedFor, predictedWait, actualWait, absError }] }`: the most recent `limit` matched slots, in chronological order. A non-positive or non-numeric `rideId` returns 400.

---

## `/api/chat`: AI chat

**Body:**
```json
{ "messages": [{ "role": "user", "content": "Should I visit Saturday?" }] }
```

1–50 messages, each with `role` `user` or `assistant` and 1–4000 characters of `content`.

**Response:** a plain-text stream (`text/plain; charset=utf-8`). An upstream failure mid-stream errors the stream rather than closing it, so a truncated answer never looks complete.

**Context injected:** the 10 longest current waits among open rides, and today's ML crowd score.

The route returns 503 when `GROQ_API_KEY` is unset. It checks config, then rate limit, then body, before any upstream call.

---

## `/api/live`: live wait times

**Returns:** `{ rides, fetchedAt }`, with every non-excluded ride from both parks: `{ id, name, landName, isOpen, waitTime, lastUpdated }`. Returns 502 with `{ error }` when queue-times.com fails or changes shape.

---

## `/api/weather`: 16-day Anaheim forecast

Takes no parameters, so one cache entry serves every visitor. **Returns:** `{ days: WeatherDay[] }` from Open-Meteo, or 502 with `{ error }`.

---

## `/api/cron/sync-date-context`: date-context sync

**Auth:** `Authorization: Bearer $CRON_SECRET`. The route returns 500 when the secret is unset.

Called monthly by `sync-date-context.yml`, or on demand.

1. `syncDateContext(365)`:
   - fetches ThemeParks.wiki park hours, Lightning Lane prices and ticketed events, and turns them into a tier (0–5);
   - fetches Open-Meteo weather for the first 16 days, with climatological normals beyond;
   - computes holiday and school-break flags;
   - upserts `DateContext`, skipping dates whose tier was fetched in the last 24 h.
2. `syncGroqAdjustments(365)`: for dates with no `groqAdjustment` or one older than 7 days, it asks Groq for an adjustment of ±35 points to that date's mean ML crowd score (or 50 when there are no forecasts).

**Returns:**
```json
{ "ok": true, "synced": 42, "skipped": 323, "adjusted": 38 }
```

A Groq failure is logged and does not fail the sync (`adjusted` stays 0). A schedule failure returns 500 with `{ error }`.

---

## `/api/admin/date-context`: inspect `DateContext`

**Auth:** `Authorization: Bearer $CRON_SECRET`.

Read-only. **Query:** `?days=N` (1–365, default 90; non-numeric falls back to 90). **Returns:** `{ count, days, rows }`: the `DateContext` rows from today forward, each with `date, tier, specialEvent, isHoliday, isSchoolBreak, tierFetchedAt, tierSource`.

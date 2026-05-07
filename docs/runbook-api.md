# Runbook: API Routes (`src/app/api/`)

## Overview

All routes are Next.js App Router Route Handlers. No shared state between requests.

---

## Data collection

The cron pipeline lives in `ml-service/collect.py` and runs via GitHub Actions dispatch. See [runbook-cron.md](runbook-cron.md) and [runbook-ml-service.md](runbook-ml-service.md).

---

## `/api/forecast` — Ride Predictions

**Cache:** `revalidate = 1800` (30 min)

**Query params:** `?date=YYYY-MM-DD` (required, Zod-validated)

**Logic:**
1. Fetch `DailyForecast` rows for date + `CollectRun` history + `DateContext.groqAdjustment`
2. If ML forecasts exist: apply `groqAdjustment` to raw crowd score, narrate via Groq → `source: "ml"`
3. If no ML forecasts but historical data exists: synthesize from `HourlyWaitSummary` same-DOW means → `source: "historical"`
4. If no data at all: call Groq for general estimate → `source: "groq"`

**Response (ML path):**
```json
{
  "date": "2025-07-04",
  "crowdScore": 87,
  "crowdNarration": "July 4th will be extremely crowded...",
  "groqAdjustment": 5,
  "groqReasoning": "Holiday surge exceeds model baseline",
  "forecasts": [
    {
      "rideId": 1,
      "rideName": "Matterhorn Bobsleds",
      "landName": "Fantasyland",
      "forecastFor": "2025-07-04T20:00:00.000Z",
      "predictedWait": 65,
      "crowdScore": 87,
      "mlConfidence": 0.78
    }
  ],
  "source": "ml",
  "dataQualityOk": true,
  "lastCollectedAt": "2025-07-03T22:00:00.000Z"
}
```

`groqAdjustment` and `groqReasoning` are omitted when adjustment is 0.

**Response (historical path):** Same shape with `source: "historical"`, `crowdScore` derived from same-DOW wait means, `mlConfidence: 0.25` on each forecast.

**Response (groq path):** `forecasts: []`, `crowdScore` and `crowdNarration` from Groq general estimate, `source: "groq"`.

---

## `/api/live` — Live Wait Times

**Cache:** `revalidate = 300` (5 min)

**Returns:** Flat array of all rides with current `waitTime`, `isOpen`, `landName`.

---

## `/api/accuracy` — Prediction Accuracy

**No cache** (always fresh).

**Query params:** `?days=30` (optional, default 30, max 90)

**Logic:** Single `$queryRaw` JOIN — `Prediction` × `WaitTimeRecord` where `windowedAt` matches `predictedFor` rounded to 30 min AND `isOpen = true`. Closed rides excluded.

**Returns:**
```json
{
  "mae": 8.3,
  "within5": 0.41,
  "within10": 0.68,
  "within15": 0.82,
  "perRide": [{ "rideId": 1, "rideName": "...", "mae": 6.1, "count": 48 }]
}
```

---

## `/api/chat` — AI Chat

**Method:** POST

**Body:**
```json
{ "messages": [{ "role": "user", "content": "Should I visit Saturday?" }] }
```

Max 50 messages, each max 4000 chars (Zod-validated).

**Response:** Plain text stream (`text/plain; charset=utf-8`). Read chunks from `ReadableStream`.

**Context injected:** Live wait times (top 10 open rides) + today's crowd score from DB.

---

## `/api/calendar` — Monthly Crowd Scores

**Cache:** `revalidate = 3600` (1 hour)

**Query params:** `?year=2025&month=7` (optional, defaults to current month)

**Returns:** Array of `{ date, crowdScore, source, tier, specialEvent, isHoliday }` for each day in the month.

Score sources per day (in priority order):
1. `"ml"` — from `DailyForecast` (within 30-day ML window)
2. `"historical"` — same-DOW weighted mean from `HourlyWaitSummary`
3. `"unavailable"` — beyond ML window with no historical data

---

## `/api/admin/date-context` — Date Context Admin

**Auth:** Bearer `CRON_SECRET`

Manual read/write of `DateContext` rows. Used for inspecting or overriding tier/holiday/weather data.

---

## `/api/cron/sync-date-context` — Date Context Sync

**Auth:** Bearer `CRON_SECRET`

**Method:** GET

Called by `sync-date-context.yml` GitHub Action (monthly + on-demand).

**What it does:**
1. `syncDateContext(365)` — fetches 365 days of schedule from ThemeParks.wiki + weather from Open-Meteo, upserts `DateContext` rows
2. `syncGroqAdjustments(365)` — for dates without `groqAdjustment`, calls Groq adjuster and stores result

**Returns:**
```json
{ "ok": true, "synced": 42, "skipped": 323, "adjusted": 38 }
```

Groq adjustment failure is non-fatal — response still returns `ok: true`.

---

## `/api/raw-data` — Raw Wait Time Export

Returns raw `WaitTimeRecord` rows for a date range. Used for debugging and data inspection.

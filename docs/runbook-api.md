# Runbook: API Routes (`src/app/api/`)

## Overview

All routes are Next.js App Router Route Handlers. No shared state between requests.

---

## `/api/collect` — Data Collection

**Trigger:** GitHub Actions cron every 30 min (also callable manually).

**Auth:** `Authorization: Bearer $COLLECT_SECRET` header required. Returns 401 otherwise.

**Flow:**
1. Fetch live rides from queue-times.com via `fetchLiveRides()`
2. Round each `last_updated` to nearest 30 min → `windowedAt`
3. Upsert into `WaitTimeRecord` with `skipDuplicates: true`
4. Write `CollectRun` row (success, rowsUpserted)
5. Fetch last 90 days from DB → POST to Python ML service
6. Write returned `DailyForecast` rows (next 24 hours per ride)
7. On ML failure: skip step 6, log error in `CollectRun.errorMessage`

**Manual test:**
```bash
curl -X POST http://localhost:3000/api/collect \
  -H "Authorization: Bearer $(grep COLLECT_SECRET .env.local | cut -d= -f2 | tr -d '"')"
```

---

## `/api/forecast` — Ride Predictions

**Cache:** `revalidate = 1800` (30 min)

**Query params:** `?date=YYYY-MM-DD` (required, Zod-validated)

**Returns:**
```json
{
  "date": "2025-07-04",
  "crowdScore": 87,
  "crowdLabel": "Very Busy",
  "narration": "July 4th will be extremely crowded...",
  "forecasts": [{ "rideId": 1, "rideName": "...", "predictedWait": 65 }],
  "source": "db"
}
```

`source` is `"db"` when data exists, `"none"` when no forecasts found for date.

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

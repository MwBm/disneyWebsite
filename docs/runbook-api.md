# Runbook: API Routes (`src/app/api/`)

## Overview

All routes are Next.js App Router Route Handlers. No shared state between requests.

---

## Data collection

The cron pipeline lives in `ml-service/collect.py` and runs in GitHub Actions, not Next.js. See [runbook-cron.md](runbook-cron.md) and [runbook-ml-service.md](runbook-ml-service.md).

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

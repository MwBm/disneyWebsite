# Runbook: Database (`prisma/`)

Supabase PostgreSQL. ORM: Prisma 5. Project ref: `cuzkfncrhdddozdxdcyy`.

---

## Schema

### `WaitTimeRecord`
Raw data collected from queue-times.com each time `collect.py` runs.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `rideId` | Int | queue-times.com ride ID |
| `rideName` | String | |
| `landName` | String | Fantasyland, Tomorrowland, etc. |
| `waitTime` | Int | minutes |
| `isOpen` | Boolean | false = ride closed |
| `windowedAt` | DateTime | `recordedAt` rounded to nearest 30 min |
| `recordedAt` | DateTime | actual fetch time |

Unique constraint: `(rideId, windowedAt)` — deduplication key. Upsert uses `ON CONFLICT DO UPDATE`.

Raw rows older than 30 days are aggregated to `HourlyWaitSummary` by the weekly archive job.

### `HourlyWaitSummary`
Hourly aggregates of `WaitTimeRecord` after the 30-day raw retention window. Used as long-term ML training data alongside the raw 30-day window.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `rideId` | Int | |
| `rideName` | String | |
| `landName` | String | |
| `date` | DateTime | midnight UTC of the park date |
| `hour` | Int | 0–23 (park local hour) |
| `avgWait` | Float | mean wait for this hour |
| `peakWait` | Int | max wait seen |
| `sampleCount` | Int | number of raw records averaged |
| `isOpen` | Boolean | |

Unique constraint: `(rideId, date, hour)`.

### `DailyForecast`
Pre-computed predictions written by `ml-service/collect.py` after each ML run. Stale rows for a given slot are deleted before re-insertion to prevent drift.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `rideId` | Int | |
| `rideName` | String | |
| `landName` | String | |
| `forecastFor` | DateTime | future date/time being predicted |
| `predictedWait` | Int | minutes, clipped to [0, 300] |
| `crowdScore` | Int | 0–100 park-wide score |
| `mlConfidence` | Float | 0–1 from XGBoost residual std |
| `createdAt` | DateTime | |

### `DateContext`
Per-date signals used to improve crowd score accuracy: Disney ticket tier, holiday/school-break flags, weather forecast, and Groq post-process adjustment.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `date` | DateTime | midnight UTC for the park date (unique) |
| `tier` | Int? | Disney LLMP tier 0–5 (higher = pricier/busier) |
| `isHoliday` | Boolean | US/CA holiday |
| `isSchoolBreak` | Boolean | SoCal school break window |
| `specialEvent` | String? | Ticketed event name (e.g. "Oogie Boogie Bash") |
| `tierFetchedAt` | DateTime? | When tier was last fetched; re-fetch after 24h |
| `tierSource` | String? | e.g. `"themeparks-wiki"` |
| `groqDowEstimate` | Json? | Cached DOW→score map from `estimateDowCrowdScores` |
| `tempHigh` | Float? | Forecast high °F (Open-Meteo or climatological fallback) |
| `tempLow` | Float? | Forecast low °F |
| `precipMm` | Float? | Total precipitation in mm |
| `isRainy` | Boolean? | true when `precipMm ≥ 2.5` |
| `weatherFetchedAt` | DateTime? | When weather was last fetched |
| `groqAdjustment` | Float? | Points to add to ML crowd score (bounded ±20) |
| `groqReasoning` | String? | One-sentence Groq explanation |

### `Prediction`
Historical record of predictions made (for accuracy tracking). Linked to `DateContext`.

### `CollectRun`
One row per `collect.py` execution. Tracks success, rows upserted, and error messages.

---

## Connections

**App runtime (Vercel serverless):** Transaction Pooler on port 6543.
```
postgresql://postgres.[ref]:[password]@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Schema changes + direct psycopg (collect.py):** Direct connection on port 5432 (set as `DIRECT_URL`).
```
postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require
```

---

## Schema Changes

**Preferred approach for production (existing data, no migration history):** Use `prisma db push`.

```bash
# 1. Update prisma/schema.prisma
# 2. Push schema to DB (additive-only — safe for existing data)
npx prisma db push
# 3. Regenerate Prisma client
npx prisma generate
```

**Alternative (network blocked):** Supabase Dashboard → SQL Editor → paste DDL → Run, then run `npx prisma generate`.

`prisma migrate dev` is **not** recommended for this project — migration history was not initialized from the start, and `migrate dev` will attempt a reset if the DB state doesn't match.

---

## Useful Commands

```bash
# Regenerate Prisma client (no DB connection needed)
npx prisma generate

# View schema diff as SQL
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script

# Push schema to DB (requires direct connection on port 5432)
npx prisma db push

# Open Prisma Studio (local DB browser)
npx prisma studio
```

# Runbook: Database (`prisma/`)

Supabase PostgreSQL (Free plan: 0.5 GB database, **5 GB/month egress**). ORM: Prisma 7. Project ref: `cuzkfncrhdddozdxdcyy`.

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
Pre-computed predictions written only by `ml-service/train.py` (daily, 30-day window). Rows are upserted on `(rideId, forecastFor)`; nothing is deleted.

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
One row per ml-service job run: `collect`, `train` or `archive`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `job` | `JobKind` enum | `collect` \| `train` \| `archive`; default `collect` |
| `ranAt` | DateTime | |
| `rowsUpserted` | Int | rows the run wrote; 0 for failures (the transaction rolled back) |
| `success` | Boolean | |
| `errorMessage` | String? | |

`job` was added on 2026-09-13 (`20260913180000_collect_run_job`). Before that, train runs were logged here indistinguishably from collect runs; the migration backfills successful runs with ≥ 1,000 rows as `train` (collect wrote 50–59, train 65k+). Failed runs from before then can't be told apart and read as `collect`.

`/api/forecast` reads only `job = 'collect'` runs for its data-quality flag. `ml-service/check_freshness.py` reads the latest successful `train` run. `JobKind` must match `JOBS` in `ml-service/common.py`; a unit test checks it.

---

## Connections

**App runtime (Vercel serverless):** Transaction Pooler on port 6543.
```
postgresql://postgres.[ref]:[password]@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Prisma CLI (migrations):** `prisma.config.ts` rewrites the pooler URL to session mode (port 5432).

**ml-service jobs (psycopg):** `DATABASE_URL`, else `DIRECT_URL`, through `common.connect()`. It strips Prisma-only query params and disables psycopg prepared statements, which collide behind the pooler (`prepared statement "_pg3_0" already exists`).

**Direct connection:** `postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require`. This host is IPv6-only; from a network without IPv6 (most home connections, GitHub runners) use the session pooler instead.

**Egress:** every row a query returns counts against the 5 GB/month quota. Aggregate in SQL and never re-read bulk history on a frequent schedule — that is what restricted the project in September 2026.

---

## Schema Changes

Production has migration history since 2026-09-13 (`0_init` baselined, see `prisma/migrations/README.md`). **Do not use `prisma db push` against production anymore** — it changes the schema without recording a migration, and the next `migrate deploy` fails on drift.

Never point `migrate dev` or `migrate reset` at Supabase; both can drop data. Generate migrations against a disposable local database instead:

```bash
# 1. Disposable Postgres with the current migrations applied
docker run -d --rm --name disney-it-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=disney_test -p 55432:5432 postgres:17
export DATABASE_URL=postgresql://postgres:postgres@localhost:55432/disney_test
npx prisma migrate deploy

# 2. Edit prisma/schema.prisma, then write the SQL for the difference
mkdir prisma/migrations/<YYYYMMDDHHMMSS>_<name>
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --script --output prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql
#    Add any data backfill by hand, and cover it in
#    ml-service/tests/integration/test_migrations_db.py.

# 3. Apply locally, confirm no drift, regenerate the client
npx prisma migrate deploy
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
npx prisma generate
unset DATABASE_URL

# 4. After the PR is merged, apply to production (uses .env.local)
npx prisma migrate deploy
```

CI applies every migration to an empty Postgres 17 and fails on drift (`ml-integration` job).

**Deploy order:** apply a migration before merging code that depends on it. The ml-service jobs run from `main` every 30 minutes, so code that writes a new column fails every run until the column exists.

---

## Useful Commands

```bash
# Regenerate Prisma client (no DB connection needed)
npx prisma generate

# Which migrations are applied?
npx prisma migrate status

# Does the live database match schema.prisma? (read-only)
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma

# Open Prisma Studio (local DB browser)
npx prisma studio
```

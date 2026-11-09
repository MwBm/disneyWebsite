# Runbook: Database (`prisma/`)

Supabase Postgres, Free plan: 0.5 GB database, **5 GB/month egress**. ORM: Prisma 7. Project ref: `cuzkfncrhdddozdxdcyy`.

---

## Schema

Every fact, forecast and context table carries `parkId` (16 = Disneyland, 17 = Disney California Adventure; default 16, added by migration `20261025020056_park_aware_forecasts_and_serving_projections`). The website reads the small projection tables (`RideDayForecast`, `ParkDayForecast`, `RideCatalog`); the slot-level `DailyForecast` is read only for a selected ride's chart and the accuracy pages.

### `WaitTimeRecord`
Raw wait times, one row per ride per 30-minute window, written by `collect.py`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `rideId` | Int | queue-times.com ride ID |
| `parkId` | Int | |
| `rideName` | String | |
| `landName` | String | Fantasyland, Tomorrowland, etc. |
| `waitTime` | Int | minutes |
| `isOpen` | Boolean | false = ride closed |
| `windowedAt` | DateTime | `recordedAt` rounded to the nearest 30 min (UTC) |
| `recordedAt` | DateTime | actual fetch time |

Unique: `(rideId, windowedAt)`; collect upserts on it. The weekly archive moves rows older than 30 days (cutoff truncated to the hour) into `HourlyWaitSummary`, in one statement. Until then they are training data: `train.py` reads every row in this table.

### `HourlyWaitSummary`
Hourly aggregates of archived `WaitTimeRecord` rows, plus the DCA Kaggle import. Training reads 3 years of it alongside the raw table.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `rideId` | Int | |
| `parkId` | Int | |
| `rideName` | String | latest name seen for that hour |
| `landName` | String | |
| `date` | DateTime | the park date, stored as midnight UTC |
| `hour` | Int | park-local hour, 0–23 |
| `avgWait` | Float | mean wait over the hour's **open** samples (0 if none) |
| `peakWait` | Int | max open wait seen |
| `sampleCount` | Int | raw records in the bucket |
| `observedSampleCount` | Int | raw records observed (equal to `sampleCount` for archived buckets) |
| `openSampleCount` | Int | records where the ride was open; the weight for merges |
| `isOpen` | Boolean | open at any point in the hour |

Unique: `(rideId, date, hour)`. When archive meets an existing bucket it merges it: `avgWait` weighted by `openSampleCount`, max `peakWait`, summed counts, OR'd `isOpen`, latest names. Kept 3 years.

### `DailyForecast`
Predictions for 30-minute slots, written only by `train.py` (daily, 30 days ahead). Upserted on `(rideId, forecastFor)`. `archive.py` deletes slots older than 35 days (`FORECAST_RETENTION_DAYS`): the accuracy pages read 30 days, joined to raw rows that only exist for 30.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `rideId` | Int | |
| `parkId` | Int | |
| `rideName` | String | |
| `landName` | String | |
| `forecastFor` | DateTime | slot start, 30-minute aligned UTC; 08:00–23:30 Pacific only |
| `predictedWait` | Int | minutes, clipped to 0–300 |
| `crowdScore` | Int | 0–100, park-wide for the slot |
| `mlConfidence` | Float | 0–1 from walk-forward CV error; 0.3 for rides on the hour-mean fallback |
| `createdAt` | DateTime | when the row was last written |

### `RideDayForecast`
One row per park, ride and park date: `avgWait` (mean slot prediction), `peakWait` (max slot prediction) and `mlConfidence` (mean slot confidence), plus `modelRunId`. Written by `train.py`; read by `/api/forecast`, the narration route and chat. Unique: `(parkId, rideId, date)`. Kept 60 days.

### `ParkDayForecast`
One row per park and park date: `crowdScore`, the 75th percentile of that day's slot scores, plus `modelRunId`. Written by `train.py`; the crowd score shown on the home page and calendar. Unique: `(parkId, date)`. Kept 60 days.

### `RideCatalog`
Current name, land and `isActive` flag per `(parkId, rideId)` (the primary key). Each train run marks every ride in the trained parks inactive, then re-activates the rides in its history. Every website query joins it and shows active rides only.

### `ModelRun`
One row per train run: `version`, `featureVersion`, `trainingCutoff` and aggregate `metrics` (JSON: model counts, mean CV MAE). Never model binaries. Kept 2 years.

### `ForecastEvaluation`
A ride's predicted daily average for selected horizons (`horizonBucket`: same day, 1, 3, 7, 14 and 28 days ahead), with `actualAvgWait` and `mae` filled in by later train runs once the day has passed and raw rows still exist. Unique: `(modelRunId, parkId, rideId, targetDate)`. Kept 2 years. Nothing in the website reads it yet.

### `DateContext`
Per-date signals per park: Disney demand tier, holiday and school-break flags and weather. Written by `/api/cron/sync-date-context`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `parkId` | Int | unique with `date` |
| `date` | DateTime | park date as midnight UTC |
| `tier` | Int? | demand tier 0–5 (higher = busier) |
| `isHoliday` | Boolean | US/CA holiday |
| `isSchoolBreak` | Boolean | SoCal school break |
| `specialEvent` | String? | ticketed event name (e.g. "Oogie Boogie Bash") |
| `tierFetchedAt` | DateTime? | re-fetched after 24 h |
| `tierSource` | String? | `"themeparks-wiki"` |
| `tempHigh` | Float? | °F, Open-Meteo forecast or climatological normal |
| `tempLow` | Float? | °F |
| `precipMm` | Float? | mm |
| `isRainy` | Boolean? | `precipMm ≥ 2.5` |
| `weatherFetchedAt` | DateTime? | |
| `groqDowEstimate`, `groqAdjustment`, `groqReasoning`, `groqAdjustedAt` | | **Unused.** Left from a removed Groq crowd adjuster; nothing reads or writes them. Dropping them needs a migration |

### `Prediction`
**Unused**: not read or written by any current code. Accuracy is computed by joining `DailyForecast` to `WaitTimeRecord`. Dropping it needs a migration.

### `CollectRun`
One row per ml-service job run.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `job` | `JobKind` enum | `collect` \| `train` \| `archive`; default `collect` |
| `ranAt` | DateTime | |
| `rowsUpserted` | Int | rows the run wrote; 0 for failures (the transaction rolled back) |
| `success` | Boolean | |
| `errorMessage` | String? | |

**Rows written before `job` existed (before 2026-09-13):**
- Migration `20260913180000_collect_run_job` backfilled successful runs with ≥ 1,000 rows as `train` (collect writes 50–59 rows, train 65k+).
- Older failed runs can't be told apart, so they read as `collect`.
- Archive runs weren't logged at all.

`/api/forecast` uses only `job = 'collect'` rows for its data-quality flag, and `check_freshness.py` reads the latest successful `train` run. `JobKind` must match `JOBS` in `ml-service/common.py`; a unit test checks. Kept 90 days.

---

## Excluded attractions

Shows, walkthroughs, meet-and-greets and seasonal overlays are excluded by ID and by name in `src/lib/ride-config.json`, which both the website and the Python jobs read. Migration `20261108000000_exclude_non_ride_attractions` deleted their existing rows from every table, and `20261108001000_purge_shared_seasonal_projection_history` removed projection history for four IDs that seasonal overlays share with normal rides. `20261108003000_purge_misclassified_dca_attractions` repeats the DCA purge without a `parkId` filter, because some historic DCA rows had been stamped `parkId = 16`.

Migration `20261108002000_prevent_excluded_attraction_reinsertion` adds `BEFORE INSERT OR UPDATE` triggers on `WaitTimeRecord`, `DailyForecast`, `HourlyWaitSummary`, `RideCatalog`, `RideDayForecast`, `ForecastEvaluation` and `Prediction` that silently skip an excluded row (`RETURN NULL`) and keep the rest of the batch.

**The trigger functions hardcode their own copy of the exclusion list.** Adding an exclusion to `ride-config.json` stops new collection, but the database keeps accepting the attraction until a new migration re-creates the trigger functions (`CREATE OR REPLACE FUNCTION`) with the new list. `ml-service/tests/test_exclusion_triggers.py` compares each function's latest definition with `ride-config.json` and fails CI on any drift. The legacy `Prediction` guard is the exception for names: it lists only seasonal overlays that share an ID with a normal ride, so the test only checks that its names are a subset.

---

## Data API lockdown (RLS)

Supabase serves the `public` schema over its Data API (REST) as the `anon` and `authenticated` roles, and by default grants them full access to whatever `postgres` creates. The app never uses the Data API: Prisma and psycopg connect to Postgres directly.

Migration `20260914020000_lock_down_data_api`:
- enables RLS on every table, with **no policies**;
- revokes all table, sequence and function privileges from `anon` and `authenticated`;
- revokes `postgres`'s default privileges for them.

The app is unaffected: it connects as `postgres`, which owns the tables and has BYPASSRLS. RLS is not FORCEd.

- **New tables must enable RLS in their migration.** `ml-service/tests/integration/test_migrations_db.py::test_every_table_in_the_migrated_database_has_rls` fails CI otherwise.
- **Keep the Data API turned off** (Dashboard → Project Settings → Data API). That also covers objects created by `supabase_admin`, whose default privileges the migration can't change.

Verify on production:

```sql
SET ROLE anon;
SELECT count(*) FROM "WaitTimeRecord";   -- ERROR: permission denied
RESET ROLE;
```

---

## Connections

| Client | Connection |
|---|---|
| App runtime (Vercel) | Transaction pooler, port 6543: `postgresql://postgres.[ref]:[password]@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true` |
| Prisma CLI (migrations) | `prisma.config.ts` rewrites that URL to the session pooler, port 5432 |
| ml-service jobs (psycopg) | `DATABASE_URL`, else `DIRECT_URL`, through `common.connect()`. Prisma-only query params are stripped, and prepared statements are disabled because they collide behind the pooler |
| Direct | `postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require`. **IPv6-only**: from networks without IPv6 (most home connections, GitHub-hosted runners) use the session pooler |

**Egress:** every row a query returns counts against the 5 GB/month quota. Aggregate in SQL, and never re-read bulk history on a frequent schedule. See [incidents.md](incidents.md).

---

## Schema Changes

Production has Prisma migration history (`0_init` baselined on 2026-09-13; see `prisma/migrations/README.md`).

- **Never run `prisma db push` against production.** It changes the schema without recording a migration, and the next `migrate deploy` fails on drift.
- **Never point `migrate dev` or `migrate reset` at Supabase.** Both can drop data.

Generate migrations against a disposable local database instead:

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
#    Enable RLS on any new table.

# 3. Apply locally, confirm no drift, regenerate the client
npx prisma migrate deploy
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
npx prisma generate
unset DATABASE_URL

# 4. After review, apply to production (uses .env.local)
npx prisma migrate deploy
```

- **CI** applies every migration to an empty Postgres 17 and fails on drift (the `ml-integration` job).
- **Never edit an applied migration.** Its checksum changes, and `migrate dev` then treats it as modified.
- **Deploy order:** apply a migration before merging code that depends on it. The ml-service jobs run from `main` every 30 minutes, so code that writes a new column fails every run until that column exists.

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

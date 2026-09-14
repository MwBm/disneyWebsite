# Runbook: Python ML Pipeline (`ml-service/`)

Single-shot Python jobs run from GitHub Actions; there is no HTTP server.

- `collect.py` runs every 30 minutes and only records live waits.
- `train.py` runs daily, trains per-ride XGBoost models and writes every `DailyForecast` row.
- `archive.py` runs weekly and rolls old raw rows up into hourly buckets.

---

## Local Setup

```bash
cd ml-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL="<Supabase session pooler URL, port 5432>"
python collect.py   # writes one WaitTimeRecord window
python train.py     # writes the 30-day forecast window
```

Jobs use `DATABASE_URL`, falling back to `DIRECT_URL`. `common.normalize_db_url` strips the Prisma-only query parameters (`pgbouncer`, `connection_limit`, `pool_timeout`, `schema`), so one secret works for both Prisma and psycopg. Supabase's direct host is IPv6-only; from a network without IPv6, use the pooler.

**Mac note:** XGBoost requires OpenMP. If you get a `libxgboost.dylib` load error, run `brew install libomp`.

---

## Files

| File | Purpose |
|---|---|
| `collect.py` | 30-min job: queue-times.com → `WaitTimeRecord`. Writes only; never reads |
| `train.py` | Daily job: `pipeline.generate_forecasts` → 30 days of `DailyForecast` (the only writer of forecasts) |
| `archive.py` | Weekly job, entirely in SQL. Folds raw rows older than 30 days (hour-aligned) into `HourlyWaitSummary`, merging existing buckets, and deletes forecasts older than 35 days |
| `check_freshness.py` | Daily monitor run from collect.yml; see [runbook-cron.md](runbook-cron.md#forecast-freshness-check-freshness-job) |
| `pipeline.py` | Training-data reads, lag and cross-ride features, forecast slots and upsert |
| `model.py` | `train_ride_models`, `predict_for_ride`, crowd score: XGBoost per ride |
| `common.py` | Shared settings (`PARK_TZ`, `WINDOW_MINUTES`, retention days, `JOBS`), DB URL handling, `connect()`, `run_logged_job()` |
| `schemas.py` | Pydantic models (`RideHistory`, `RideForecast`, `DateContext`, `LagFeatures`) |
| `import_dca_kaggle_history.py` | One-time importer for the DCA Kaggle dataset → `HourlyWaitSummary` |
| `requirements.txt` | Runtime dependencies; what the Actions jobs install |
| `requirements-dev.txt` | `requirements.txt` plus pytest and PyYAML, for CI and local development |

---

## Collection (`collect.py`)

1. Load park configs from `src/lib/ride-config.json` (queue-times URLs, excluded ride IDs)
2. `GET` queue-times.com for each park. Zero rides across all parks is a failure, because the API lists rides even while the parks are closed
3. `INSERT … ON CONFLICT ("rideId", "windowedAt") DO UPDATE` → `WaitTimeRecord`
4. Insert a `CollectRun` success row in the same transaction

It never reads from the database: at 48 runs a day, any read is multiplied against the 5 GB/month egress quota. `tests/test_collect.py::test_main_runs_only_its_two_writes_and_never_reads` fails if a read creeps in.

## Forecasting (`train.py` → `pipeline.generate_forecasts`)

1. Build 30 Pacific days of 30-minute slots, 08:00–23:30. If there are no slots, return 0 before any read
2. `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`, so every read sees one snapshot even if archive commits mid-run. It must be the transaction's first statement
3. `fetch_training_history`:
   - **every** unarchived `WaitTimeRecord` row, plus 3 years of `HourlyWaitSummary`;
   - rows carry ride IDs only, and names come from one `DISTINCT ON` lookup;
   - archive moves rows between the two tables atomically, so there is no gap or overlap however late it runs;
   - about 14 MB per run.
4. Attach `DateContext`, lag features and cross-ride features to each record
5. `train_ride_models(history)`: one model per ride. If no model trains at all, raise, so an empty forecast is never reported as a success
6. Fetch `DateContext` and lag features for the slots; `predict_for_ride(...)`, one XGBoost call per ride
7. `upsert_forecasts()`: `ON CONFLICT ("rideId", "forecastFor") DO UPDATE`

train.yml runs at 06:00 UTC (23:00 Pacific in summer), so each run writes tonight's last slots plus the next 29 days. Today's daytime slots come from the previous night's run.

## Archive (`archive.py`)

One transaction, one data statement, two counts read back:

1. `DELETE FROM "WaitTimeRecord" … RETURNING` feeds an aggregate `INSERT INTO "HourlyWaitSummary"`, bucketed by (ride, park date, park hour) with the latest ride name. The cutoff is `now − 30 days` truncated to the hour, so no hour is ever split
2. On conflict, the existing bucket is merged: `avgWait` weighted by `sampleCount`, max `peakWait`, summed `sampleCount`, OR'd `isOpen`, latest names
3. `DELETE FROM "DailyForecast"` for slots older than `FORECAST_RETENTION_DAYS` (35)

## Run logging (`common.run_logged_job`)

`collect`, `train` and `archive` all run inside `run_logged_job(job, work)`:

- **Success:** the work and its `CollectRun` success row (with `job` set) share one transaction, so a run is recorded as successful only when its rows commit.
- **Failure:** any exception rolls back. The failure is logged on a fresh autocommit connection with `rowsUpserted = 0` and the error message, and the job exits 1 so GitHub fails the run.
- **Timeouts:** connections time out after `CONNECT_TIMEOUT_SECONDS` (15) instead of hanging until the workflow timeout.
- **Pooler:** `connect()` disables psycopg prepared statements, which collide behind Supabase's pooler.

---

## Model (`model.py`)

### Training

`train_ride_models(records)`:

- Uses open records only, grouped by `ride_id`
- A ride with fewer than `MIN_SAMPLES` (200) records falls back to per-hour mean waits, with confidence `FALLBACK_CONFIDENCE` (0.3)
- Otherwise it runs expanding-window walk-forward CV (`TimeSeriesSplit`, 4 folds, every validation fold strictly after its training data) to get `cv_mae_minutes`, then fits on all of the ride's data
- `XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.1, subsample=0.8, colsample_bytree=0.8, random_state=42, n_jobs=1)`
- Returns `Dict[ride_id, TrainedModel]` (`model`, `confidence`, `cv_mae_minutes`, `hour_means`, `global_mean`)

**Confidence** = `clip(1 − cv_mae / max(global_mean, 1), 0, 1)`. If no CV fold was possible, it is 0.3, never 1.0.

**Headliners:** `headlinerRideIds` in `ride-config.json` when set; otherwise the top quartile of rides by mean wait.

### Features (23, in `FEATURE_NAMES` order)

| Feature | Notes |
|---|---|
| `hour` | Park-local hour (0–23) |
| `weekday` | 0 = Monday … 6 = Sunday |
| `month` | 1–12 |
| `is_weekend` | 1.0 on Saturday/Sunday |
| `tier` | Disney demand tier 0–5; 0 without context |
| `has_special_event` | 1.0 if a ticketed event |
| `is_holiday` | 1.0 if a US/CA holiday |
| `is_school_break` | 1.0 during a SoCal school break |
| `temp_high` | Forecast high °F; default 75.0 |
| `temp_range` | `temp_high − temp_low`; default 20.0 |
| `is_rainy` | 1.0 if precipMm ≥ 2.5 |
| `precip_mm` | Total precipitation, mm |
| `is_extreme_heat` | 1.0 if temp_high > 95°F |
| `hour_x_weekday`, `hour_x_weekend`, `month_x_weekday`, `month_x_school_break` | Interaction terms |
| `lag_7d_wait`, `lag_14d_wait` | Same ride, same park hour, 7 and 14 days earlier; 0.0 when missing |
| `rolling_7d_mean`, `rolling_7d_std` | Same ride and park hour over the previous 7 days; 0.0 when missing, **never** the record's own wait (that would leak the label) |
| `pct_rides_open` | Fraction of rides open in that park hour. For future slots: the training mean for that hour |
| `is_headliner_open` | 1.0 if any headliner was open in that hour. For future slots: the training mean for that hour |

Imputing the two cross-ride features from the training profile, instead of a constant 1.0, keeps training and prediction on the same distribution.

### Prediction

- `predict_for_ride(tm, ride_id, slots, contexts, lag_features_list)` predicts every slot for one ride in one call.
  - Predictions are clipped to 0–300 minutes.
  - Empty `slots` returns `[]`.
  - Mismatched list lengths raise `ValueError`.
- `predict_for_date(records, target_date, ctx)` trains and predicts one slot; the tests use it.

### Crowd score

`_compute_crowd_score(forecasts, context)` computes, per slot:

```
avg_wait   = mean(min(predicted_wait, 120))
ride_ratio = min(len(forecasts) / 24, 1)
score      = min(avg_wait × ride_ratio / 120 × 100, 100) × (1 + tier × 0.08), capped at 100
```

120, 24 and 0.08 come from `ride-config.json` (`crowdMaxWait`, `crowdExpectedRides`, `tierMultiplierStep`), which `src/lib/crowd.ts` also reads.

---

## DCA Kaggle Historical Import

One-time backfill of DCA history into `HourlyWaitSummary`:

```bash
cd ml-service
python import_dca_kaggle_history.py                        # needs DATABASE_URL
python import_dca_kaggle_history.py --dry-run --limit 1000 # parse only
```

It downloads `tivory27/disney-california-adventure-wait-times`, maps DCA ride names (including seasonal aliases) to queue-times ride IDs, drops zero waits and excluded rides, and inserts hourly buckets with `ON CONFLICT DO NOTHING`, so reruns are safe. Kaggle rows have no `DateContext`, so their tier, holiday and weather features take the defaults.

---

## Running Tests

```bash
cd ml-service
python -m pytest -q                  # unit tests
python -m pytest -m integration      # needs a local Postgres; see runbook-tests.md
```

See [runbook-tests.md](runbook-tests.md#pytest-ml-service) for what each file covers.

---

## Deploy

There is no deploy step. The jobs run from `main` on `ubuntu-latest` runners, so a merged commit takes effect on the next run. A job that depends on a new column needs its migration applied first; see [runbook-database.md](runbook-database.md#schema-changes).

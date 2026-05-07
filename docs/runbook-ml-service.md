# Runbook: Python ML Pipeline (`ml-service/`)

Single-shot Python script. Run on demand from GitHub Actions (manual dispatch). Fetches live waits, upserts records, trains per-ride XGBoost models, writes 30-day forecasts. No HTTP server.

---

## Local Setup

```bash
cd ml-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL="$DIRECT_URL" python collect.py
```

Uses Supabase `DIRECT_URL` (port 5432) — pgbouncer query param is stripped automatically if present.

**Mac note:** XGBoost requires OpenMP. If you get a `libxgboost.dylib` load error, run `brew install libomp`.

---

## Files

| File | Purpose |
|---|---|
| `collect.py` | End-to-end pipeline: queue-times → DB upsert → ML → DB insert |
| `model.py` | `train_ride_models(records)` + `predict_for_slot(models, slot, ctx)` — XGBoost per ride |
| `archive.py` | Aggregates `WaitTimeRecord` >30 days into `HourlyWaitSummary` |
| `import_dca_kaggle_history.py` | One-time importer for the DCA Kaggle dataset → `HourlyWaitSummary` |
| `schemas.py` | Pydantic models (`RideHistory`, `RideForecast`, `DateContext`) |
| `requirements.txt` | xgboost, scikit-learn, numpy, pydantic, httpx, kagglehub, psycopg, pytest |

---

## Pipeline (`collect.py`)

1. Load park configs from `src/lib/ride-config.json` (park URLs, excluded ride IDs)
2. `GET` queue-times.com for each park — flat list of rides with wait times
3. `INSERT ... ON CONFLICT (rideId, windowedAt) DO UPDATE` per ride → `WaitTimeRecord`
4. Fetch training data: last 30 days of `WaitTimeRecord` + all `HourlyWaitSummary` (up to 3 years)
5. Attach `DateContext` (tier, holiday, weather) to each training record
6. `train_ride_models(history)` — one XGBRegressor per ride
7. Delete stale `DailyForecast` rows for the target slots (prevents drift from old predictions)
8. Build 30 Pacific-aligned days of 30-min slots, skipping midnight–8 AM (low signal)
9. `predict_for_slot(models, slot, ctx)` for each slot → list of `RideForecast` + crowd score
10. Bulk insert all rows into `DailyForecast`
11. Insert `CollectRun` row with success/error

Errors caught at top level → logged to `CollectRun` with `success=false`, then exit 1 so GitHub fails the job.

---

## Model (`model.py`)

### Training

`train_ride_models(records)` — call once, predict for many slots:

- Filters to `is_open=True`
- Groups by `ride_id`
- Falls back to historical hour-means if ride has < 30 training samples (confidence = 0.3)
- Trains `xgb.XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.1, subsample=0.8, colsample_bytree=0.8)` per ride

### Features (14 total)

| Index | Feature | Notes |
|---|---|---|
| 0 | `hour` | Park local hour (0–23) |
| 1 | `weekday` | 0=Monday…6=Sunday |
| 2 | `month` | 1–12 |
| 3 | `is_weekend` | 1.0 if Saturday/Sunday |
| 4 | `tier` | Disney LLMP tier 0–5; 0 if no context |
| 5 | `has_special_event` | 1.0 if ticketed event |
| 6 | `is_holiday` | 1.0 if US/CA holiday |
| 7 | `is_school_break` | 1.0 if SoCal school break |
| 8 | `temp_high` | Forecast high °F; default 75.0 |
| 9 | `is_rainy` | 1.0 if precipMm ≥ 2.5 |
| 10 | `hour × weekday` | Interaction term |
| 11 | `hour × is_weekend` | Interaction term |
| 12 | `month × weekday` | Seasonal interaction |
| 13 | `month × is_school_break` | Seasonal interaction |

### Crowd Score

`crowd_score = min(effective_wait / 120 * 100 * tier_multiplier, 100)`

- `effective_wait` = mean(min(predicted_wait, 120)) × (open_rides / 24)
- `tier_multiplier` = 1.0 + tier × 0.08 (tier 5 → 1.4×)
- Must stay in sync with `src/lib/crowd.ts` constants (`MAX_WAIT=120`, `EXPECTED_RIDES=24`)

### Confidence

`1 - std(residuals) / mean(wait)`, clipped to [0, 1]. Fallback: 0.3.

### Backward-compatible wrapper

`predict_for_date(records, target_date, ctx)` — trains fresh and predicts in one call. Used by tests and ad hoc callers.

---

## DCA Kaggle Historical Import

One-time backfill of DCA historical data into `HourlyWaitSummary`:

```bash
cd ml-service
DATABASE_URL="$DIRECT_URL" python import_dca_kaggle_history.py
```

For a local parse-only smoke test:

```bash
python import_dca_kaggle_history.py --dry-run --limit 1000
```

Downloads `tivory27/disney-california-adventure-wait-times`, maps DCA ride names to queue-times ride IDs, inserts hourly aggregate buckets with `ON CONFLICT DO NOTHING`. Reruns are safe.

**Note:** Kaggle records have no `DateContext` attached (tier/holiday/weather default to 0/false/75°F during training). Weather features will learn signal only from records collected after weather sync began.

---

## Running Tests

```bash
cd ml-service
pytest tests/ -v
```

Tests cover: prediction range, XGBoost training, weather features, DateContext propagation, fallback on <30 samples, closed ride exclusion, crowd score 0–100, archive logic, and Kaggle importer.

---

## Deploy

No deploy step. The script lives in the repo and runs inside `ubuntu-latest` GitHub Actions runners. Update behavior by pushing a new commit — next dispatch picks it up.

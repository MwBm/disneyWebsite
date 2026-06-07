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
| `train.py` | Daily full-window job: load all history → train → write 30-day `DailyForecast` |
| `collect.py` | 30-min intraday job: queue-times → DB upsert → quick ML retrain → today's slots |
| `model.py` | `train_ride_models(records)` + `predict_for_ride(tm, ride_id, slots, ...)` — XGBoost per ride |
| `archive.py` | Aggregates `WaitTimeRecord` >30 days into `HourlyWaitSummary` |
| `import_dca_kaggle_history.py` | One-time importer for the DCA Kaggle dataset → `HourlyWaitSummary` |
| `schemas.py` | Pydantic models (`RideHistory`, `RideForecast`, `DateContext`, `LagFeatures`) |
| `requirements.txt` | xgboost, scikit-learn, numpy, pydantic, httpx, kagglehub, psycopg, pytest |

---

## Pipeline (`collect.py`)

1. Load park configs from `src/lib/ride-config.json` (park URLs, excluded ride IDs, headliner IDs)
2. `GET` queue-times.com for each park — flat list of rides with wait times
3. `INSERT ... ON CONFLICT (rideId, windowedAt) DO UPDATE` per ride → `WaitTimeRecord`
4. Fetch training data: last `RAW_RETENTION_DAYS` of `WaitTimeRecord` + all `HourlyWaitSummary`
5. Attach `DateContext` (tier, holiday, weather), lag features, and cross-ride features to each training record
6. `train_ride_models(history)` — one XGBRegressor per ride (walk-forward CV)
7. Build forecast slots (today's intraday window), fetch `DateContext` + lag map
8. `predict_for_ride(tm, ride_id, slots, ...)` for each trained ride
9. `upsert_forecasts()` → upsert `DailyForecast` rows (ON CONFLICT updates in place)
10. `log_collect_run()` → insert `CollectRun` row with success/error

Errors caught at top level → logged to `CollectRun` with `success=false`, then exit 1 so GitHub fails the job.

---

## Model (`model.py`)

### Training

`train_ride_models(records)` — call once, predict for many slots:

- Filters to `is_open=True`
- Groups by `ride_id`
- Falls back to historical hour-means if ride has < 200 training samples (confidence = 0.3)
- Runs walk-forward CV (80/20 time split) to compute honest `cv_mae_minutes`
- Trains `xgb.XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.1, subsample=0.8, colsample_bytree=0.8, random_state=42, n_jobs=1)` per ride on full data
- Returns `Dict[ride_id, TrainedModel]` where `TrainedModel` holds `model`, `confidence`, `cv_mae_minutes`, `hour_means`, `global_mean`

### Features (23 total)

| Feature | Notes |
|---|---|
| `hour` | Park local hour (0–23) |
| `weekday` | 0=Monday…6=Sunday |
| `month` | 1–12 |
| `is_weekend` | 1.0 if Saturday/Sunday |
| `tier` | Disney LLMP tier 0–5; 0 if no context |
| `has_special_event` | 1.0 if ticketed event |
| `is_holiday` | 1.0 if US/CA holiday |
| `is_school_break` | 1.0 if SoCal school break |
| `temp_high` | Forecast high °F; default 75.0 |
| `temp_range` | `temp_high − temp_low`; default 20.0 |
| `is_rainy` | 1.0 if precipMm ≥ 2.5 |
| `precip_mm` | Total precipitation in mm |
| `is_extreme_heat` | 1.0 if temp_high > 95°F |
| `hour_x_weekday` | Interaction term |
| `hour_x_weekend` | Interaction term |
| `month_x_weekday` | Seasonal interaction |
| `month_x_school_break` | Seasonal interaction |
| `lag_7d_wait` | Same ride, same hour, 7 days prior |
| `lag_14d_wait` | Same ride, same hour, 14 days prior |
| `rolling_7d_mean` | 7-day rolling mean wait for this ride |
| `rolling_7d_std` | 7-day rolling std dev |
| `pct_rides_open` | Fraction of rides open park-wide |
| `is_headliner_open` | 1.0 if any headliner ride (from `ride-config.json`) is open |

### Crowd Score

`crowd_score = min(effective_wait / 120 * 100 * tier_multiplier, 100)`

- `effective_wait` = mean(min(predicted_wait, 120)) × (open_rides / 24)
- `tier_multiplier` = 1.0 + tier × 0.08 (tier 5 → 1.4×)
- Must stay in sync with `src/lib/crowd.ts` constants (`MAX_WAIT=120`, `EXPECTED_RIDES=24`)

### Confidence

Walk-forward CV MAE → `confidence = 1 - cv_mae / global_mean`, clipped to [0.3, 1]. Fallback rides (< 200 samples): confidence = 0.3.

### Batch prediction

`predict_for_ride(tm, ride_id, slots, contexts, lag_features_list)` — vectorized batch prediction over many slots for one ride. Used by both `train.py` and `collect.py`.

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

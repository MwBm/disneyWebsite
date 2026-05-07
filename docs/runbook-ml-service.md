# Runbook: Python ML Pipeline (`ml-service/`)

Single-shot Python script. Runs from GitHub Actions every 30 min. Fetches live waits, upserts records, trains per-ride regression, writes forecasts. No HTTP server.

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

---

## Files

| File | Purpose |
|---|---|
| `collect.py` | End-to-end cron pipeline: queue-times → DB upsert → ML → DB insert |
| `model.py` | `train_ride_models(records)` + `predict_for_slot(models, target_date)` — Ridge regression per ride |
| `import_dca_kaggle_history.py` | One-time importer for the DCA Kaggle history dataset → `HourlyWaitSummary` |
| `schemas.py` | Pydantic models (`RideHistory`, `RideForecast`) |
| `requirements.txt` | scikit-learn, numpy, pydantic, httpx, kagglehub, psycopg, pytest |

---

## Pipeline (`collect.py`)

1. `GET https://queue-times.com/en-US/parks/16/queue_times.json`
2. `INSERT ... ON CONFLICT (rideId, windowedAt) DO UPDATE` per ride into `WaitTimeRecord`
3. `SELECT` last 90 days of `WaitTimeRecord` rows
4. Train one model set, then loop 30 days of Pacific-aligned 30-min slots. For each slot:
   - `predict_for_slot(models, slot)` → list of `(ride_id, predicted_wait, confidence)` + crowd score
5. Bulk `INSERT` all rows into `DailyForecast`
6. `INSERT` `CollectRun` row with success/error

Errors caught at top level → logged to `CollectRun` with `success=false`, then exit 1 so GitHub fails the job.

---

## Model (`model.py`)

`train_ride_models(records)` / `predict_for_slot(models, target_date)`:

- Filters to `is_open=True`
- Groups by `ride_id`
- Trains scikit-learn `Ridge` regression per ride
- Features use Disneyland local time: `hour`, `day_of_week`, `month`, `is_weekend`
- Falls back to historical mean if ride has < 30 training samples
- `crowd_score` = mean of predicted waits (each ride capped at 120) scaled to 0–100

`predict_for_date(records, target_date)` remains as a backward-compatible one-shot wrapper for tests or ad hoc callers.

---

## DCA Kaggle Historical Import

The DCA-only Kaggle dataset can be imported directly into `HourlyWaitSummary`:

```bash
cd ml-service
pip install -r requirements.txt
DATABASE_URL="$DIRECT_URL" python import_dca_kaggle_history.py
```

The script downloads `tivory27/disney-california-adventure-wait-times`, uses
`disney_wait_times.csv`, maps known DCA ride names to queue-times ride IDs,
skips excluded rides and zero-wait rows, and inserts hourly aggregate buckets
with `ON CONFLICT DO NOTHING` so reruns do not overwrite existing archive data.

For a local parse-only smoke test:

```bash
python import_dca_kaggle_history.py --dry-run --limit 1000
```

---

## Running Tests

```bash
cd ml-service
pytest tests/ -v
```

Tests cover: valid prediction range, fallback on <30 samples, closed ride exclusion, crowd score 0–100 range.

---

## Deploy

No deploy step. The script lives in the repo and runs inside `ubuntu-latest` GitHub Actions runners. Update behavior by pushing a new commit — next scheduled run picks it up.

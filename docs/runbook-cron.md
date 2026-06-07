# Runbook: GitHub Actions Workflows (`.github/workflows/`)

---

## Workflows Overview

| Workflow | Trigger | Purpose |
|---|---|---|
| `train.yml` | Daily 06:00 UTC + dispatch | Full model retrain on all history, write 30-day forecast window |
| `collect.yml` | Manual dispatch only | Fetch live waits, upsert WaitTimeRecord (no ML training) |
| `archive.yml` | Weekly Sunday 09:00 UTC | Archive WaitTimeRecord >30 days → HourlyWaitSummary |
| `sync-date-context.yml` | Monthly 1st 10:00 UTC + dispatch | Sync tier/holiday/weather/Groq adjustment |
| `import-dca-history.yml` | Manual dispatch only | One-time DCA Kaggle historical backfill |

---

## `train.yml` — Daily Model Training

**Trigger:** Daily at 06:00 UTC (10 PM Pacific, before park opens). Also manually dispatchable. Timeout: 20 minutes.

Runs `python train.py`. Full pipeline:

1. Load all training history: last `RAW_RETENTION_DAYS` of `WaitTimeRecord` + all `HourlyWaitSummary`
2. Attach `DateContext`, lag features, and cross-ride features to each training record
3. `train_ride_models(history)` — XGBoost per ride with walk-forward CV
4. Generate 30 Pacific-aligned days of forecast slots
5. `upsert_forecasts()` → bulk upsert `DailyForecast` rows
6. Log to `CollectRun`

**Required secret:** `DATABASE_URL`.

---

## `collect.yml` — Data Collection

**Trigger:** Manual dispatch only. Intended for on-demand intraday data collection (can be wired to a 30-min schedule via `cron-job.org` or a `schedule:` block).

To enable automatic collection, add a `schedule` block to `collect.yml`:
```yaml
on:
  schedule:
    - cron: '*/30 * * * *'
  workflow_dispatch:
```

**What it does:** Fetch live waits + quick ML retrain to update **today's** intraday `DailyForecast` slots. Full 30-day window is owned by `train.yml`.

1. Checkout repo, setup Python 3.11 with pip cache
2. `pip install -r ml-service/requirements.txt`
3. Run `python collect.py`

`collect.py` pipeline:

1. Load park configs from `src/lib/ride-config.json`
2. `GET` queue-times.com for each park, fetch live ride waits
3. `INSERT ... ON CONFLICT` upsert each ride into `WaitTimeRecord`
4. Pull training data: `WaitTimeRecord` (raw retention window) + all `HourlyWaitSummary`
5. Attach `DateContext`, lag features, and cross-ride features to training records
6. Train XGBoost model per ride on combined history
7. Upsert `DailyForecast` rows for today's intraday slots
8. Log result to `CollectRun`

Job times out after 10 minutes. Errors logged to `CollectRun` with `success=false`.

**Required secret:** `DATABASE_URL` (Supabase direct URL, port 5432, `?sslmode=require`).

---

## `archive.yml` — Weekly Archival

**Trigger:** Every Sunday at 09:00 UTC (1–2am Pacific, outside park hours). Also manually dispatchable.

Runs `python archive.py`. Aggregates `WaitTimeRecord` rows older than 30 days into `HourlyWaitSummary` (hourly averages per ride per day), then deletes the raw rows. Keeps training data footprint bounded while preserving multi-year signal.

**Required secret:** `DATABASE_URL`.

---

## `sync-date-context.yml` — Date Context Sync

**Trigger:** 1st of each month at 10:00 UTC. Also manually dispatchable.

Calls `GET /api/cron/sync-date-context` (the Vercel endpoint, not a direct Python script).

**What the endpoint does:**

1. Fetch park schedule from ThemeParks.wiki API (park hours + LLMP price → tier 0–5)
2. Fetch 16-day weather forecast from Open-Meteo (free, no API key, Anaheim coords)
3. Apply climatological fallback for dates beyond 16-day window
4. Upsert `DateContext` rows (tier, holiday, school break, weather fields)
5. Call Groq adjuster for each date with no `groqAdjustment` yet → store `groqAdjustment` ± 20 + `groqReasoning`

Non-fatal: Groq failure for one date does not abort the others.

**Required secrets:** `CRON_SECRET`, `APP_URL`.

---

## `import-dca-history.yml` — Kaggle Backfill

**Trigger:** Manual dispatch only. One-time operation.

Runs `python import_dca_kaggle_history.py` (optionally with `--dry-run`). Inserts into `HourlyWaitSummary` with `ON CONFLICT DO NOTHING` — safe to re-run.

**Required secret:** `DATABASE_URL`.

---

## Monitoring

Check `CollectRun` table for collect job history:

```sql
SELECT * FROM "CollectRun" ORDER BY "ranAt" DESC LIMIT 10;
```

The `/accuracy` page shows a data-quality indicator if recent collect runs failed.

GitHub also sends email on workflow failure.

---

## Manual Trigger

**Via GitHub UI:** Actions tab → select workflow → Run workflow.

**Locally (train — full 30-day window):**
```bash
cd ml-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL="$DIRECT_URL" python train.py
```

**Locally (collect — intraday update):**
```bash
cd ml-service
DATABASE_URL="$DIRECT_URL" python collect.py
```

**Locally (sync-date-context):**
```bash
curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$APP_URL/api/cron/sync-date-context"
```

---

## Disabling

Comment out or remove the `schedule:` block in the relevant workflow file to pause without deleting it.

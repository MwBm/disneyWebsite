# Runbook: GitHub Actions Workflows (`.github/workflows/`)

---

## Workflows Overview

| Workflow | Trigger | Purpose |
|---|---|---|
| `collect.yml` | Manual dispatch only | Fetch live waits, run ML, write forecasts |
| `archive.yml` | Weekly Sunday 09:00 UTC | Archive WaitTimeRecord >30 days → HourlyWaitSummary |
| `sync-date-context.yml` | Monthly 1st 10:00 UTC + dispatch | Sync tier/holiday/weather/Groq adjustment |
| `import-dca-history.yml` | Manual dispatch only | One-time DCA Kaggle historical backfill |

---

## `collect.yml` — Data Collection

**Trigger:** Manual dispatch (`workflow_dispatch` only — no automatic schedule).

To re-enable automatic collection, add a `schedule` block to `collect.yml`:
```yaml
on:
  schedule:
    - cron: '*/30 * * * *'
  workflow_dispatch:
```

**What it does:**

1. Checkout repo, setup Python 3.11 with pip cache
2. `pip install -r ml-service/requirements.txt`
3. Run `python collect.py`

`collect.py` pipeline:

1. Load park configs from `src/lib/ride-config.json`
2. `GET` queue-times.com for each park, fetch live ride waits
3. `INSERT ... ON CONFLICT` upsert each ride into `WaitTimeRecord`
4. Pull training data: last 30 days of `WaitTimeRecord` + all `HourlyWaitSummary` (up to 3 years)
5. Attach `DateContext` (tier, holiday, weather) to each training record
6. Train XGBoost model per ride on combined history
7. Delete stale `DailyForecast` rows for target slots
8. Predict 30 Pacific-aligned days of 30-min slots
9. Bulk insert `DailyForecast` rows
10. Log result to `CollectRun`

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

**Locally (collect):**
```bash
cd ml-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
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

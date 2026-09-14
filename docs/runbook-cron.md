# Runbook: GitHub Actions Workflows (`.github/workflows/`)

---

## Workflows Overview

| Workflow | Trigger | Purpose |
|---|---|---|
| `train.yml` | Daily 06:00 UTC + dispatch | Full model retrain on all history, write 30-day forecast window |
| `collect.yml` | Dispatch every 30 min (cron-job.org) | Fetch live waits, upsert WaitTimeRecord (no reads, no ML training) |
| `archive.yml` | Weekly Sunday 09:00 UTC | Archive WaitTimeRecord >30 days → HourlyWaitSummary |
| `sync-date-context.yml` | Monthly 1st 10:00 UTC + dispatch | Sync tier/holiday/weather/Groq adjustment |
| `import-dca-history.yml` | Manual dispatch only | One-time DCA Kaggle historical backfill |

---

## `train.yml` — Daily Model Training

**Trigger:** Daily at 06:00 UTC (11 PM Pacific in summer, 10 PM in winter — after the parks close). Also manually dispatchable. Timeout: 20 minutes.

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

**Trigger:** `workflow_dispatch` only, fired every 30 minutes by a cron-job.org job (~48 runs/day). Timeout: 10 minutes.

Do not replace cron-job.org with a `schedule:` block. GitHub disables scheduled workflows in public repositories after 60 days without repository activity (a dispatch doesn't count), which is how `train`, `archive` and `sync-date-context` all silently stopped in August 2026. Dispatch-triggered workflows are not affected.

**What it does:** records live waits. Nothing else — it reads nothing from the database and trains nothing.

1. Checkout repo, setup Python 3.11 with pip cache
2. `pip install -r ml-service/requirements.txt`
3. Run `python collect.py`:
   1. `GET` queue-times.com for each park in `src/lib/ride-config.json`, dropping excluded rides
   2. Upsert `WaitTimeRecord` (`ON CONFLICT (rideId, windowedAt)`), plus a `CollectRun` success row in the same transaction
   3. On any error (queue-times down, zero rides, DB failure): roll back, log `CollectRun` with `success=false`, exit 1

Until September 2026 this job also reloaded the whole training history and retrained every model on each run, to refresh today's forecast slots. That read 20–28 MB per run and used 16.5 GB of the Supabase Free plan's 5 GB monthly egress quota, restricting the project. `train.yml` now owns all forecasts.

### Keepalive (`keep-schedules-enabled` job)

Runs `gh workflow enable` for every workflow in `SCHEDULED_WORKFLOWS` on each collect dispatch, using the job's `GITHUB_TOKEN` with `actions: write` (the only job with that permission). If GitHub disables a scheduled workflow for inactivity, it is re-enabled within 30 minutes. `tests/test_workflows.py` fails when a workflow gains a `schedule:` trigger without being added to the list.

### Forecast freshness (`check-freshness` job)

Runs `ml-service/check_freshness.py`. Outside 12:00–12:30 UTC it exits immediately; inside, it fails the run (one GitHub email a day) when:

- the latest successful `CollectRun` with `job='train'` is older than 24 h (a single missed nightly run), or
- `DailyForecast` ends less than 27 days ahead (a healthy run writes 29).

Dispatch with `check_freshness: true` to check immediately: `gh workflow run collect.yml -f check_freshness=true`.

**Required secret:** `DATABASE_URL`.

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

Check `CollectRun` for job history:

```sql
SELECT job, "ranAt", success, "rowsUpserted", "errorMessage"
FROM "CollectRun" ORDER BY "ranAt" DESC LIMIT 20;

-- Latest outcome per job
SELECT DISTINCT ON (job) job, "ranAt", success, "errorMessage"
FROM "CollectRun" ORDER BY job, "ranAt" DESC;
```

`archive` runs are logged since 2026-09-13; before that archive left no trace. Check `gh workflow list --all` for any workflow in `disabled_inactivity` state.

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

**Locally (collect — one wait-time window):**
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

# Runbook: GitHub Actions Workflows (`.github/workflows/`)

---

## Workflows Overview

| Workflow | Trigger | Timeout | Purpose |
|---|---|---|---|
| `collect.yml` | Dispatch every 30 min (cron-job.org) | 10 min | Record live waits; keep scheduled workflows enabled; daily freshness check |
| `train.yml` | Daily 06:00 UTC + dispatch | 20 min | Retrain on all history, write the 30-day forecast window |
| `archive.yml` | Sundays 09:00 UTC + dispatch | 10 min | Raw rows older than 30 days → `HourlyWaitSummary`; delete old forecasts |
| `sync-date-context.yml` | 1st of month 10:00 UTC + dispatch | 10 min | Tier, holiday, weather and Groq adjustments via the Vercel endpoint |
| `import-dca-history.yml` | Dispatch only | 15 min | One-time DCA Kaggle backfill |
| `ci.yml` | Every push and pull request | 5–15 min per job | Types, lint, tests, build, integration suites, actionlint ([runbook-tests.md](runbook-tests.md)) |

The Python jobs need the `DATABASE_URL` secret, and sync-date-context needs `CRON_SECRET` and `APP_URL`. `DATABASE_URL` must be a Supabase pooler URL: GitHub-hosted runners have no IPv6, and the direct database host is IPv6-only.

GitHub disables `schedule:` workflows in public repositories after 60 days without repository activity. Dispatches don't count as activity, but dispatch-triggered workflows are never disabled. Hence collect is dispatch-only and re-enables the rest. See [incidents.md](incidents.md).

---

## `collect.yml`: data collection

**Trigger:** `workflow_dispatch` only, fired every 30 minutes by a cron-job.org job (~48 runs/day). Do not add a `schedule:` block; `tests/test_workflows.py` fails if one appears.

Three jobs:

### `collect`

1. Checkout, set up Python 3.11 with pip cache, `pip install -r ml-service/requirements.txt`
2. `python collect.py`:
   1. `GET` queue-times.com for each park in `src/lib/ride-config.json`, dropping excluded rides
   2. Upsert `WaitTimeRecord` (`ON CONFLICT ("rideId", "windowedAt")`) and a `CollectRun` success row in one transaction
   3. On any error (queue-times down, zero rides, database failure): roll back, log `CollectRun` with `success = false`, exit 1

It reads nothing from the database and trains nothing.

### Keepalive (`keep-schedules-enabled` job)

Runs `gh workflow enable` for every workflow in `SCHEDULED_WORKFLOWS`, using the job's `GITHUB_TOKEN` with `actions: write`. It is the only job with that permission. A workflow GitHub disables is re-enabled within 30 minutes. `tests/test_workflows.py` fails when a workflow with a `schedule:` trigger is missing from the list.

### Forecast freshness (`check-freshness` job)

Runs `ml-service/check_freshness.py`, which writes nothing and reads a single aggregate row. Outside 12:00–12:30 UTC it exits immediately. Inside that window it fails the run (one GitHub email a day) when any of these hold:

- the latest successful `CollectRun` with `job = 'train'` is older than 24 h (one missed nightly run);
- `DailyForecast` ends less than 27 days ahead (a healthy run writes 29);
- the oldest `WaitTimeRecord` row is more than 38 days old (archive has stopped).

To check immediately: `gh workflow run collect.yml -f check_freshness=true`. If GitHub starts two collect runs inside the window, expect two emails that day.

---

## `train.yml`: daily model training

**Trigger:** 06:00 UTC daily (23:00 Pacific in summer, 22:00 in winter, after the parks close), or dispatch.

Runs `python train.py`, logged as `CollectRun.job = 'train'`:

1. Build 30 Pacific days of forecast slots
2. In one `REPEATABLE READ` snapshot, read every unarchived `WaitTimeRecord` row plus 3 years of `HourlyWaitSummary` (ride IDs only, ~14 MB)
3. Attach `DateContext`, lag and cross-ride features
4. Train one XGBoost model per ride with walk-forward CV
5. Upsert `DailyForecast`

Details: [runbook-ml-service.md](runbook-ml-service.md#forecasting-trainpy--pipelinegenerate_forecasts).

---

## `archive.yml`: weekly archival

**Trigger:** Sundays 09:00 UTC (01:00–02:00 Pacific), or dispatch.

Runs `python archive.py`, logged as `CollectRun.job = 'archive'`. One transaction, entirely in Postgres; only two counts are read back.

1. `DELETE … RETURNING` raw `WaitTimeRecord` rows older than `now − 30 days` (truncated to the hour). In the same statement they are aggregated into `HourlyWaitSummary` buckets keyed on (ride, park date, park hour), merging into any bucket that already exists
2. Delete `DailyForecast` rows older than 35 days

Training reads every unarchived raw row, so a late archive loses nothing, but each week it is late grows train's daily read.

---

## `sync-date-context.yml`: date-context sync

**Trigger:** 1st of each month at 10:00 UTC, or dispatch.

Calls `GET $APP_URL/api/cron/sync-date-context` with `Authorization: Bearer $CRON_SECRET`. The endpoint:

1. Fetches the park schedule from ThemeParks.wiki (hours and Lightning Lane price → tier 0–5, plus ticketed events)
2. Fetches Open-Meteo weather for the next 16 days, and uses climatological normals beyond that
3. Upserts `DateContext` rows (tier, holiday, school break, weather) for the next 365 days
4. Asks Groq for a crowd adjustment (±35) for each date that has none, or whose adjustment is older than 7 days

A Groq failure for one date doesn't stop the others. See [runbook-api.md](runbook-api.md#apicronsync-date-context-date-context-sync).

---

## `import-dca-history.yml`: Kaggle backfill

**Trigger:** dispatch only, with an optional `dry_run` input.

Runs `python import_dca_kaggle_history.py`. It inserts into `HourlyWaitSummary` with `ON CONFLICT DO NOTHING`, so it is safe to re-run.

---

## Monitoring

`CollectRun` holds every job run:

```sql
-- Latest outcome per job
SELECT DISTINCT ON (job) job, "ranAt", success, "rowsUpserted", "errorMessage"
FROM "CollectRun" ORDER BY job, "ranAt" DESC;

-- Recent history
SELECT job, "ranAt", success, "rowsUpserted", "errorMessage"
FROM "CollectRun" ORDER BY "ranAt" DESC LIMIT 20;
```

Archive runs are logged from 2026-09-13 onwards; earlier archive runs left no row.

- **Daily:** the `check-freshness` job fails and emails when forecasts or the archive are stale.
- **Any failed workflow:** GitHub sends a failure email.
- **Workflows GitHub disabled:** `gh workflow list --all` shows any in state `disabled_inactivity`.
- **Forecasts API:** `/api/forecast` reports `dataQualityOk: false` when none of the last 3 collect runs succeeded.

---

## Manual Trigger

**Via GitHub UI:** Actions tab → select the workflow → Run workflow.

**Via CLI:**
```bash
gh workflow run train.yml
gh workflow run archive.yml
gh workflow run collect.yml -f check_freshness=true
```

**Locally:** see [runbook-ml-service.md](runbook-ml-service.md#local-setup) for the Python jobs. For the date-context sync:
```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/sync-date-context"
```

---

## Pausing

- **Collect:** pause the cron-job.org job. Collect has no schedule of its own.
- **train, archive, sync-date-context:** `gh workflow disable <file>` alone is undone within 30 minutes by collect's keepalive. Remove the workflow's `schedule:` block and its entry in `SCHEDULED_WORKFLOWS` (`collect.yml`) in the same commit; `tests/test_workflows.py` requires the two to match.

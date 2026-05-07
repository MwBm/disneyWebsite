# Runbook: Data Collection Cron (`.github/workflows/collect.yml`)

---

## Schedule

Runs every 30 minutes: `*/30 * * * *`

Executes `python ml-service/collect.py` directly inside the GitHub Actions runner. No external HTTP service required.

---

## Required GitHub Secrets

Set in repo Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `DATABASE_URL` | Supabase `DIRECT_URL` (port 5432, with `?sslmode=require`) |

The script also accepts `DIRECT_URL` as an alternative variable name. Use the direct connection — `psycopg` does not need pgbouncer.

---

## What the Workflow Does

1. Checkout repo
2. Setup Python 3.11 with pip cache keyed on `ml-service/requirements.txt`
3. `pip install -r ml-service/requirements.txt`
4. `python collect.py`

`collect.py` pipeline:

1. `GET https://queue-times.com/en-US/parks/16/queue_times.json`
2. `INSERT ... ON CONFLICT` upsert each ride into `WaitTimeRecord`
3. Pull last 90 days of `WaitTimeRecord` rows
4. Train Ridge regression per ride, predict each 30-min slot through end of day
5. Bulk insert `DailyForecast` rows
6. Log result to `CollectRun`

Job times out after 10 minutes. Errors get logged to `CollectRun` with `success=false` and `errorMessage`.

---

## Monitoring

Check `CollectRun` table in Supabase for run history:

```sql
SELECT * FROM "CollectRun" ORDER BY "ranAt" DESC LIMIT 10;
```

The `/accuracy` page shows a data-quality indicator if recent runs failed.

GitHub also emails on workflow failure.

---

## Manual Trigger

In GitHub: Actions tab → "Collect Wait Times" → Run workflow.

Or locally:
```bash
cd ml-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL="$DIRECT_URL" python collect.py
```

The one-time DCA Kaggle historical backfill has its own manual workflow:
Actions tab → "Import DCA Kaggle History" → Run workflow. It inserts into
`HourlyWaitSummary`, and the next collect run will train on that history.

---

## Disabling

Comment out or remove the `schedule:` block in `collect.yml` to pause collection without deleting the workflow.

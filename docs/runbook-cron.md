# Runbook: Data Collection Cron (`.github/workflows/collect.yml`)

---

## Schedule

Runs every 30 minutes: `*/30 * * * *`

Calls `POST /api/collect` on the deployed Vercel app.

---

## Required GitHub Secrets

Set in repo Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `COLLECT_SECRET` | Same value as `COLLECT_SECRET` in Vercel env vars |
| `NEXT_PUBLIC_APP_URL` | Deployed Vercel URL e.g. `https://disney-planner.vercel.app` |

---

## What the Workflow Does

```yaml
curl -X POST "$NEXT_PUBLIC_APP_URL/api/collect" \
  -H "Authorization: Bearer $COLLECT_SECRET" \
  --fail
```

Fails the job (non-zero exit) if response is not 2xx. GitHub sends email on failure.

---

## Monitoring

Check `CollectRun` table in Supabase for run history:

```sql
SELECT * FROM "CollectRun" ORDER BY "ranAt" DESC LIMIT 10;
```

The `/accuracy` page shows a data-quality indicator if the last 3 runs failed.

---

## Manual Trigger

In GitHub: Actions tab → "Collect Wait Times" → Run workflow.

Or locally:
```bash
curl -X POST http://localhost:3000/api/collect \
  -H "Authorization: Bearer YOUR_COLLECT_SECRET"
```

---

## Disabling

Comment out or remove the `schedule:` block in `collect.yml` to pause collection without deleting the workflow.

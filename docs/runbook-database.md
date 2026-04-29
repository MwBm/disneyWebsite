# Runbook: Database (`prisma/`)

Supabase PostgreSQL. ORM: Prisma 5. Project ref: `cuzkfncrhdddozdxdcyy`.

---

## Schema

### `WaitTimeRecord`
Raw data collected every 30 min from queue-times.com.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `rideId` | Int | queue-times.com ride ID |
| `rideName` | String | |
| `landName` | String | Fantasyland, Tomorrowland, etc. |
| `waitTime` | Int | minutes |
| `isOpen` | Boolean | false = ride closed |
| `windowedAt` | DateTime | `recordedAt` rounded to nearest 30 min |
| `recordedAt` | DateTime | actual fetch time |

Unique constraint: `(rideId, windowedAt)` — deduplication key. Upsert uses `skipDuplicates`.

### `DailyForecast`
Pre-computed predictions written by `/api/collect` after each ML run.

| Column | Type | Notes |
|---|---|---|
| `forecastFor` | DateTime | future date/time being predicted |
| `predictedWait` | Int | minutes |
| `crowdScore` | Int | 0–100 park-wide score |
| `mlConfidence` | Float | 0–1 from scikit-learn |

### `Prediction`
Historical record of predictions made (for accuracy tracking).

### `CollectRun`
One row per cron execution. Tracks success, rows upserted, error messages.

---

## Connections

**App runtime (Vercel serverless):** Transaction Pooler on port 6543.
```
postgresql://postgres.[ref]:[password]@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Schema migrations:** Direct connection on port 5432 (set as `DIRECT_URL`).
```
postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require
```

---

## Schema Changes

Port 5432 may be blocked on some networks. Use Supabase SQL Editor instead:

1. Write migration SQL
2. Supabase Dashboard → SQL Editor → paste → Run
3. Update `prisma/schema.prisma` to match
4. Run `npx prisma generate` (no network needed — regenerates TS types only)

---

## Useful Commands

```bash
# Regenerate Prisma client (no DB connection needed)
npx prisma generate

# View schema diff (no DB connection needed)
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script

# Push schema to DB (requires direct connection on port 5432)
npx prisma db push
```

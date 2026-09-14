# Disneyland Trip Planner

[![CI](https://github.com/MwBm/disneyWebsite/actions/workflows/ci.yml/badge.svg)](https://github.com/MwBm/disneyWebsite/actions/workflows/ci.yml)

Crowd-level predictor, per-ride wait-time forecaster and accuracy tracker for Disneyland and Disney California Adventure. Live wait times are collected from queue-times.com every 30 minutes, per-ride XGBoost models retrain nightly, and Groq writes the narration and adjusts crowd scores.

## Stack

| Layer              | Tech                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| Frontend + API     | Next.js 16 (App Router, TypeScript) on Vercel                                        |
| Data + ML pipeline | Python 3.11 + XGBoost on GitHub Actions (collect every 30 min, train daily, archive weekly) |
| Database           | Supabase Postgres (Free plan), via Prisma 7 (web) and psycopg 3 (ml-service)         |
| AI                 | Groq API; model IDs in [`src/lib/groq-models.ts`](src/lib/groq-models.ts)            |

## Pages

| Route         | Purpose                                                  |
| ------------- | -------------------------------------------------------- |
| `/`           | Date picker → crowd score (0–100) + AI narration         |
| `/wait-times` | Per-ride average and peak predicted wait for a date      |
| `/calendar`   | Monthly crowd calendar                                   |
| `/accuracy`   | Predicted vs. actual waits over the last 30 days         |
| `/chat`       | Streaming AI chat assistant with live park context       |

## Local Setup

```bash
npm install
# fill in .env.local (see Environment Variables below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tests

```bash
npx tsc --noEmit                       # types
npm run lint                           # eslint
npm test                               # jest: unit, route and component tests
npm run build                          # must succeed without a database

npx playwright install chromium        # one-time, per machine
npm run test:e2e                       # browser e2e on port 3100

cd ml-service
pip install -r requirements-dev.txt
python -m pytest -q                    # ML service unit tests
```

The web SQL tests (`npm run test:integration`) and the ML integration tests need a local Postgres; see [docs/runbook-tests.md](docs/runbook-tests.md). CI runs everything except e2e on every push, including both integration suites against Postgres 17 and `actionlint` on the workflow files.

## Environment Variables

Add to `.env.local`:

```
DATABASE_URL=postgresql://postgres.[ref]:[password]@[pooler-host]:6543/postgres?pgbouncer=true
GROQ_API_KEY=gsk_...
CRON_SECRET=<random secret for /api/cron/* and /api/admin/* authorization>
```

GitHub Actions repo secrets (Settings → Secrets and variables → Actions):

| Secret         | Value                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Supabase pooler connection string. The direct `db.[ref]` host is IPv6-only, and GitHub-hosted runners have no IPv6 |
| `CRON_SECRET`  | Same value as `CRON_SECRET` in Vercel                                                  |
| `APP_URL`      | The Vercel deployment URL (e.g. `https://your-app.vercel.app`)                         |

`CRON_SECRET` is required: `/api/cron/*` and `/api/admin/*` return 500 when it is unset.

The app talks to Postgres directly and never uses Supabase's Data API. Keep it turned off (Supabase dashboard → Project Settings → Data API); see [docs/runbook-database.md](docs/runbook-database.md#data-api-lockdown-rls).

## Docs

| Doc                                                      | Covers                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| [docs/runbook-api.md](docs/runbook-api.md)               | API routes: forecast, calendar, accuracy, chat, live, weather, cron, admin |
| [docs/runbook-lib.md](docs/runbook-lib.md)               | Service layer in `src/lib/`                                            |
| [docs/runbook-components.md](docs/runbook-components.md) | UI components                                                          |
| [docs/runbook-ml-service.md](docs/runbook-ml-service.md) | Python jobs: collect, train, archive, freshness check, model           |
| [docs/runbook-cron.md](docs/runbook-cron.md)             | GitHub Actions workflows and monitoring                                |
| [docs/runbook-database.md](docs/runbook-database.md)     | Schema, migrations, RLS, connections, egress                           |
| [docs/runbook-tests.md](docs/runbook-tests.md)           | Jest, integration suites, Playwright, pytest                           |
| [docs/incidents.md](docs/incidents.md)                   | Past incidents and the rules they left behind                          |

## Architecture

```
Browser
  └── Next.js (Vercel)
        ├── /api/forecast          ← per-ride avg/peak + crowd score for a date (30 req/min)
        ├── /api/calendar          ← monthly crowd scores: ML → historical → Groq estimate (30 req/min)
        ├── /api/accuracy          ← DailyForecast × WaitTimeRecord, aggregated in SQL
        ├── /api/accuracy/rides/:id← chart points for one ride
        ├── /api/chat              ← Groq streaming + live context (10 req/min)
        ├── /api/live              ← live wait times (CDN-cached 5 min)
        ├── /api/weather           ← 16-day Anaheim forecast (CDN-cached 1 h)
        ├── /api/cron/sync-date-context ← DateContext + Groq adjustments (Bearer CRON_SECRET)
        └── /api/admin/date-context     ← DateContext inspection (Bearer CRON_SECRET)

GitHub Actions: collect.yml (dispatched every 30 min by cron-job.org)
  ├── ml-service/collect.py         ← queue-times.com → WaitTimeRecord; writes only, never reads
  ├── keep-schedules-enabled        ← re-enables scheduled workflows GitHub disables for inactivity
  └── ml-service/check_freshness.py ← fails once a day (12:00 UTC) if forecasts or the archive are stale

GitHub Actions: train.yml (daily 06:00 UTC)
  └── ml-service/train.py
        ├── Every unarchived WaitTimeRecord row + 3 years of HourlyWaitSummary, one snapshot
        ├── DateContext + lag + cross-ride features (23 total)
        ├── XGBoost per ride, expanding-window walk-forward CV
        └── Upsert 30 days of DailyForecast

GitHub Actions: archive.yml (Sundays 09:00 UTC)
  └── ml-service/archive.py
        ├── WaitTimeRecord older than 30 days → HourlyWaitSummary (one statement, merges buckets)
        └── Delete DailyForecast older than 35 days

GitHub Actions: sync-date-context.yml (1st of each month, 10:00 UTC)
  └── GET /api/cron/sync-date-context
        ├── ThemeParks.wiki (park hours + Lightning Lane price → tier)
        ├── Open-Meteo (16-day forecast), climatological normals beyond it
        └── Groq adjuster (bounded ±35 points on the ML crowd score)

Every job logs to CollectRun (job = collect | train | archive).
```

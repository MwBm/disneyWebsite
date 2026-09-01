# Disneyland Trip Planner

[![CI](https://github.com/MwBm/disneyWebsite/actions/workflows/ci.yml/badge.svg)](https://github.com/MwBm/disneyWebsite/actions/workflows/ci.yml)

Crowd-level predictor, per-ride wait time forecaster, and historical accuracy tracker for Disneyland. Data collected on demand from queue-times.com via GitHub Actions. AI narration and post-process crowd adjustment via Groq (Llama 3.3).

## Stack

| Layer              | Tech                                                           |
| ------------------ | -------------------------------------------------------------- |
| Frontend + API     | Next.js 16 (App Router, TypeScript) — Vercel                   |
| Data + ML pipeline | Python 3.11 + XGBoost — GitHub Actions (daily + manual dispatch) |
| Database           | Supabase (PostgreSQL) via Prisma                               |
| AI                 | Groq API (`llama-3.3-70b-versatile`)                           |

## Pages

| Route         | Purpose                                            |
| ------------- | -------------------------------------------------- |
| `/`           | Date picker → crowd score (0–100) + AI forecast    |
| `/wait-times` | Per-ride predicted wait times for a selected date  |
| `/accuracy`   | Historical predicted vs. actual wait time accuracy |
| `/chat`       | Streaming AI chat assistant with live park context |
| `/calendar`   | Monthly crowd calendar view                        |

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
npm test                               # jest — 300+ unit and route tests
npm run build                          # must succeed without a database

cd ml-service && python -m pytest -q   # ML service

npx playwright install chromium        # one-time, per machine
npm run test:e2e                       # browser e2e on port 3100
```

CI runs everything except e2e on every push — see
[docs/runbook-tests.md](docs/runbook-tests.md).

## Environment Variables

Add to `.env.local`:

```
DATABASE_URL=postgresql://postgres.[ref]:[password]@[pooler-host]:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require
GROQ_API_KEY=gsk_...
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
CRON_SECRET=<random secret for /api/cron/* authorization>
```

For GitHub Actions, add repo secrets (Settings → Secrets and variables → Actions):

| Secret         | Value                                                             |
| -------------- | ----------------------------------------------------------------- |
| `DATABASE_URL` | Supabase direct URL (port 5432, `?sslmode=require`)               |
| `CRON_SECRET`  | Same value as `CRON_SECRET` in Vercel env                         |
| `APP_URL`      | Your Vercel deployment URL (e.g. `https://your-app.vercel.app`)   |

`CRON_SECRET` is required, not optional. `/api/cron/*` and `/api/admin/*` return
500 when it is unset rather than letting the request through — an earlier version
compared against `` `Bearer ${process.env.CRON_SECRET}` ``, which authenticated
anyone sending the literal header `Bearer undefined`.

## Docs

| Runbook                                                  | Covers                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| [docs/runbook-api.md](docs/runbook-api.md)               | API routes — forecast, accuracy, chat, live, calendar, cron     |
| [docs/runbook-lib.md](docs/runbook-lib.md)               | Service layer — db, queue-times, forecast, crowd, groq, date-context |
| [docs/runbook-components.md](docs/runbook-components.md) | UI components                                                   |
| [docs/runbook-ml-service.md](docs/runbook-ml-service.md) | Python ML service — setup, deploy, test                         |
| [docs/runbook-database.md](docs/runbook-database.md)     | Database schema, migrations, Supabase connection                |
| [docs/runbook-tests.md](docs/runbook-tests.md)           | Running Jest + Playwright + pytest                              |
| [docs/runbook-cron.md](docs/runbook-cron.md)             | GitHub Actions workflows — collect, archive, sync-date-context  |

## Architecture

```
Browser
  └── Next.js (Vercel)
        ├── /wait-times        ← per-ride predicted waits for a date
        ├── /api/forecast      ← reads DailyForecast from DB; applies Groq adjustment
        ├── /api/calendar      ← monthly crowd scores from DailyForecast + HourlyWaitSummary
        ├── /api/accuracy      ← JOIN Prediction × WaitTimeRecord
        ├── /api/chat          ← Groq streaming + live context (rate-limited, 10 req/min per IP)
        ├── /api/live          ← live wait times (CDN-cached 300s)
        ├── /api/weather       ← 16-day Anaheim forecast (CDN-cached 1h)
        └── /api/admin/date-context  ← DateContext inspection (Bearer CRON_SECRET)

GitHub Actions (daily 06:00 UTC)
  └── ml-service/train.py
        ├── Full history: WaitTimeRecord (raw window) + HourlyWaitSummary
        ├── Attach DateContext + lag features + cross-ride features
        ├── XGBoost per-ride model, expanding-window walk-forward CV (23 features)
        └── Supabase (upsert 30-day DailyForecast + log CollectRun)

GitHub Actions (manual dispatch)
  └── ml-service/collect.py
        ├── queue-times.com (fetch live data for all parks)
        ├── Supabase (upsert WaitTimeRecord)
        ├── XGBoost quick retrain → today's intraday DailyForecast slots
        └── Supabase (log CollectRun)

GitHub Actions (weekly Sunday 09:00 UTC)
  └── ml-service/archive.py
        └── Aggregates WaitTimeRecord >30 days → HourlyWaitSummary

GitHub Actions (monthly, 1st at 10:00 UTC)
  └── /api/cron/sync-date-context
        ├── ThemeParks.wiki (park hours + LLMP price → tier)
        ├── Open-Meteo (16-day weather forecast for Anaheim)
        ├── Climatological fallback (beyond 16-day window)
        └── Groq adjuster (post-processes XGBoost crowd score, bounded ±35)
```

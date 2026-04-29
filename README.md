# Disneyland Trip Planner

Crowd-level predictor, per-ride wait time forecaster, and historical accuracy tracker for Disneyland. Data collected every 30 minutes from queue-times.com. ML predictions via Python/FastAPI on Railway. AI narration via Groq (Llama 3).

## Stack

| Layer | Tech |
|---|---|
| Frontend + API | Next.js 14 (App Router, TypeScript) — Vercel |
| ML service | Python 3.11 + FastAPI + scikit-learn — Railway |
| Database | Supabase (PostgreSQL) via Prisma |
| AI | Groq API (`llama3-8b-8192`) |
| Cron | GitHub Actions every 30 min |

## Pages

| Route | Purpose |
|---|---|
| `/` | Date picker → crowd score (0–100) + AI forecast |
| `/wait-times` | Per-ride predicted wait times for a selected date |
| `/accuracy` | Historical predicted vs. actual wait time accuracy |
| `/chat` | Streaming AI chat assistant with live park context |

## Local Setup

```bash
npm install
# fill in .env.local (see Environment Variables below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Add to `.env.local`:

```
DATABASE_URL=postgresql://postgres.[ref]:[password]@[pooler-host]:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require
GROQ_API_KEY=gsk_...
ML_SERVICE_URL=https://your-service.railway.app
COLLECT_SECRET=<32-char hex from openssl rand -hex 32>
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

## Docs

| Runbook | Covers |
|---|---|
| [docs/runbook-api.md](docs/runbook-api.md) | API routes — collect, forecast, accuracy, chat, live |
| [docs/runbook-lib.md](docs/runbook-lib.md) | Service layer — db, queue-times, forecast, ml-client, groq |
| [docs/runbook-components.md](docs/runbook-components.md) | UI components |
| [docs/runbook-ml-service.md](docs/runbook-ml-service.md) | Python ML service — setup, deploy, test |
| [docs/runbook-database.md](docs/runbook-database.md) | Database schema, migrations, Supabase connection |
| [docs/runbook-tests.md](docs/runbook-tests.md) | Running Jest + Playwright + pytest |
| [docs/runbook-cron.md](docs/runbook-cron.md) | GitHub Actions data collection cron |

## Architecture

```
Browser
  └── Next.js (Vercel)
        ├── /api/collect  ← GitHub Actions cron every 30 min
        │     ├── queue-times.com (fetch live data)
        │     ├── Supabase (upsert WaitTimeRecord)
        │     └── Python ML service (write DailyForecast)
        ├── /api/forecast ← reads DailyForecast from DB
        ├── /api/accuracy ← JOIN Prediction × WaitTimeRecord
        ├── /api/chat     ← Groq streaming + live context
        └── /api/live     ← live wait times (revalidate 300s)
```

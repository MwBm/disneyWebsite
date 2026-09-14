# Runbook: Tests

| Suite | Command | Needs | In CI |
|---|---|---|---|
| Jest unit, route and component tests | `npm test` | nothing (Prisma is mocked) | yes |
| Web SQL integration (Jest) | `npm run test:integration` | local Postgres | yes |
| pytest unit | `cd ml-service && python -m pytest -q` | nothing | yes |
| pytest integration | `cd ml-service && python -m pytest -m integration` | local Postgres | yes |
| Playwright e2e | `npm run test:e2e` | Chromium download, Groq key | no |

CI (`.github/workflows/ci.yml`) also runs `tsc`, eslint, `next build` with placeholder env (no database), and `actionlint` on the workflow files.

## Everything at once

```bash
npx tsc --noEmit          # types
npm run lint              # eslint (flat config, eslint.config.mjs)
npm test                  # jest
npm run build             # next build: must pass without a database
cd ml-service && python -m pytest -q
```

The integration suites need the database below.

---

## Jest

```bash
npm test
npm test -- --coverage                  # writes coverage/ (gitignored)
npm test -- tests/lib/crowd.test.ts     # one file
```

Prisma is mocked globally in `tests/setup.ts`, so no unit test touches a database.

### Mocking seam: read this before adding a route test

Route tests mock the **lib boundary**, not Prisma:

```ts
jest.mock("@/lib/forecast-queries", () => ({ getRideForecastsForDate: jest.fn(), ... }));
```

Mocking `prisma.$queryRaw` from a route test does not work: every raw query goes through that one mock, so a test cannot give the ML read and the historical read different rows. The SQL lives in `src/lib/forecast-queries.ts` so that routes and `forecast.ts` can mock each query separately. The SQL itself is tested against Postgres (below).

### Coverage map

| Area | File |
| --- | --- |
| Bearer auth, fail-closed + constant-time | `tests/lib/auth.test.ts` |
| Sliding-window rate limiter and 429 helper | `tests/lib/rate-limit.test.ts` |
| CDN cache headers | `tests/lib/http.test.ts` |
| Bounded concurrency, failure isolation | `tests/lib/concurrency.test.ts` |
| Crowd score, scale, bands, legend, wait colors | `tests/lib/crowd.test.ts` |
| Open-Meteo parsing + climatological fallback | `tests/lib/weather.test.ts` |
| queue-times.com parsing, exclusions, failure modes | `tests/lib/queue-times.test.ts` |
| LLM response parsing, clamping, narration prompt | `tests/lib/groq.test.ts` |
| ThemeParks.wiki tiers, holiday + school-break calendar, `syncDateContext` | `tests/lib/date-context.test.ts` |
| Park-local date/time conversion | `tests/lib/park-time.test.ts` |
| Monthly crowd aggregation, per-date score | `tests/lib/forecast.test.ts` |
| Forecast query parameters + number coercion | `tests/lib/forecast-queries.test.ts` |
| Groq sync: daily ML scores per pending date | `tests/lib/sync-groq-adjustments.test.ts` |
| Accuracy table filter/sort | `tests/lib/accuracy-filters.test.ts` |
| `/api/forecast`: one avg/peak row per ride on every path, Groq adjustment, validation, caching, 429 | `tests/api/forecast.test.ts` |
| `/api/calendar` | `tests/api/calendar.test.ts` |
| `/api/accuracy`: MAE, buckets, per-ride, BigInt coercion | `tests/api/accuracy.test.ts` |
| Chat send and error states, loading overlay timing, ride table sorting | `tests/components/*.test.tsx` |

---

## Local Postgres for the integration suites

Both integration suites run against a disposable Postgres 17 with the Prisma migrations applied:

```bash
docker run -d --rm --name disney-it-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=disney_test -p 55432:5432 postgres:17
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/disney_test npx prisma migrate deploy
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/disney_test

npm run test:integration                                   # web SQL
(cd ml-service && python -m pytest -m integration)         # ML jobs + migrations

docker stop disney-it-pg
```

Every test truncates the app tables, so both suites refuse any host but localhost. Without `TEST_DATABASE_URL` they skip; CI sets `REQUIRE_INTEGRATION_DB=1` so a missing database fails instead.

### Web SQL integration (`tests/integration/`)

`jest.integration.config.ts` runs these without the global Prisma mock. `tests/integration/forecast-queries.test.ts` runs every query in `src/lib/forecast-queries.ts`, checking:
- Pacific-day bounds, including 23:30 slots that fall on the next UTC date and a 25-hour DST day;
- rounding and the newest ride name, including a newest row that is excluded from the averages;
- weekday, hour, lookback and closed-row filters;
- the 2× recent-year weighting;
- the `JobKind` filter.

### ML integration (`ml-service/tests/integration/`)

Marked `integration` and deselected by default (`pytest.ini`). They cover what mocks can't:
- real SQL, transactions and rollback;
- the `JobKind` enum cast;
- archive bucketing across both DST transitions, merges, renames and the hour-aligned cutoff;
- forecast retention;
- the full `train.main()` on seeded data;
- migration backfills applied to pre-existing rows;
- the Data API lockdown under Supabase-like grants;
- a check that every table has RLS.

---

## Playwright (e2e)

```bash
npx playwright install chromium   # one-time, per machine
npm run test:e2e
```

**The browser download is required and is not part of `npm ci`.** Without it every spec fails with `browserType.launch: Executable doesn't exist`.

Playwright starts its own dev server on **port 3100** with `reuseExistingServer: false`, so the suite always runs against the current code. Stop any running `npm run dev` first: Next refuses to start a second dev server for the same directory, whatever the port ("Another next dev server is already running").

E2E is not in CI: it needs a browser download and a live Groq key, and a flaky required check is worse than no check. Run it locally before a release.

---

## pytest (ML service)

```bash
cd ml-service
pip install -r requirements-dev.txt    # runtime deps + pytest + PyYAML
python -m pytest -q                    # unit tests; integration tests are deselected
python -m pytest tests/test_model.py -v
```

### Shared fakes (`tests/conftest.py`)

`fake_db` routes every `common.connect()` to a recording `FakeConnection`, including in modules that imported `connect` by name, and makes the real `psycopg.connect` raise. Tests assert on the exact SQL run, commits and rollbacks, and `fake_db.collect_runs()`.

### `tests/test_model.py`
- The feature vector is **23 named features**; tests reference `FEATURE_NAMES` entries, never positional indices
- Walk-forward CV: multiple folds, every validation index strictly after its training set, expanding training windows, graceful degradation on tiny input
- Zero folds never report confidence 1.0; they fall back to `FALLBACK_CONFIDENCE`
- Rides below `MIN_SAMPLES` (200) use the hour-mean fallback at confidence 0.3
- Crowd score stays within 0–100 for all inputs, including extremes
- Weather defaults: `temp_high` 75.0, `is_rainy` 0.0
- `predict_for_ride`: empty slots return `[]`; mismatched lengths raise
- `CROWD_MAX_WAIT` / `CROWD_EXPECTED_RIDES` match `src/lib/ride-config.json`

### `tests/test_collect.py`
- **Egress guard**: `collect.main()` runs only the `WaitTimeRecord` upsert and the `CollectRun` insert, with no SELECT at all
- queue-times down, malformed or empty → failed run logged, nothing written

### `tests/test_pipeline.py`
- `build_forecast_slots` uses Pacific days and skips midnight–8 AM; empty after 23:30; 32 slots on both DST days
- `generate_forecasts` reads nothing when there are no slots, raises when no model trains, and sets `REPEATABLE READ` first
- Training reads carry no time filter on raw rows and no ride names
- Lag features look back exactly 7 and 14 days at the same hour
- **Label leakage guard**: `rolling_7d_mean` is never imputed with the record's own `wait_time`
- **Train/serve skew**: `compute_cross_ride_profile` imputes `pct_rides_open` from the training mean for that park hour, not a constant 1.0
- Headliner resolution: explicit config wins; otherwise the top quartile by mean wait, ignoring closed records
- `PARK_CLOSED_LOCAL_HOURS` matches `FORECAST_FIRST_LOCAL_HOUR` in `src/lib/forecast-queries.ts`

### `tests/test_train.py`
- `train.main()` exits non-zero without `DATABASE_URL` / `DIRECT_URL`
- `build_forecast_slots(days=30)` spans exactly 30 Pacific calendar days; the 06:00 UTC run covers tonight plus 29 full days

### `tests/test_archive_main.py`
- Hour-truncated raw cutoff, forecast cutoff, statement shape (two counts, never rows), run logging

### `tests/test_common.py`
- `normalize_db_url` edge cases (param order, bare flags, encoding), connect timeout and no prepared statements, park-time boundaries across DST
- `run_logged_job`: success and failure rows per job, rollback, failure of the failure log, connect failures
- `JOBS` matches the Prisma `JobKind` enum; retention constants match the accuracy routes' window

### `tests/test_check_freshness.py`
- Daily window boundaries; train-age, horizon and archive-backlog thresholds; one aggregate read

### `tests/test_workflows.py`
- Every `schedule:` workflow is in collect.yml's keepalive list, and only that job gets `actions: write`
- collect stays dispatch-only
- every job has a timeout
- scripts run by workflows exist
- production jobs install runtime dependencies only

### `tests/test_import_dca_kaggle_history.py`
- Ride-name aliases, hourly aggregation, and skipping excluded, zero-wait and unmapped rows

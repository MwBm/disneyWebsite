# Runbook: Tests

Three suites: Jest (TypeScript unit + route), Playwright (browser e2e), pytest
(Python ML service). CI runs Jest and pytest on every push; e2e is local-only.

## Everything at once

```bash
npx tsc --noEmit          # types
npm run lint              # eslint (flat config, eslint.config.mjs)
npm test                  # jest
npm run build             # next build — must pass without a database
cd ml-service && python -m pytest -q
```

`npm run test:e2e` is deliberately not in that list; see the Playwright section.

---

## Jest

```bash
npm test
npm test -- --coverage
npm test -- tests/lib/crowd.test.ts   # one file
```

Prisma is mocked globally in `tests/setup.ts`, so no test touches a database.

### Mocking seam — read this before adding a route test

Route tests mock the **lib boundary**, not Prisma:

```ts
jest.mock("@/lib/forecast", () => ({ getForecastForDate: jest.fn(), ... }));
```

Mocking `prisma.$queryRaw` from a route test does not work. `getForecastForDate`
and `getHistoricalMeansForDate` both go through that single mock, so a test
cannot make one return ML rows and the other return historical rows — the
fallback branch becomes untestable. `tests/lib/forecast.test.ts` is where the
Prisma-level behaviour of those functions is covered.

### Coverage map

| Area | File |
| --- | --- |
| Bearer auth, fail-closed + constant-time | `tests/lib/auth.test.ts` |
| Sliding-window rate limiter | `tests/lib/rate-limit.test.ts` |
| CDN cache headers | `tests/lib/http.test.ts` |
| Crowd scale, bands, legend | `tests/lib/crowd.test.ts` |
| Open-Meteo parsing + climatological fallback | `tests/lib/weather.test.ts` |
| queue-times.com parsing, exclusions, failure modes | `tests/lib/queue-times.test.ts` |
| LLM response parsing and clamping | `tests/lib/groq.test.ts` |
| Holiday + school-break calendar | `tests/lib/date-context.test.ts` |
| Park-local date/time conversion | `tests/lib/park-time.test.ts` |
| Monthly crowd aggregation | `tests/lib/forecast.test.ts` |
| Accuracy table filter/sort | `tests/lib/accuracy-filters.test.ts` |
| `/api/forecast` — ML, historical, Groq, validation, caching, 429 | `tests/api/forecast.test.ts` |
| `/api/calendar` | `tests/api/calendar.test.ts` |
| `/api/accuracy` — MAE, buckets, per-ride, BigInt coercion | `tests/api/accuracy.test.ts` |
| Components | `tests/components/*.test.tsx` |

---

## Playwright (e2e)

```bash
npx playwright install chromium   # one-time, per machine
npm run test:e2e
```

**The browser download is required and is not part of `npm ci`.** Without it
every spec fails with `browserType.launch: Executable doesn't exist`.

Playwright starts its own dev server on **port 3100** with
`reuseExistingServer: false`. Two consequences:

- Stop any running `npm run dev` first. Next refuses to start a second dev
  server for the same directory, whatever the port, and the run will fail with
  "Another next dev server is already running."
- The suite can never silently attach to a stale server left over from another
  session — the failure mode that made this config necessary.

E2E is not in CI: it needs a browser download and a live Groq key, and a flaky
required check is worse than no check. Run it locally before a release.

---

## pytest (ML service)

```bash
cd ml-service
python -m pytest -q
python -m pytest tests/test_model.py -v
```

### `tests/test_model.py`
- Feature vector is **23 named features**; tests reference `FEATURE_NAMES`
  entries, never positional indices
- Walk-forward CV: multiple folds, every validation index strictly after its
  training set, expanding training windows, graceful degradation on tiny input
- Zero folds must not report confidence 1.0 — it falls back to
  `FALLBACK_CONFIDENCE`
- Rides below `MIN_SAMPLES` (200) use the hour-mean fallback at confidence 0.3
- Crowd score stays within 0–100 for all inputs, including extremes
- Weather defaults: `temp_high` 75.0, `is_rainy` 0.0
- `CROWD_MAX_WAIT` / `CROWD_EXPECTED_RIDES` match `src/lib/ride-config.json`

### `tests/test_collect.py`
- `build_forecast_slots` uses Pacific days and skips midnight–8 AM
- Lag features look back exactly 7 and 14 days at the same hour
- **Label leakage guard**: `rolling_7d_mean` is never imputed with the record's
  own `wait_time`
- **Train/serve skew**: `compute_cross_ride_profile` imputes `pct_rides_open`
  from the training mean for that park hour, not a constant 1.0
- Headliner resolution: explicit config wins; otherwise the top quartile by mean
  wait is derived from the data, ignoring closed records

### `tests/test_train.py`
- `train.main()` exits non-zero without `DATABASE_URL` / `DIRECT_URL`
- `build_forecast_slots(days=30)` spans exactly 30 Pacific calendar days

### `tests/test_archive.py`, `tests/test_import_dca_kaggle_history.py`
- Hourly aggregation and `ON CONFLICT DO NOTHING`; Kaggle importer smoke tests

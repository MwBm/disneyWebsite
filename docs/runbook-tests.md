# Runbook: Tests

---

## Jest (API Route Unit Tests)

```bash
npm test
```

### `tests/api/accuracy.test.ts`
- MAE calculated correctly
- Empty result when no matching `WaitTimeRecord` for predictions
- Closed rides (`isOpen = false`) excluded from accuracy calc
- Per-ride grouping correct

Prisma and HTTP calls are mocked in `tests/setup.ts`.

---

## Playwright (E2E)

```bash
npm run test:e2e
```

Requires dev server running (`npm run dev` in another terminal), or set `webServer` in `playwright.config.ts`.

### `tests/e2e/critical-flows.spec.ts`
- All pages load without errors (`/`, `/wait-times`, `/accuracy`, `/chat`)
- Nav links present on each page
- Chat send button disabled when input is empty

---

## Python Tests (ML Service)

```bash
cd ml-service
pytest tests/ -v
```

### `tests/test_model.py`
- `predict_for_date` returns predictions in valid range [0, 300]
- Fallback to historical hour-mean fires when < 30 training samples (confidence = 0.3)
- Closed rides excluded from crowd score
- Crowd score always 0–100 (with and without context, including extreme inputs)
- Empty ride list returns crowd score 0
- Weather features: `temp_high` defaults to 75.0, `is_rainy` defaults to 0.0
- Weather context flows through to feature vector (indices 8, 9)
- Feature vector shape: 14 elements
- Interaction features: `month × weekday` (index 12), `month × is_school_break` (index 13)
- `CROWD_MAX_WAIT` and `CROWD_EXPECTED_RIDES` match `src/lib/crowd.ts`

### `tests/test_collect.py`
- `build_forecast_slots` uses Pacific days, skips midnight–8 AM
- `fetch_date_contexts` returns keyed dict from mock DB rows (7-column schema including weather)
- `fetch_date_contexts` returns empty dict for empty dates
- `DateContext` tier flows through training → XGBoost → feature index 4
- Context attachment pipeline: records get correct `DateContext` from map; missing dates get default

### `tests/test_archive.py`
- Archive aggregation logic
- `ON CONFLICT DO NOTHING` behavior

### `tests/test_import_dca_kaggle_history.py`
- DCA Kaggle importer smoke tests

---

## Running All Tests

```bash
# TypeScript type check
npx tsc --noEmit

# Jest
npm test

# Playwright (requires dev server)
npm run test:e2e

# Python
cd ml-service && pytest tests/ -v
```

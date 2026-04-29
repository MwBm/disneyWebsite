# Runbook: Tests (`tests/`)

---

## Jest (API Route Unit Tests)

```bash
npm test
```

### `tests/api/collect.test.ts`
- Upsert count matches fetched ride count
- `CollectRun` written on success
- `CollectRun.errorMessage` set when ML service fails
- No `DailyForecast` rows written when ML returns null
- Idempotency: calling collect twice doesn't duplicate rows

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
- All 4 pages load without errors (`/`, `/wait-times`, `/accuracy`, `/chat`)
- Nav links present on each page
- Chat send button disabled when input is empty

---

## Python Tests (ML Service)

```bash
cd ml-service
pytest tests/ -v
```

### `tests/test_model.py`
- `predict_for_date` returns predictions in valid range
- Fallback to historical mean fires when < 30 training samples
- Closed rides excluded from crowd score
- Crowd score always 0–100
- Empty ride list handled gracefully

### `tests/test_api.py`
- `GET /health` returns 200
- `POST /predict` with valid payload returns correct shape
- `POST /predict` with empty rides returns 422
- `POST /predict` with bad schema returns 422

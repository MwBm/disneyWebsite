# Runbook: Python ML Service (`ml-service/`)

Stateless FastAPI service. Receives historical ride data, returns wait time predictions. Deployed on Railway.

---

## Local Setup

```bash
cd ml-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health check:
```bash
curl http://localhost:8000/health
# {"status": "ok"}
```

---

## Endpoints

### `GET /health`
Returns `{"status": "ok"}`. Used by Railway health checks.

### `POST /predict`

**Request:**
```json
{
  "rides": [
    {
      "ride_id": 1,
      "ride_name": "Space Mountain",
      "wait_time": 45,
      "is_open": true,
      "windowed_at": "2025-06-01T14:00:00Z"
    }
  ],
  "target_date": "2025-07-04T00:00:00Z",
  "full_retrain": false
}
```

`rides` = last 90 days of `WaitTimeRecord` rows from DB.

**Response:**
```json
{
  "forecasts": [
    { "ride_id": 1, "predicted_wait": 62, "confidence": 0.78 }
  ],
  "crowd_score": 84
}
```

---

## Model

`model.py` — `predict_for_date(records, target_date)`:

- Groups records by `ride_id`
- Trains scikit-learn `Ridge` regression per ride
- Features: `hour`, `day_of_week`, `month`, `is_weekend`
- Falls back to historical mean if ride has < 30 training samples
- `crowd_score` = weighted average of predicted waits, clipped to 0–100

---

## Running Tests

```bash
cd ml-service
pytest tests/ -v
```

Tests cover: valid prediction range, fallback on <30 samples, closed ride exclusion, crowd score 0–100 range, API shape validation.

---

## Railway Deploy

1. Push `ml-service/` code to repo
2. In Railway: New Project → Deploy from GitHub → set root directory to `ml-service`
3. Set start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Copy the Railway URL → set `ML_SERVICE_URL` in Vercel env vars and `.env.local`

---

## Fallback Behavior

If this service is unreachable, `ml-client.ts` returns `null`. The Next.js app serves existing `DailyForecast` rows from the DB instead. No user-facing error.

import pytest
from fastapi.testclient import TestClient
from main import app
from datetime import datetime, timezone

client = TestClient(app)


def _ride_payload(ride_id: int, n: int = 50):
    return [
        {
            "ride_id": ride_id,
            "ride_name": f"Ride {ride_id}",
            "land_name": "Fantasyland",
            "wait_time": 30 + (i % 15),
            "is_open": True,
            "recorded_at": f"2026-0{(i % 9) + 1}-{(i % 28) + 1:02d}T10:00:00Z",
        }
        for i in range(n)
    ]


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_predict_returns_correct_shape():
    payload = {
        "rides": _ride_payload(1) + _ride_payload(2),
        "target_date": "2026-07-05T11:00:00Z",
    }
    res = client.post("/predict", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "forecasts" in data
    assert "crowd_score" in data
    assert isinstance(data["forecasts"], list)
    assert 0 <= data["crowd_score"] <= 100
    for f in data["forecasts"]:
        assert "ride_id" in f
        assert "predicted_wait" in f
        assert "confidence" in f


def test_predict_empty_rides_raises_422():
    payload = {"rides": [], "target_date": "2026-07-05T11:00:00Z"}
    res = client.post("/predict", json=payload)
    assert res.status_code == 422


def test_predict_bad_schema_raises_422():
    res = client.post("/predict", json={"not_rides": "bad"})
    assert res.status_code == 422

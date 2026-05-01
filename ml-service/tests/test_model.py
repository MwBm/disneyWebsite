import pytest
from datetime import datetime, timezone
from schemas import RideHistory, DateContext
from model import predict_for_date, MIN_SAMPLES


def _make_records(ride_id: int, n: int, base_wait: int = 30, is_open: bool = True):
    return [
        RideHistory(
            ride_id=ride_id,
            ride_name=f"Ride {ride_id}",
            land_name="Fantasyland",
            wait_time=base_wait + (i % 10),
            is_open=is_open,
            recorded_at=datetime(2026, 1, 1 + (i % 28), 10 + (i % 8), tzinfo=timezone.utc),
        )
        for i in range(n)
    ]


def test_predict_returns_valid_range():
    records = _make_records(1, 50, base_wait=40)
    target = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
    forecasts, crowd_score = predict_for_date(records, target)

    assert len(forecasts) == 1
    assert 0 <= forecasts[0].predicted_wait <= 300
    assert 0.0 <= forecasts[0].confidence <= 1.0
    assert 0 <= crowd_score <= 100


def test_fallback_fires_with_few_samples():
    records = _make_records(2, MIN_SAMPLES - 1, base_wait=20)
    target = datetime(2026, 6, 15, 10, 0, tzinfo=timezone.utc)
    forecasts, _ = predict_for_date(records, target)

    assert len(forecasts) == 1
    assert forecasts[0].confidence == 0.3  # fallback confidence marker


def test_closed_rides_excluded():
    closed = _make_records(3, 50, is_open=False)
    open_rides = _make_records(4, 50, is_open=True)
    target = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
    forecasts, _ = predict_for_date(closed + open_rides, target)

    ride_ids = [f.ride_id for f in forecasts]
    assert 3 not in ride_ids
    assert 4 in ride_ids


def test_crowd_score_in_range():
    records = _make_records(1, 50, base_wait=60) + _make_records(2, 50, base_wait=80)
    target = datetime(2026, 6, 15, 11, 0, tzinfo=timezone.utc)
    _, crowd_score = predict_for_date(records, target)

    assert 0 <= crowd_score <= 100


def test_empty_rides_returns_zero_crowd():
    _, crowd_score = predict_for_date([], datetime(2026, 6, 15, 10, 0, tzinfo=timezone.utc))
    assert crowd_score == 0


def test_predict_with_date_context_stays_in_range():
    records = _make_records(1, 50, base_wait=40)
    target = datetime(2026, 7, 4, 14, 0, tzinfo=timezone.utc)
    ctx = DateContext(tier=5, has_special_event=True, is_holiday=True, is_school_break=True)
    forecasts, crowd_score = predict_for_date(records, target, ctx)

    assert len(forecasts) == 1
    assert 0 <= forecasts[0].predicted_wait <= 300
    assert 0.0 <= forecasts[0].confidence <= 1.0
    assert 0 <= crowd_score <= 100


def test_predict_without_context_backward_compatible():
    records = _make_records(1, 50, base_wait=40)
    target = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
    forecasts, crowd_score = predict_for_date(records, target)  # no context arg

    assert len(forecasts) == 1
    assert 0 <= forecasts[0].predicted_wait <= 300
    assert 0 <= crowd_score <= 100

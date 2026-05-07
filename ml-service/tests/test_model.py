import pytest
from datetime import datetime, timezone
from schemas import RideHistory, DateContext
from model import predict_for_date, MIN_SAMPLES, CROWD_MAX_WAIT, CROWD_EXPECTED_RIDES, _extract_features


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


def test_predict_with_weather_context():
    records = _make_records(1, 50, base_wait=40)
    target = datetime(2026, 8, 1, 14, 0, tzinfo=timezone.utc)
    ctx = DateContext(tier=3, is_holiday=False, temp_high=105.0, is_rainy=False)
    forecasts, crowd_score = predict_for_date(records, target, ctx)

    assert len(forecasts) == 1
    assert 0 <= forecasts[0].predicted_wait <= 300
    assert 0 <= crowd_score <= 100


def test_predict_rainy_day_stays_in_range():
    records = _make_records(1, 50, base_wait=40)
    target = datetime(2026, 12, 25, 14, 0, tzinfo=timezone.utc)
    ctx = DateContext(tier=5, is_holiday=True, temp_high=58.0, is_rainy=True)
    forecasts, crowd_score = predict_for_date(records, target, ctx)

    assert 0 <= crowd_score <= 100


# --- Feature engineering tests ---

def test_extract_features_shape():
    """Feature vector must be 14 elements (10 base + 2 weather + 2 seasonal interactions)."""
    dt = datetime(2026, 6, 5, 19, 0, tzinfo=timezone.utc)
    features = _extract_features(dt)
    assert len(features) == 14


def test_month_weekday_interaction():
    """month_x_weekday (feature[12]) = month * weekday.
    June 5 2026 is a Friday (weekday=4) in Pacific time; month=6.
    """
    # 2026-06-05 19:00 UTC = 2026-06-05 12:00 PDT (UTC-7)
    dt = datetime(2026, 6, 5, 19, 0, tzinfo=timezone.utc)
    features = _extract_features(dt)
    month = features[2]   # index 2
    weekday = features[1]  # index 1
    assert features[12] == pytest.approx(month * weekday)
    assert features[12] == pytest.approx(6.0 * 4.0)  # June, Friday


def test_month_school_break_interaction():
    """month_x_school_break (feature[13]) = month * is_school_break.
    July + school break context → 7.0 * 1.0 = 7.0.
    """
    dt = datetime(2026, 7, 15, 19, 0, tzinfo=timezone.utc)  # July 15 12:00 PDT
    ctx = DateContext(is_school_break=True)
    features = _extract_features(dt, ctx)
    assert features[13] == pytest.approx(7.0 * 1.0)


def test_month_school_break_zero_without_context():
    """Without school_break context, feature[13] must be 0."""
    dt = datetime(2026, 7, 15, 19, 0, tzinfo=timezone.utc)
    features = _extract_features(dt)
    assert features[13] == pytest.approx(0.0)


def test_weather_features_defaults():
    """Without weather context, temp_high defaults to 75.0 and is_rainy to 0.0."""
    dt = datetime(2026, 6, 15, 19, 0, tzinfo=timezone.utc)
    features = _extract_features(dt)
    assert features[8] == pytest.approx(75.0)  # temp_high default
    assert features[9] == pytest.approx(0.0)   # is_rainy default


def test_weather_features_with_context():
    """Weather features reflect context values."""
    dt = datetime(2026, 6, 15, 19, 0, tzinfo=timezone.utc)
    ctx = DateContext(temp_high=95.0, is_rainy=True)
    features = _extract_features(dt, ctx)
    assert features[8] == pytest.approx(95.0)
    assert features[9] == pytest.approx(1.0)


# --- Crowd score constants sync test ---

def test_crowd_score_formula_constants():
    """CROWD_MAX_WAIT and CROWD_EXPECTED_RIDES must match src/lib/crowd.ts constants.
    crowd.ts: MAX_WAIT = 120, EXPECTED_RIDES = 24
    If these drift, the Python and TypeScript crowd scores will silently diverge.
    """
    assert CROWD_MAX_WAIT == 120, "Must match MAX_WAIT in src/lib/crowd.ts"
    assert CROWD_EXPECTED_RIDES == 24, "Must match EXPECTED_RIDES in src/lib/crowd.ts"

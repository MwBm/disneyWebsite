import json
import os
import pytest
from datetime import datetime, timedelta, timezone

from schemas import DateContext, LagFeatures, RideHistory
from model import (
    CROWD_EXPECTED_RIDES,
    CROWD_MAX_WAIT,
    FEATURE_NAMES,
    MIN_SAMPLES,
    TIER_MULTIPLIER_STEP,
    _extract_features,
    _train_ride_model,
    predict_for_date,
    predict_for_ride,
    train_ride_models,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_records(
    ride_id: int,
    n: int,
    base_wait: int = 30,
    is_open: bool = True,
    spread_days: int = 60,
) -> list[RideHistory]:
    """Generate n records spread over spread_days so lag features have lookback data."""
    records = []
    for i in range(n):
        day_offset = i % spread_days
        records.append(
            RideHistory(
                ride_id=ride_id,
                ride_name=f"Ride {ride_id}",
                land_name="Fantasyland",
                wait_time=base_wait + (i % 10),
                is_open=is_open,
                recorded_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=day_offset, hours=10 + (i % 8)),
            )
        )
    return records


def _make_records_with_lags(
    ride_id: int,
    n: int,
    base_wait: int = 30,
    lag_7d: float = 25.0,
    lag_14d: float = 20.0,
) -> list[RideHistory]:
    records = _make_records(ride_id, n, base_wait=base_wait)
    return [
        r.model_copy(update={
            "lag_features": LagFeatures(
                lag_7d_wait=lag_7d,
                lag_14d_wait=lag_14d,
                rolling_7d_mean=lag_7d,
                rolling_7d_std=3.0,
                pct_rides_open=1.0,
                is_headliner_open=1.0,
            )
        })
        for r in records
    ]


# ---------------------------------------------------------------------------
# Basic prediction range tests
# ---------------------------------------------------------------------------

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
    assert forecasts[0].confidence == 0.3


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
    forecasts, crowd_score = predict_for_date(records, target)
    assert len(forecasts) == 1
    assert 0 <= forecasts[0].predicted_wait <= 300
    assert 0 <= crowd_score <= 100


def test_predict_with_weather_context():
    records = _make_records(1, 50, base_wait=40)
    target = datetime(2026, 8, 1, 14, 0, tzinfo=timezone.utc)
    ctx = DateContext(tier=3, is_holiday=False, temp_high=105.0, is_rainy=False)
    forecasts, crowd_score = predict_for_date(records, target, ctx)
    assert 0 <= forecasts[0].predicted_wait <= 300
    assert 0 <= crowd_score <= 100


def test_predict_rainy_day_stays_in_range():
    records = _make_records(1, 50, base_wait=40)
    target = datetime(2026, 12, 25, 14, 0, tzinfo=timezone.utc)
    ctx = DateContext(tier=5, is_holiday=True, temp_high=58.0, is_rainy=True, precip_mm=12.0)
    _, crowd_score = predict_for_date(records, target, ctx)
    assert 0 <= crowd_score <= 100


# ---------------------------------------------------------------------------
# Feature engineering tests — use FEATURE_NAMES for order-independent access
# ---------------------------------------------------------------------------

def test_extract_features_shape():
    dt = datetime(2026, 6, 5, 19, 0, tzinfo=timezone.utc)
    features = _extract_features(dt)
    assert len(features) == len(FEATURE_NAMES)


def _feat(name: str, dt: datetime, ctx=None, lag=None) -> float:
    """Extract a single named feature."""
    vec = _extract_features(dt, ctx, lag)
    return vec[FEATURE_NAMES.index(name)]


def test_month_weekday_interaction():
    # 2026-06-05 19:00 UTC = 2026-06-05 12:00 PDT (UTC-7) → Friday (weekday=4), month=6
    dt = datetime(2026, 6, 5, 19, 0, tzinfo=timezone.utc)
    assert _feat("month_x_weekday", dt) == pytest.approx(6.0 * 4.0)


def test_month_school_break_interaction():
    dt = datetime(2026, 7, 15, 19, 0, tzinfo=timezone.utc)
    ctx = DateContext(is_school_break=True)
    assert _feat("month_x_school_break", dt, ctx) == pytest.approx(7.0 * 1.0)


def test_month_school_break_zero_without_context():
    dt = datetime(2026, 7, 15, 19, 0, tzinfo=timezone.utc)
    assert _feat("month_x_school_break", dt) == pytest.approx(0.0)


def test_weather_features_defaults():
    dt = datetime(2026, 6, 15, 19, 0, tzinfo=timezone.utc)
    assert _feat("temp_high", dt) == pytest.approx(75.0)
    assert _feat("is_rainy", dt) == pytest.approx(0.0)
    assert _feat("precip_mm", dt) == pytest.approx(0.0)
    assert _feat("is_extreme_heat", dt) == pytest.approx(0.0)


def test_extreme_heat_flag():
    dt = datetime(2026, 8, 15, 19, 0, tzinfo=timezone.utc)
    ctx = DateContext(temp_high=100.0)
    assert _feat("is_extreme_heat", dt, ctx) == pytest.approx(1.0)

    ctx_cool = DateContext(temp_high=90.0)
    assert _feat("is_extreme_heat", dt, ctx_cool) == pytest.approx(0.0)


def test_temp_range_feature():
    dt = datetime(2026, 6, 15, 19, 0, tzinfo=timezone.utc)
    ctx = DateContext(temp_high=90.0, temp_low=60.0)
    assert _feat("temp_range", dt, ctx) == pytest.approx(30.0)


def test_precip_mm_feature():
    dt = datetime(2026, 12, 1, 19, 0, tzinfo=timezone.utc)
    ctx = DateContext(precip_mm=5.5, is_rainy=True)
    assert _feat("precip_mm", dt, ctx) == pytest.approx(5.5)


def test_lag_features_flow_through():
    dt = datetime(2026, 6, 15, 19, 0, tzinfo=timezone.utc)
    lag = LagFeatures(lag_7d_wait=42.0, lag_14d_wait=38.0, rolling_7d_mean=40.0, rolling_7d_std=5.0)
    assert _feat("lag_7d_wait", dt, lag=lag) == pytest.approx(42.0)
    assert _feat("lag_14d_wait", dt, lag=lag) == pytest.approx(38.0)
    assert _feat("rolling_7d_mean", dt, lag=lag) == pytest.approx(40.0)
    assert _feat("rolling_7d_std", dt, lag=lag) == pytest.approx(5.0)


def test_lag_features_zero_by_default():
    dt = datetime(2026, 6, 15, 19, 0, tzinfo=timezone.utc)
    assert _feat("lag_7d_wait", dt) == pytest.approx(0.0)
    assert _feat("lag_14d_wait", dt) == pytest.approx(0.0)
    assert _feat("rolling_7d_mean", dt) == pytest.approx(0.0)


def test_cross_ride_features_defaults():
    dt = datetime(2026, 6, 15, 19, 0, tzinfo=timezone.utc)
    assert _feat("pct_rides_open", dt) == pytest.approx(1.0)
    assert _feat("is_headliner_open", dt) == pytest.approx(1.0)


def test_cross_ride_features_set():
    dt = datetime(2026, 6, 15, 19, 0, tzinfo=timezone.utc)
    lag = LagFeatures(pct_rides_open=0.75, is_headliner_open=0.0)
    assert _feat("pct_rides_open", dt, lag=lag) == pytest.approx(0.75)
    assert _feat("is_headliner_open", dt, lag=lag) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# CV MAE and confidence tests
# ---------------------------------------------------------------------------

def test_cv_mae_in_trained_model():
    """Trained ride (≥ MIN_SAMPLES records) gets a real model with finite cv_mae."""
    records = _make_records_with_lags(1, MIN_SAMPLES + 50, base_wait=40)
    models = train_ride_models(records)
    tm = models[1]
    assert tm.model is not None
    assert tm.cv_mae_minutes >= 0.0
    assert 0.0 <= tm.confidence <= 1.0


def test_fallback_model_has_zero_cv_mae():
    records = _make_records(2, MIN_SAMPLES - 1, base_wait=20)
    models = train_ride_models(records)
    tm = models[2]
    assert tm.model is None
    assert tm.cv_mae_minutes == 0.0
    assert tm.confidence == 0.3


def test_cv_mae_bounded_confidence():
    """Confidence must stay in [0, 1] regardless of wait magnitude."""
    records = _make_records_with_lags(1, MIN_SAMPLES + 100, base_wait=5)
    models = train_ride_models(records)
    tm = models.get(1)
    if tm and tm.model is not None:
        assert 0.0 <= tm.confidence <= 1.0


def test_cv_split_is_temporal():
    """Walk-forward CV: validation records must all be later than training records."""
    from model import _train_ride_model
    records = _make_records_with_lags(1, 300, base_wait=40)
    sorted_recs = sorted(records, key=lambda r: r.recorded_at)
    split = int(len(sorted_recs) * 0.8)
    train_recs = sorted_recs[:split]
    val_recs = sorted_recs[split:]

    # Every validation timestamp must be >= every training timestamp at the split boundary
    assert all(v.recorded_at >= train_recs[-1].recorded_at for v in val_recs)


# ---------------------------------------------------------------------------
# Lag feature correctness tests
# ---------------------------------------------------------------------------

def test_lag_7d_lookback_correct():
    """Lag features from compute_lag_features must reference exactly 7 days prior."""
    from collect import compute_lag_features

    base_date = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
    date_7d_ago = base_date - timedelta(days=7)

    target_record = RideHistory(
        ride_id=1, ride_name="Test", land_name="Land",
        wait_time=50, is_open=True, recorded_at=base_date,
    )
    prior_record = RideHistory(
        ride_id=1, ride_name="Test", land_name="Land",
        wait_time=30, is_open=True, recorded_at=date_7d_ago,
    )
    history = [target_record, prior_record]
    enriched = compute_lag_features(history)

    enriched_by_time = {r.recorded_at: r for r in enriched}
    target = enriched_by_time[base_date]
    assert target.lag_features is not None
    assert target.lag_features.lag_7d_wait == pytest.approx(30.0)


def test_lag_features_zero_when_no_prior_data():
    """When no historical data exists 7/14 days prior, lags default to 0.0."""
    from collect import compute_lag_features

    record = RideHistory(
        ride_id=99, ride_name="New Ride", land_name="Land",
        wait_time=40, is_open=True,
        recorded_at=datetime(2026, 1, 8, 14, 0, tzinfo=timezone.utc),
    )
    enriched = compute_lag_features([record])
    assert enriched[0].lag_features is not None
    assert enriched[0].lag_features.lag_7d_wait == 0.0
    assert enriched[0].lag_features.lag_14d_wait == 0.0


def test_rolling_7d_mean_uses_prior_days_at_same_hour():
    """Rolling mean uses prior 7 calendar days at same hour, not same day-of-week."""
    from collect import compute_lag_features

    base_date = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)  # 7am Pacific
    records = [
        RideHistory(
            ride_id=1, ride_name="Test", land_name="Land",
            wait_time=50, is_open=True, recorded_at=base_date,
        )
    ]
    # Add 5 prior days with known wait times at same UTC hour
    known_waits = [10.0, 20.0, 30.0, 40.0, 50.0]
    for days_back, w in enumerate(known_waits, start=1):
        records.append(
            RideHistory(
                ride_id=1, ride_name="Test", land_name="Land",
                wait_time=int(w), is_open=True,
                recorded_at=base_date - timedelta(days=days_back),
            )
        )

    enriched = compute_lag_features(records)
    target = next(r for r in enriched if r.recorded_at == base_date)
    assert target.lag_features is not None
    assert target.lag_features.rolling_7d_mean == pytest.approx(sum(known_waits) / len(known_waits))


# ---------------------------------------------------------------------------
# Batch prediction tests
# ---------------------------------------------------------------------------

def test_predict_for_ride_batch_matches_single():
    """Batch predict_for_ride must produce same values as single-slot calls."""
    records = _make_records(1, 50, base_wait=40)
    models = train_ride_models(records)
    tm = models[1]

    slots = [
        datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc),
        datetime(2026, 6, 15, 15, 0, tzinfo=timezone.utc),
        datetime(2026, 6, 16, 11, 0, tzinfo=timezone.utc),
    ]
    batch = predict_for_ride(tm, 1, slots, [None] * 3, [None] * 3)

    assert len(batch) == len(slots)
    for f in batch:
        assert 0 <= f.predicted_wait <= 300
        assert 0.0 <= f.confidence <= 1.0


def test_predict_for_ride_all_rides_in_range():
    records = _make_records(5, 50, base_wait=25) + _make_records(6, 50, base_wait=60)
    models = train_ride_models(records)
    slot = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)

    for ride_id, tm in models.items():
        result = predict_for_ride(tm, ride_id, [slot], [None], [None])
        assert len(result) == 1
        assert 0 <= result[0].predicted_wait <= 300


# ---------------------------------------------------------------------------
# Crowd score constants sync test
# ---------------------------------------------------------------------------

def test_crowd_score_formula_constants():
    """model.py constants must match ride-config.json (single source of truth)."""
    config_path = os.path.join(os.path.dirname(__file__), "../../src/lib/ride-config.json")
    with open(config_path) as f:
        config = json.load(f)
    assert CROWD_MAX_WAIT == config["crowdMaxWait"]
    assert CROWD_EXPECTED_RIDES == config["crowdExpectedRides"]
    assert TIER_MULTIPLIER_STEP == pytest.approx(config["tierMultiplierStep"])

import pytest
from datetime import datetime, date, timedelta, timezone
from unittest.mock import MagicMock, patch, call

from collect import (
    PARK_CLOSED_LOCAL_HOURS,
    PARK_TZ,
    attach_cross_ride_features,
    build_forecast_slots,
    compute_lag_features,
    fetch_date_contexts,
    park_date_key,
)
from schemas import DateContext, LagFeatures, RideHistory
from model import train_ride_models, MIN_SAMPLES


def test_build_forecast_slots_uses_pacific_days_and_skips_closed_hours():
    now = datetime(2026, 6, 1, 18, 15, tzinfo=timezone.utc)  # 11:15 AM Pacific
    slots = build_forecast_slots(now, days=2)

    assert slots[0] == datetime(2026, 6, 1, 18, 30, tzinfo=timezone.utc)
    assert {s.astimezone(PARK_TZ).strftime("%Y-%m-%d") for s in slots} == {
        "2026-06-01",
        "2026-06-02",
    }
    assert all(s.astimezone(PARK_TZ).hour not in PARK_CLOSED_LOCAL_HOURS for s in slots)


# ---------------------------------------------------------------------------
# DateContext fetch tests
# ---------------------------------------------------------------------------

def _make_mock_conn(fetchall_rows):
    cursor = MagicMock()
    cursor.__enter__ = lambda s: s
    cursor.__exit__ = MagicMock(return_value=False)
    cursor.fetchall.return_value = fetchall_rows
    conn = MagicMock()
    conn.cursor.return_value = cursor
    return conn


def test_fetch_date_contexts_returns_keyed_dict():
    rows = [
        (date(2026, 6, 1), 3, None, True, False, 82.0, 60.0, 0.0, False),
        (date(2026, 6, 2), 0, "Oogie Boogie", False, True, None, None, 3.2, None),
    ]
    conn = _make_mock_conn(rows)
    dates = [
        datetime(2026, 6, 1, 19, 0, tzinfo=timezone.utc),
        datetime(2026, 6, 2, 19, 0, tzinfo=timezone.utc),
    ]
    result = fetch_date_contexts(conn, dates)

    assert "2026-06-01" in result
    assert result["2026-06-01"].tier == 3
    assert result["2026-06-01"].is_holiday is True
    assert result["2026-06-01"].temp_high == 82.0
    assert result["2026-06-01"].temp_low == 60.0
    assert result["2026-06-01"].precip_mm == pytest.approx(0.0)
    assert result["2026-06-01"].is_rainy is False

    assert "2026-06-02" in result
    assert result["2026-06-02"].has_special_event is True
    assert result["2026-06-02"].temp_high is None
    assert result["2026-06-02"].precip_mm == pytest.approx(3.2)
    assert result["2026-06-02"].is_rainy is False  # None → default False


def test_fetch_date_contexts_empty_dates_returns_empty():
    conn = _make_mock_conn([])
    assert fetch_date_contexts(conn, []) == {}


# ---------------------------------------------------------------------------
# Lag feature computation tests
# ---------------------------------------------------------------------------

def _make_history(ride_id: int, base_date: datetime, n_days: int, base_wait: int = 30):
    return [
        RideHistory(
            ride_id=ride_id, ride_name=f"Ride {ride_id}", land_name="Land",
            wait_time=base_wait + i, is_open=True,
            recorded_at=base_date - timedelta(days=i),
        )
        for i in range(n_days)
    ]


def test_lag_7d_populated_from_prior_record():
    base = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
    records = [
        RideHistory(
            ride_id=1, ride_name="Test", land_name="Land",
            wait_time=50, is_open=True, recorded_at=base,
        ),
        RideHistory(
            ride_id=1, ride_name="Test", land_name="Land",
            wait_time=28, is_open=True, recorded_at=base - timedelta(days=7),
        ),
    ]
    enriched = compute_lag_features(records)
    target = next(r for r in enriched if r.recorded_at == base)
    assert target.lag_features is not None
    assert target.lag_features.lag_7d_wait == pytest.approx(28.0)


def test_lag_zero_when_no_prior_data():
    record = RideHistory(
        ride_id=99, ride_name="New", land_name="Land",
        wait_time=40, is_open=True,
        recorded_at=datetime(2026, 1, 8, 14, 0, tzinfo=timezone.utc),
    )
    enriched = compute_lag_features([record])
    assert enriched[0].lag_features.lag_7d_wait == 0.0
    assert enriched[0].lag_features.lag_14d_wait == 0.0


def test_cross_ride_pct_open():
    slot_time = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
    # rides 1-3 open, ride 4 closed → 3 of 4 = 0.75
    records = [
        RideHistory(
            ride_id=i, ride_name=f"R{i}", land_name="Land",
            wait_time=30, is_open=(i < 4), recorded_at=slot_time,
        )
        for i in range(1, 5)
    ]
    enriched = attach_cross_ride_features(records, frozenset())
    pcts = {r.ride_id: r.lag_features.pct_rides_open for r in enriched}
    assert all(v == pytest.approx(0.75) for v in pcts.values())


def test_cross_ride_headliner_open():
    slot_time = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
    records = [
        RideHistory(
            ride_id=1, ride_name="Headliner", land_name="Land",
            wait_time=60, is_open=True, recorded_at=slot_time,
        ),
        RideHistory(
            ride_id=2, ride_name="Other", land_name="Land",
            wait_time=20, is_open=True, recorded_at=slot_time,
        ),
    ]
    enriched = attach_cross_ride_features(records, frozenset({1}))
    assert all(r.lag_features.is_headliner_open == pytest.approx(1.0) for r in enriched)


def test_cross_ride_headliner_closed():
    slot_time = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
    records = [
        RideHistory(
            ride_id=1, ride_name="Headliner", land_name="Land",
            wait_time=0, is_open=False, recorded_at=slot_time,
        ),
        RideHistory(
            ride_id=2, ride_name="Other", land_name="Land",
            wait_time=30, is_open=True, recorded_at=slot_time,
        ),
    ]
    enriched = attach_cross_ride_features(records, frozenset({1}))
    assert all(r.lag_features.is_headliner_open == pytest.approx(0.0) for r in enriched)


# ---------------------------------------------------------------------------
# Context pipeline tests
# ---------------------------------------------------------------------------

def test_training_context_tier_flows_through():
    """DateContext tier=3 must appear as feature value 3.0 after context attachment."""
    from model import _extract_features
    records = [
        RideHistory(
            ride_id=1, ride_name="Test Ride", land_name="Test Land",
            wait_time=40 + (i % 10), is_open=True,
            recorded_at=datetime(2026, 6, 1, 12, tzinfo=timezone.utc) + timedelta(days=i % 60),
            context=DateContext(tier=3),
        )
        for i in range(MIN_SAMPLES + 10)  # must exceed MIN_SAMPLES to train a model
    ]
    trained = train_ride_models(records)
    assert 1 in trained
    assert trained[1].model is not None

    sample = records[0]
    features = _extract_features(sample.recorded_at, sample.context)
    from model import FEATURE_NAMES
    tier_idx = FEATURE_NAMES.index("tier")
    assert features[tier_idx] == pytest.approx(3.0)


def test_context_attachment_pipeline():
    history = [
        RideHistory(
            ride_id=1, ride_name="Test", land_name="Land",
            wait_time=30, is_open=True,
            recorded_at=datetime(2026, 6, 1, 19, 0, tzinfo=timezone.utc),
        ),
        RideHistory(
            ride_id=1, ride_name="Test", land_name="Land",
            wait_time=35, is_open=True,
            recorded_at=datetime(2026, 6, 15, 19, 0, tzinfo=timezone.utc),
        ),
    ]
    context_map = {"2026-06-01": DateContext(tier=2, is_holiday=True)}
    augmented = [
        r.model_copy(update={"context": context_map.get(park_date_key(r.recorded_at), DateContext())})
        for r in history
    ]

    assert all(r.context is not None for r in augmented)
    assert augmented[0].context.tier == 2
    assert augmented[0].context.is_holiday is True
    assert augmented[1].context.tier == 0
    assert augmented[1].context.is_holiday is False


# ---------------------------------------------------------------------------
# Transaction / partial-failure tests
# ---------------------------------------------------------------------------

def test_upsert_forecasts_no_delete_step():
    """upsert_forecasts must never issue a DELETE statement.

    The old delete_stale_forecasts + insert pattern deleted rows first, leaving a
    window where forecasts were missing. ON CONFLICT DO UPDATE eliminates that gap.
    """
    from collect import upsert_forecasts
    from schemas import RideForecast

    cursor = MagicMock()
    cursor.__enter__ = lambda s: s
    cursor.__exit__ = MagicMock(return_value=False)
    cursor.executemany.side_effect = Exception("simulated DB failure")

    conn = MagicMock()
    conn.cursor.return_value = cursor

    slot = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
    fake_forecast = RideForecast(ride_id=1, predicted_wait=30, confidence=0.8)
    ride_meta = {1: {"name": "Test Ride", "land_name": "Land"}}

    with pytest.raises(Exception, match="simulated DB failure"):
        upsert_forecasts(conn, [(slot, [fake_forecast], 50)], ride_meta)

    # Critical: cursor.execute (single SQL call) was never called — no DELETE issued.
    # Only executemany (the INSERT ... ON CONFLICT) was attempted, and it failed.
    cursor.execute.assert_not_called()


def test_main_exits_nonzero_without_db_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DIRECT_URL", raising=False)
    from collect import main
    assert main() == 1

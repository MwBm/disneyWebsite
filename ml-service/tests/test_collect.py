from datetime import datetime, date, timezone
from unittest.mock import MagicMock

from collect import PARK_CLOSED_LOCAL_HOURS, PARK_TZ, build_forecast_slots, fetch_date_contexts, park_date_key
from schemas import RideHistory, DateContext
from model import train_ride_models


def test_build_forecast_slots_uses_pacific_days_and_skips_closed_hours():
    now = datetime(2026, 6, 1, 18, 15, tzinfo=timezone.utc)  # 11:15 AM Pacific
    slots = build_forecast_slots(now, days=2)

    assert slots[0] == datetime(2026, 6, 1, 18, 30, tzinfo=timezone.utc)
    assert {s.astimezone(PARK_TZ).strftime("%Y-%m-%d") for s in slots} == {
        "2026-06-01",
        "2026-06-02",
    }
    assert all(s.astimezone(PARK_TZ).hour not in PARK_CLOSED_LOCAL_HOURS for s in slots)


# --- Phase 4B: DateContext join tests ---

def _make_mock_conn(fetchall_rows):
    """Return a mock psycopg connection whose cursor returns `fetchall_rows`."""
    cursor = MagicMock()
    cursor.__enter__ = lambda s: s
    cursor.__exit__ = MagicMock(return_value=False)
    cursor.fetchall.return_value = fetchall_rows
    conn = MagicMock()
    conn.cursor.return_value = cursor
    return conn


def test_fetch_date_contexts_returns_keyed_dict():
    rows = [
        (date(2026, 6, 1), 3, None, True, False),          # tier=3, holiday
        (date(2026, 6, 2), 0, "Oogie Boogie", False, True), # special event + school break
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
    assert result["2026-06-01"].is_school_break is False

    assert "2026-06-02" in result
    assert result["2026-06-02"].has_special_event is True
    assert result["2026-06-02"].is_school_break is True


def test_fetch_date_contexts_empty_dates_returns_empty():
    conn = _make_mock_conn([])
    assert fetch_date_contexts(conn, []) == {}


def test_training_scaler_tier_nonzero_when_context_attached():
    """After attaching DateContext (tier=3) to training records, the scaler's
    mean for the tier feature (index 4) must be close to 3.0 — confirming
    context flows through to _extract_features during training."""
    records = [
        RideHistory(
            ride_id=1,
            ride_name="Test Ride",
            land_name="Test Land",
            wait_time=40 + (i % 10),
            is_open=True,
            recorded_at=datetime(2026, 6, 1 + (i % 28), 12, tzinfo=timezone.utc),
            context=DateContext(tier=3),
        )
        for i in range(40)
    ]
    trained = train_ride_models(records)
    assert 1 in trained
    scaler = trained[1].scaler
    assert scaler is not None
    tier_feature_idx = 4
    assert abs(scaler.mean_[tier_feature_idx] - 3.0) < 0.1


def test_context_attachment_pipeline():
    """Simulate the main() context-attachment step: records get correct DateContext
    from context_map and default DateContext for dates not in the map."""
    history = [
        RideHistory(
            ride_id=1, ride_name="Test", land_name="Land",
            wait_time=30, is_open=True,
            recorded_at=datetime(2026, 6, 1, 19, 0, tzinfo=timezone.utc),
        ),
        RideHistory(
            ride_id=1, ride_name="Test", land_name="Land",
            wait_time=35, is_open=True,
            recorded_at=datetime(2026, 6, 15, 19, 0, tzinfo=timezone.utc),  # no context row
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
    assert augmented[1].context.tier == 0   # default
    assert augmented[1].context.is_holiday is False


# --- Phase 4E: main() error-path smoke test ---

def test_main_exits_nonzero_without_db_url(monkeypatch):
    """main() returns 1 (not an unhandled exception) when no DATABASE_URL is set."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DIRECT_URL", raising=False)
    from collect import main
    assert main() == 1

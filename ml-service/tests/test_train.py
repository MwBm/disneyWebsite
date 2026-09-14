"""Tests for train.py — the daily job that owns every DailyForecast row."""

from datetime import datetime, timezone

import pytest

import train
from common import PARK_TZ
from pipeline import build_forecast_slots


def test_train_main_exits_nonzero_without_db_url(monkeypatch, fake_db):
    monkeypatch.delenv("DATABASE_URL")

    assert train.main() == 1
    assert fake_db.connect_attempts == 0


def test_forecast_slots_cover_30_days():
    """build_forecast_slots with days=30 must span 30 Pacific calendar days."""
    now = datetime(2026, 6, 1, 18, 0, tzinfo=timezone.utc)
    slots = build_forecast_slots(now, days=30)

    park_dates = {s.astimezone(PARK_TZ).strftime("%Y-%m-%d") for s in slots}
    assert len(park_dates) == 30


def test_scheduled_run_time_still_produces_29_full_days():
    """train.yml fires at 06:00 UTC — 23:00 PDT — so 'today' has only two slots left.

    Today's slots are therefore written by the previous night's run, which is
    why collect.py never needs to write forecasts.
    """
    now = datetime(2026, 9, 14, 6, 0, tzinfo=timezone.utc)
    slots = build_forecast_slots(now, days=train.FORECAST_DAYS)

    today = [s for s in slots if s.astimezone(PARK_TZ).date().isoformat() == "2026-09-13"]
    assert [s.astimezone(PARK_TZ).strftime("%H:%M") for s in today] == ["23:00", "23:30"]
    assert len(slots) == 2 + 29 * 32


def test_main_logs_the_rows_generate_forecasts_wrote(monkeypatch, fake_db):
    calls = []

    def fake_generate(conn, now, days):
        calls.append((now, days))
        return 75_120

    monkeypatch.setattr(train, "generate_forecasts", fake_generate)

    assert train.main() == 0

    [(now, days)] = calls
    assert days == 30
    assert now.tzinfo is not None
    [conn] = fake_db.connections
    assert conn.events[-1] == "commit"
    [run] = fake_db.collect_runs()
    assert run["job"] == "train"
    rows, success, error = run["rows"], run["success"], run["error"]
    assert (rows, success, error) == (75_120, True, None)


@pytest.mark.parametrize(
    "error",
    [
        RuntimeError("No ride models trained from 0 history records; refusing to report success"),
        ValueError("slots, contexts and lag_features_list must be the same length; got 3, 2, 3"),
    ],
)
def test_main_rolls_back_and_logs_when_forecasting_fails(monkeypatch, fake_db, error):
    def fake_generate(conn, now, days):
        raise error

    monkeypatch.setattr(train, "generate_forecasts", fake_generate)

    assert train.main() == 1

    work_conn, log_conn = fake_db.connections
    assert work_conn.events == ["rollback"]
    assert log_conn.autocommit is True
    [run] = fake_db.collect_runs()
    assert run["job"] == "train"
    rows, success, message = run["rows"], run["success"], run["error"]
    assert (rows, success, message) == (0, False, str(error))

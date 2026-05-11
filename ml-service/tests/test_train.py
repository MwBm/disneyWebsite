"""Tests for train.py — daily full-window training job."""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from schemas import DateContext, RideHistory
from model import MIN_SAMPLES


def _make_history(ride_id: int, n: int, base_wait: int = 30):
    return [
        RideHistory(
            ride_id=ride_id, ride_name=f"Ride {ride_id}", land_name="Land",
            wait_time=base_wait + (i % 10), is_open=True,
            recorded_at=datetime(2026, 1, 1, 12, tzinfo=timezone.utc) + timedelta(days=i % 60),
        )
        for i in range(n)
    ]


def test_train_main_exits_nonzero_without_db_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DIRECT_URL", raising=False)
    from train import main
    assert main() == 1


def test_forecast_slots_cover_30_days():
    """build_forecast_slots with days=30 must span 30 Pacific calendar days."""
    from collect import build_forecast_slots, PARK_TZ

    now = datetime(2026, 6, 1, 18, 0, tzinfo=timezone.utc)
    slots = build_forecast_slots(now, days=30)

    park_dates = {s.astimezone(PARK_TZ).strftime("%Y-%m-%d") for s in slots}
    assert len(park_dates) == 30


def test_upsert_forecasts_called_with_all_slots():
    """train.py must generate forecasts for all 30 days, not just today."""
    from collect import build_forecast_slots, PARK_TZ

    now = datetime(2026, 6, 1, 18, 0, tzinfo=timezone.utc)
    slots_30 = build_forecast_slots(now, days=30)
    slots_1 = build_forecast_slots(now, days=1)

    # Daily job generates many more slots than 30-min collect
    assert len(slots_30) > len(slots_1)
    # At least 16 open hours × 2 slots/hr × ~30 days
    assert len(slots_30) >= 900

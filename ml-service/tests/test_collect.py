from datetime import datetime, timezone

from collect import PARK_CLOSED_LOCAL_HOURS, PARK_TZ, build_forecast_slots


def test_build_forecast_slots_uses_pacific_days_and_skips_closed_hours():
    now = datetime(2026, 6, 1, 18, 15, tzinfo=timezone.utc)  # 11:15 AM Pacific
    slots = build_forecast_slots(now, days=2)

    assert slots[0] == datetime(2026, 6, 1, 18, 30, tzinfo=timezone.utc)
    assert {s.astimezone(PARK_TZ).strftime("%Y-%m-%d") for s in slots} == {
        "2026-06-01",
        "2026-06-02",
    }
    assert all(s.astimezone(PARK_TZ).hour not in PARK_CLOSED_LOCAL_HOURS for s in slots)

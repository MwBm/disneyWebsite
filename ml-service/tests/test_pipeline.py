"""Tests for pipeline.py — training-data loading, feature engineering, forecast writing."""

import pytest
from datetime import datetime, date, timedelta, timezone
from unittest.mock import MagicMock

from pipeline import (
    PARK_CLOSED_LOCAL_HOURS,
    PARK_TZ,
    attach_cross_ride_features,
    build_forecast_slots,
    compute_lag_features,
    fetch_date_contexts,
    park_date_key,
)
from schemas import DateContext, RideHistory
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
    from pipeline import upsert_forecasts
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




# ---------------------------------------------------------------------------
# Train/serve skew tests
#
# Training observes pct_rides_open / is_headliner_open directly; a future slot
# cannot. These cover the imputation that keeps both sides on one distribution.
# ---------------------------------------------------------------------------

def _slot_records(hour_utc: int, open_flags: list[bool], day: int = 15):
    slot = datetime(2026, 6, day, hour_utc, 0, tzinfo=timezone.utc)
    return [
        RideHistory(
            ride_id=i + 1, ride_name=f"R{i + 1}", land_name="Land",
            wait_time=30, is_open=flag, recorded_at=slot,
        )
        for i, flag in enumerate(open_flags)
    ]


def test_cross_ride_profile_averages_by_park_hour():
    from pipeline import compute_cross_ride_profile

    # 14:00 UTC = 07:00 Pacific, 22:00 UTC = 15:00 Pacific
    morning = attach_cross_ride_features(
        _slot_records(14, [True, False, False, False]), frozenset({1})
    )
    afternoon = attach_cross_ride_features(
        _slot_records(22, [True, True, True, True]), frozenset({1})
    )
    profile = compute_cross_ride_profile(morning + afternoon)

    assert profile[7][0] == pytest.approx(0.25)
    assert profile[15][0] == pytest.approx(1.0)


def test_cross_ride_profile_ignores_records_without_lag_features():
    from pipeline import compute_cross_ride_profile

    raw = _slot_records(22, [True, True])  # never passed through attach_*
    assert compute_cross_ride_profile(raw) == {}


def test_impute_uses_training_mean_not_a_constant_one():
    """The skew this fixes: training saw 0.25 open at 7am, prediction must not send 1.0."""
    from pipeline import _impute_cross_ride

    profile = {7: (0.25, 0.0), 15: (1.0, 1.0)}
    assert _impute_cross_ride(profile, 7) == (0.25, 0.0)
    assert _impute_cross_ride(profile, 15) == (1.0, 1.0)


def test_impute_falls_back_to_overall_mean_for_an_unseen_hour():
    from pipeline import _impute_cross_ride

    profile = {10: (0.5, 0.0), 14: (1.0, 1.0)}
    pct, headliner = _impute_cross_ride(profile, 23)
    assert pct == pytest.approx(0.75)
    assert headliner == pytest.approx(0.5)


def test_impute_without_a_profile_returns_neutral_constants():
    from pipeline import _impute_cross_ride

    pct, _ = _impute_cross_ride(None, 12)
    assert pct == pytest.approx(1.0)
    assert _impute_cross_ride({}, 12)[0] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Label-leakage guard
# ---------------------------------------------------------------------------

def test_rolling_mean_does_not_leak_the_label_when_no_prior_week_exists():
    """rolling_7d_mean must never be imputed with the record's own wait_time.

    Doing so hands the model the answer for every row lacking 7-day history,
    which on a young dataset is most of them.
    """
    lone = RideHistory(
        ride_id=1, ride_name="R1", land_name="Land",
        wait_time=77, is_open=True,
        recorded_at=datetime(2026, 6, 15, 20, 0, tzinfo=timezone.utc),
    )
    enriched = compute_lag_features([lone])
    assert enriched[0].lag_features.rolling_7d_mean != 77.0
    assert enriched[0].lag_features.rolling_7d_mean == pytest.approx(0.0)


def test_rolling_mean_still_uses_real_history_when_present():
    base = datetime(2026, 6, 15, 20, 0, tzinfo=timezone.utc)
    records = [
        RideHistory(
            ride_id=1, ride_name="R1", land_name="Land",
            wait_time=w, is_open=True, recorded_at=base - timedelta(days=d),
        )
        for d, w in [(3, 20), (5, 40), (0, 99)]
    ]
    enriched = compute_lag_features(records)
    target = next(r for r in enriched if r.recorded_at == base)
    assert target.lag_features.rolling_7d_mean == pytest.approx(30.0)


# ---------------------------------------------------------------------------
# Headliner resolution
# ---------------------------------------------------------------------------

def test_resolve_headliner_ids_prefers_explicit_config():
    from model import resolve_headliner_ids

    history = _slot_records(22, [True, True, True, True])
    assert resolve_headliner_ids(history, frozenset({99})) == frozenset({99})


def test_resolve_headliner_ids_derives_top_quartile_by_mean_wait():
    from model import resolve_headliner_ids

    slot = datetime(2026, 6, 15, 22, 0, tzinfo=timezone.utc)
    waits = {1: 90, 2: 70, 3: 20, 4: 10, 5: 5, 6: 3, 7: 2, 8: 1}
    history = [
        RideHistory(
            ride_id=rid, ride_name=f"R{rid}", land_name="Land",
            wait_time=w, is_open=True, recorded_at=slot,
        )
        for rid, w in waits.items()
    ]
    assert resolve_headliner_ids(history, frozenset()) == frozenset({1, 2})


def test_resolve_headliner_ids_ignores_closed_records():
    from model import resolve_headliner_ids

    slot = datetime(2026, 6, 15, 22, 0, tzinfo=timezone.utc)
    history = [
        RideHistory(ride_id=1, ride_name="Closed", land_name="L",
                    wait_time=999, is_open=False, recorded_at=slot),
        RideHistory(ride_id=2, ride_name="Open", land_name="L",
                    wait_time=50, is_open=True, recorded_at=slot),
    ]
    assert resolve_headliner_ids(history, frozenset()) == frozenset({2})


def test_resolve_headliner_ids_on_empty_history():
    from model import resolve_headliner_ids

    assert resolve_headliner_ids([], frozenset()) == frozenset()


# ---------------------------------------------------------------------------
# build_forecast_slots edge cases
#
# The last slot of the Pacific day is 23:30. collect.py used to predict
# "today's remaining slots" every 30 minutes, and at 06:30 UTC in summer
# (23:31 PDT) that list was empty — XGBoost then crashed with "1 vs. 23".
# ---------------------------------------------------------------------------

def _pacific(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=PARK_TZ).astimezone(timezone.utc)


def test_build_forecast_slots_is_empty_after_the_last_slot_of_the_day():
    assert build_forecast_slots(_pacific(2026, 9, 13, 23, 31), days=1) == []


def test_build_forecast_slots_includes_a_slot_exactly_at_now():
    now = _pacific(2026, 9, 13, 23, 30)
    assert build_forecast_slots(now, days=1) == [now]


def test_build_forecast_slots_after_the_last_slot_starts_at_tomorrows_opening():
    slots = build_forecast_slots(_pacific(2026, 9, 13, 23, 31), days=2)
    assert slots[0] == _pacific(2026, 9, 14, 8, 0)
    assert len(slots) == 32  # 08:00 through 23:30


def test_build_forecast_slots_with_zero_days_is_empty():
    assert build_forecast_slots(_pacific(2026, 9, 13, 9, 0), days=0) == []


def test_build_forecast_slots_accepts_naive_utc():
    aware = datetime(2026, 9, 13, 16, 0, tzinfo=timezone.utc)
    assert build_forecast_slots(aware.replace(tzinfo=None), days=1) == build_forecast_slots(aware, days=1)


@pytest.mark.parametrize(
    "day, first_slot_utc",
    [
        # Fall back (Nov 1 2026): 08:00 local is already PST, UTC-8.
        ((2026, 11, 1), datetime(2026, 11, 1, 16, 0, tzinfo=timezone.utc)),
        # Spring forward (Mar 8 2026): 08:00 local is already PDT, UTC-7.
        ((2026, 3, 8), datetime(2026, 3, 8, 15, 0, tzinfo=timezone.utc)),
    ],
)
def test_build_forecast_slots_on_dst_days_has_32_unique_open_slots(day, first_slot_utc):
    y, m, d = day
    slots = build_forecast_slots(_pacific(y, m, d, 0, 0), days=1)

    assert slots[0] == first_slot_utc
    assert len(slots) == 32
    assert len(set(slots)) == 32
    assert slots == sorted(slots)
    assert all(park_date_key(s) == f"{y}-{m:02d}-{d:02d}" for s in slots)
    assert all(s.astimezone(PARK_TZ).hour not in PARK_CLOSED_LOCAL_HOURS for s in slots)


# ---------------------------------------------------------------------------
# generate_forecasts
# ---------------------------------------------------------------------------

def _raw_history_rows(ride_ids, now, n_per_ride=12):
    """Rows shaped like fetch_history's SELECT: rideId, rideName, landName, waitTime, isOpen, recordedAt."""
    return [
        (rid, f"Ride {rid}", "Land", 20 + i, True, (now - timedelta(days=i + 1)).replace(tzinfo=None))
        for rid in ride_ids
        for i in range(n_per_ride)
    ]


def test_generate_forecasts_with_no_slots_reads_nothing(fake_db):
    from pipeline import generate_forecasts

    conn = fake_db.connect("x")

    assert generate_forecasts(conn, _pacific(2026, 9, 13, 23, 31), days=1) == 0
    assert conn.statements == []


def test_generate_forecasts_raises_when_no_model_can_be_trained(fake_db):
    from pipeline import generate_forecasts

    conn = fake_db.connect("x")  # every SELECT returns no rows

    with pytest.raises(RuntimeError, match="No ride models trained"):
        generate_forecasts(conn, _pacific(2026, 9, 13, 9, 0), days=1)
    assert not any("DailyForecast" in sql for sql in conn.sql)


def test_generate_forecasts_upserts_one_row_per_ride_per_slot_without_committing(fake_db):
    from pipeline import generate_forecasts

    now = _pacific(2026, 9, 13, 9, 0)
    fake_db.results['FROM "WaitTimeRecord"'] = _raw_history_rows([1, 2], now)
    conn = fake_db.connect("x")

    written = generate_forecasts(conn, now, days=1)

    slots = build_forecast_slots(now, days=1)
    [upsert] = [s for s in conn.statements if 'INSERT INTO "DailyForecast"' in s.sql]
    assert upsert.many is True
    assert written == len(upsert.params) == 2 * len(slots)
    assert {row[1] for row in upsert.params} == {1, 2}
    assert {row[4] for row in upsert.params} == set(slots)
    assert all(row[2] in ("Ride 1", "Ride 2") and row[3] == "Land" for row in upsert.params)
    # Writing is the last statement, and committing is the caller's job.
    assert conn.statements[-1] is upsert
    assert "commit" not in conn.events

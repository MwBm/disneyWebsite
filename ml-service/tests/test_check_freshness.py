"""Tests for check_freshness.py — the daily stale-forecast monitor."""

from datetime import datetime, timedelta, timezone

import psycopg
import pytest

import check_freshness
from check_freshness import MAX_RAW_AGE, MAX_TRAIN_AGE, MIN_HORIZON, find_problems, in_check_window

NOON = datetime(2026, 9, 14, 12, 5, tzinfo=timezone.utc)
HEALTHY_TRAIN = NOON - timedelta(hours=6)       # this morning's 06:00 UTC run
HEALTHY_HORIZON = HEALTHY_TRAIN + timedelta(days=29)
HEALTHY_OLDEST_RAW = NOON - timedelta(days=33)  # archive ran 3 days ago


# ---------------------------------------------------------------------------
# in_check_window
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "now, expected",
    [
        (datetime(2026, 9, 14, 11, 59, 59, tzinfo=timezone.utc), False),
        (datetime(2026, 9, 14, 12, 0, tzinfo=timezone.utc), True),
        (datetime(2026, 9, 14, 12, 29, 59, tzinfo=timezone.utc), True),
        (datetime(2026, 9, 14, 12, 30, tzinfo=timezone.utc), False),
        (datetime(2026, 9, 14, 0, 5, tzinfo=timezone.utc), False),
        # Naive means UTC.
        (datetime(2026, 9, 14, 12, 10), True),
        # An aware non-UTC time is compared by its UTC instant: 05:10 PDT is 12:10 UTC.
        (datetime(2026, 9, 14, 12, 10, tzinfo=timezone.utc).astimezone(timezone(timedelta(hours=-7))), True),
    ],
)
def test_in_check_window(now, expected):
    assert in_check_window(now) is expected


# ---------------------------------------------------------------------------
# find_problems
# ---------------------------------------------------------------------------

def test_a_healthy_state_has_no_problems():
    assert find_problems(HEALTHY_TRAIN, HEALTHY_HORIZON, HEALTHY_OLDEST_RAW, NOON) == []


def test_one_missed_nightly_run_is_reported():
    yesterday = HEALTHY_TRAIN - timedelta(days=1)
    problems = find_problems(yesterday, yesterday + timedelta(days=29), HEALTHY_OLDEST_RAW, NOON)

    assert len(problems) == 1
    assert "30 h ago" in problems[0] and "train.yml" in problems[0]


def test_train_age_exactly_at_the_limit_is_not_a_problem():
    assert find_problems(NOON - MAX_TRAIN_AGE, HEALTHY_HORIZON, HEALTHY_OLDEST_RAW, NOON) == []
    assert len(find_problems(NOON - MAX_TRAIN_AGE - timedelta(seconds=1), HEALTHY_HORIZON, HEALTHY_OLDEST_RAW, NOON)) == 1


def test_horizon_exactly_at_the_minimum_is_not_a_problem():
    assert find_problems(HEALTHY_TRAIN, NOON + MIN_HORIZON, HEALTHY_OLDEST_RAW, NOON) == []
    [problem] = find_problems(HEALTHY_TRAIN, NOON + MIN_HORIZON - timedelta(seconds=1), HEALTHY_OLDEST_RAW, NOON)
    assert "days ahead (minimum 27)" in problem


def test_a_train_run_that_succeeds_with_a_short_window_is_reported():
    [problem] = find_problems(HEALTHY_TRAIN, NOON + timedelta(days=3), HEALTHY_OLDEST_RAW, NOON)
    assert "3.0 days ahead" in problem


def test_never_trained_and_empty_forecasts_reports_both():
    problems = find_problems(None, None, None, NOON)
    assert problems == [
        "No successful train run has ever been logged (CollectRun job='train').",
        "DailyForecast is empty.",
    ]


def test_forecasts_already_in_the_past_are_reported():
    [problem] = find_problems(HEALTHY_TRAIN, NOON - timedelta(days=2), HEALTHY_OLDEST_RAW, NOON)
    assert "-2.0 days ahead" in problem


def test_naive_database_timestamps_are_treated_as_utc():
    naive_train = HEALTHY_TRAIN.replace(tzinfo=None)
    naive_horizon = HEALTHY_HORIZON.replace(tzinfo=None)
    assert find_problems(naive_train, naive_horizon, HEALTHY_OLDEST_RAW, NOON) == []


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def _seed(fake_db, last_train, horizon, oldest_raw=None):
    fake_db.results["SELECT max(\"ranAt\")"] = [(last_train, horizon, oldest_raw)]


def test_outside_the_window_it_skips_without_connecting(fake_db, capsys):
    assert check_freshness.main([], now=datetime(2026, 9, 14, 3, 0, tzinfo=timezone.utc)) == 0
    assert fake_db.connect_attempts == 0
    assert "Skipping" in capsys.readouterr().out


def test_force_checks_outside_the_window(fake_db):
    _seed(fake_db, HEALTHY_TRAIN.replace(tzinfo=None), HEALTHY_HORIZON.replace(tzinfo=None))

    assert check_freshness.main(["--force"], now=datetime(2026, 9, 14, 12, 45, tzinfo=timezone.utc)) == 0
    assert fake_db.connect_attempts == 1


def test_fresh_forecasts_exit_zero_with_one_aggregate_read(fake_db, capsys):
    _seed(fake_db, HEALTHY_TRAIN.replace(tzinfo=None), HEALTHY_HORIZON.replace(tzinfo=None))

    assert check_freshness.main([], now=NOON) == 0

    [conn] = fake_db.connections
    assert conn.autocommit is True
    [statement] = conn.statements
    assert statement.sql.startswith("""SELECT (SELECT max("ranAt") FROM "CollectRun" WHERE job = 'train' AND success)""")
    assert "Forecasts are fresh" in capsys.readouterr().out


def test_stale_forecasts_exit_one_with_a_github_error_annotation(fake_db, capsys):
    _seed(fake_db, None, None)

    assert check_freshness.main([], now=NOON) == 1

    err = capsys.readouterr().err
    assert err.count("::error title=Forecasts are stale::") == 2


def test_a_database_failure_is_loud(fake_db):
    fake_db.connect_failures[0] = psycopg.OperationalError("connection timeout expired")

    with pytest.raises(psycopg.OperationalError):
        check_freshness.main([], now=NOON)


def test_missing_database_url_exits_one(monkeypatch, fake_db):
    monkeypatch.delenv("DATABASE_URL")

    assert check_freshness.main([], now=NOON) == 1
    assert fake_db.connect_attempts == 0


# ---------------------------------------------------------------------------
# Archive backlog
# ---------------------------------------------------------------------------

def test_raw_rows_just_inside_the_archive_grace_period_are_fine():
    assert find_problems(HEALTHY_TRAIN, HEALTHY_HORIZON, NOON - MAX_RAW_AGE, NOON) == []


def test_raw_rows_past_the_archive_grace_period_are_reported():
    oldest = NOON - MAX_RAW_AGE - timedelta(seconds=1)
    [problem] = find_problems(HEALTHY_TRAIN, HEALTHY_HORIZON, oldest, NOON)
    assert "archive.yml" in problem and "limit 38" in problem


def test_the_production_backlog_on_sep_14_2026_would_have_been_reported():
    """Archive last ran Aug 23; the oldest raw row was from Jul 24."""
    [problem] = find_problems(HEALTHY_TRAIN, HEALTHY_HORIZON, datetime(2026, 7, 24, 9, 30), NOON)
    assert "52 days ago" in problem


def test_an_empty_wait_time_table_is_not_an_archive_problem():
    assert find_problems(HEALTHY_TRAIN, HEALTHY_HORIZON, None, NOON) == []


def test_status_query_reads_the_oldest_raw_row():
    assert 'SELECT min("windowedAt") FROM "WaitTimeRecord"' in check_freshness.STATUS_SQL

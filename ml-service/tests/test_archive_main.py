"""Unit tests for archive.py — cutoffs, statement shape and run logging.

The SQL itself (bucketing, merging, DST, renames) is exercised against real
Postgres in tests/integration/test_jobs_db.py.
"""

from datetime import datetime, timedelta, timezone

import psycopg
import pytest

import archive
from common import FORECAST_RETENTION_DAYS, RAW_RETENTION_DAYS


@pytest.mark.parametrize(
    "now, expected",
    [
        (datetime(2026, 9, 20, 9, 26, 44, 123456, tzinfo=timezone.utc), datetime(2026, 8, 21, 9, 0, tzinfo=timezone.utc)),
        (datetime(2026, 9, 20, 9, 0, tzinfo=timezone.utc), datetime(2026, 8, 21, 9, 0, tzinfo=timezone.utc)),
        (datetime(2026, 9, 20, 9, 59, 59, 999999, tzinfo=timezone.utc), datetime(2026, 8, 21, 9, 0, tzinfo=timezone.utc)),
        (datetime(2026, 3, 1, 0, 30, tzinfo=timezone.utc), datetime(2026, 1, 30, 0, 0, tzinfo=timezone.utc)),
    ],
)
def test_raw_cutoff_is_truncated_to_the_hour(now, expected):
    assert archive.raw_cutoff(now) == expected


def test_raw_cutoff_never_splits_a_park_hour_in_either_timezone_offset():
    for now in (datetime(2026, 7, 5, 9, 41, tzinfo=timezone.utc), datetime(2026, 12, 6, 10, 17, tzinfo=timezone.utc)):
        from common import PARK_TZ

        local = archive.raw_cutoff(now).astimezone(PARK_TZ)
        assert (local.minute, local.second, local.microsecond) == (0, 0, 0)


def test_forecast_cutoff():
    now = datetime(2026, 9, 20, 9, 26, tzinfo=timezone.utc)
    assert archive.forecast_cutoff(now) == now - timedelta(days=FORECAST_RETENTION_DAYS)


def _seed_counts(fake_db, raw_deleted, buckets_written, forecasts_deleted=0):
    fake_db.results["WITH moved AS"] = [(raw_deleted, buckets_written)]


def test_archive_runs_one_server_side_statement_then_forecast_retention(fake_db):
    _seed_counts(fake_db, raw_deleted=40_320, buckets_written=20_160)
    before = datetime.now(timezone.utc)

    assert archive.main() == 0

    [conn] = fake_db.connections
    archive_stmt, retention_stmt, log_stmt = conn.statements
    assert archive_stmt.sql.startswith('WITH moved AS ( DELETE FROM "WaitTimeRecord"')
    assert "ON CONFLICT (\"rideId\", date, hour) DO UPDATE" in archive_stmt.sql
    assert archive_stmt.params["cutoff"] == archive.raw_cutoff(archive_stmt.params["cutoff"] + timedelta(days=RAW_RETENTION_DAYS))
    assert abs(archive_stmt.params["cutoff"] - (before - timedelta(days=RAW_RETENTION_DAYS))) < timedelta(hours=1)

    assert retention_stmt.sql == 'DELETE FROM "DailyForecast" WHERE "forecastFor" < %(cutoff)s'
    assert abs(retention_stmt.params["cutoff"] - (before - timedelta(days=FORECAST_RETENTION_DAYS))) < timedelta(seconds=5)

    assert log_stmt.sql.startswith('INSERT INTO "CollectRun"')
    assert conn.events[-1] == "commit" and conn.events.count("commit") == 1
    [run] = fake_db.collect_runs()
    assert (run["job"], run["rows"], run["success"]) == ("archive", 20_160, True)


def test_archive_reads_back_only_counts():
    """Egress: the final SELECT of ARCHIVE_SQL returns two counts, never rows."""
    final_select = archive.ARCHIVE_SQL.strip().splitlines()[-1].strip()
    assert final_select == "SELECT (SELECT count(*) FROM moved), (SELECT count(*) FROM written)"


def test_nothing_to_archive_logs_a_zero_row_success(fake_db):
    _seed_counts(fake_db, raw_deleted=0, buckets_written=0)

    assert archive.main() == 0

    [run] = fake_db.collect_runs()
    assert (run["job"], run["rows"], run["success"]) == ("archive", 0, True)


def test_a_failed_forecast_cleanup_rolls_back_the_archive_too(fake_db):
    _seed_counts(fake_db, raw_deleted=10, buckets_written=5)
    fake_db.fail_on['DELETE FROM "DailyForecast"'] = psycopg.errors.QueryCanceled(
        "canceling statement due to statement timeout"
    )

    assert archive.main() == 1

    work_conn, _ = fake_db.connections
    assert "commit" not in work_conn.events and work_conn.events[-1] == "rollback"
    [run] = fake_db.collect_runs()
    assert (run["job"], run["rows"], run["success"]) == ("archive", 0, False)
    assert "statement timeout" in run["error"]


def test_exits_nonzero_without_db_url(monkeypatch, fake_db):
    monkeypatch.delenv("DATABASE_URL")

    assert archive.main() == 1
    assert fake_db.connect_attempts == 0

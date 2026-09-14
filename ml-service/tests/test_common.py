"""Tests for common.py — shared settings, URL handling and the run-logging wrapper."""

import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import psycopg
import pytest

import common
from common import (
    CONNECT_TIMEOUT_SECONDS,
    as_utc,
    database_url_from_env,
    log_collect_run,
    normalize_db_url,
    park_date_key,
    park_hour,
    run_logged_job,
)

BASE = "postgresql://postgres.ref:p%40ss%3Fw0rd@aws-1-us-west-2.pooler.supabase.com:6543/postgres"


# ---------------------------------------------------------------------------
# normalize_db_url
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "url, expected",
    [
        pytest.param(BASE, BASE, id="no query string"),
        pytest.param(f"{BASE}?pgbouncer=true", BASE, id="only pgbouncer"),
        # The old str.replace("?pgbouncer=true", "") produced ".../postgres&sslmode=require":
        # database name "postgres&sslmode=require", sslmode silently dropped.
        pytest.param(f"{BASE}?pgbouncer=true&sslmode=require", f"{BASE}?sslmode=require", id="pgbouncer first"),
        pytest.param(f"{BASE}?sslmode=require&pgbouncer=true", f"{BASE}?sslmode=require", id="pgbouncer last"),
        pytest.param(
            f"{BASE}?sslmode=require&pgbouncer=true&application_name=train",
            f"{BASE}?sslmode=require&application_name=train",
            id="pgbouncer in the middle",
        ),
        pytest.param(
            f"{BASE}?pgbouncer=true&connection_limit=1&pool_timeout=0&schema=public",
            BASE,
            id="every Prisma-only param",
        ),
        pytest.param(f"{BASE}?pgbouncer", BASE, id="bare flag without a value"),
        pytest.param(f"{BASE}?", BASE, id="dangling question mark"),
        pytest.param(f"{BASE}?sslmode=require&&pgbouncer=true", f"{BASE}?sslmode=require", id="empty segment"),
        pytest.param(
            f"{BASE}?options=-c%20search_path%3Dpublic",
            f"{BASE}?options=-c%20search_path%3Dpublic",
            id="surviving param keeps its percent-encoding",
        ),
        pytest.param(f"{BASE}?mypgbouncer=true", f"{BASE}?mypgbouncer=true", id="key must match exactly"),
    ],
)
def test_normalize_db_url(url, expected):
    assert normalize_db_url(url) == expected


def test_normalize_db_url_keeps_an_encoded_password_intact():
    assert "p%40ss%3Fw0rd@" in normalize_db_url(f"{BASE}?pgbouncer=true")


# ---------------------------------------------------------------------------
# database_url_from_env / connect
# ---------------------------------------------------------------------------

def test_database_url_prefers_database_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"{BASE}?pgbouncer=true")
    monkeypatch.setenv("DIRECT_URL", "postgresql://direct/db")
    assert database_url_from_env() == BASE


def test_database_url_falls_back_to_direct_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DIRECT_URL", "postgresql://direct/db?sslmode=require")
    assert database_url_from_env() == "postgresql://direct/db?sslmode=require"


def test_empty_database_url_counts_as_unset(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("DIRECT_URL", "postgresql://direct/db")
    assert database_url_from_env() == "postgresql://direct/db"


def test_database_url_is_none_when_neither_is_set(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DIRECT_URL", raising=False)
    assert database_url_from_env() is None


def test_connect_sets_a_timeout_and_disables_prepared_statements(monkeypatch):
    calls = []
    monkeypatch.setattr(common.psycopg, "connect", lambda url, **kw: calls.append((url, kw)))

    common.connect("postgresql://x/db")
    common.connect("postgresql://x/db", autocommit=True)

    expected = {"prepare_threshold": None, "connect_timeout": CONNECT_TIMEOUT_SECONDS}
    assert calls == [
        ("postgresql://x/db", {"autocommit": False, **expected}),
        ("postgresql://x/db", {"autocommit": True, **expected}),
    ]


# ---------------------------------------------------------------------------
# Park time helpers
# ---------------------------------------------------------------------------

def test_as_utc_treats_naive_datetimes_as_utc():
    assert as_utc(datetime(2026, 6, 1, 12, 0)) == datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


def test_as_utc_leaves_aware_datetimes_alone():
    tokyo = datetime(2026, 6, 1, 21, 0, tzinfo=ZoneInfo("Asia/Tokyo"))
    assert as_utc(tokyo) is tokyo


@pytest.mark.parametrize(
    "utc, expected_date, expected_hour",
    [
        # Summer (PDT, UTC-7): the park day rolls over at 07:00 UTC.
        (datetime(2026, 6, 2, 6, 59, tzinfo=timezone.utc), "2026-06-01", 23),
        (datetime(2026, 6, 2, 7, 0, tzinfo=timezone.utc), "2026-06-02", 0),
        # Winter (PST, UTC-8): the rollover moves to 08:00 UTC.
        (datetime(2026, 12, 2, 7, 59, tzinfo=timezone.utc), "2026-12-01", 23),
        (datetime(2026, 12, 2, 8, 0, tzinfo=timezone.utc), "2026-12-02", 0),
        # Fall back, Nov 1 2026: 01:30 local happens twice, both on Nov 1.
        (datetime(2026, 11, 1, 8, 30, tzinfo=timezone.utc), "2026-11-01", 1),
        (datetime(2026, 11, 1, 9, 30, tzinfo=timezone.utc), "2026-11-01", 1),
        # Spring forward, Mar 8 2026: 02:00 local never happens.
        (datetime(2026, 3, 8, 9, 59, tzinfo=timezone.utc), "2026-03-08", 1),
        (datetime(2026, 3, 8, 10, 0, tzinfo=timezone.utc), "2026-03-08", 3),
        # Naive input is UTC, matching what Prisma DateTime columns return.
        (datetime(2026, 6, 2, 6, 59), "2026-06-01", 23),
    ],
)
def test_park_date_key_and_hour(utc, expected_date, expected_hour):
    assert park_date_key(utc) == expected_date
    assert park_hour(utc) == expected_hour


# ---------------------------------------------------------------------------
# log_collect_run
# ---------------------------------------------------------------------------

def test_log_collect_run_inserts_one_row(fake_db):
    conn = fake_db.connect("x")
    before = datetime.now(timezone.utc)

    log_collect_run(conn, "train", 42, success=False, error_message="boom")

    [statement] = conn.statements
    assert statement.sql.startswith('INSERT INTO "CollectRun"')
    run_id, job, ran_at, rows, success, error = statement.params
    uuid.UUID(run_id)
    assert ran_at.tzinfo is not None and before <= ran_at <= datetime.now(timezone.utc)
    assert (job, rows, success, error) == ("train", 42, False, "boom")


# ---------------------------------------------------------------------------
# run_logged_job
# ---------------------------------------------------------------------------

def _writes_rows(n: int):
    def work(conn):
        with conn.cursor() as cur:
            cur.executemany('INSERT INTO "WaitTimeRecord" VALUES (%s)', [(i,) for i in range(n)])
        return n
    return work


def test_run_logged_job_without_a_database_url_never_connects(monkeypatch, fake_db, capsys):
    monkeypatch.delenv("DATABASE_URL")

    assert run_logged_job("collect", _writes_rows(3)) == 1
    assert fake_db.connect_attempts == 0
    assert "DATABASE_URL or DIRECT_URL must be set" in capsys.readouterr().err


def test_run_logged_job_success_logs_in_the_same_transaction(fake_db):
    assert run_logged_job("collect", _writes_rows(3)) == 0

    [conn] = fake_db.connections
    assert conn.autocommit is False
    assert conn.sql[0].startswith('INSERT INTO "WaitTimeRecord"')
    assert conn.sql[1].startswith('INSERT INTO "CollectRun"')
    # The success row commits together with the work, and only once.
    assert conn.events == ["execute", "execute", "commit"]
    [run] = fake_db.collect_runs()
    assert run["job"] == "collect"
    rows, success, error = run["rows"], run["success"], run["error"]
    assert (rows, success, error) == (3, True, None)
    assert conn.closed


def test_run_logged_job_failure_rolls_back_and_logs_zero_rows(fake_db):
    def work(conn):
        _writes_rows(5)(conn)
        raise ValueError("model exploded")

    assert run_logged_job("collect", work) == 1

    work_conn, log_conn = fake_db.connections
    assert "commit" not in work_conn.events
    assert work_conn.events[-1] == "rollback"
    assert not any("CollectRun" in sql for sql in work_conn.sql)
    # The 5 rows were rolled back, so the failure row must not claim them.
    assert log_conn.autocommit is True
    [run] = fake_db.collect_runs()
    assert run["job"] == "collect"
    rows, success, error = run["rows"], run["success"], run["error"]
    assert (rows, success, error) == (0, False, "model exploded")


def test_run_logged_job_rolls_back_when_the_success_log_itself_fails(fake_db):
    fake_db.fail_on['INSERT INTO "CollectRun"'] = psycopg.OperationalError("CollectRun unavailable")

    # The failure log hits the same broken table; the job must still exit 1
    # rather than raise and hide the original error.
    assert run_logged_job("collect", _writes_rows(2)) == 1

    work_conn, log_conn = fake_db.connections
    assert "commit" not in work_conn.events
    assert work_conn.events[-1] == "rollback"
    assert log_conn.sql == [fake_db.statements[-1].sql]


def test_run_logged_job_logs_when_the_first_connect_fails(fake_db):
    fake_db.connect_failures[0] = psycopg.OperationalError("connection timeout expired")

    assert run_logged_job("collect", _writes_rows(2)) == 1

    [log_conn] = fake_db.connections
    assert log_conn.autocommit is True
    [run] = fake_db.collect_runs()
    assert run["job"] == "collect"
    rows, success, error = run["rows"], run["success"], run["error"]
    assert (rows, success, error) == (0, False, "connection timeout expired")


def test_run_logged_job_exits_1_when_every_connect_fails(fake_db):
    fake_db.connect_failures[0] = psycopg.OperationalError("down")
    fake_db.connect_failures[1] = psycopg.OperationalError("still down")

    assert run_logged_job("collect", _writes_rows(2)) == 1
    assert fake_db.connections == []
    assert fake_db.connect_attempts == 2


# ---------------------------------------------------------------------------
# Job names
# ---------------------------------------------------------------------------

def test_jobs_match_the_prisma_jobkind_enum():
    """CollectRun.job is a Postgres enum generated from schema.prisma; drift fails every insert."""
    import re
    from pathlib import Path

    schema = (Path(__file__).resolve().parents[2] / "prisma" / "schema.prisma").read_text()
    body = re.search(r"enum JobKind \{(.*?)\}", schema, re.S).group(1)
    enum_values = [line.split("//")[0].strip() for line in body.splitlines()]
    assert tuple(v for v in enum_values if v) == common.JOBS


def test_log_collect_run_rejects_an_unknown_job_before_touching_the_database(fake_db):
    conn = fake_db.connect("x")

    with pytest.raises(ValueError, match="unknown job 'cleanup'"):
        log_collect_run(conn, "cleanup", 1, success=True)
    assert conn.statements == []


def test_run_logged_job_rejects_an_unknown_job_before_connecting(fake_db):
    with pytest.raises(ValueError, match="unknown job 'Collect'"):
        run_logged_job("Collect", _writes_rows(1))
    assert fake_db.connect_attempts == 0


@pytest.mark.parametrize("job", common.JOBS)
def test_run_logged_job_records_the_job_on_success_and_failure(fake_db, job):
    def fails(conn):
        raise RuntimeError("nope")

    assert run_logged_job(job, _writes_rows(1)) == 0
    assert run_logged_job(job, fails) == 1

    assert [(r["job"], r["success"]) for r in fake_db.collect_runs()] == [(job, True), (job, False)]


# ---------------------------------------------------------------------------
# Retention constants
# ---------------------------------------------------------------------------

def test_forecasts_outlive_every_window_that_reads_them():
    """archive.py deletes forecasts older than FORECAST_RETENTION_DAYS; the accuracy routes read back WINDOW_DAYS."""
    import re
    from pathlib import Path

    src = Path(__file__).resolve().parents[2] / "src"
    windows = {
        path.relative_to(src).as_posix(): int(match.group(1))
        for path in src.rglob("*.ts")
        for match in [re.search(r"\bconst WINDOW_DAYS = (\d+);", path.read_text())]
        if match
    }
    assert windows, "expected the accuracy routes to define WINDOW_DAYS"
    for path, days in windows.items():
        assert common.FORECAST_RETENTION_DAYS > days, f"{path} reads {days} days of forecasts"


def test_forecast_retention_covers_the_raw_rows_it_is_compared_with():
    assert common.FORECAST_RETENTION_DAYS >= common.RAW_RETENTION_DAYS


def test_archive_grace_exceeds_the_weekly_schedule():
    assert common.ARCHIVE_GRACE_DAYS > 7

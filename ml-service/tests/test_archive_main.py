"""Orchestration tests for archive.main — it used to run with no logging at all."""

from datetime import datetime, timedelta, timezone

import psycopg

import archive
from common import RAW_RETENTION_DAYS

BUCKET_QUERY = "WITH localized AS"


def _bucket(ride_id, hour):
    return (ride_id, f"Ride {ride_id}", "Land", datetime(2026, 8, 1), hour, 30.0, 45, 2, True)


def test_nothing_to_archive_logs_a_zero_row_success(fake_db):
    assert archive.main() == 0

    [conn] = fake_db.connections
    assert conn.sql[0].startswith(BUCKET_QUERY)
    assert not any(sql.startswith(("INSERT INTO \"HourlyWaitSummary\"", "DELETE")) for sql in conn.sql)
    assert conn.events[-1] == "commit"
    [run] = fake_db.collect_runs()
    assert (run["job"], run["rows"], run["success"]) == ("archive", 0, True)


def test_archives_buckets_then_deletes_raw_rows_in_one_transaction(fake_db):
    fake_db.results[BUCKET_QUERY] = [_bucket(1, 9), _bucket(1, 10), _bucket(2, 9)]
    before = datetime.now(timezone.utc)

    assert archive.main() == 0

    [conn] = fake_db.connections
    kinds = [sql.split(" (")[0].split(" WHERE")[0] for sql in conn.sql]
    assert kinds == [BUCKET_QUERY, 'INSERT INTO "HourlyWaitSummary"', 'DELETE FROM "WaitTimeRecord"', 'INSERT INTO "CollectRun"']
    assert conn.events.count("commit") == 1 and conn.events[-1] == "commit"

    select_cutoff = conn.statements[0].params[0]
    delete_cutoff = conn.statements[2].params[0]
    assert select_cutoff == delete_cutoff, "rows aggregated and rows deleted must use the same cutoff"
    expected = before - timedelta(days=RAW_RETENTION_DAYS)
    assert abs(select_cutoff - expected) < timedelta(seconds=5)

    [run] = fake_db.collect_runs()
    assert (run["job"], run["rows"], run["success"]) == ("archive", 3, True)


def test_a_failed_delete_rolls_back_the_summaries_too(fake_db):
    fake_db.results[BUCKET_QUERY] = [_bucket(1, 9)]
    fake_db.fail_on['DELETE FROM "WaitTimeRecord"'] = psycopg.errors.QueryCanceled("canceling statement due to statement timeout")

    assert archive.main() == 1

    work_conn, log_conn = fake_db.connections
    assert "commit" not in work_conn.events
    assert work_conn.events[-1] == "rollback"
    [run] = fake_db.collect_runs()
    assert (run["job"], run["rows"], run["success"]) == ("archive", 0, False)
    assert "statement timeout" in run["error"]


def test_exits_nonzero_without_db_url(monkeypatch, fake_db):
    monkeypatch.delenv("DATABASE_URL")

    assert archive.main() == 1
    assert fake_db.connect_attempts == 0

"""Tests for collect.py — the 30-minute live wait-time collector."""

import uuid
from datetime import datetime, timezone

import httpx
import psycopg
import pytest
from pydantic import ValidationError

import collect
from collect import fetch_live_rides, round_to_window, upsert_wait_records


def _ride(ride_id, name, wait=30, is_open=True):
    return {"id": ride_id, "name": name, "is_open": is_open, "wait_time": wait,
            "last_updated": "2026-09-13T17:00:00.000Z"}


PARKS = [
    {"queueTimesUrl": "https://queue-times.test/parks/16/queue_times.json", "excludedRideIds": [3]},
    {"queueTimesUrl": "https://queue-times.test/parks/17/queue_times.json", "excludedRideIds": [12]},
]

PAYLOADS = {
    PARKS[0]["queueTimesUrl"]: {
        "lands": [{"id": 1, "name": "Tomorrowland", "rides": [_ride(1, "Space Mountain", 45), _ride(3, "Excluded")]}],
        "rides": [_ride(2, "Loose Ride", 10, is_open=False)],
    },
    PARKS[1]["queueTimesUrl"]: {
        "lands": [{"id": 2, "name": "Cars Land", "rides": [_ride(11, "Radiator Springs Racers", 70)]}],
        "rides": [_ride(12, "Excluded Loose Ride")],
    },
}


@pytest.fixture
def queue_times(monkeypatch):
    """Serve PAYLOADS for every park; tests can overwrite entries to break one."""
    payloads = {url: dict(body) for url, body in PAYLOADS.items()}
    monkeypatch.setattr(collect, "_load_park_configs", lambda: PARKS)

    def fake_get(url, timeout):
        body = payloads[url]
        if isinstance(body, int):
            return httpx.Response(body, request=httpx.Request("GET", url))
        return httpx.Response(200, json=body, request=httpx.Request("GET", url))

    monkeypatch.setattr(collect.httpx, "get", fake_get)
    return payloads


# ---------------------------------------------------------------------------
# round_to_window
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "now, expected",
    [
        (datetime(2026, 9, 13, 17, 0, tzinfo=timezone.utc), datetime(2026, 9, 13, 17, 0, tzinfo=timezone.utc)),
        (datetime(2026, 9, 13, 17, 7, 42, tzinfo=timezone.utc), datetime(2026, 9, 13, 17, 0, tzinfo=timezone.utc)),
        (datetime(2026, 9, 13, 17, 23, tzinfo=timezone.utc), datetime(2026, 9, 13, 17, 30, tzinfo=timezone.utc)),
        # GitHub often starts a :30 dispatch a few minutes late; it still lands on :30.
        (datetime(2026, 9, 13, 17, 34, 59, tzinfo=timezone.utc), datetime(2026, 9, 13, 17, 30, tzinfo=timezone.utc)),
        (datetime(2026, 9, 13, 23, 50, tzinfo=timezone.utc), datetime(2026, 9, 14, 0, 0, tzinfo=timezone.utc)),
    ],
)
def test_round_to_window(now, expected):
    assert round_to_window(now) == expected


# ---------------------------------------------------------------------------
# fetch_live_rides
# ---------------------------------------------------------------------------

def test_fetch_live_rides_flattens_every_park_and_skips_excluded(queue_times):
    rides = fetch_live_rides()

    assert rides == [
        {"id": 1, "name": "Space Mountain", "land_name": "Tomorrowland", "is_open": True, "wait_time": 45},
        {"id": 2, "name": "Loose Ride", "land_name": "Other", "is_open": False, "wait_time": 10},
        {"id": 11, "name": "Radiator Springs Racers", "land_name": "Cars Land", "is_open": True, "wait_time": 70},
    ]


def test_fetch_live_rides_raises_on_an_http_error(queue_times):
    queue_times[PARKS[1]["queueTimesUrl"]] = 503

    with pytest.raises(httpx.HTTPStatusError):
        fetch_live_rides()


def test_fetch_live_rides_raises_on_a_malformed_payload(queue_times):
    queue_times[PARKS[0]["queueTimesUrl"]] = {"lands": [{"id": 1, "name": "Broken", "rides": [{"id": "x"}]}]}

    with pytest.raises(ValidationError):
        fetch_live_rides()


def test_fetch_live_rides_with_empty_payloads_returns_nothing(queue_times):
    for url in queue_times:
        queue_times[url] = {}

    assert fetch_live_rides() == []


# ---------------------------------------------------------------------------
# upsert_wait_records
# ---------------------------------------------------------------------------

def test_upsert_wait_records_row_shape(fake_db):
    conn = fake_db.connect("x")
    windowed_at = datetime(2026, 9, 13, 17, 0, tzinfo=timezone.utc)
    now = datetime(2026, 9, 13, 17, 2, tzinfo=timezone.utc)
    rides = [{"id": 1, "name": "Space Mountain", "land_name": "Tomorrowland", "is_open": True, "wait_time": 45}]

    assert upsert_wait_records(conn, rides, windowed_at, now) == 1

    [statement] = conn.statements
    assert statement.many is True
    assert "ON CONFLICT (\"rideId\", \"windowedAt\") DO UPDATE" in statement.sql
    [(row_id, *rest)] = statement.params
    uuid.UUID(row_id)
    assert rest == [1, "Space Mountain", "Tomorrowland", 45, True, windowed_at, now]


# ---------------------------------------------------------------------------
# main — orchestration and the egress guard
# ---------------------------------------------------------------------------

def test_main_exits_nonzero_without_db_url(monkeypatch, fake_db, queue_times):
    monkeypatch.delenv("DATABASE_URL")

    assert collect.main() == 1
    assert fake_db.connect_attempts == 0


def test_main_writes_wait_records_and_a_success_run(fake_db, queue_times):
    assert collect.main() == 0

    [conn] = fake_db.connections
    assert conn.events[-1] == "commit"
    [upsert] = [s for s in conn.statements if 'INSERT INTO "WaitTimeRecord"' in s.sql]
    assert len(upsert.params) == 3
    windowed_at = upsert.params[0][6]
    assert windowed_at.minute in (0, 30) and windowed_at.second == 0 and windowed_at.microsecond == 0
    [run] = fake_db.collect_runs()
    assert run["job"] == "collect"
    rows, success, error = run["rows"], run["success"], run["error"]
    assert (rows, success, error) == (3, True, None)


def test_main_runs_only_its_two_writes_and_never_reads(fake_db, queue_times):
    """Egress guard.

    Every byte a SELECT returns counts against Supabase's 5 GB/month egress
    quota. collect.py once reloaded ~20-28 MB of training history on each of
    its 48 daily runs and used 16.5 GB in one cycle. If this test fails, a
    read has crept back in: move it to train.py, which runs once a day.
    """
    assert collect.main() == 0

    allowed = ('INSERT INTO "WaitTimeRecord"', 'INSERT INTO "CollectRun"')
    statements = [s.sql for s in fake_db.statements]
    assert statements, "collect should have written something"
    assert all(sql.startswith(allowed) for sql in statements), statements
    assert not any("SELECT" in sql.upper() for sql in statements)


def test_main_logs_a_failure_when_queue_times_is_down(fake_db, queue_times):
    queue_times[PARKS[0]["queueTimesUrl"]] = 502

    assert collect.main() == 1

    assert not any('INSERT INTO "WaitTimeRecord"' in s.sql for s in fake_db.statements)
    [run] = fake_db.collect_runs()
    assert run["job"] == "collect"
    rows, success, error = run["rows"], run["success"], run["error"]
    assert (rows, success) == (0, False)
    assert "502" in error


def test_main_treats_zero_rides_as_a_failure(fake_db, queue_times):
    for url in queue_times:
        queue_times[url] = {}

    assert collect.main() == 1

    assert not any('INSERT INTO "WaitTimeRecord"' in s.sql for s in fake_db.statements)
    [run] = fake_db.collect_runs()
    assert run["job"] == "collect"
    rows, success, error = run["rows"], run["success"], run["error"]
    assert (rows, success) == (0, False)
    assert "no rides" in error


def test_main_rolls_back_and_logs_when_the_upsert_fails(fake_db, queue_times):
    fake_db.fail_on['INSERT INTO "WaitTimeRecord"'] = psycopg.errors.DeadlockDetected("deadlock detected")

    assert collect.main() == 1

    work_conn, log_conn = fake_db.connections
    assert work_conn.events[-1] == "rollback"
    assert "commit" not in work_conn.events
    assert log_conn.autocommit is True
    [run] = fake_db.collect_runs()
    assert run["job"] == "collect"
    rows, success, error = run["rows"], run["success"], run["error"]
    assert (rows, success, error) == (0, False, "deadlock detected")

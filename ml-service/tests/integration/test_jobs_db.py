"""The ml-service jobs against real Postgres: SQL, transactions, enum casts."""

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg
import pytest

import archive
import train
from collect import upsert_wait_records
from common import log_collect_run, run_logged_job
from model import MIN_SAMPLES
from pipeline import build_forecast_slots

pytestmark = pytest.mark.integration

PT = ZoneInfo("America/Los_Angeles")
RIDE = {"id": 1, "name": "Space Mountain", "land_name": "Tomorrowland", "is_open": True, "wait_time": 45}


def _count(pg, table, where="TRUE", params=()):
    return pg.execute(f'SELECT count(*) FROM "{table}" WHERE {where}', params).fetchone()[0]


def _runs(pg):
    return pg.execute('SELECT job::text, "rowsUpserted", success, "errorMessage" FROM "CollectRun" ORDER BY "ranAt"').fetchall()


# ---------------------------------------------------------------------------
# run_logged_job / log_collect_run
# ---------------------------------------------------------------------------

def test_success_commits_the_work_and_its_run_row_together(pg):
    now = datetime.now(timezone.utc)

    assert run_logged_job("collect", lambda conn: upsert_wait_records(conn, [RIDE], now, now)) == 0

    assert _count(pg, "WaitTimeRecord") == 1
    assert _runs(pg) == [("collect", 1, True, None)]


def test_failure_rolls_back_the_work_and_logs_the_error(pg):
    now = datetime.now(timezone.utc)

    def work(conn):
        upsert_wait_records(conn, [RIDE], now, now)
        raise RuntimeError("exploded after writing")

    assert run_logged_job("collect", work) == 1

    assert _count(pg, "WaitTimeRecord") == 0
    assert _runs(pg) == [("collect", 0, False, "exploded after writing")]


def test_a_sql_error_in_the_work_is_logged_not_raised(pg):
    def work(conn):
        conn.execute('SELECT * FROM "NoSuchTable"')
        return 0

    assert run_logged_job("train", work) == 1

    [(job, rows, success, error)] = _runs(pg)
    assert (job, rows, success) == ("train", 0, False)
    assert 'relation "NoSuchTable" does not exist' in error


@pytest.mark.parametrize("job", ["collect", "train", "archive"])
def test_every_job_name_casts_into_the_jobkind_enum(pg, job):
    log_collect_run(pg, job, 7, success=True)

    assert pg.execute('SELECT job::text, pg_typeof(job)::text FROM "CollectRun"').fetchone() == (job, '"JobKind"')


def test_the_database_rejects_a_job_outside_the_enum(pg):
    with pytest.raises(psycopg.errors.InvalidTextRepresentation):
        pg.execute(
            'INSERT INTO "CollectRun" (id, job, "rowsUpserted", success) VALUES (%s, %s, 0, true)',
            (str(uuid.uuid4()), "cleanup"),
        )


def test_job_defaults_to_collect_for_writers_that_omit_it(pg):
    pg.execute('INSERT INTO "CollectRun" (id, "rowsUpserted", success) VALUES (%s, 3, true)', (str(uuid.uuid4()),))

    assert _runs(pg) == [("collect", 3, True, None)]


# ---------------------------------------------------------------------------
# collect
# ---------------------------------------------------------------------------

def test_upserting_the_same_window_twice_updates_in_place(pg):
    window = datetime(2026, 9, 13, 17, 0, tzinfo=timezone.utc)
    first = datetime(2026, 9, 13, 17, 1, tzinfo=timezone.utc)
    second = datetime(2026, 9, 13, 17, 14, tzinfo=timezone.utc)

    with pg.transaction():
        upsert_wait_records(pg, [RIDE], window, first)
    with pg.transaction():
        upsert_wait_records(pg, [{**RIDE, "wait_time": 60, "is_open": False}], window, second)

    rows = pg.execute('SELECT "waitTime", "isOpen", "recordedAt" FROM "WaitTimeRecord"').fetchall()
    assert rows == [(60, False, second.replace(tzinfo=None))]


# ---------------------------------------------------------------------------
# train, end to end
# ---------------------------------------------------------------------------

def _seed_training_data(pg, now):
    """Ride 1 gets enough raw history for a real XGBoost model; ride 2 only enough for the fallback."""
    raw = []
    for ride_id, days in ((1, 29), (2, 2)):
        for d in range(1, days + 1):
            for h in range(8, 23):
                local = datetime.combine((now.astimezone(PT) - timedelta(days=d)).date(), datetime.min.time(), PT)
                recorded = (local + timedelta(hours=h)).astimezone(timezone.utc).replace(tzinfo=None)
                raw.append((str(uuid.uuid4()), ride_id, f"Ride {ride_id}", "Land", 20 + (h * 7 + d) % 40,
                            True, recorded, recorded))
    assert sum(1 for r in raw if r[1] == 1) >= MIN_SAMPLES
    with pg.cursor() as cur:
        cur.executemany(
            'INSERT INTO "WaitTimeRecord" (id, "rideId", "rideName", "landName", "waitTime", "isOpen", "windowedAt", "recordedAt") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            raw,
        )
        today = now.astimezone(PT).date()
        cur.executemany(
            'INSERT INTO "HourlyWaitSummary" (id, "rideId", "rideName", "landName", date, hour, "avgWait", "peakWait", "sampleCount", "isOpen") '
            "VALUES (%s, 1, 'Ride 1', 'Land', %s, %s, %s, %s, 2, true)",
            [(str(uuid.uuid4()), datetime.combine(today - timedelta(days=d), datetime.min.time()), h, 30.0 + h, 40 + h)
             for d in range(31, 60) for h in range(8, 23)],
        )
        cur.executemany(
            'INSERT INTO "DateContext" (id, date, tier, "isHoliday", "isSchoolBreak", "tempHigh", "tempLow", "precipMm", "isRainy") '
            "VALUES (%s, %s, %s, false, false, 85, 62, 0, false)",
            [(str(uuid.uuid4()), datetime.combine(today + timedelta(days=k), datetime.min.time()), k % 5)
             for k in range(-60, 32)],
        )


def test_train_writes_the_full_window_and_reruns_upsert_in_place(pg):
    now = datetime.now(timezone.utc)
    _seed_training_data(pg, now)

    assert train.main() == 0
    first_count = _count(pg, "DailyForecast")
    assert train.main() == 0

    slots_now = build_forecast_slots(datetime.now(timezone.utc), days=train.FORECAST_DAYS)
    # A slot can pass between the two runs; the first run's rows for it remain.
    assert _count(pg, "DailyForecast") == first_count
    assert first_count in (2 * len(slots_now), 2 * (len(slots_now) + 1))
    assert _count(pg, "DailyForecast", '"predictedWait" < 0 OR "predictedWait" > 300') == 0

    horizon = pg.execute('SELECT max("forecastFor") FROM "DailyForecast"').fetchone()[0]
    assert horizon.replace(tzinfo=timezone.utc) - now > timedelta(days=28)
    runs = _runs(pg)
    assert [(job, success) for job, _, success, _ in runs] == [("train", True), ("train", True)]
    assert runs[0][1] == first_count


# ---------------------------------------------------------------------------
# archive, end to end
# ---------------------------------------------------------------------------

def _insert_raw(pg, ride_id, at_utc, wait, is_open=True):
    naive = at_utc.astimezone(timezone.utc).replace(tzinfo=None)
    pg.execute(
        'INSERT INTO "WaitTimeRecord" (id, "rideId", "rideName", "landName", "waitTime", "isOpen", "windowedAt", "recordedAt") '
        "VALUES (%s, %s, %s, 'Land', %s, %s, %s, %s)",
        (str(uuid.uuid4()), ride_id, f"Ride {ride_id}", wait, is_open, naive, naive),
    )


def test_archive_aggregates_old_rows_by_park_hour_and_keeps_recent_ones(pg):
    old_day = datetime(2026, 6, 1, tzinfo=PT)
    _insert_raw(pg, 1, old_day + timedelta(hours=14), 30)
    _insert_raw(pg, 1, old_day + timedelta(hours=14, minutes=30), 50, is_open=False)
    _insert_raw(pg, 2, old_day + timedelta(hours=14), 10)
    recent = datetime.now(timezone.utc) - timedelta(days=2)
    _insert_raw(pg, 1, recent, 99)

    assert archive.main() == 0

    buckets = pg.execute(
        'SELECT "rideId", date, hour, "avgWait", "peakWait", "sampleCount", "isOpen" FROM "HourlyWaitSummary" ORDER BY "rideId"'
    ).fetchall()
    assert buckets == [
        (1, datetime(2026, 6, 1), 14, 40.0, 50, 2, True),
        (2, datetime(2026, 6, 1), 14, 10.0, 10, 1, True),
    ]
    assert _count(pg, "WaitTimeRecord") == 1
    assert _count(pg, "WaitTimeRecord", '"waitTime" = 99') == 1
    assert _runs(pg) == [("archive", 2, True, None)]


def test_archive_buckets_across_both_dst_transitions(pg):
    # Fall back, Nov 2 2025 (first Sunday of November): 01:30 PDT (08:30 UTC)
    # and 01:30 PST (09:30 UTC) are one park hour.
    _insert_raw(pg, 1, datetime(2025, 11, 2, 8, 30, tzinfo=timezone.utc), 20)
    _insert_raw(pg, 1, datetime(2025, 11, 2, 9, 30, tzinfo=timezone.utc), 40)
    # Spring forward, Mar 8 2026: 01:30 PST is followed directly by 03:00 PDT.
    _insert_raw(pg, 2, datetime(2026, 3, 8, 9, 30, tzinfo=timezone.utc), 5)
    _insert_raw(pg, 2, datetime(2026, 3, 8, 10, 0, tzinfo=timezone.utc), 15)

    assert archive.main() == 0

    buckets = pg.execute(
        'SELECT "rideId", date, hour, "avgWait", "sampleCount" FROM "HourlyWaitSummary" ORDER BY "rideId", hour'
    ).fetchall()
    assert buckets == [
        (1, datetime(2025, 11, 2), 1, 30.0, 2),
        (2, datetime(2026, 3, 8), 1, 5.0, 1),
        (2, datetime(2026, 3, 8), 3, 15.0, 1),
    ]


def test_archive_with_nothing_old_logs_a_zero_row_success(pg):
    _insert_raw(pg, 1, datetime.now(timezone.utc) - timedelta(hours=1), 20)

    assert archive.main() == 0

    assert _count(pg, "HourlyWaitSummary") == 0
    assert _count(pg, "WaitTimeRecord") == 1
    assert _runs(pg) == [("archive", 0, True, None)]

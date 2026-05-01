"""Tests for archive.py pure-logic functions (no DB required)."""

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, call
from archive import fetch_buckets_to_archive, insert_summaries, delete_archived_rows


def _make_bucket(ride_id=1, ride_name="Space Mountain", land_name="Tomorrowland",
                 date=None, hour=10, avg_wait=35.0, peak_wait=50, sample_count=2, is_open=True):
    date = date or datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    return (ride_id, ride_name, land_name, date, hour, avg_wait, peak_wait, sample_count, is_open)


def test_insert_summaries_returns_bucket_count():
    cur = MagicMock()
    buckets = [_make_bucket(ride_id=1), _make_bucket(ride_id=2)]
    count = insert_summaries(cur, buckets)
    assert count == 2
    cur.executemany.assert_called_once()


def test_insert_summaries_empty_skips_db():
    cur = MagicMock()
    count = insert_summaries(cur, [])
    assert count == 0
    cur.executemany.assert_not_called()


def test_insert_summaries_row_shape():
    """Verify the tuple passed to executemany has 10 columns in the right order."""
    cur = MagicMock()
    date = datetime(2026, 3, 15, 0, 0, 0, tzinfo=timezone.utc)
    bucket = _make_bucket(ride_id=7, ride_name="Matterhorn", land_name="Fantasyland",
                          date=date, hour=14, avg_wait=42.5, peak_wait=60, sample_count=2, is_open=True)
    insert_summaries(cur, [bucket])

    args = cur.executemany.call_args[0]
    rows = args[1]
    assert len(rows) == 1

    row = rows[0]
    assert len(row) == 10
    # id is a UUID string
    assert len(row[0]) == 36
    assert row[1] == 7           # rideId
    assert row[2] == "Matterhorn"
    assert row[3] == "Fantasyland"
    assert row[4] == date        # date
    assert row[5] == 14          # hour
    assert row[6] == 42.5        # avgWait
    assert row[7] == 60          # peakWait
    assert row[8] == 2           # sampleCount
    assert row[9] is True        # isOpen


def test_delete_archived_rows_returns_rowcount():
    cur = MagicMock()
    cur.rowcount = 42
    cutoff = datetime(2026, 4, 1, 0, 0, 0, tzinfo=timezone.utc)
    deleted = delete_archived_rows(cur, cutoff)
    assert deleted == 42
    cur.execute.assert_called_once()
    # Cutoff passed as parameter
    assert cur.execute.call_args[0][1] == (cutoff,)


def test_fetch_buckets_calls_query_with_cutoff():
    cur = MagicMock()
    cur.fetchall.return_value = []
    cutoff = datetime(2026, 4, 1, 0, 0, 0, tzinfo=timezone.utc)
    result = fetch_buckets_to_archive(cur, cutoff)
    assert result == []
    cur.execute.assert_called_once()
    assert cur.execute.call_args[0][1] == (cutoff,)

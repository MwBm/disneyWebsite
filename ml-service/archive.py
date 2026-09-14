"""Weekly archival job: aggregate WaitTimeRecord rows older than 30 days
into HourlyWaitSummary, then delete the raw rows.

Runs from GitHub Actions every Sunday. Safe to re-run: ON CONFLICT DO NOTHING
means already-archived buckets are skipped without error. Each run is logged to
CollectRun with job='archive'; runs used to leave no trace at all.
"""

import logging
import sys
import uuid
from datetime import datetime, timedelta, timezone

from common import RAW_RETENTION_DAYS, run_logged_job

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def fetch_buckets_to_archive(cur, cutoff: datetime) -> list[tuple]:
    cur.execute(
        """
        WITH localized AS (
            SELECT
                "rideId",
                "rideName",
                "landName",
                "waitTime",
                "isOpen",
                "windowedAt",
                ("windowedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') AS park_time
            FROM "WaitTimeRecord"
            WHERE "windowedAt" < %s
        )
        SELECT
            "rideId",
            "rideName",
            "landName",
            DATE_TRUNC('day', park_time) AS date,
            EXTRACT(HOUR FROM park_time)::int AS hour,
            AVG("waitTime")::float            AS avg_wait,
            MAX("waitTime")                   AS peak_wait,
            COUNT(*)                          AS sample_count,
            BOOL_OR("isOpen")                 AS is_open
        FROM localized
        GROUP BY
            "rideId", "rideName", "landName",
            DATE_TRUNC('day', park_time),
            EXTRACT(HOUR FROM park_time)
        ORDER BY date, "rideId", hour
        """,
        (cutoff,),
    )
    return cur.fetchall()


def insert_summaries(cur, buckets: list[tuple]) -> int:
    if not buckets:
        return 0
    cur.executemany(
        """
        INSERT INTO "HourlyWaitSummary"
            (id, "rideId", "rideName", "landName", date, hour,
             "avgWait", "peakWait", "sampleCount", "isOpen")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("rideId", date, hour) DO NOTHING
        """,
        [
            (
                str(uuid.uuid4()),
                b[0],  # rideId
                b[1],  # rideName
                b[2],  # landName
                b[3],  # park date as midnight timestamp
                b[4],  # Pacific-local hour
                b[5],  # avgWait
                b[6],  # peakWait
                b[7],  # sampleCount
                b[8],  # isOpen
            )
            for b in buckets
        ],
    )
    return len(buckets)


def delete_archived_rows(cur, cutoff: datetime) -> int:
    cur.execute(
        'DELETE FROM "WaitTimeRecord" WHERE "windowedAt" < %s',
        (cutoff,),
    )
    return cur.rowcount


def archive(conn) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=RAW_RETENTION_DAYS)
    logger.info("Archiving WaitTimeRecord rows with windowedAt < %s", cutoff.date())

    with conn.cursor() as cur:
        buckets = fetch_buckets_to_archive(cur, cutoff)
        if not buckets:
            logger.info("Nothing to archive")
            return 0
        inserted = insert_summaries(cur, buckets)
        deleted = delete_archived_rows(cur, cutoff)

    logger.info("Archived %d (ride, date, hour) buckets, deleted %d raw rows", inserted, deleted)
    return inserted


def main() -> int:
    return run_logged_job("archive", archive)


if __name__ == "__main__":
    sys.exit(main())

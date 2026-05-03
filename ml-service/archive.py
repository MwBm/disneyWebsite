"""Weekly archival job: aggregate WaitTimeRecord rows older than 30 days
into HourlyWaitSummary, then delete the raw rows.

Runs from GitHub Actions every Sunday. Safe to re-run: ON CONFLICT DO NOTHING
means already-archived buckets are skipped without error.
"""

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import psycopg

RAW_RETENTION_DAYS = 30


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


def main() -> int:
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("DIRECT_URL")
    if not db_url:
        print("ERROR: DATABASE_URL or DIRECT_URL must be set", file=sys.stderr)
        return 1

    db_url = db_url.replace("?pgbouncer=true", "").replace("&pgbouncer=true", "")
    cutoff = datetime.now(timezone.utc) - timedelta(days=RAW_RETENTION_DAYS)
    print(f"Archiving WaitTimeRecord rows with windowedAt < {cutoff.date()}")

    with psycopg.connect(db_url, autocommit=False) as conn:
        try:
            with conn.cursor() as cur:
                buckets = fetch_buckets_to_archive(cur, cutoff)

            if not buckets:
                print("Nothing to archive.")
                conn.rollback()
                return 0

            print(f"Found {len(buckets)} (ride, date, hour) buckets to archive")

            with conn.cursor() as cur:
                inserted = insert_summaries(cur, buckets)
                deleted = delete_archived_rows(cur, cutoff)

            conn.commit()
            print(f"Archived {inserted} buckets, deleted {deleted} raw rows")
        except Exception:
            conn.rollback()
            raise

    return 0


if __name__ == "__main__":
    sys.exit(main())

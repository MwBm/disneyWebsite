"""Weekly archival job: roll raw WaitTimeRecord rows up into HourlyWaitSummary.

Runs from GitHub Actions every Sunday and logs to CollectRun as job='archive'.

Everything happens in Postgres, in one transaction:
1. Raw rows older than the cutoff are deleted and, in the same statement,
   aggregated into (ride, park date, park hour) buckets.
2. Forecasts older than FORECAST_RETENTION_DAYS are deleted.

Nothing is read back except two counts. The job used to SELECT every bucket
into Python and insert it again row by row.

The cutoff is truncated to a whole hour. It used to be `now - 30 days` down to
the second, so every run split one hour: the rows before the cutoff became a
bucket and, with ON CONFLICT DO NOTHING, the rest of that hour was dropped when
the next week's run found the bucket already present. Truncating prevents the
split, and conflicting buckets are now merged rather than skipped, so a bucket
that already exists (a re-run, an overlapping Kaggle import) never loses rows.
"""

import logging
import sys
from datetime import datetime, timedelta, timezone

from common import FORECAST_RETENTION_DAYS, RAW_RETENTION_DAYS, run_logged_job

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# One statement: DELETE ... RETURNING feeds the aggregation, so a row can only
# leave WaitTimeRecord by landing in a bucket.
#
# Buckets are keyed on (rideId, park date, park hour) only. Grouping by name as
# well produced two buckets for the same key whenever a ride was renamed inside
# an hour, which ON CONFLICT DO UPDATE rejects; the latest name wins instead.
#
# Merging into an existing bucket weights each side's average by its sample
# count, so the result equals the average over all raw rows in that hour.
ARCHIVE_SQL = """
    WITH moved AS (
        DELETE FROM "WaitTimeRecord"
        WHERE "windowedAt" < %(cutoff)s
        RETURNING "rideId", "rideName", "landName", "waitTime", "isOpen", "windowedAt"
    ),
    localized AS (
        SELECT *, ("windowedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') AS park_time
        FROM moved
    ),
    buckets AS (
        SELECT
            "rideId",
            (array_agg("rideName" ORDER BY "windowedAt" DESC))[1] AS "rideName",
            (array_agg("landName" ORDER BY "windowedAt" DESC))[1] AS "landName",
            DATE_TRUNC('day', park_time)      AS date,
            EXTRACT(HOUR FROM park_time)::int AS hour,
            AVG("waitTime")::float            AS "avgWait",
            MAX("waitTime")                   AS "peakWait",
            COUNT(*)::int                     AS "sampleCount",
            BOOL_OR("isOpen")                 AS "isOpen"
        FROM localized
        GROUP BY "rideId", DATE_TRUNC('day', park_time), EXTRACT(HOUR FROM park_time)
    ),
    written AS (
        INSERT INTO "HourlyWaitSummary" AS existing
            (id, "rideId", "rideName", "landName", date, hour, "avgWait", "peakWait", "sampleCount", "isOpen")
        SELECT gen_random_uuid()::text, "rideId", "rideName", "landName", date, hour,
               "avgWait", "peakWait", "sampleCount", "isOpen"
        FROM buckets
        ON CONFLICT ("rideId", date, hour) DO UPDATE SET
            "avgWait" = (existing."avgWait" * existing."sampleCount" + EXCLUDED."avgWait" * EXCLUDED."sampleCount")
                        / (existing."sampleCount" + EXCLUDED."sampleCount"),
            "peakWait"    = GREATEST(existing."peakWait", EXCLUDED."peakWait"),
            "sampleCount" = existing."sampleCount" + EXCLUDED."sampleCount",
            "isOpen"      = existing."isOpen" OR EXCLUDED."isOpen",
            "rideName"    = EXCLUDED."rideName",
            "landName"    = EXCLUDED."landName"
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM moved), (SELECT count(*) FROM written)
"""

DELETE_OLD_FORECASTS_SQL = 'DELETE FROM "DailyForecast" WHERE "forecastFor" < %(cutoff)s'


def raw_cutoff(now: datetime) -> datetime:
    """Start of the hour RAW_RETENTION_DAYS ago, so an archive never splits an hour.

    Pacific offsets are whole hours, so a UTC hour boundary is a park-hour boundary.
    """
    return (now - timedelta(days=RAW_RETENTION_DAYS)).replace(minute=0, second=0, microsecond=0)


def forecast_cutoff(now: datetime) -> datetime:
    return now - timedelta(days=FORECAST_RETENTION_DAYS)


def archive(conn) -> int:
    now = datetime.now(timezone.utc)
    cutoff = raw_cutoff(now)

    with conn.cursor() as cur:
        cur.execute(ARCHIVE_SQL, {"cutoff": cutoff})
        raw_deleted, buckets_written = cur.fetchone()
        cur.execute(DELETE_OLD_FORECASTS_SQL, {"cutoff": forecast_cutoff(now)})
        forecasts_deleted = cur.rowcount

    logger.info(
        "Archived %d raw rows older than %s into %d hourly buckets; deleted %d forecasts older than %d days",
        raw_deleted, cutoff.isoformat(), buckets_written, forecasts_deleted, FORECAST_RETENTION_DAYS,
    )
    return buckets_written


def main() -> int:
    return run_logged_job("archive", archive)


if __name__ == "__main__":
    sys.exit(main())

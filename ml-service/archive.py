"""Weekly archival job: roll raw WaitTimeRecord rows up into HourlyWaitSummary.

Runs from GitHub Actions every Sunday and logs to CollectRun as job='archive'.

Everything happens in Postgres, in one transaction:
1. Raw rows older than the cutoff are deleted and, in the same statement,
   aggregated into (ride, park date, park hour) buckets.
2. Forecasts older than FORECAST_RETENTION_DAYS are deleted.

Nothing is read back except two counts.

The cutoff is truncated to a whole hour, so a run never splits an hour between
this week's bucket and next week's. A bucket that already exists (a re-run, an
overlapping Kaggle import) is merged rather than skipped, so it never loses rows.
"""

import logging
import sys
from datetime import datetime, timedelta, timezone

from common import (
    COLLECT_RUN_RETENTION_DAYS,
    EVALUATION_RETENTION_DAYS,
    FORECAST_RETENTION_DAYS,
    HOURLY_RETENTION_DAYS,
    MODEL_RUN_RETENTION_DAYS,
    RAW_RETENTION_DAYS,
    SERVING_FORECAST_RETENTION_DAYS,
    run_logged_job,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# One statement: DELETE ... RETURNING feeds the aggregation, so a row can only
# leave WaitTimeRecord by landing in a bucket.
#
# Buckets are keyed on (parkId, rideId, park date, park hour), with the latest
# name: a ride renamed inside an hour would otherwise give one key two rows,
# which ON CONFLICT DO UPDATE rejects.
#
# Merging into an existing bucket weights each side's average by its open
# sample count, so closures never dilute the predicted queue wait.
ARCHIVE_SQL = """
    WITH moved AS (
        DELETE FROM "WaitTimeRecord"
        WHERE "windowedAt" < %(cutoff)s
        RETURNING "parkId", "rideId", "rideName", "landName", "waitTime", "isOpen", "windowedAt"
    ),
    localized AS (
        SELECT *, ("windowedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') AS park_time
        FROM moved
    ),
    buckets AS (
        SELECT
            "parkId",
            "rideId",
            (array_agg("rideName" ORDER BY "windowedAt" DESC))[1] AS "rideName",
            (array_agg("landName" ORDER BY "windowedAt" DESC))[1] AS "landName",
            DATE_TRUNC('day', park_time)      AS date,
            EXTRACT(HOUR FROM park_time)::int AS hour,
            COALESCE(AVG("waitTime") FILTER (WHERE "isOpen"), 0)::float AS "avgWait",
            COALESCE(MAX("waitTime") FILTER (WHERE "isOpen"), 0)        AS "peakWait",
            COUNT(*)::int                                                 AS "sampleCount",
            COUNT(*)::int                                                 AS "observedSampleCount",
            COUNT(*) FILTER (WHERE "isOpen")::int                        AS "openSampleCount",
            BOOL_OR("isOpen")                 AS "isOpen"
        FROM localized
        GROUP BY "parkId", "rideId", DATE_TRUNC('day', park_time), EXTRACT(HOUR FROM park_time)
    ),
    written AS (
        INSERT INTO "HourlyWaitSummary" AS existing
            (id, "parkId", "rideId", "rideName", "landName", date, hour,
             "avgWait", "peakWait", "sampleCount", "observedSampleCount", "openSampleCount", "isOpen")
        SELECT gen_random_uuid()::text, "parkId", "rideId", "rideName", "landName", date, hour,
               "avgWait", "peakWait", "sampleCount", "observedSampleCount", "openSampleCount", "isOpen"
        FROM buckets
        ON CONFLICT ("rideId", date, hour) DO UPDATE SET
            "parkId"      = EXCLUDED."parkId",
            "avgWait" = CASE
                WHEN existing."openSampleCount" + EXCLUDED."openSampleCount" = 0 THEN 0
                ELSE (existing."avgWait" * existing."openSampleCount" + EXCLUDED."avgWait" * EXCLUDED."openSampleCount")
                     / (existing."openSampleCount" + EXCLUDED."openSampleCount")
            END,
            "peakWait"    = GREATEST(existing."peakWait", EXCLUDED."peakWait"),
            "sampleCount" = existing."sampleCount" + EXCLUDED."sampleCount",
            "observedSampleCount" = existing."observedSampleCount" + EXCLUDED."observedSampleCount",
            "openSampleCount" = existing."openSampleCount" + EXCLUDED."openSampleCount",
            "isOpen"      = existing."isOpen" OR EXCLUDED."isOpen",
            "rideName"    = EXCLUDED."rideName",
            "landName"    = EXCLUDED."landName"
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM moved), (SELECT count(*) FROM written)
"""

DELETE_OLD_FORECASTS_SQL = 'DELETE FROM "DailyForecast" WHERE "forecastFor" < %(cutoff)s'
DELETE_OLD_HOURLY_SQL = 'DELETE FROM "HourlyWaitSummary" WHERE date < %(cutoff)s'
DELETE_OLD_PARK_DAY_SQL = 'DELETE FROM "ParkDayForecast" WHERE date < %(cutoff)s'
DELETE_OLD_RIDE_DAY_SQL = 'DELETE FROM "RideDayForecast" WHERE date < %(cutoff)s'
DELETE_OLD_EVALUATIONS_SQL = 'DELETE FROM "ForecastEvaluation" WHERE "targetDate" < %(cutoff)s'
DELETE_OLD_MODEL_RUNS_SQL = 'DELETE FROM "ModelRun" WHERE "trainedAt" < %(cutoff)s'
DELETE_OLD_COLLECT_RUNS_SQL = 'DELETE FROM "CollectRun" WHERE "ranAt" < %(cutoff)s'


def raw_cutoff(now: datetime) -> datetime:
    """Start of the hour RAW_RETENTION_DAYS ago, so an archive never splits an hour.

    Pacific offsets are whole hours, so a UTC hour boundary is a park-hour boundary.
    """
    return (now - timedelta(days=RAW_RETENTION_DAYS)).replace(minute=0, second=0, microsecond=0)


def forecast_cutoff(now: datetime) -> datetime:
    return now - timedelta(days=FORECAST_RETENTION_DAYS)


def retention_cutoff(now: datetime, days: int) -> datetime:
    return now - timedelta(days=days)


def archive(conn) -> int:
    now = datetime.now(timezone.utc)
    cutoff = raw_cutoff(now)

    with conn.cursor() as cur:
        cur.execute(ARCHIVE_SQL, {"cutoff": cutoff})
        raw_deleted, buckets_written = cur.fetchone()
        cur.execute(DELETE_OLD_FORECASTS_SQL, {"cutoff": forecast_cutoff(now)})
        forecasts_deleted = cur.rowcount
        cur.execute(DELETE_OLD_HOURLY_SQL, {"cutoff": retention_cutoff(now, HOURLY_RETENTION_DAYS)})
        hourly_deleted = cur.rowcount
        cur.execute(DELETE_OLD_PARK_DAY_SQL, {"cutoff": retention_cutoff(now, SERVING_FORECAST_RETENTION_DAYS)})
        park_days_deleted = cur.rowcount
        cur.execute(DELETE_OLD_RIDE_DAY_SQL, {"cutoff": retention_cutoff(now, SERVING_FORECAST_RETENTION_DAYS)})
        ride_days_deleted = cur.rowcount
        cur.execute(DELETE_OLD_EVALUATIONS_SQL, {"cutoff": retention_cutoff(now, EVALUATION_RETENTION_DAYS)})
        evaluations_deleted = cur.rowcount
        cur.execute(DELETE_OLD_MODEL_RUNS_SQL, {"cutoff": retention_cutoff(now, MODEL_RUN_RETENTION_DAYS)})
        model_runs_deleted = cur.rowcount
        cur.execute(DELETE_OLD_COLLECT_RUNS_SQL, {"cutoff": retention_cutoff(now, COLLECT_RUN_RETENTION_DAYS)})
        collect_runs_deleted = cur.rowcount

    logger.info(
        "Archived %d raw rows older than %s into %d hourly buckets; removed %d slot forecasts, %d hourly summaries, "
        "%d park-day forecasts, %d ride-day forecasts, %d evaluations, %d model runs, and %d job runs",
        raw_deleted, cutoff.isoformat(), buckets_written, forecasts_deleted, hourly_deleted,
        park_days_deleted, ride_days_deleted, evaluations_deleted, model_runs_deleted, collect_runs_deleted,
    )
    return buckets_written


def main() -> int:
    return run_logged_job("archive", archive)


if __name__ == "__main__":
    sys.exit(main())

"""Fail loudly when forecasts go stale. A monitor, not a job: it writes nothing.

collect.yml runs this after every collect, but it only checks during
CHECK_WINDOW_START_UTC..+30 min, so a stale forecast produces one failed run
and one GitHub email a day rather than 48. If GitHub starts two collect runs in
that window (a delayed :30 run plus the next :00), expect two emails that day.
Pass --force to check immediately.

Problems it reports:
- no successful train run for longer than MAX_TRAIN_AGE. train.yml fires at
  06:00 UTC, so at the noon check a healthy run is ~6 h old and one missed
  night makes it ~30 h.
- a forecast horizon shorter than MIN_HORIZON. Each healthy train run writes
  29 days ahead, so this catches a run that "succeeds" with a short window.
- raw wait times older than RAW_RETENTION_DAYS + ARCHIVE_GRACE_DAYS, meaning
  archive.yml has stopped. Training reads every unarchived raw row, so a
  stalled archive also grows train.py's daily egress until it is noticed.
"""

import argparse
import sys
from datetime import datetime, time, timedelta, timezone

from common import ARCHIVE_GRACE_DAYS, RAW_RETENTION_DAYS, as_utc, connect, database_url_from_env

MAX_TRAIN_AGE = timedelta(hours=24)
MIN_HORIZON = timedelta(days=27)
CHECK_WINDOW_START_UTC = time(12, 0)
CHECK_WINDOW = timedelta(minutes=30)
MAX_RAW_AGE = timedelta(days=RAW_RETENTION_DAYS + ARCHIVE_GRACE_DAYS)

STATUS_SQL = """
    SELECT
        (SELECT max("ranAt") FROM "CollectRun" WHERE job = 'train' AND success),
        (SELECT max("forecastFor") FROM "DailyForecast"),
        (SELECT min("windowedAt") FROM "WaitTimeRecord")
"""


def in_check_window(now: datetime) -> bool:
    now = as_utc(now)
    start = datetime.combine(now.date(), CHECK_WINDOW_START_UTC, tzinfo=timezone.utc)
    return start <= now < start + CHECK_WINDOW


def fetch_status(conn) -> tuple[datetime | None, datetime | None, datetime | None]:
    """(latest successful train run, furthest forecast slot, oldest raw row) as stored; None when absent.

    One aggregate row, so the check costs a few hundred bytes of egress.
    """
    with conn.cursor() as cur:
        cur.execute(STATUS_SQL)
        return cur.fetchone()


def find_problems(
    last_train: datetime | None,
    horizon: datetime | None,
    oldest_raw: datetime | None,
    now: datetime,
) -> list[str]:
    """Human-readable problems, empty when healthy. Naive datetimes are UTC (Prisma columns)."""
    now = as_utc(now)
    last_train, horizon, oldest_raw = (
        as_utc(dt) if dt is not None else None for dt in (last_train, horizon, oldest_raw)
    )
    problems = []
    if last_train is None:
        problems.append("No successful train run has ever been logged (CollectRun job='train').")
    elif now - last_train > MAX_TRAIN_AGE:
        problems.append(
            f"Last successful train run was {last_train:%Y-%m-%d %H:%M} UTC, "
            f"{(now - last_train) / timedelta(hours=1):.0f} h ago (limit {MAX_TRAIN_AGE / timedelta(hours=1):.0f} h). "
            "Check that train.yml is enabled and its recent runs."
        )
    if horizon is None:
        problems.append("DailyForecast is empty.")
    elif horizon - now < MIN_HORIZON:
        problems.append(
            f"Forecasts end {horizon:%Y-%m-%d %H:%M} UTC, "
            f"{(horizon - now) / timedelta(days=1):.1f} days ahead (minimum {MIN_HORIZON.days})."
        )
    # An empty WaitTimeRecord is not an archive problem: collect's own failures report that.
    if oldest_raw is not None and now - oldest_raw > MAX_RAW_AGE:
        problems.append(
            f"The oldest unarchived wait time is from {oldest_raw:%Y-%m-%d %H:%M} UTC, "
            f"{(now - oldest_raw) / timedelta(days=1):.0f} days ago (limit {MAX_RAW_AGE.days}). "
            "Check that archive.yml is enabled and its recent runs."
        )
    return problems


def main(argv: list[str] | None = None, now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fail when forecasts or the archive have gone stale.")
    parser.add_argument("--force", action="store_true", help="check now, outside the daily window")
    args = parser.parse_args(argv)
    now = as_utc(now or datetime.now(timezone.utc))

    if not args.force and not in_check_window(now):
        print(f"Skipping: forecast freshness is checked once a day at {CHECK_WINDOW_START_UTC:%H:%M} UTC.")
        return 0

    db_url = database_url_from_env()
    if not db_url:
        print("ERROR: DATABASE_URL or DIRECT_URL must be set", file=sys.stderr)
        return 1

    # A monitor that cannot reach the database must fail too; an exception
    # here exits 1 with a traceback, which is the loud outcome we want.
    with connect(db_url, autocommit=True) as conn:
        last_train, horizon, oldest_raw = fetch_status(conn)

    problems = find_problems(last_train, horizon, oldest_raw, now)
    for problem in problems:
        # ::error:: surfaces the message on the GitHub Actions run summary.
        print(f"::error title=Forecasts are stale::{problem}", file=sys.stderr)
    if not problems:
        print(f"Forecasts are fresh: last train {last_train:%Y-%m-%d %H:%M} UTC, horizon {horizon:%Y-%m-%d} UTC.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

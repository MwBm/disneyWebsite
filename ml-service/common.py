"""Settings and database access shared by every ml-service job.

Each setting has exactly one definition: training silently loses data if two
jobs disagree about, say, RAW_RETENTION_DAYS.
"""

import logging
import os
import sys
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import psycopg

logger = logging.getLogger(__name__)

PARK_TZ = ZoneInfo("America/Los_Angeles")

# WaitTimeRecord.windowedAt and DailyForecast.forecastFor are aligned to this.
WINDOW_MINUTES = 30

# Raw WaitTimeRecord rows older than this are rolled up into HourlyWaitSummary.
RAW_RETENTION_DAYS = 30

# DailyForecast rows for slots older than this are deleted by archive.py. The
# accuracy pages compare the last 30 days of forecasts against raw
# WaitTimeRecord rows, which only exist for RAW_RETENTION_DAYS, so older
# forecasts can never be read; 5 extra days keep the whole window safe while an
# archive run is late. tests/test_common.py pins both relationships.
FORECAST_RETENTION_DAYS = 35

# How long raw rows may outlive RAW_RETENTION_DAYS before check_freshness.py
# reports that archive.yml has stopped. Archive runs weekly, so a healthy
# backlog peaks just under 7 days.
ARCHIVE_GRACE_DAYS = 8

# Without a timeout an unreachable database hangs the job until GitHub Actions
# kills it at timeout-minutes, and the failure is never logged to CollectRun.
CONNECT_TIMEOUT_SECONDS = 15

# Connection-string parameters that Prisma understands and libpq rejects with
# "invalid URI query parameter". The same DATABASE_URL secret serves both.
PRISMA_ONLY_URL_PARAMS = frozenset({"pgbouncer", "connection_limit", "pool_timeout", "schema"})

# Values of the JobKind enum on CollectRun.job (prisma/schema.prisma).
JOBS = ("collect", "train", "archive")


def normalize_db_url(url: str) -> str:
    """Strip Prisma-only query parameters so psycopg accepts the URL.

    Works on the raw query string rather than parse/urlencode round-tripping, so
    every parameter that survives keeps its original percent-encoding.
    """
    base, sep, query = url.partition("?")
    if not sep:
        return url
    kept = [
        param for param in query.split("&")
        if param and param.split("=", 1)[0] not in PRISMA_ONLY_URL_PARAMS
    ]
    return f"{base}?{'&'.join(kept)}" if kept else base


def database_url_from_env() -> str | None:
    """DATABASE_URL, else DIRECT_URL, normalized for psycopg. None when neither is set."""
    raw = os.environ.get("DATABASE_URL") or os.environ.get("DIRECT_URL")
    return normalize_db_url(raw) if raw else None


def connect(db_url: str, *, autocommit: bool = False) -> psycopg.Connection:
    """Open a connection that is safe behind Supabase's connection pooler.

    psycopg prepares a statement server-side after `prepare_threshold` runs on a
    connection. Behind a pooler another client may already hold that name on
    the server session (`prepared statement "_pg3_0" already exists`), so
    preparation is disabled, as psycopg's docs advise for pooling middleware.
    """
    return psycopg.connect(
        db_url,
        autocommit=autocommit,
        prepare_threshold=None,
        connect_timeout=CONNECT_TIMEOUT_SECONDS,
    )


def as_utc(dt: datetime) -> datetime:
    """Treat a naive datetime as UTC; Prisma DateTime columns come back naive."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def park_date_key(dt: datetime) -> str:
    return as_utc(dt).astimezone(PARK_TZ).strftime("%Y-%m-%d")


def park_hour(dt: datetime) -> int:
    return as_utc(dt).astimezone(PARK_TZ).hour


def require_known_job(job: str) -> None:
    """Reject a job name the CollectRun.job enum doesn't have.

    The database would reject it too, but only after the work's transaction
    had been spent — and run_logged_job would then try to log that failure under
    the same bad name.
    """
    if job not in JOBS:
        raise ValueError(f"unknown job {job!r}; expected one of {JOBS}")


def log_collect_run(
    conn, job: str, rows_upserted: int, success: bool, error_message: str | None = None
) -> None:
    require_known_job(job)
    sql = """
        INSERT INTO "CollectRun" (id, job, "ranAt", "rowsUpserted", success, "errorMessage")
        VALUES (%s, %s, %s, %s, %s, %s)
    """
    with conn.cursor() as cur:
        cur.execute(
            sql,
            (str(uuid.uuid4()), job, datetime.now(timezone.utc), rows_upserted, success, error_message),
        )


def run_logged_job(job: str, work: Callable[[psycopg.Connection], int]) -> int:
    """Run `work` in one transaction, record the outcome in CollectRun as `job`, return an exit code.

    `work` receives an open connection and returns the number of rows it wrote.
    Success is logged in the same transaction as the work, so a run is never
    recorded as successful unless its rows committed. Any exception rolls the
    transaction back and is logged on a fresh autocommit connection with 0 rows,
    because nothing was written. If even that fails, the job still exits 1 —
    GitHub's failure email is then the only signal, which beats a crash that
    hides the original error.
    """
    require_known_job(job)
    db_url = database_url_from_env()
    if not db_url:
        print("ERROR: DATABASE_URL or DIRECT_URL must be set", file=sys.stderr)
        return 1

    try:
        with connect(db_url) as conn:
            try:
                rows = work(conn)
                log_collect_run(conn, job, rows, success=True)
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        logger.info("%s run successful: %d rows written", job, rows)
        return 0
    except Exception as exc:
        logger.error("%s run failed: %s", job, exc)
        try:
            with connect(db_url, autocommit=True) as conn:
                log_collect_run(conn, job, 0, success=False, error_message=str(exc))
        except Exception as log_exc:
            logger.error("Failed to log the failure to CollectRun: %s", log_exc)
        return 1

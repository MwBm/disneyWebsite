"""Settings and database access shared by every ml-service job.

collect, train, archive and the Kaggle importer need the same park time zone,
the same retention window and the same connection handling. Each used to keep
its own copy. RAW_RETENTION_DAYS lived in both collect.py and archive.py, and
training silently loses data whenever those two disagree, so there is exactly
one definition of each here.
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

# Without a timeout an unreachable database hangs the job until GitHub Actions
# kills it at timeout-minutes, and the failure is never logged to CollectRun.
CONNECT_TIMEOUT_SECONDS = 15

# Connection-string parameters that Prisma understands and libpq rejects with
# "invalid URI query parameter". The same DATABASE_URL secret serves both.
PRISMA_ONLY_URL_PARAMS = frozenset({"pgbouncer", "connection_limit", "pool_timeout", "schema"})


def normalize_db_url(url: str) -> str:
    """Strip Prisma-only query parameters so psycopg accepts the URL.

    Every job used to do `url.replace("?pgbouncer=true", "")`, which turns
    `...postgres?pgbouncer=true&sslmode=require` into `...postgres&sslmode=require`:
    the database name becomes "postgres&sslmode=require" and sslmode is lost.

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

    psycopg prepares a statement server-side after it runs `prepare_threshold`
    (default 5) times on a connection — executemany over thousands of rows
    always crosses that. Behind a pooler the prepared name "_pg3_0" can already
    exist on the pooled server session from another client, and the job dies
    with `prepared statement "_pg3_0" already exists`. psycopg's docs say to
    disable preparation behind pooling middleware; None does that.
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


def log_collect_run(
    conn, rows_upserted: int, success: bool, error_message: str | None = None
) -> None:
    sql = """
        INSERT INTO "CollectRun" (id, "ranAt", "rowsUpserted", success, "errorMessage")
        VALUES (%s, %s, %s, %s, %s)
    """
    with conn.cursor() as cur:
        cur.execute(
            sql,
            (str(uuid.uuid4()), datetime.now(timezone.utc), rows_upserted, success, error_message),
        )


def run_logged_job(work: Callable[[psycopg.Connection], int]) -> int:
    """Run `work` in one transaction, record the outcome in CollectRun, return an exit code.

    `work` receives an open connection and returns the number of rows it wrote.
    Success is logged in the same transaction as the work, so a run is never
    recorded as successful unless its rows committed. Any exception rolls the
    transaction back and is logged on a fresh autocommit connection with 0 rows,
    because nothing was written. If even that fails, the job still exits 1 —
    GitHub's failure email is then the only signal, which beats a crash that
    hides the original error.
    """
    db_url = database_url_from_env()
    if not db_url:
        print("ERROR: DATABASE_URL or DIRECT_URL must be set", file=sys.stderr)
        return 1

    try:
        with connect(db_url) as conn:
            try:
                rows = work(conn)
                log_collect_run(conn, rows, success=True)
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        logger.info("Run successful: %d rows written", rows)
        return 0
    except Exception as exc:
        logger.error("Run failed: %s", exc)
        try:
            with connect(db_url, autocommit=True) as conn:
                log_collect_run(conn, 0, success=False, error_message=str(exc))
        except Exception as log_exc:
            logger.error("Failed to log the failure to CollectRun: %s", log_exc)
        return 1

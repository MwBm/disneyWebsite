"""End-to-end cron job: fetch live waits, upsert WaitTimeRecord, run ML, write DailyForecast.

Replaces the old Next.js /api/collect + Railway FastAPI service.
Runs from GitHub Actions every 30 min.
"""

import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

from model import predict_for_date
from schemas import RideHistory, DateContext


WINDOW_MINUTES = 30
RAW_RETENTION_DAYS = 30  # raw rows kept before archival to HourlyWaitSummary
FORECAST_SLOTS = 48  # 48 × 30min = 24h

# Disneyland is Pacific time (UTC-7 PDT / UTC-8 PST).
# Exclude UTC hours 7–14 inclusive: that's roughly midnight–7:59 AM Pacific,
# when the park is always closed. Generating predictions for those hours
# produces garbage extrapolations that pollute the daily crowd score.
PARK_CLOSED_UTC_HOURS = frozenset(range(7, 15))

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "../src/lib/ride-config.json")

def _load_park_configs() -> list[dict]:
    with open(_CONFIG_PATH) as f:
        return json.load(f)["parks"]


def round_to_window(dt: datetime) -> datetime:
    """Round to nearest 30-min window."""
    epoch_ms = int(dt.timestamp() * 1000)
    window_ms = WINDOW_MINUTES * 60 * 1000
    rounded = round(epoch_ms / window_ms) * window_ms
    return datetime.fromtimestamp(rounded / 1000, tz=timezone.utc)


def fetch_live_rides() -> list[dict]:
    """Pull live waits from all parks. Returns flat list of ride dicts."""
    park_configs = _load_park_configs()
    rides = []
    for park in park_configs:
        excluded = set(park["excludedRideIds"])
        res = httpx.get(park["queueTimesUrl"], timeout=20.0)
        res.raise_for_status()
        data = res.json()
        for land in data.get("lands", []):
            for ride in land.get("rides", []):
                if ride["id"] in excluded:
                    continue
                rides.append({
                    "id": ride["id"],
                    "name": ride["name"],
                    "land_name": land["name"],
                    "is_open": ride["is_open"],
                    "wait_time": ride["wait_time"],
                })
        for ride in data.get("rides", []):
            if ride["id"] in excluded:
                continue
            rides.append({
                "id": ride["id"],
                "name": ride["name"],
                "land_name": "Other",
                "is_open": ride["is_open"],
                "wait_time": ride["wait_time"],
            })
    return rides


def upsert_wait_records(conn, rides: list[dict], windowed_at: datetime, now: datetime) -> int:
    """INSERT...ON CONFLICT update on (rideId, windowedAt)."""
    sql = """
        INSERT INTO "WaitTimeRecord"
            (id, "rideId", "rideName", "landName", "waitTime", "isOpen", "windowedAt", "recordedAt")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("rideId", "windowedAt") DO UPDATE SET
            "waitTime" = EXCLUDED."waitTime",
            "isOpen" = EXCLUDED."isOpen",
            "recordedAt" = EXCLUDED."recordedAt"
    """
    rows = [
        (
            str(uuid.uuid4()),
            r["id"],
            r["name"],
            r["land_name"],
            r["wait_time"],
            r["is_open"],
            windowed_at,
            now,
        )
        for r in rides
    ]
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


def fetch_history(conn, since: datetime) -> list[RideHistory]:
    """Pull raw WaitTimeRecord rows since `since`."""
    sql = """
        SELECT "rideId", "rideName", "landName", "waitTime", "isOpen", "recordedAt"
        FROM "WaitTimeRecord"
        WHERE "recordedAt" >= %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (since,))
        return [
            RideHistory(
                ride_id=row[0],
                ride_name=row[1],
                land_name=row[2],
                wait_time=row[3],
                is_open=row[4],
                recorded_at=row[5],
            )
            for row in cur.fetchall()
        ]


def fetch_hourly_archive(conn) -> list[RideHistory]:
    """Pull all HourlyWaitSummary rows as RideHistory for ML training.

    Each archived row represents one hour of data; recorded_at is set to
    midnight-UTC + hour so the model's hour/weekday/month features work correctly.
    """
    sql = """
        SELECT "rideId", "rideName", "landName", "avgWait", "isOpen", date, hour
        FROM "HourlyWaitSummary"
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        return [
            RideHistory(
                ride_id=row[0],
                ride_name=row[1],
                land_name=row[2],
                wait_time=round(row[3]),
                is_open=row[4],
                recorded_at=row[5].replace(hour=row[6], minute=0, second=0, tzinfo=timezone.utc),
            )
            for row in cur.fetchall()
        ]


def insert_forecasts(
    conn,
    forecasts_per_slot: list[tuple[datetime, list, int]],
    ride_meta: dict[int, dict],
) -> int:
    """Bulk insert DailyForecast rows."""
    sql = """
        INSERT INTO "DailyForecast"
            (id, "rideId", "rideName", "landName", "forecastFor",
             "predictedWait", "crowdScore", "mlConfidence", "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    now = datetime.now(timezone.utc)
    rows = []
    for slot, ride_forecasts, crowd_score in forecasts_per_slot:
        for f in ride_forecasts:
            meta = ride_meta.get(f.ride_id)
            if not meta:
                continue
            rows.append((
                str(uuid.uuid4()),
                f.ride_id,
                meta["name"],
                meta["land_name"],
                slot,
                f.predicted_wait,
                crowd_score,
                f.confidence,
                now,
            ))
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


def fetch_date_contexts(conn, dates: list[datetime]) -> dict[str, DateContext]:
    """Fetch DateContext rows for a set of dates. Missing dates return default context."""
    unique_strs = list({d.strftime("%Y-%m-%d") for d in dates})
    if not unique_strs:
        return {}
    sql = """
        SELECT date::date, tier, "specialEvent", "isHoliday", "isSchoolBreak"
        FROM "DateContext"
        WHERE date::date = ANY(%s)
    """
    result: dict[str, DateContext] = {}
    with conn.cursor() as cur:
        cur.execute(sql, (unique_strs,))
        for row in cur.fetchall():
            key = row[0].strftime("%Y-%m-%d")
            result[key] = DateContext(
                tier=row[1] or 0,
                has_special_event=bool(row[2]),
                is_holiday=bool(row[3]),
                is_school_break=bool(row[4]),
            )
    return result


def delete_stale_forecasts(conn, slots: list[datetime]) -> int:
    """Delete existing DailyForecast rows for these exact slots before inserting fresh ones.

    Without this, each collect run appends new rows. The daily crowd score then averages
    stale old predictions with fresh ones, producing drift even when nothing changed.
    """
    if not slots:
        return 0
    sql = 'DELETE FROM "DailyForecast" WHERE "forecastFor" = ANY(%s)'
    with conn.cursor() as cur:
        cur.execute(sql, (slots,))
        return cur.rowcount


def log_collect_run(conn, rows_upserted: int, success: bool, error_message: str | None = None) -> None:
    sql = """
        INSERT INTO "CollectRun" (id, "ranAt", "rowsUpserted", success, "errorMessage")
        VALUES (%s, %s, %s, %s, %s)
    """
    with conn.cursor() as cur:
        cur.execute(
            sql,
            (str(uuid.uuid4()), datetime.now(timezone.utc), rows_upserted, success, error_message),
        )


def main() -> int:
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("DIRECT_URL")
    if not db_url:
        print("ERROR: DATABASE_URL or DIRECT_URL must be set", file=sys.stderr)
        return 1

    # Strip pgbouncer query param if present — doesn't apply to direct psycopg
    db_url = db_url.replace("?pgbouncer=true", "").replace("&pgbouncer=true", "")

    now = datetime.now(timezone.utc)
    windowed_at = round_to_window(now)
    rows_upserted = 0

    try:
        rides = fetch_live_rides()
        print(f"Fetched {len(rides)} rides from queue-times.com")

        with psycopg.connect(db_url, autocommit=False) as conn:
            try:
                rows_upserted = upsert_wait_records(conn, rides, windowed_at, now)
                conn.commit()
                print(f"Upserted {rows_upserted} WaitTimeRecord rows")

                # Build ride metadata lookup from live data
                ride_meta = {r["id"]: {"name": r["name"], "land_name": r["land_name"]} for r in rides}

                # Train + predict: combine raw 30-day window with all hourly archives
                raw_history = fetch_history(conn, now - timedelta(days=RAW_RETENTION_DAYS))
                archived_history = fetch_hourly_archive(conn)
                history = raw_history + archived_history
                print(f"Loaded {len(raw_history)} raw + {len(archived_history)} archived records ({len(history)} total)")

                # Predict for each 30-min slot in next 24h, skipping park-closed UTC hours.
                # Park-closed slots (midnight–8 AM Pacific ≈ UTC 07:00–14:59) have no
                # training signal; Ridge extrapolates garbage that pollutes crowd scores.
                start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
                slots = [
                    start_of_day + timedelta(minutes=i * 30)
                    for i in range(FORECAST_SLOTS)
                    if (
                        start_of_day + timedelta(minutes=i * 30) >= now
                        and (start_of_day + timedelta(minutes=i * 30)).hour not in PARK_CLOSED_UTC_HOURS
                    )
                ]
                date_contexts = fetch_date_contexts(conn, slots)
                forecasts_per_slot = []
                for slot in slots:
                    ctx = date_contexts.get(slot.strftime("%Y-%m-%d"))
                    ride_forecasts, crowd_score = predict_for_date(history, slot, ctx)
                    forecasts_per_slot.append((slot, ride_forecasts, crowd_score))

                stale_deleted = delete_stale_forecasts(conn, [s for s, _, _ in forecasts_per_slot])
                print(f"Deleted {stale_deleted} stale DailyForecast rows")
                forecast_count = insert_forecasts(conn, forecasts_per_slot, ride_meta)
                conn.commit()
                print(f"Inserted {forecast_count} DailyForecast rows across {len(forecasts_per_slot)} slots")

                log_collect_run(conn, rows_upserted, success=True)
                conn.commit()
            except Exception:
                conn.rollback()
                raise

        print("Collect run successful")
        return 0
    except Exception as exc:
        print(f"Collect failed: {exc}", file=sys.stderr)
        try:
            with psycopg.connect(db_url, autocommit=True) as conn:
                log_collect_run(conn, rows_upserted, success=False, error_message=str(exc))
        except Exception as log_exc:
            print(f"Failed to log error: {log_exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

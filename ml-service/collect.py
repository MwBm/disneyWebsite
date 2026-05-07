"""End-to-end cron job: fetch live waits, upsert WaitTimeRecord, run ML, write DailyForecast.

Replaces the old Next.js /api/collect + Railway FastAPI service.
Runs from GitHub Actions every 30 min.
"""

import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import psycopg

from model import predict_for_slot, train_ride_models
from schemas import RideHistory, DateContext


WINDOW_MINUTES = 30
RAW_RETENTION_DAYS = 30  # raw rows kept before archival to HourlyWaitSummary
FORECAST_DAYS = 30
FORECAST_SLOTS_PER_DAY = 48  # 48 × 30min = 24h
PARK_TZ = ZoneInfo("America/Los_Angeles")

# Midnight–7:59 AM Pacific has little useful training signal and can pollute
# daily crowd scores with extrapolated closed-park predictions.
PARK_CLOSED_LOCAL_HOURS = frozenset(range(0, 8))

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


def park_date_key(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(PARK_TZ).strftime("%Y-%m-%d")


def build_forecast_slots(now: datetime, days: int = FORECAST_DAYS) -> list[datetime]:
    """Build future 30-minute slots anchored to Disneyland's local calendar days."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    park_midnight = now.astimezone(PARK_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    slots: list[datetime] = []
    for day_offset in range(days):
        local_day = park_midnight + timedelta(days=day_offset)
        for i in range(FORECAST_SLOTS_PER_DAY):
            local_slot = local_day + timedelta(minutes=i * WINDOW_MINUTES)
            if local_slot.hour in PARK_CLOSED_LOCAL_HOURS:
                continue
            slot = local_slot.astimezone(timezone.utc)
            if slot >= now:
                slots.append(slot)
    return slots


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

    Each archived row represents one Pacific-local hour of data; recorded_at is
    rebuilt as that park-local hour converted to UTC for model feature extraction.
    """
    sql = """
        SELECT "rideId", "rideName", "landName", "avgWait", "isOpen", date, hour
        FROM "HourlyWaitSummary"
        WHERE date >= NOW() - INTERVAL '3 years'
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = []
        for row in cur.fetchall():
            local_recorded_at = row[5].replace(
                hour=row[6],
                minute=0,
                second=0,
                microsecond=0,
                tzinfo=PARK_TZ,
            )
            rows.append(
                RideHistory(
                    ride_id=row[0],
                    ride_name=row[1],
                    land_name=row[2],
                    wait_time=round(row[3]),
                    is_open=row[4],
                    recorded_at=local_recorded_at.astimezone(timezone.utc),
                )
            )
        return rows


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
    unique_strs = list({park_date_key(d) for d in dates})
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

                # Attach DateContext to training records so tier/holiday features
                # are non-zero during training, matching prediction-time feature values.
                training_contexts = fetch_date_contexts(conn, [r.recorded_at for r in history])
                history = [
                    r.model_copy(update={"context": training_contexts.get(park_date_key(r.recorded_at), DateContext())})
                    for r in history
                ]

                trained_models = train_ride_models(history)
                print(f"Trained {len(trained_models)} ride models")

                # Predict 30 days ahead using Pacific-local day boundaries so
                # calendar days do not mix late evenings into the next UTC date.
                slots = build_forecast_slots(now)
                date_contexts = fetch_date_contexts(conn, slots)
                forecasts_per_slot = []
                for slot in slots:
                    ctx = date_contexts.get(park_date_key(slot))
                    ride_forecasts, crowd_score = predict_for_slot(trained_models, slot, ctx)
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

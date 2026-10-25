"""Training-data loading, feature engineering and forecast writing.

Owned by train.py, the only job that writes DailyForecast rows.
"""

import logging
import json
import uuid
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone

import numpy as np

from common import PARK_TZ, WINDOW_MINUTES, as_utc, park_date_key, park_hour
from model import (
    CROWD_CALIBRATION_PERCENTILES,
    HEADLINER_RIDE_IDS,
    _compute_crowd_score,
    build_crowd_calibration,
    predict_for_ride,
    resolve_headliner_ids,
    train_ride_models,
)
from schemas import DateContext, LagFeatures, RideForecast, RideHistory

logger = logging.getLogger(__name__)

FORECAST_SLOTS_PER_DAY = 24 * 60 // WINDOW_MINUTES
MODEL_VERSION = "xgboost-per-ride-v2"
FEATURE_VERSION = "park-aware-calendar-weather-lags-v1"
EVALUATION_HORIZONS = {
    0: "same_day",
    1: "1_day",
    3: "3_days",
    7: "7_days",
    14: "14_days",
    28: "28_days",
}

# Midnight–7:59 AM Pacific has little useful training signal.
PARK_CLOSED_LOCAL_HOURS = frozenset(range(0, 8))


def build_forecast_slots(now: datetime, days: int = 1) -> list[datetime]:
    """Build future 30-minute slots for `days` Pacific calendar days starting today.

    Returns [] when `days` is 1 and no open slot is left today (after 11:30 PM
    Pacific). Callers must handle that; see generate_forecasts.
    """
    now = as_utc(now)
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


def forecast_date(slot: datetime) -> datetime:
    """The UTC-midnight key representing a park-local forecast date."""
    return datetime.combine(as_utc(slot).astimezone(PARK_TZ).date(), time.min, tzinfo=timezone.utc)


# The training reads carry only stable identifiers and measurements; names are
# loaded once per (park, ride) pair. `windowedAt`, not collection time, is the
# canonical observation slot used by predictions and accuracy joins.
RAW_HISTORY_SQL = 'SELECT "parkId", "rideId", "waitTime", "isOpen", "windowedAt" FROM "WaitTimeRecord"'

ARCHIVE_HISTORY_SQL = """
    SELECT "parkId", "rideId", "avgWait", "isOpen", date::date, hour
    FROM "HourlyWaitSummary"
    WHERE date >= NOW() - INTERVAL '3 years'
"""

# Latest name per ride across both tables; five rides have been renamed.
RIDE_NAMES_SQL = """
    SELECT DISTINCT ON ("parkId", "rideId") "parkId", "rideId", "rideName", "landName"
    FROM (
        SELECT "parkId", "rideId", "rideName", "landName", "windowedAt" AS seen_at FROM "WaitTimeRecord"
        UNION ALL
        SELECT "parkId", "rideId", "rideName", "landName", date + make_interval(hours => hour) FROM "HourlyWaitSummary"
    ) AS sightings
    ORDER BY "parkId", "rideId", seen_at DESC
"""


def fetch_ride_names(conn) -> dict[tuple[int, int], tuple[str, str]]:
    """(parkId, rideId) -> (rideName, landName), using the newest sighting."""
    with conn.cursor() as cur:
        cur.execute(RIDE_NAMES_SQL)
        return {
            (park_id, ride_id): (ride_name, land_name)
            for park_id, ride_id, ride_name, land_name in cur.fetchall()
        }


def fetch_raw_history(conn, names: dict[tuple[int, int], tuple[str, str]]) -> list[RideHistory]:
    with conn.cursor() as cur:
        cur.execute(RAW_HISTORY_SQL)
        return [
            RideHistory(
                park_id=park_id, ride_id=ride_id,
                ride_name=names[(park_id, ride_id)][0], land_name=names[(park_id, ride_id)][1],
                wait_time=wait_time, is_open=is_open, recorded_at=as_utc(windowed_at),
            )
            for park_id, ride_id, wait_time, is_open, windowed_at in cur.fetchall()
        ]


def fetch_hourly_archive(conn, names: dict[tuple[int, int], tuple[str, str]]) -> list[RideHistory]:
    """HourlyWaitSummary rows; each stands for one Pacific-local hour, rebuilt as UTC."""
    with conn.cursor() as cur:
        cur.execute(ARCHIVE_HISTORY_SQL)
        return [
            RideHistory(
                park_id=park_id, ride_id=ride_id,
                ride_name=names[(park_id, ride_id)][0], land_name=names[(park_id, ride_id)][1],
                wait_time=round(avg_wait), is_open=is_open,
                recorded_at=datetime.combine(park_date, time(hour), tzinfo=PARK_TZ).astimezone(timezone.utc),
            )
            for park_id, ride_id, avg_wait, is_open, park_date, hour in cur.fetchall()
        ]


def fetch_training_history(conn) -> list[RideHistory]:
    """Every unarchived raw row plus three years of hourly archive.

    Raw rows are read with no time filter. archive.py removes a raw row in the
    same statement that folds it into HourlyWaitSummary, so the two tables
    never overlap and never leave a gap, however late archive runs.

    The caller's transaction must be REPEATABLE READ (generate_forecasts sets
    it): under READ COMMITTED an archive committing between these reads would
    count the same rows once raw and once archived, or look up a ride name
    that is not in the name snapshot.
    """
    names = fetch_ride_names(conn)
    return fetch_raw_history(conn, names) + fetch_hourly_archive(conn, names)


def compute_lag_features(history: list[RideHistory]) -> list[RideHistory]:
    """Enrich training records with lag and rolling statistics via dict lookups.

    Uses Python dict lookups rather than SQL LAG() to correctly handle gaps
    (closed days, missing data) without producing wrong values.
    """
    # (park_id, ride_id, date_str_pacific, hour) -> avg_wait
    lookup: dict[tuple[int, int, str, int], float] = {}
    for r in history:
        pdt = r.recorded_at.astimezone(PARK_TZ)
        key = (r.park_id, r.ride_id, pdt.strftime("%Y-%m-%d"), pdt.hour)
        lookup[key] = r.wait_time

    enriched: list[RideHistory] = []
    for r in history:
        pdt = r.recorded_at.astimezone(PARK_TZ)
        d = pdt.date()
        h = pdt.hour

        lag_7d = lookup.get((r.park_id, r.ride_id, str(d - timedelta(days=7)), h), float("nan"))
        lag_14d = lookup.get((r.park_id, r.ride_id, str(d - timedelta(days=14)), h), float("nan"))

        # 7-day rolling mean/std: average over same hour for prior 7 calendar days
        week_waits: list[float] = []
        for days_back in range(1, 8):
            w = lookup.get((r.park_id, r.ride_id, str(d - timedelta(days=days_back)), h))
            if w is not None:
                week_waits.append(w)

        # Imputing r.wait_time here would leak the label into the feature: for
        # every row with no prior-week history the model could read the answer
        # off rolling_7d_mean. Preserve an empty window as NaN instead. This
        # matches inference, where a future source wait is unavailable, and
        # lets XGBoost route missing values explicitly rather than treating
        # them as a real zero-minute wait.
        rolling_mean = float(np.mean(week_waits)) if week_waits else float("nan")
        rolling_std = float(np.std(week_waits)) if week_waits else float("nan")

        existing = r.lag_features or LagFeatures()
        new_lag = LagFeatures(
            lag_7d_wait=lag_7d,
            lag_14d_wait=lag_14d,
            rolling_7d_mean=rolling_mean,
            rolling_7d_std=rolling_std,
            pct_rides_open=existing.pct_rides_open,
            is_headliner_open=existing.is_headliner_open,
        )
        enriched.append(r.model_copy(update={"lag_features": new_lag}))

    return enriched


def attach_cross_ride_features(
    history: list[RideHistory],
    headliner_ids: frozenset,
) -> list[RideHistory]:
    """Compute pct_rides_open and is_headliner_open from concurrent records."""
    slot_stats: dict = defaultdict(lambda: {"open": 0, "total": 0, "headliner_open": False})
    for r in history:
        slot = (r.park_id, r.recorded_at.astimezone(PARK_TZ).replace(minute=0, second=0, microsecond=0))
        slot_stats[slot]["total"] += 1
        if r.is_open:
            slot_stats[slot]["open"] += 1
        if r.ride_id in headliner_ids and r.is_open:
            slot_stats[slot]["headliner_open"] = True

    enriched: list[RideHistory] = []
    for r in history:
        slot = (r.park_id, r.recorded_at.astimezone(PARK_TZ).replace(minute=0, second=0, microsecond=0))
        stats = slot_stats[slot]
        total = stats["total"]
        pct_open = stats["open"] / total if total > 0 else 1.0
        headliner_open = 1.0 if stats["headliner_open"] else 0.0

        existing = r.lag_features or LagFeatures()
        new_lag = existing.model_copy(update={
            "pct_rides_open": pct_open,
            "is_headliner_open": headliner_open,
        })
        enriched.append(r.model_copy(update={"lag_features": new_lag}))

    return enriched


def compute_cross_ride_profile(
    history: list[RideHistory],
) -> dict[tuple[int, int], tuple[float, float]]:
    """(park ID, park hour) -> availability profile observed in training.

    Future slots have no live open/closed data, so the prediction path has to
    impute these two features. Imputing a constant 1.0 feeds the model a value
    it rarely saw while training (rides break down; the park is not fully open
    at 8am), which is train/serve skew: the same feature carries a different
    distribution at inference than it did at fit time. Imputing the training
    mean for that hour keeps both sides on the same distribution.

    Requires history already enriched by attach_cross_ride_features.
    """
    by_hour: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for r in history:
        lag = r.lag_features
        if lag is None:
            continue
        hour = r.recorded_at.astimezone(PARK_TZ).hour
        by_hour[(r.park_id, hour)].append((lag.pct_rides_open, lag.is_headliner_open))

    return {
        hour: (
            float(np.mean([p for p, _ in vals])),
            float(np.mean([h for _, h in vals])),
        )
        for hour, vals in by_hour.items()
    }


def fetch_date_contexts(
    conn,
    park_dates: list[tuple[int, datetime]],
) -> dict[tuple[int, str], DateContext]:
    """Fetch contexts keyed by the park and Pacific-local date they describe."""
    unique_strs = list({park_date_key(d) for _, d in park_dates})
    park_ids = list({park_id for park_id, _ in park_dates})
    if not unique_strs or not park_ids:
        return {}
    sql = """
        SELECT "parkId", date::date, tier, "specialEvent", "isHoliday", "isSchoolBreak",
               "tempHigh", "tempLow", "precipMm", "isRainy"
        FROM "DateContext"
        WHERE date::date = ANY(%s)
          AND "parkId" = ANY(%s)
    """
    result: dict[tuple[int, str], DateContext] = {}
    with conn.cursor() as cur:
        cur.execute(sql, (unique_strs, park_ids))
        for row in cur.fetchall():
            park_id, date_value = row[0], row[1]
            result[(park_id, date_value.strftime("%Y-%m-%d"))] = DateContext(
                tier=row[2] or 0,
                has_special_event=bool(row[3]),
                is_holiday=bool(row[4]),
                is_school_break=bool(row[5]),
                temp_high=float(row[6]) if row[6] is not None else None,
                temp_low=float(row[7]) if row[7] is not None else None,
                precip_mm=float(row[8]) if row[8] is not None else 0.0,
                is_rainy=bool(row[9]) if row[9] is not None else False,
            )
    return result


def _impute_cross_ride(
    profile: dict[tuple[int, int], tuple[float, float]] | None,
    park_id: int,
    hour: int,
) -> tuple[float, float]:
    """Cross-ride feature values for a future slot at `hour`.

    Falls back to the profile's overall mean for an hour never seen in training
    (e.g. an early slot on a day the park opens earlier than usual), and only
    then to neutral constants.
    """
    if not profile:
        return 1.0, 1.0 if HEADLINER_RIDE_IDS else 0.0
    if (park_id, hour) in profile:
        return profile[(park_id, hour)]
    park_values = [values for (profile_park_id, _), values in profile.items() if profile_park_id == park_id]
    values = park_values or list(profile.values())
    return (
        float(np.mean([p for p, _ in values])),
        float(np.mean([h for _, h in values])),
    )


def build_prediction_lag_features(
    conn,
    ride_keys: list[tuple[int, int]],
    slots: list[datetime],
    cross_ride_profile: dict[tuple[int, int], tuple[float, float]] | None = None,
) -> dict[tuple[int, int, str, int], LagFeatures]:
    """Fetch available historical lag features for future prediction slots.

    For each (ride_id, slot), looks up the 7-day and 14-day prior waits and
    computes a rolling 7-day mean/std. The lookup includes both archived and
    recent raw waits: archive.py guarantees those sources do not overlap.

    A missing lookup stays NaN, never 0.0. For a multi-day forecast, the
    source date for a lag may still be in the future, so treating it as a
    zero-minute wait creates train/serve skew. XGBoost handles NaN natively.

    pct_rides_open and is_headliner_open cannot be observed for a future slot.
    Pass `cross_ride_profile` (from compute_cross_ride_profile) to impute them
    with the training mean for that park hour. Without it they fall back to
    neutral constants, which is the skew this parameter exists to avoid — so
    production callers should always pass it.
    """
    if not ride_keys or not slots:
        return {}

    park_slots = [s.astimezone(PARK_TZ) for s in slots]

    dates_needed: set[str] = set()
    for ps in park_slots:
        d = ps.date()
        for days_back in range(1, 15):
            dates_needed.add(str(d - timedelta(days=days_back)))

    park_ids = list({park_id for park_id, _ in ride_keys})
    ride_ids = list({ride_id for _, ride_id in ride_keys})
    archive_sql = """
        SELECT "parkId", "rideId", date::date, hour, "avgWait"
        FROM "HourlyWaitSummary"
        WHERE date::date = ANY(%s)
          AND "rideId" = ANY(%s)
          AND "parkId" = ANY(%s)
    """
    raw_sql = """
        SELECT
            "parkId", "rideId",
            ("windowedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
            EXTRACT(HOUR FROM ("windowedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'))::int AS hour,
            AVG("waitTime")::float AS "avgWait"
        FROM "WaitTimeRecord"
        WHERE "rideId" = ANY(%s)
          AND "parkId" = ANY(%s)
          AND ("windowedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = ANY(%s)
        GROUP BY 1, 2, 3, 4
    """
    lookup: dict[tuple[int, int, str, int], float] = {}
    with conn.cursor() as cur:
        cur.execute(archive_sql, (list(dates_needed), ride_ids, park_ids))
        for row in cur.fetchall():
            park_id, ride_id, d, hour, avg_wait = row
            lookup[(park_id, ride_id, str(d), hour)] = float(avg_wait)
        cur.execute(raw_sql, (ride_ids, park_ids, list(dates_needed)))
        for row in cur.fetchall():
            park_id, ride_id, d, hour, avg_wait = row
            lookup[(park_id, ride_id, str(d), hour)] = float(avg_wait)

    result: dict[tuple[int, int, str, int], LagFeatures] = {}
    for ps in park_slots:
        date_str = ps.strftime("%Y-%m-%d")
        d = ps.date()
        h = ps.hour
        for park_id, ride_id in ride_keys:
            lag_7d = lookup.get((park_id, ride_id, str(d - timedelta(days=7)), h), float("nan"))
            lag_14d = lookup.get((park_id, ride_id, str(d - timedelta(days=14)), h), float("nan"))
            week_waits = [
                lookup[(park_id, ride_id, str(d - timedelta(days=db)), h)]
                for db in range(1, 8)
                if (park_id, ride_id, str(d - timedelta(days=db)), h) in lookup
            ]
            rolling_mean = float(np.mean(week_waits)) if week_waits else float("nan")
            rolling_std = float(np.std(week_waits)) if week_waits else float("nan")
            pct_open, headliner_open = _impute_cross_ride(cross_ride_profile, park_id, h)
            result[(park_id, ride_id, date_str, h)] = LagFeatures(
                lag_7d_wait=lag_7d,
                lag_14d_wait=lag_14d,
                rolling_7d_mean=rolling_mean,
                rolling_7d_std=rolling_std,
                pct_rides_open=pct_open,
                is_headliner_open=headliner_open,
            )

    return result


def upsert_forecasts(
    conn,
    forecasts_per_slot: list[tuple[datetime, list[RideForecast], dict[int, int]]],
    ride_meta: dict[tuple[int, int], dict],
) -> int:
    """Upsert DailyForecast rows — ON CONFLICT updates existing rows in place."""
    sql = """
        INSERT INTO "DailyForecast"
            (id, "parkId", "rideId", "rideName", "landName", "forecastFor",
             "predictedWait", "crowdScore", "mlConfidence", "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("rideId", "forecastFor") DO UPDATE SET
            "parkId"       = EXCLUDED."parkId",
            "predictedWait" = EXCLUDED."predictedWait",
            "crowdScore"    = EXCLUDED."crowdScore",
            "mlConfidence"  = EXCLUDED."mlConfidence",
            "createdAt"     = EXCLUDED."createdAt"
    """
    now = datetime.now(timezone.utc)
    rows = []
    for slot, ride_forecasts, crowd_scores in forecasts_per_slot:
        for f in ride_forecasts:
            meta = ride_meta.get((f.park_id, f.ride_id))
            if not meta:
                continue
            rows.append((
                str(uuid.uuid4()),
                f.park_id, f.ride_id, meta["name"], meta["land_name"],
                slot, f.predicted_wait, crowd_scores[f.park_id], f.confidence, now,
            ))
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


def upsert_ride_catalog(conn, ride_meta: dict[tuple[int, int], dict]) -> int:
    """Refresh compact ride metadata once per model run.

    Slot predictions intentionally retain their historical display fields for
    backwards compatibility. The serving projection tables refer to this
    small catalogue instead, avoiding 48 copies of a ride name every day.
    """
    if not ride_meta:
        return 0
    park_ids = sorted({park_id for park_id, _ in ride_meta})
    rows = [
        (park_id, ride_id, meta["name"], meta["land_name"])
        for (park_id, ride_id), meta in ride_meta.items()
    ]
    sql = """
        INSERT INTO "RideCatalog" ("parkId", "rideId", "rideName", "landName", "isActive", "updatedAt")
        VALUES (%s, %s, %s, %s, true, CURRENT_TIMESTAMP)
        ON CONFLICT ("parkId", "rideId") DO UPDATE SET
            "rideName" = EXCLUDED."rideName",
            "landName" = EXCLUDED."landName",
            "isActive" = true,
            "updatedAt" = CURRENT_TIMESTAMP
    """
    with conn.cursor() as cur:
        # A ride that disappears from a successful complete source response is
        # no longer selectable, but its historical projection remains intact.
        cur.execute('UPDATE "RideCatalog" SET "isActive" = false WHERE "parkId" = ANY(%s)', (park_ids,))
        cur.executemany(sql, rows)
    return len(rows)


def create_model_run(conn, now: datetime, trained_models: dict) -> str:
    """Record only aggregate validation metadata for a reproducible scoring run."""
    cv_maes = [float(model.cv_mae) for model in trained_models.values() if model.model is not None]
    metrics = {
        "rideModelCount": len(trained_models),
        "xgboostModelCount": len(cv_maes),
        "meanCvMae": round(float(np.mean(cv_maes)), 3) if cv_maes else None,
    }
    model_run_id = str(uuid.uuid4())
    sql = """
        INSERT INTO "ModelRun" (id, version, "featureVersion", "trainingCutoff", metrics)
        VALUES (%s, %s, %s, %s, %s::jsonb)
    """
    with conn.cursor() as cur:
        cur.execute(sql, (model_run_id, MODEL_VERSION, FEATURE_VERSION, now, json.dumps(metrics)))
    return model_run_id


def build_serving_projection_rows(
    forecasts_per_slot: list[tuple[datetime, list[RideForecast], dict[int, int]]],
    model_run_id: str,
) -> tuple[list[tuple], list[tuple]]:
    """Collapse slot predictions into one small row per park/day and ride/day."""
    generated_at = datetime.now(timezone.utc)
    scores: dict[tuple[int, datetime], list[int]] = defaultdict(list)
    ride_values: dict[tuple[int, int, datetime], dict[str, list[float]]] = defaultdict(
        lambda: {"waits": [], "confidences": []}
    )
    for slot, ride_forecasts, crowd_scores in forecasts_per_slot:
        day = forecast_date(slot)
        for park_id, score in crowd_scores.items():
            scores[(park_id, day)].append(score)
        for forecast in ride_forecasts:
            values = ride_values[(forecast.park_id, forecast.ride_id, day)]
            values["waits"].append(forecast.predicted_wait)
            values["confidences"].append(forecast.confidence)

    park_rows = [
        (str(uuid.uuid4()), park_id, day, int(round(float(np.percentile(day_scores, 75)))), model_run_id, generated_at)
        for (park_id, day), day_scores in scores.items()
        if day_scores
    ]
    ride_rows = [
        (
            str(uuid.uuid4()), park_id, ride_id, day,
            int(round(float(np.mean(values["waits"])))), int(max(values["waits"])),
            float(np.mean(values["confidences"])), model_run_id, generated_at,
        )
        for (park_id, ride_id, day), values in ride_values.items()
        if values["waits"]
    ]
    return park_rows, ride_rows


def upsert_serving_projections(conn, park_rows: list[tuple], ride_rows: list[tuple]) -> int:
    """Write compact calendar and wait-table projections without a delete gap."""
    park_sql = """
        INSERT INTO "ParkDayForecast" (id, "parkId", date, "crowdScore", "modelRunId", "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT ("parkId", date) DO UPDATE SET
            "crowdScore" = EXCLUDED."crowdScore",
            "modelRunId" = EXCLUDED."modelRunId",
            "createdAt" = EXCLUDED."createdAt"
    """
    ride_sql = """
        INSERT INTO "RideDayForecast"
            (id, "parkId", "rideId", date, "avgWait", "peakWait", "mlConfidence", "modelRunId", "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("parkId", "rideId", date) DO UPDATE SET
            "avgWait" = EXCLUDED."avgWait",
            "peakWait" = EXCLUDED."peakWait",
            "mlConfidence" = EXCLUDED."mlConfidence",
            "modelRunId" = EXCLUDED."modelRunId",
            "createdAt" = EXCLUDED."createdAt"
    """
    with conn.cursor() as cur:
        if park_rows:
            cur.executemany(park_sql, park_rows)
        if ride_rows:
            cur.executemany(ride_sql, ride_rows)
    return len(park_rows) + len(ride_rows)


def issue_evaluations(conn, model_run_id: str, ride_rows: list[tuple], now: datetime) -> int:
    """Keep only selected forecast horizons, not every predicted 30-minute slot."""
    today = as_utc(now).astimezone(PARK_TZ).date()
    rows = []
    for _, park_id, ride_id, target_date, avg_wait, *_ in ride_rows:
        # `forecast_date` is intentionally UTC midnight for a *park-local*
        # calendar day, so do not convert that storage key back to Pacific.
        horizon = (as_utc(target_date).date() - today).days
        if horizon not in EVALUATION_HORIZONS:
            continue
        rows.append((
            str(uuid.uuid4()), model_run_id, park_id, ride_id, target_date,
            EVALUATION_HORIZONS[horizon], avg_wait,
        ))
    if not rows:
        return 0
    sql = """
        INSERT INTO "ForecastEvaluation"
            (id, "modelRunId", "parkId", "rideId", "targetDate", "horizonBucket", "predictedAvgWait")
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("modelRunId", "parkId", "rideId", "targetDate") DO UPDATE SET
            "horizonBucket" = EXCLUDED."horizonBucket",
            "predictedAvgWait" = EXCLUDED."predictedAvgWait"
    """
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


def backfill_evaluations(conn) -> int:
    """Fill finalized wait averages while raw observations are still retained."""
    sql = """
        WITH actuals AS (
            SELECT
                "parkId",
                "rideId",
                ("windowedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date::timestamp AS "targetDate",
                ROUND(AVG("waitTime") FILTER (WHERE "isOpen"))::int AS "actualAvgWait"
            FROM "WaitTimeRecord"
            WHERE "windowedAt" >= NOW() - INTERVAL '31 days'
            GROUP BY 1, 2, 3
        )
        UPDATE "ForecastEvaluation" AS evaluation
        SET
            "actualAvgWait" = actuals."actualAvgWait",
            mae = ABS(evaluation."predictedAvgWait" - actuals."actualAvgWait")::float
        FROM actuals
        WHERE evaluation."parkId" = actuals."parkId"
          AND evaluation."rideId" = actuals."rideId"
          AND evaluation."targetDate" = actuals."targetDate"
          AND evaluation."targetDate" < DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Los_Angeles')
          AND evaluation."actualAvgWait" IS NULL
          AND actuals."actualAvgWait" IS NOT NULL
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.rowcount


def generate_forecasts(conn, now: datetime, days: int) -> int:
    """Load history, train per-ride models, and upsert `days` of DailyForecast rows.

    Returns the number of rows upserted. Does not commit.

    Returns 0 without touching the database when there is no open slot left in
    the window: training on the full history only to predict nothing wastes
    the whole read. Raises when history yields no models at all, because an
    empty forecast table would otherwise be reported as a successful run.
    """
    slots = build_forecast_slots(now, days=days)
    if not slots:
        logger.info("No open forecast slots between %s and the end of the window", now)
        return 0

    # One snapshot for every read below; see fetch_training_history. This must be
    # the transaction's first statement, which Postgres enforces loudly.
    with conn.cursor() as cur:
        cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")

    history = fetch_training_history(conn)
    logger.info("Loaded %d training records", len(history))

    training_contexts = fetch_date_contexts(conn, [(r.park_id, r.recorded_at) for r in history])
    history = [
        r.model_copy(update={"context": training_contexts.get((r.park_id, park_date_key(r.recorded_at)), DateContext())})
        for r in history
    ]

    history = compute_lag_features(history)
    headliner_ids = resolve_headliner_ids(history)
    history = attach_cross_ride_features(history, headliner_ids)
    cross_ride_profile = compute_cross_ride_profile(history)
    park_calibrations = {
        park_id: build_crowd_calibration(
            [r for r in history if r.park_id == park_id], headliner_ids
        )
        for park_id in {r.park_id for r in history}
    }
    logger.info("Resolved %d headliner rides", len(headliner_ids))
    logger.info(
        "Crowd calibration anchors (P%s): %s",
        "/P".join(str(int(p)) for p in CROWD_CALIBRATION_PERCENTILES),
        {park_id: calibration.anchors for park_id, calibration in park_calibrations.items()},
    )

    trained_models = train_ride_models(history)
    if not trained_models:
        raise RuntimeError(
            f"No ride models trained from {len(history)} history records; refusing to report success"
        )
    logger.info("Trained %d ride models", len(trained_models))
    model_run_id = create_model_run(conn, now, trained_models)

    ride_meta: dict[tuple[int, int], dict] = {}
    for r in history:
        ride_meta.setdefault(
            (r.park_id, r.ride_id),
            {"name": r.ride_name, "land_name": r.land_name},
        )

    ride_keys = list(ride_meta)
    date_contexts = fetch_date_contexts(
        conn,
        [(park_id, slot) for park_id, _ in ride_keys for slot in slots],
    )
    lag_map = build_prediction_lag_features(
        conn, ride_keys, slots, cross_ride_profile
    )

    # One XGBoost call per ride covers every slot.
    all_ride_forecasts: dict[tuple[int, int, datetime], RideForecast] = {}
    for (park_id, ride_id), tm in trained_models.items():
        lags_list = [
            lag_map.get((park_id, ride_id, park_date_key(s), park_hour(s)), LagFeatures())
            for s in slots
        ]
        contexts_list = [date_contexts.get((park_id, park_date_key(s))) for s in slots]
        for slot, f in zip(
            slots,
            predict_for_ride(tm, ride_id, slots, contexts_list, lags_list, park_id),
        ):
            all_ride_forecasts[(park_id, ride_id, slot)] = f

    forecasts_per_slot = []
    for slot in slots:
        slot_forecasts = [
            all_ride_forecasts[(park_id, ride_id, slot)]
            for park_id, ride_id in ride_keys
            if (park_id, ride_id, slot) in all_ride_forecasts
        ]
        crowd_scores = {}
        for park_id in {f.park_id for f in slot_forecasts}:
            park_forecasts = [f for f in slot_forecasts if f.park_id == park_id]
            crowd_scores[park_id] = _compute_crowd_score(
                park_forecasts,
                date_contexts.get((park_id, park_date_key(slot))),
                park_calibrations[park_id],
                headliner_ids,
            )
        forecasts_per_slot.append((slot, slot_forecasts, crowd_scores))

    rows_upserted = upsert_forecasts(conn, forecasts_per_slot, ride_meta)
    catalog_rows = upsert_ride_catalog(conn, ride_meta)
    park_rows, ride_rows = build_serving_projection_rows(forecasts_per_slot, model_run_id)
    projection_rows = upsert_serving_projections(conn, park_rows, ride_rows)
    issued_evaluations = issue_evaluations(conn, model_run_id, ride_rows, now)
    completed_evaluations = backfill_evaluations(conn)
    logger.info(
        "Upserted %d slot forecasts, %d catalogue rows, and %d serving projections across %d slots (%d days); "
        "issued %d evaluations and completed %d",
        rows_upserted, catalog_rows, projection_rows, len(forecasts_per_slot), days,
        issued_evaluations, completed_evaluations,
    )
    return rows_upserted

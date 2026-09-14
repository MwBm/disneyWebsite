"""Training-data loading, feature engineering and forecast writing.

Owned by train.py, the only job that writes DailyForecast rows.
"""

import logging
import uuid
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone

import numpy as np

from common import PARK_TZ, WINDOW_MINUTES, as_utc, park_date_key, park_hour
from model import (
    HEADLINER_RIDE_IDS,
    _compute_crowd_score,
    predict_for_ride,
    resolve_headliner_ids,
    train_ride_models,
)
from schemas import DateContext, LagFeatures, RideForecast, RideHistory

logger = logging.getLogger(__name__)

FORECAST_SLOTS_PER_DAY = 24 * 60 // WINDOW_MINUTES

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


# The training reads carry ride IDs only; names would be ~45% of the bytes.
# RIDE_NAMES_SQL returns one name row per ride instead.
RAW_HISTORY_SQL = 'SELECT "rideId", "waitTime", "isOpen", "recordedAt" FROM "WaitTimeRecord"'

ARCHIVE_HISTORY_SQL = """
    SELECT "rideId", "avgWait", "isOpen", date::date, hour
    FROM "HourlyWaitSummary"
    WHERE date >= NOW() - INTERVAL '3 years'
"""

# Latest name per ride across both tables; five rides have been renamed.
RIDE_NAMES_SQL = """
    SELECT DISTINCT ON ("rideId") "rideId", "rideName", "landName"
    FROM (
        SELECT "rideId", "rideName", "landName", "windowedAt" AS seen_at FROM "WaitTimeRecord"
        UNION ALL
        SELECT "rideId", "rideName", "landName", date + make_interval(hours => hour) FROM "HourlyWaitSummary"
    ) AS sightings
    ORDER BY "rideId", seen_at DESC
"""


def fetch_ride_names(conn) -> dict[int, tuple[str, str]]:
    """rideId -> (rideName, landName), the most recently seen pair."""
    with conn.cursor() as cur:
        cur.execute(RIDE_NAMES_SQL)
        return {ride_id: (ride_name, land_name) for ride_id, ride_name, land_name in cur.fetchall()}


def fetch_raw_history(conn, names: dict[int, tuple[str, str]]) -> list[RideHistory]:
    with conn.cursor() as cur:
        cur.execute(RAW_HISTORY_SQL)
        return [
            RideHistory(
                ride_id=ride_id, ride_name=names[ride_id][0], land_name=names[ride_id][1],
                wait_time=wait_time, is_open=is_open, recorded_at=as_utc(recorded_at),
            )
            for ride_id, wait_time, is_open, recorded_at in cur.fetchall()
        ]


def fetch_hourly_archive(conn, names: dict[int, tuple[str, str]]) -> list[RideHistory]:
    """HourlyWaitSummary rows; each stands for one Pacific-local hour, rebuilt as UTC."""
    with conn.cursor() as cur:
        cur.execute(ARCHIVE_HISTORY_SQL)
        return [
            RideHistory(
                ride_id=ride_id, ride_name=names[ride_id][0], land_name=names[ride_id][1],
                wait_time=round(avg_wait), is_open=is_open,
                recorded_at=datetime.combine(park_date, time(hour), tzinfo=PARK_TZ).astimezone(timezone.utc),
            )
            for ride_id, avg_wait, is_open, park_date, hour in cur.fetchall()
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
    # (ride_id, date_str_pacific, hour) -> avg_wait
    lookup: dict[tuple[int, str, int], float] = {}
    for r in history:
        pdt = r.recorded_at.astimezone(PARK_TZ)
        key = (r.ride_id, pdt.strftime("%Y-%m-%d"), pdt.hour)
        lookup[key] = r.wait_time

    enriched: list[RideHistory] = []
    for r in history:
        pdt = r.recorded_at.astimezone(PARK_TZ)
        d = pdt.date()
        h = pdt.hour

        lag_7d = lookup.get((r.ride_id, str(d - timedelta(days=7)), h), 0.0)
        lag_14d = lookup.get((r.ride_id, str(d - timedelta(days=14)), h), 0.0)

        # 7-day rolling mean/std: average over same hour for prior 7 calendar days
        week_waits: list[float] = []
        for days_back in range(1, 8):
            w = lookup.get((r.ride_id, str(d - timedelta(days=days_back)), h))
            if w is not None:
                week_waits.append(w)

        # Imputing r.wait_time here would leak the label into the feature: for
        # every row with no prior-week history the model could read the answer
        # off rolling_7d_mean. Use 0.0, which is also what the prediction path
        # imputes (build_prediction_lag_features) — train and serve must agree.
        rolling_mean = float(np.mean(week_waits)) if week_waits else 0.0
        rolling_std = float(np.std(week_waits)) if len(week_waits) > 1 else 0.0

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
        slot = r.recorded_at.astimezone(PARK_TZ).replace(minute=0, second=0, microsecond=0)
        slot_stats[slot]["total"] += 1
        if r.is_open:
            slot_stats[slot]["open"] += 1
        if r.ride_id in headliner_ids and r.is_open:
            slot_stats[slot]["headliner_open"] = True

    enriched: list[RideHistory] = []
    for r in history:
        slot = r.recorded_at.astimezone(PARK_TZ).replace(minute=0, second=0, microsecond=0)
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
) -> dict[int, tuple[float, float]]:
    """Park hour -> (mean pct_rides_open, mean is_headliner_open) seen in training.

    Future slots have no live open/closed data, so the prediction path has to
    impute these two features. Imputing a constant 1.0 feeds the model a value
    it rarely saw while training (rides break down; the park is not fully open
    at 8am), which is train/serve skew: the same feature carries a different
    distribution at inference than it did at fit time. Imputing the training
    mean for that hour keeps both sides on the same distribution.

    Requires history already enriched by attach_cross_ride_features.
    """
    by_hour: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for r in history:
        lag = r.lag_features
        if lag is None:
            continue
        hour = r.recorded_at.astimezone(PARK_TZ).hour
        by_hour[hour].append((lag.pct_rides_open, lag.is_headliner_open))

    return {
        hour: (
            float(np.mean([p for p, _ in vals])),
            float(np.mean([h for _, h in vals])),
        )
        for hour, vals in by_hour.items()
    }


def fetch_date_contexts(conn, dates: list[datetime]) -> dict[str, DateContext]:
    unique_strs = list({park_date_key(d) for d in dates})
    if not unique_strs:
        return {}
    sql = """
        SELECT date::date, tier, "specialEvent", "isHoliday", "isSchoolBreak",
               "tempHigh", "tempLow", "precipMm", "isRainy"
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
                temp_high=float(row[5]) if row[5] is not None else None,
                temp_low=float(row[6]) if row[6] is not None else None,
                precip_mm=float(row[7]) if row[7] is not None else 0.0,
                is_rainy=bool(row[8]) if row[8] is not None else False,
            )
    return result


def _impute_cross_ride(
    profile: dict[int, tuple[float, float]] | None,
    hour: int,
) -> tuple[float, float]:
    """Cross-ride feature values for a future slot at `hour`.

    Falls back to the profile's overall mean for an hour never seen in training
    (e.g. an early slot on a day the park opens earlier than usual), and only
    then to neutral constants.
    """
    if not profile:
        return 1.0, 1.0 if HEADLINER_RIDE_IDS else 0.0
    if hour in profile:
        return profile[hour]
    return (
        float(np.mean([p for p, _ in profile.values()])),
        float(np.mean([h for _, h in profile.values()])),
    )


def build_prediction_lag_features(
    conn,
    ride_ids: list[int],
    slots: list[datetime],
    cross_ride_profile: dict[int, tuple[float, float]] | None = None,
) -> dict[tuple[int, str, int], LagFeatures]:
    """Fetch historical lag features from HourlyWaitSummary for future prediction slots.

    For each (ride_id, slot), looks up the 7-day and 14-day prior waits and
    computes a rolling 7-day mean/std.

    pct_rides_open and is_headliner_open cannot be observed for a future slot.
    Pass `cross_ride_profile` (from compute_cross_ride_profile) to impute them
    with the training mean for that park hour. Without it they fall back to
    neutral constants, which is the skew this parameter exists to avoid — so
    production callers should always pass it.
    """
    if not ride_ids or not slots:
        return {}

    park_slots = [s.astimezone(PARK_TZ) for s in slots]

    dates_needed: set[str] = set()
    for ps in park_slots:
        d = ps.date()
        for days_back in range(1, 15):
            dates_needed.add(str(d - timedelta(days=days_back)))

    sql = """
        SELECT "rideId", date::date, hour, "avgWait"
        FROM "HourlyWaitSummary"
        WHERE date::date = ANY(%s)
          AND "rideId" = ANY(%s)
    """
    lookup: dict[tuple[int, str, int], float] = {}
    with conn.cursor() as cur:
        cur.execute(sql, (list(dates_needed), ride_ids))
        for row in cur.fetchall():
            ride_id, d, hour, avg_wait = row
            lookup[(ride_id, str(d), hour)] = float(avg_wait)

    result: dict[tuple[int, str, int], LagFeatures] = {}
    for ps in park_slots:
        date_str = ps.strftime("%Y-%m-%d")
        d = ps.date()
        h = ps.hour
        for ride_id in ride_ids:
            lag_7d = lookup.get((ride_id, str(d - timedelta(days=7)), h), 0.0)
            lag_14d = lookup.get((ride_id, str(d - timedelta(days=14)), h), 0.0)
            week_waits = [
                lookup[(ride_id, str(d - timedelta(days=db)), h)]
                for db in range(1, 8)
                if (ride_id, str(d - timedelta(days=db)), h) in lookup
            ]
            rolling_mean = float(np.mean(week_waits)) if week_waits else 0.0
            rolling_std = float(np.std(week_waits)) if len(week_waits) > 1 else 0.0
            pct_open, headliner_open = _impute_cross_ride(cross_ride_profile, h)
            result[(ride_id, date_str, h)] = LagFeatures(
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
    forecasts_per_slot: list[tuple[datetime, list, int]],
    ride_meta: dict[int, dict],
) -> int:
    """Upsert DailyForecast rows — ON CONFLICT updates existing rows in place."""
    sql = """
        INSERT INTO "DailyForecast"
            (id, "rideId", "rideName", "landName", "forecastFor",
             "predictedWait", "crowdScore", "mlConfidence", "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("rideId", "forecastFor") DO UPDATE SET
            "predictedWait" = EXCLUDED."predictedWait",
            "crowdScore"    = EXCLUDED."crowdScore",
            "mlConfidence"  = EXCLUDED."mlConfidence",
            "createdAt"     = EXCLUDED."createdAt"
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
                f.ride_id, meta["name"], meta["land_name"],
                slot, f.predicted_wait, crowd_score, f.confidence, now,
            ))
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


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

    training_contexts = fetch_date_contexts(conn, [r.recorded_at for r in history])
    history = [
        r.model_copy(update={"context": training_contexts.get(park_date_key(r.recorded_at), DateContext())})
        for r in history
    ]

    history = compute_lag_features(history)
    headliner_ids = resolve_headliner_ids(history)
    history = attach_cross_ride_features(history, headliner_ids)
    cross_ride_profile = compute_cross_ride_profile(history)
    logger.info("Resolved %d headliner rides", len(headliner_ids))

    trained_models = train_ride_models(history)
    if not trained_models:
        raise RuntimeError(
            f"No ride models trained from {len(history)} history records; refusing to report success"
        )
    logger.info("Trained %d ride models", len(trained_models))

    ride_meta: dict[int, dict] = {}
    for r in history:
        if r.ride_id not in ride_meta:
            ride_meta[r.ride_id] = {"name": r.ride_name, "land_name": r.land_name}

    date_contexts = fetch_date_contexts(conn, slots)
    lag_map = build_prediction_lag_features(
        conn, list(trained_models.keys()), slots, cross_ride_profile
    )

    # One XGBoost call per ride covers every slot.
    contexts_list = [date_contexts.get(park_date_key(s)) for s in slots]
    all_ride_forecasts: dict[tuple[int, datetime], RideForecast] = {}
    for ride_id, tm in trained_models.items():
        lags_list = [
            lag_map.get((ride_id, park_date_key(s), park_hour(s)), LagFeatures())
            for s in slots
        ]
        for slot, f in zip(slots, predict_for_ride(tm, ride_id, slots, contexts_list, lags_list)):
            all_ride_forecasts[(ride_id, slot)] = f

    forecasts_per_slot = []
    for slot in slots:
        ctx = date_contexts.get(park_date_key(slot))
        slot_forecasts = [
            all_ride_forecasts[(rid, slot)]
            for rid in trained_models
            if (rid, slot) in all_ride_forecasts
        ]
        forecasts_per_slot.append((slot, slot_forecasts, _compute_crowd_score(slot_forecasts, ctx)))

    rows_upserted = upsert_forecasts(conn, forecasts_per_slot, ride_meta)
    logger.info(
        "Upserted %d DailyForecast rows across %d slots (%d days)",
        rows_upserted, len(forecasts_per_slot), days,
    )
    return rows_upserted

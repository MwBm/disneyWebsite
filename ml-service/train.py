"""Daily training job: load full history, train models, write 30-day DailyForecast window.

Designed to run once per day (06:00 UTC). Keeps today's intra-day predictions
managed by collect.py (30-min job). This script owns the future 30-day window.
"""

import logging
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import psycopg

from collect import (
    RAW_RETENTION_DAYS,
    attach_cross_ride_features,
    build_forecast_slots,
    build_prediction_lag_features,
    compute_lag_features,
    fetch_date_contexts,
    fetch_history,
    fetch_hourly_archive,
    log_collect_run,
    park_date_key,
    park_hour,
    upsert_forecasts,
)
from model import HEADLINER_RIDE_IDS, _compute_crowd_score, predict_for_ride, train_ride_models
from schemas import DateContext, LagFeatures

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

FORECAST_DAYS = 30


def main() -> int:
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("DIRECT_URL")
    if not db_url:
        print("ERROR: DATABASE_URL or DIRECT_URL must be set", file=sys.stderr)
        return 1

    db_url = db_url.replace("?pgbouncer=true", "").replace("&pgbouncer=true", "")

    now = datetime.now(timezone.utc)
    rows_upserted = 0

    try:
        with psycopg.connect(db_url, autocommit=False) as conn:
            try:
                # Load training data
                raw_history = fetch_history(conn, now - timedelta(days=RAW_RETENTION_DAYS))
                archived_history = fetch_hourly_archive(conn)
                history = raw_history + archived_history
                logger.info(
                    "Loaded %d raw + %d archived = %d total records",
                    len(raw_history), len(archived_history), len(history),
                )

                # Attach DateContext, lag features, cross-ride features
                training_contexts = fetch_date_contexts(conn, [r.recorded_at for r in history])
                history = [
                    r.model_copy(update={"context": training_contexts.get(park_date_key(r.recorded_at), DateContext())})
                    for r in history
                ]
                history = compute_lag_features(history)
                history = attach_cross_ride_features(history, HEADLINER_RIDE_IDS)

                trained_models = train_ride_models(history)
                logger.info("Trained %d ride models", len(trained_models))

                # Build ride metadata from training records
                ride_meta: dict[int, dict] = {}
                for r in history:
                    if r.ride_id not in ride_meta:
                        ride_meta[r.ride_id] = {"name": r.ride_name, "land_name": r.land_name}

                # Generate full 30-day forecast window
                slots = build_forecast_slots(now, days=FORECAST_DAYS)
                date_contexts = fetch_date_contexts(conn, slots)
                lag_map = build_prediction_lag_features(conn, list(trained_models.keys()), slots)

                # Batch-predict per ride
                all_ride_forecasts: dict[tuple[int, datetime], object] = {}
                for ride_id, tm in trained_models.items():
                    contexts_list = [date_contexts.get(park_date_key(s)) for s in slots]
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
                    crowd_score = _compute_crowd_score(slot_forecasts, ctx)
                    forecasts_per_slot.append((slot, slot_forecasts, crowd_score))

                rows_upserted = upsert_forecasts(conn, forecasts_per_slot, ride_meta)
                conn.commit()
                logger.info(
                    "Upserted %d DailyForecast rows across %d slots (%d days)",
                    rows_upserted, len(forecasts_per_slot), FORECAST_DAYS,
                )

                log_collect_run(conn, rows_upserted, success=True)
                conn.commit()
            except Exception:
                conn.rollback()
                raise

        logger.info("Daily training run successful")
        return 0
    except Exception as exc:
        logger.error("Training run failed: %s", exc)
        try:
            with psycopg.connect(db_url, autocommit=True) as conn:
                log_collect_run(conn, rows_upserted, success=False, error_message=str(exc))
        except Exception as log_exc:
            logger.error("Failed to log error: %s", log_exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())

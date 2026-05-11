import numpy as np
import xgboost as xgb
from typing import List, Dict, Tuple, Optional, NamedTuple
from schemas import RideHistory, RideForecast, DateContext
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

MIN_SAMPLES = 30

# Sync contract: must stay in sync with src/lib/crowd.ts
# MAX_WAIT           = CROWD_MAX_WAIT         = 120
# EXPECTED_RIDES     = CROWD_EXPECTED_RIDES   = 24
# TIER_MULTIPLIER_STEP                        = 0.08
CROWD_MAX_WAIT = 120       # wait minutes where crowd score = 100
CROWD_EXPECTED_RIDES = 24  # nominal full ride complement for count adjustment
TIER_MULTIPLIER_STEP = 0.08
PARK_TZ = ZoneInfo("America/Los_Angeles")


class TrainedModel(NamedTuple):
    model: Optional[xgb.XGBRegressor]  # None → use fallback
    confidence: float
    hour_means: Dict[int, int]          # Pacific hour → mean wait (fallback lookup)
    global_mean: int                    # fallback when hour has no history


def _park_time(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(PARK_TZ)


def _extract_features(dt: datetime, context: Optional[DateContext] = None) -> List[float]:
    park_dt = _park_time(dt)
    hour = float(park_dt.hour)
    weekday = float(park_dt.weekday())
    month = float(park_dt.month)
    is_weekend = 1.0 if park_dt.weekday() >= 5 else 0.0
    tier = float(context.tier) if context else 0.0
    has_special_event = 1.0 if context and context.has_special_event else 0.0
    is_holiday = 1.0 if context and context.is_holiday else 0.0
    is_school_break = 1.0 if context and context.is_school_break else 0.0
    temp_high = float(context.temp_high) if context and context.temp_high is not None else 75.0
    is_rainy = 1.0 if context and context.is_rainy else 0.0
    hour_x_weekday = hour * weekday
    hour_x_weekend = hour * is_weekend
    month_x_weekday = month * weekday
    month_x_school_break = month * is_school_break
    return [
        hour, weekday, month, is_weekend, tier, has_special_event,
        is_holiday, is_school_break, temp_high, is_rainy,
        hour_x_weekday, hour_x_weekend, month_x_weekday, month_x_school_break,
    ]


def _train_ride_model(records: List[RideHistory]) -> Tuple[xgb.XGBRegressor, float]:
    X = np.array([_extract_features(r.recorded_at, r.context) for r in records], dtype=float)
    y = np.array([r.wait_time for r in records], dtype=float)

    model = xgb.XGBRegressor(
        n_estimators=100,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=1,
    )
    model.fit(X, y)

    preds = model.predict(X)
    residuals = np.abs(preds - y)
    mean_wait = np.mean(y) if np.mean(y) > 0 else 1
    confidence = float(np.clip(1.0 - np.std(residuals) / mean_wait, 0.0, 1.0))

    return model, confidence


def train_ride_models(rides: List[RideHistory]) -> Dict[int, TrainedModel]:
    """Train one XGBRegressor per ride from history. Call once; predict for many slots."""
    ride_groups: Dict[int, List[RideHistory]] = {}
    for r in rides:
        if r.is_open:
            ride_groups.setdefault(r.ride_id, []).append(r)

    result: Dict[int, TrainedModel] = {}
    for ride_id, records in ride_groups.items():
        global_mean = int(np.mean([r.wait_time for r in records])) if records else 0
        by_hour: Dict[int, List[float]] = {}
        for r in records:
            by_hour.setdefault(_park_time(r.recorded_at).hour, []).append(r.wait_time)
        hour_means = {h: int(np.mean(v)) for h, v in by_hour.items()}

        if len(records) < MIN_SAMPLES:
            result[ride_id] = TrainedModel(None, 0.3, hour_means, global_mean)
        else:
            model, confidence = _train_ride_model(records)
            result[ride_id] = TrainedModel(model, confidence, hour_means, global_mean)

    return result


def predict_for_slot(
    trained_models: Dict[int, TrainedModel],
    slot: datetime,
    context: Optional[DateContext] = None,
) -> Tuple[List[RideForecast], int]:
    """Predict wait times for a single time slot using pre-trained models."""
    features = _extract_features(slot, context)
    forecasts: List[RideForecast] = []

    for ride_id, tm in trained_models.items():
        if tm.model is None:
            mean_wait = tm.hour_means.get(_park_time(slot).hour, tm.global_mean)
            forecasts.append(
                RideForecast(ride_id=ride_id, predicted_wait=max(0, mean_wait), confidence=tm.confidence)
            )
        else:
            X = np.array([features], dtype=float)
            predicted = int(np.clip(tm.model.predict(X)[0], 0, 300))
            forecasts.append(
                RideForecast(ride_id=ride_id, predicted_wait=predicted, confidence=tm.confidence)
            )

    if forecasts:
        raw_waits = [min(f.predicted_wait, CROWD_MAX_WAIT) for f in forecasts]
        avg_wait = float(np.mean(raw_waits))
        ride_ratio = min(len(forecasts) / CROWD_EXPECTED_RIDES, 1.0)
        effective_wait = avg_wait * ride_ratio
        base = min(effective_wait / CROWD_MAX_WAIT * 100, 100)
        tier_multiplier = 1.0 + (context.tier * TIER_MULTIPLIER_STEP if context else 0.0)
        crowd_score = int(min(base * tier_multiplier, 100))
    else:
        crowd_score = 0

    return forecasts, crowd_score


def predict_for_date(
    rides: List[RideHistory],
    target_date: datetime,
    context: Optional[DateContext] = None,
) -> Tuple[List[RideForecast], int]:
    """Backward-compatible one-shot predictor for callers that pass raw history."""
    return predict_for_slot(train_ride_models(rides), target_date, context)

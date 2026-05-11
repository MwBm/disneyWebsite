import json
import logging
import os
from typing import Dict, List, Optional, Tuple, NamedTuple

import numpy as np
import xgboost as xgb
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from schemas import DateContext, LagFeatures, RideForecast, RideHistory

logger = logging.getLogger(__name__)

MIN_SAMPLES = 200  # rides with fewer training records fall back to hourly means

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "../src/lib/ride-config.json")

def _load_config() -> dict:
    with open(_CONFIG_PATH) as f:
        return json.load(f)

_config = _load_config()
CROWD_MAX_WAIT: int = _config["crowdMaxWait"]
CROWD_EXPECTED_RIDES: int = _config["crowdExpectedRides"]
TIER_MULTIPLIER_STEP: float = _config["tierMultiplierStep"]
HEADLINER_RIDE_IDS: frozenset = frozenset(_config.get("headlinerRideIds", []))

PARK_TZ = ZoneInfo("America/Los_Angeles")

# Canonical feature order — tests reference these names, not positional indices.
FEATURE_NAMES: List[str] = [
    # Time signals
    "hour", "weekday", "month", "is_weekend",
    # Date context
    "tier", "has_special_event", "is_holiday", "is_school_break",
    # Weather (precip_mm and is_extreme_heat are new vs. original 14-feature set)
    "temp_high", "temp_range", "is_rainy", "precip_mm", "is_extreme_heat",
    # Interaction terms
    "hour_x_weekday", "hour_x_weekend", "month_x_weekday", "month_x_school_break",
    # Lag features (new)
    "lag_7d_wait", "lag_14d_wait", "rolling_7d_mean", "rolling_7d_std",
    # Cross-ride features (new)
    "pct_rides_open", "is_headliner_open",
]


class TrainedModel(NamedTuple):
    model: Optional[xgb.XGBRegressor]  # None → use hour_means fallback
    confidence: float                   # 0–1 derived from CV MAE; 0.3 for fallback rides
    cv_mae_minutes: float               # walk-forward CV MAE in minutes; 0.0 for fallback
    hour_means: Dict[int, int]          # Pacific hour → mean wait (fallback lookup)
    global_mean: int                    # fallback when hour has no history


def _park_time(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(PARK_TZ)


def _extract_features(
    dt: datetime,
    context: Optional[DateContext] = None,
    lag: Optional[LagFeatures] = None,
) -> np.ndarray:
    """Build the canonical 23-feature vector for one (ride, slot) pair."""
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
    temp_low = float(context.temp_low) if context and context.temp_low is not None else 55.0
    temp_range = temp_high - temp_low
    is_rainy = 1.0 if context and context.is_rainy else 0.0
    precip_mm = float(context.precip_mm) if context else 0.0
    is_extreme_heat = 1.0 if temp_high > 95.0 else 0.0

    lag = lag or LagFeatures()
    values = {
        "hour": hour,
        "weekday": weekday,
        "month": month,
        "is_weekend": is_weekend,
        "tier": tier,
        "has_special_event": has_special_event,
        "is_holiday": is_holiday,
        "is_school_break": is_school_break,
        "temp_high": temp_high,
        "temp_range": temp_range,
        "is_rainy": is_rainy,
        "precip_mm": precip_mm,
        "is_extreme_heat": is_extreme_heat,
        "hour_x_weekday": hour * weekday,
        "hour_x_weekend": hour * is_weekend,
        "month_x_weekday": month * weekday,
        "month_x_school_break": month * is_school_break,
        "lag_7d_wait": lag.lag_7d_wait,
        "lag_14d_wait": lag.lag_14d_wait,
        "rolling_7d_mean": lag.rolling_7d_mean,
        "rolling_7d_std": lag.rolling_7d_std,
        "pct_rides_open": lag.pct_rides_open,
        "is_headliner_open": lag.is_headliner_open,
    }
    return np.array([values[name] for name in FEATURE_NAMES], dtype=float)


_XGB_PARAMS = dict(
    n_estimators=100,
    max_depth=5,
    learning_rate=0.1,
    subsample=0.8,
    colsample_bytree=0.8,
    random_state=42,
    n_jobs=1,
)


def _train_ride_model(
    records: List[RideHistory],
    global_mean: float,
) -> Tuple[xgb.XGBRegressor, float, float]:
    """Walk-forward CV for honest MAE, then train final model on all data.

    Returns (model, confidence, cv_mae_minutes).
    """
    sorted_recs = sorted(records, key=lambda r: r.recorded_at)
    split = int(len(sorted_recs) * 0.8)
    train_recs = sorted_recs[:split]
    val_recs = sorted_recs[split:]

    def _build_matrix(recs: List[RideHistory]) -> Tuple[np.ndarray, np.ndarray]:
        X = np.array(
            [_extract_features(r.recorded_at, r.context, r.lag_features) for r in recs],
            dtype=float,
        )
        y = np.array([r.wait_time for r in recs], dtype=float)
        return X, y

    # CV pass — train on first 80%, measure error on last 20%
    cv_mae = 0.0
    if val_recs:
        X_tr, y_tr = _build_matrix(train_recs)
        X_val, y_val = _build_matrix(val_recs)
        cv_model = xgb.XGBRegressor(**_XGB_PARAMS)
        cv_model.fit(X_tr, y_tr)
        cv_mae = float(np.mean(np.abs(cv_model.predict(X_val) - y_val)))

    # Final model trained on all data
    X_all, y_all = _build_matrix(sorted_recs)
    final_model = xgb.XGBRegressor(**_XGB_PARAMS)
    final_model.fit(X_all, y_all)

    denom = max(global_mean, 1.0)
    confidence = float(np.clip(1.0 - cv_mae / denom, 0.0, 1.0))
    return final_model, confidence, cv_mae


def train_ride_models(rides: List[RideHistory]) -> Dict[int, TrainedModel]:
    """Train one XGBRegressor per ride. Rides below MIN_SAMPLES use hour-mean fallback."""
    ride_groups: Dict[int, List[RideHistory]] = {}
    for r in rides:
        if r.is_open:
            ride_groups.setdefault(r.ride_id, []).append(r)

    result: Dict[int, TrainedModel] = {}
    for ride_id, records in ride_groups.items():
        waits = [r.wait_time for r in records]
        global_mean = int(np.mean(waits)) if waits else 0
        by_hour: Dict[int, List[float]] = {}
        for r in records:
            by_hour.setdefault(_park_time(r.recorded_at).hour, []).append(r.wait_time)
        hour_means = {h: int(np.mean(v)) for h, v in by_hour.items()}

        if len(records) < MIN_SAMPLES:
            logger.info("Ride %d: fallback (only %d samples, need %d)", ride_id, len(records), MIN_SAMPLES)
            result[ride_id] = TrainedModel(None, 0.3, 0.0, hour_means, global_mean)
        else:
            model, confidence, cv_mae = _train_ride_model(records, float(global_mean))
            logger.info("Ride %d: trained, CV MAE=%.1f min, confidence=%.2f", ride_id, cv_mae, confidence)
            result[ride_id] = TrainedModel(model, confidence, cv_mae, hour_means, global_mean)

    return result


def _compute_crowd_score(
    forecasts: List[RideForecast],
    context: Optional[DateContext] = None,
) -> int:
    if not forecasts:
        return 0
    raw_waits = [min(f.predicted_wait, CROWD_MAX_WAIT) for f in forecasts]
    avg_wait = float(np.mean(raw_waits))
    ride_ratio = min(len(forecasts) / CROWD_EXPECTED_RIDES, 1.0)
    effective_wait = avg_wait * ride_ratio
    base = min(effective_wait / CROWD_MAX_WAIT * 100, 100)
    tier_multiplier = 1.0 + (context.tier * TIER_MULTIPLIER_STEP if context else 0.0)
    return int(min(base * tier_multiplier, 100))


def predict_for_ride(
    tm: TrainedModel,
    ride_id: int,
    slots: List[datetime],
    contexts: List[Optional[DateContext]],
    lag_features_list: List[Optional[LagFeatures]],
) -> List[RideForecast]:
    """Batch-predict all slots for one ride with a single XGBoost call."""
    if tm.model is None:
        return [
            RideForecast(
                ride_id=ride_id,
                predicted_wait=max(0, tm.hour_means.get(_park_time(slot).hour, tm.global_mean)),
                confidence=tm.confidence,
            )
            for slot in slots
        ]

    X = np.array(
        [
            _extract_features(slot, ctx, lag)
            for slot, ctx, lag in zip(slots, contexts, lag_features_list)
        ],
        dtype=float,
    )
    preds = np.clip(tm.model.predict(X), 0, 300).astype(int)
    return [
        RideForecast(ride_id=ride_id, predicted_wait=int(p), confidence=tm.confidence)
        for p in preds
    ]


def predict_for_slot(
    trained_models: Dict[int, TrainedModel],
    slot: datetime,
    context: Optional[DateContext] = None,
) -> Tuple[List[RideForecast], int]:
    """Single-slot prediction across all rides (backward-compatible API)."""
    forecasts: List[RideForecast] = []
    for ride_id, tm in trained_models.items():
        result = predict_for_ride(tm, ride_id, [slot], [context], [None])
        forecasts.extend(result)
    return forecasts, _compute_crowd_score(forecasts, context)


def predict_for_date(
    rides: List[RideHistory],
    target_date: datetime,
    context: Optional[DateContext] = None,
) -> Tuple[List[RideForecast], int]:
    """Backward-compatible one-shot predictor for callers that pass raw history."""
    return predict_for_slot(train_ride_models(rides), target_date, context)

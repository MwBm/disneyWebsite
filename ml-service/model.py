import numpy as np
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from typing import List, Dict, Tuple
from schemas import RideHistory, RideForecast
from datetime import datetime

MIN_SAMPLES = 30


def _extract_features(dt: datetime) -> List[float]:
    return [
        dt.hour,
        dt.weekday(),
        dt.month,
        1.0 if dt.weekday() >= 5 else 0.0,
    ]


def _train_ride_model(
    records: List[RideHistory],
) -> Tuple[Ridge, StandardScaler, float]:
    X = np.array([_extract_features(r.recorded_at) for r in records], dtype=float)
    y = np.array([r.wait_time for r in records], dtype=float)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = Ridge(alpha=1.0)
    model.fit(X_scaled, y)

    # Simple confidence: 1 - (std of residuals / mean wait), clamped 0–1
    preds = model.predict(X_scaled)
    residuals = np.abs(preds - y)
    mean_wait = np.mean(y) if np.mean(y) > 0 else 1
    confidence = float(np.clip(1.0 - np.std(residuals) / mean_wait, 0.0, 1.0))

    return model, scaler, confidence


def predict_for_date(
    rides: List[RideHistory], target_date: datetime
) -> Tuple[List[RideForecast], int]:
    # Group records by ride_id, filtering to open rides only
    ride_groups: Dict[int, List[RideHistory]] = {}
    for r in rides:
        if r.is_open:
            ride_groups.setdefault(r.ride_id, []).append(r)

    features = _extract_features(target_date)
    forecasts: List[RideForecast] = []

    for ride_id, records in ride_groups.items():
        if len(records) < MIN_SAMPLES:
            # Fall back to historical mean for this time-of-day
            same_hour = [
                r.wait_time
                for r in records
                if r.recorded_at.hour == target_date.hour
            ]
            mean_wait = int(np.mean(same_hour)) if same_hour else int(np.mean([r.wait_time for r in records]))
            forecasts.append(
                RideForecast(ride_id=ride_id, predicted_wait=max(0, mean_wait), confidence=0.3)
            )
        else:
            model, scaler, confidence = _train_ride_model(records)
            X = np.array([features], dtype=float)
            X_scaled = scaler.transform(X)
            predicted = int(np.clip(model.predict(X_scaled)[0], 0, 300))
            forecasts.append(
                RideForecast(ride_id=ride_id, predicted_wait=predicted, confidence=confidence)
            )

    # Crowd score: weighted average of predicted waits (cap each ride at 120 for normalization)
    if forecasts:
        raw_waits = [min(f.predicted_wait, 120) for f in forecasts]
        crowd_score = int(np.clip(np.mean(raw_waits) / 120 * 100, 0, 100))
    else:
        crowd_score = 0

    return forecasts, crowd_score

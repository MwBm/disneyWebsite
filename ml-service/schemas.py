from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional


class DateContext(BaseModel):
    tier: int = 0
    has_special_event: bool = False
    is_holiday: bool = False
    is_school_break: bool = False
    temp_high: Optional[float] = None  # Fahrenheit; None → feature uses 75.0 default
    temp_low: Optional[float] = None   # Fahrenheit; used to compute temp_range
    precip_mm: float = 0.0             # total precipitation in mm
    is_rainy: bool = False


class LagFeatures(BaseModel):
    """Per-ride, per-slot historical lag features for ML training and inference."""
    lag_7d_wait: float = 0.0      # avg_wait at same (ride, hour) 7 days prior
    lag_14d_wait: float = 0.0     # avg_wait at same (ride, hour) 14 days prior
    rolling_7d_mean: float = 0.0  # mean avg_wait over prior 7 days at same hour
    rolling_7d_std: float = 0.0   # std over same window; proxy for ride volatility
    pct_rides_open: float = 1.0   # fraction of park rides open at this time slot
    is_headliner_open: float = 1.0  # 1.0 if any configured headliner ride was open


class RideHistory(BaseModel):
    ride_id: int
    ride_name: str
    land_name: str
    wait_time: int
    is_open: bool
    recorded_at: datetime
    context: Optional["DateContext"] = None
    lag_features: Optional["LagFeatures"] = None


class RideForecast(BaseModel):
    ride_id: int
    predicted_wait: int
    confidence: float

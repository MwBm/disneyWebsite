from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional


class DateContext(BaseModel):
    tier: int = 0
    has_special_event: bool = False
    is_holiday: bool = False
    is_school_break: bool = False
    temp_high: Optional[float] = None  # Fahrenheit; None → feature uses 75.0 default
    is_rainy: bool = False


class RideHistory(BaseModel):
    ride_id: int
    ride_name: str
    land_name: str
    wait_time: int
    is_open: bool
    recorded_at: datetime
    context: Optional["DateContext"] = None


class RideForecast(BaseModel):
    ride_id: int
    predicted_wait: int
    confidence: float

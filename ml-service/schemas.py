from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional


class RideHistory(BaseModel):
    ride_id: int
    ride_name: str
    land_name: str
    wait_time: int
    is_open: bool
    recorded_at: datetime


class PredictRequest(BaseModel):
    rides: List[RideHistory]
    target_date: datetime
    full_retrain: bool = False


class RideForecast(BaseModel):
    ride_id: int
    predicted_wait: int
    confidence: float


class PredictResponse(BaseModel):
    forecasts: List[RideForecast]
    crowd_score: int

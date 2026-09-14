"""Collect live wait times into WaitTimeRecord. Nothing else.

Runs every 30 minutes (cron-job.org -> workflow_dispatch on collect.yml).

This job used to reload the full training history and retrain every ride model
on each run, just to refresh today's forecast slots: roughly 20-28 MB read out
of Supabase per run, 48 runs a day. That alone used 16.5 GB of the Free plan's
5 GB monthly egress in the Aug 28 - Sep 28 2026 cycle and got the project
restricted. No model feature uses same-day data, so the retrain barely moved
any prediction. train.py now owns every DailyForecast row, and this job's only
statements are the rows it writes (tests/test_collect.py pins that).
"""

import json
import logging
import os
import sys
import uuid
from datetime import datetime, timezone

import httpx
from pydantic import BaseModel

from common import WINDOW_MINUTES, run_logged_job

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class _QueueTimesRide(BaseModel):
    id: int
    name: str
    is_open: bool
    wait_time: int
    last_updated: str


class _QueueTimesLand(BaseModel):
    id: int
    name: str
    rides: list[_QueueTimesRide]


class _QueueTimesResponse(BaseModel):
    lands: list[_QueueTimesLand] = []
    rides: list[_QueueTimesRide] = []


_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "../src/lib/ride-config.json")


def _load_park_configs() -> list[dict]:
    with open(_CONFIG_PATH) as f:
        return json.load(f)["parks"]


def round_to_window(dt: datetime) -> datetime:
    epoch_ms = int(dt.timestamp() * 1000)
    window_ms = WINDOW_MINUTES * 60 * 1000
    rounded = round(epoch_ms / window_ms) * window_ms
    return datetime.fromtimestamp(rounded / 1000, tz=timezone.utc)


def fetch_live_rides() -> list[dict]:
    park_configs = _load_park_configs()
    rides = []
    for park in park_configs:
        excluded = set(park["excludedRideIds"])
        res = httpx.get(park["queueTimesUrl"], timeout=20.0)
        res.raise_for_status()
        parsed = _QueueTimesResponse.model_validate(res.json())
        for land in parsed.lands:
            for ride in land.rides:
                if ride.id in excluded:
                    continue
                rides.append({
                    "id": ride.id,
                    "name": ride.name,
                    "land_name": land.name,
                    "is_open": ride.is_open,
                    "wait_time": ride.wait_time,
                })
        for ride in parsed.rides:
            if ride.id in excluded:
                continue
            rides.append({
                "id": ride.id,
                "name": ride.name,
                "land_name": "Other",
                "is_open": ride.is_open,
                "wait_time": ride.wait_time,
            })
    return rides


def upsert_wait_records(conn, rides: list[dict], windowed_at: datetime, now: datetime) -> int:
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
            r["id"], r["name"], r["land_name"],
            r["wait_time"], r["is_open"], windowed_at, now,
        )
        for r in rides
    ]
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


def collect(conn) -> int:
    now = datetime.now(timezone.utc)
    rides = fetch_live_rides()
    logger.info("Fetched %d rides from queue-times.com", len(rides))
    if not rides:
        # The API lists every ride even while the parks are closed, so an empty
        # response means it broke — not a quiet night.
        raise RuntimeError("queue-times.com returned no rides for any park")
    return upsert_wait_records(conn, rides, round_to_window(now), now)


def main() -> int:
    return run_logged_job(collect)


if __name__ == "__main__":
    sys.exit(main())

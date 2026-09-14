"""Daily training job: load history, train models, write the 30-day DailyForecast window.

Runs once per day (06:00 UTC). This is the only job that writes DailyForecast,
including today's slots — collect.py only collects.
"""

import logging
import sys
from datetime import datetime, timezone

from common import run_logged_job
from pipeline import generate_forecasts

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

FORECAST_DAYS = 30


def train(conn) -> int:
    return generate_forecasts(conn, datetime.now(timezone.utc), FORECAST_DAYS)


def main() -> int:
    return run_logged_job(train)


if __name__ == "__main__":
    sys.exit(main())

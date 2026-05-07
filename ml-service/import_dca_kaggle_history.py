"""Import historical Disney California Adventure waits from Kaggle.

The Kaggle dataset is historical DCA-only queue-times data. It has ride names,
wait minutes, and local timestamps, but no queue-times ride IDs or open/closed
flag. This importer maps known DCA ride names to queue-times IDs, drops excluded
and zero-wait rows, aggregates the remaining samples into hourly buckets, and
inserts them into HourlyWaitSummary.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg

PARK_TZ = ZoneInfo("America/Los_Angeles")
DATASET_SLUG = "tivory27/disney-california-adventure-wait-times"
DEFAULT_CSV_NAME = "disney_wait_times.csv"
CONFIG_PATH = Path(__file__).resolve().parent / "../src/lib/ride-config.json"
DCA_PARK_ID = 17


@dataclass(frozen=True)
class RideMapping:
    ride_id: int
    ride_name: str
    land_name: str


@dataclass
class SummaryBucket:
    ride_id: int
    ride_name: str
    land_name: str
    date: datetime
    hour: int
    wait_sum: int = 0
    peak_wait: int = 0
    sample_count: int = 0

    @property
    def avg_wait(self) -> float:
        return self.wait_sum / self.sample_count


@dataclass
class ImportStats:
    rows_read: int = 0
    rows_importable: int = 0
    skipped_zero_wait: int = 0
    skipped_excluded: int = 0
    skipped_unmapped: int = 0
    skipped_bad_rows: int = 0


# Queue Times DCA attraction IDs, plus seasonal aliases in the Kaggle dataset.
# Excluded IDs are still mapped so reports can distinguish intentional skips
# from names that need new mapping work.
RIDE_MAPPINGS: dict[str, RideMapping] = {
    "Animation Academy": RideMapping(321, "Animation Academy", "Hollywood Land"),
    "Games of Pixar Pier": RideMapping(13960, "Games of Pixar Pier", "Pixar Pier"),
    "Golden Zephyr": RideMapping(298, "Golden Zephyr", "Paradise Gardens Park"),
    "Goofy's Sky School": RideMapping(319, "Goofy's Sky School", "Paradise Gardens Park"),
    "Grizzly River Run": RideMapping(302, "Grizzly River Run", "Grizzly Peak"),
    "Guardians of the Galaxy - Mission: BREAKOUT!": RideMapping(
        329,
        "Guardians of the Galaxy - Mission: BREAKOUT!",
        "Avengers Campus",
    ),
    "Guardians of the Galaxy - Monsters After Dark": RideMapping(
        329,
        "Guardians of the Galaxy - Mission: BREAKOUT!",
        "Avengers Campus",
    ),
    "Incredicoaster": RideMapping(322, "Incredicoaster", "Pixar Pier"),
    "Incredicoaster Single Rider": RideMapping(10906, "Incredicoaster Single Rider", "Pixar Pier"),
    "Inside Out Emotional Whirlwind": RideMapping(6643, "Inside Out Emotional Whirlwind", "Pixar Pier"),
    "Jessie's Critter Carousel": RideMapping(310, "Jessie's Critter Carousel", "Pixar Pier"),
    "Jumpin' Jellyfish": RideMapping(300, "Jumpin' Jellyfish", "Pixar Pier"),
    "Luigi's Honkin' Haul-O-Ween": RideMapping(13961, "Luigi's Rollickin' Roadsters", "Cars Land"),
    "Luigi's Joy to the Whirl": RideMapping(13961, "Luigi's Rollickin' Roadsters", "Cars Land"),
    "Luigi's Rollickin' Roadsters": RideMapping(13961, "Luigi's Rollickin' Roadsters", "Cars Land"),
    "Mater's Graveyard JamBOOree": RideMapping(315, "Mater's Junkyard Jamboree", "Cars Land"),
    "Mater's Jingle Jamboree": RideMapping(315, "Mater's Junkyard Jamboree", "Cars Land"),
    "Mater's Junkyard Jamboree": RideMapping(315, "Mater's Junkyard Jamboree", "Cars Land"),
    "Mickey's PhilharMagic": RideMapping(6440, "Mickey's PhilharMagic", "Hollywood Land"),
    "Monsters, Inc. Mike & Sulley to the Rescue!": RideMapping(
        291,
        "Monsters, Inc. Mike & Sulley to the Rescue!",
        "Hollywood Land",
    ),
    "Pixar Pal-A-Round - Swinging": RideMapping(311, "Pixar Pal-A-Round - Swinging", "Pixar Pier"),
    "Pixar Pal-A-Round – Non-Swinging": RideMapping(5557, "Pixar Pal-A-Round – Non-Swinging", "Pixar Pier"),
    "Radiator Springs Racers": RideMapping(295, "Radiator Springs Racers", "Cars Land"),
    "Radiator Springs Racers Single Rider": RideMapping(10904, "Radiator Springs Racers Single Rider", "Cars Land"),
    "Redwood Creek Challenge Trail": RideMapping(293, "Redwood Creek Challenge Trail", "Grizzly Peak"),
    "Silly Symphony Swings": RideMapping(301, "Silly Symphony Swings", "Paradise Gardens Park"),
    "Silly Symphony Swings Single Rider": RideMapping(
        10905,
        "Silly Symphony Swings Single Rider",
        "Paradise Gardens Park",
    ),
    "Soarin' Around the World": RideMapping(312, "Soarin' Over California", "Grizzly Peak"),
    "Soarin' Over California": RideMapping(312, "Soarin' Over California", "Grizzly Peak"),
    "Sorcerer's Workshop": RideMapping(868, "Sorcerer's Workshop", "Hollywood Land"),
    "The Bakery Tour": RideMapping(13959, "The Bakery Tour", "San Fransokyo Square"),
    "The Little Mermaid - Ariel's Undersea Adventure": RideMapping(
        316,
        "The Little Mermaid - Ariel's Undersea Adventure",
        "Paradise Gardens Park",
    ),
    "Toy Story Midway Mania!": RideMapping(313, "Toy Story Midway Mania!", "Pixar Pier"),
    "Turtle Talk with Crush": RideMapping(294, "Turtle Talk with Crush", "Hollywood Land"),
    "WEB SLINGERS: A Spider-Man Adventure": RideMapping(
        8843,
        "WEB SLINGERS: A Spider-Man Adventure",
        "Avengers Campus",
    ),
    "WEB SLINGERS: A Spider-Man Adventure Single Rider": RideMapping(
        10907,
        "WEB SLINGERS: A Spider-Man Adventure Single Rider",
        "Avengers Campus",
    ),
    "World of Color - Season of Light": RideMapping(
        14742,
        "World of Color Happiness!",
        "Paradise Gardens Park",
    ),
    "World of Color – ONE": RideMapping(14742, "World of Color Happiness!", "Paradise Gardens Park"),
}


def load_excluded_ride_ids(config_path: Path = CONFIG_PATH) -> set[int]:
    with config_path.open() as f:
        config = json.load(f)
    for park in config["parks"]:
        if park["id"] == DCA_PARK_ID:
            return set(park["excludedRideIds"])
    raise ValueError(f"Park {DCA_PARK_ID} not found in {config_path}")


def resolve_dataset_path(dataset_path: str | None) -> Path:
    if dataset_path:
        return Path(dataset_path)

    try:
        import kagglehub
    except ImportError as exc:
        raise RuntimeError("kagglehub is required unless --dataset-path is provided") from exc

    return Path(kagglehub.dataset_download(DATASET_SLUG))


def resolve_csv_path(dataset_path: Path, csv_file: str) -> Path:
    if dataset_path.is_file():
        return dataset_path
    csv_path = dataset_path / csv_file
    if not csv_path.exists():
        available = ", ".join(sorted(p.name for p in dataset_path.glob("*.csv"))) or "none"
        raise FileNotFoundError(f"{csv_path} not found. Available CSV files: {available}")
    return csv_path


def parse_local_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=PARK_TZ)
    local = parsed.astimezone(PARK_TZ)
    return local.replace(minute=0, second=0, microsecond=0, tzinfo=None)


def build_hourly_summaries(
    csv_path: Path,
    excluded_ride_ids: set[int],
    *,
    limit: int | None = None,
) -> tuple[list[SummaryBucket], ImportStats]:
    stats = ImportStats()
    buckets: dict[tuple[int, datetime, int], SummaryBucket] = {}

    with csv_path.open(newline="") as f:
        reader = csv.DictReader(f)
        required = {"Ride", "Wait Time", "Local Time"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{csv_path} is missing columns: {', '.join(sorted(missing))}")

        for row in reader:
            if limit is not None and stats.rows_read >= limit:
                break
            stats.rows_read += 1

            mapping = RIDE_MAPPINGS.get(row["Ride"])
            if mapping is None:
                stats.skipped_unmapped += 1
                continue
            if mapping.ride_id in excluded_ride_ids:
                stats.skipped_excluded += 1
                continue

            try:
                wait_time = int(row["Wait Time"])
                bucket_time = parse_local_time(row["Local Time"])
            except (TypeError, ValueError):
                stats.skipped_bad_rows += 1
                continue

            if wait_time <= 0:
                stats.skipped_zero_wait += 1
                continue

            key = (mapping.ride_id, bucket_time.replace(hour=0), bucket_time.hour)
            bucket = buckets.get(key)
            if bucket is None:
                bucket = SummaryBucket(
                    ride_id=mapping.ride_id,
                    ride_name=mapping.ride_name,
                    land_name=mapping.land_name,
                    date=key[1],
                    hour=key[2],
                )
                buckets[key] = bucket

            bucket.wait_sum += wait_time
            bucket.peak_wait = max(bucket.peak_wait, wait_time)
            bucket.sample_count += 1
            stats.rows_importable += 1

    return sorted(buckets.values(), key=lambda b: (b.date, b.ride_id, b.hour)), stats


def insert_summaries(conn, summaries: list[SummaryBucket], batch_size: int) -> int:
    sql = """
        INSERT INTO "HourlyWaitSummary"
            (id, "rideId", "rideName", "landName", date, hour,
             "avgWait", "peakWait", "sampleCount", "isOpen")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("rideId", date, hour) DO NOTHING
    """
    inserted = 0
    total_batches = (len(summaries) + batch_size - 1) // batch_size
    with conn.cursor() as cur:
        for batch_num, start in enumerate(range(0, len(summaries), batch_size), start=1):
            batch = summaries[start : start + batch_size]
            cur.executemany(
                sql,
                [
                    (
                        str(uuid.uuid4()),
                        b.ride_id,
                        b.ride_name,
                        b.land_name,
                        b.date,
                        b.hour,
                        b.avg_wait,
                        b.peak_wait,
                        b.sample_count,
                        True,
                    )
                    for b in batch
                ],
            )
            inserted += cur.rowcount
            if batch_num % 10 == 0 or batch_num == total_batches:
                print(f"  Batch {batch_num}/{total_batches} ({start + len(batch)} rows processed...)")
    return inserted


def print_stats(stats: ImportStats, bucket_count: int) -> None:
    print(f"Read {stats.rows_read} Kaggle rows")
    print(f"Importable positive wait samples: {stats.rows_importable}")
    print(f"Built {bucket_count} hourly summary buckets")
    print(f"Skipped excluded ride rows: {stats.skipped_excluded}")
    print(f"Skipped zero/negative wait rows: {stats.skipped_zero_wait}")
    print(f"Skipped unmapped rows: {stats.skipped_unmapped}")
    print(f"Skipped malformed rows: {stats.skipped_bad_rows}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-path", help="Existing Kaggle dataset directory or CSV file")
    parser.add_argument("--csv-file", default=DEFAULT_CSV_NAME, help=f"CSV file name inside dataset path; default {DEFAULT_CSV_NAME}")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--limit", type=int, help="Read at most this many CSV rows; useful for smoke tests")
    parser.add_argument("--dry-run", action="store_true", help="Parse and aggregate without writing to the database")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.batch_size <= 0:
        print("ERROR: --batch-size must be greater than 0", file=sys.stderr)
        return 1

    try:
        dataset_path = resolve_dataset_path(args.dataset_path)
        csv_path = resolve_csv_path(dataset_path, args.csv_file)
        excluded_ride_ids = load_excluded_ride_ids()
        summaries, stats = build_hourly_summaries(csv_path, excluded_ride_ids, limit=args.limit)
        print(f"Using Kaggle CSV: {csv_path}")
        print_stats(stats, len(summaries))

        if args.dry_run:
            print("Dry run only; no database rows inserted")
            return 0

        db_url = os.environ.get("DATABASE_URL") or os.environ.get("DIRECT_URL")
        if not db_url:
            print("ERROR: DATABASE_URL or DIRECT_URL must be set", file=sys.stderr)
            return 1
        db_url = db_url.replace("?pgbouncer=true", "").replace("&pgbouncer=true", "")

        with psycopg.connect(db_url, autocommit=False) as conn:
            try:
                inserted = insert_summaries(conn, summaries, args.batch_size)
                conn.commit()
            except Exception:
                conn.rollback()
                raise

        skipped_existing = len(summaries) - inserted
        print(f"Inserted {inserted} HourlyWaitSummary rows")
        print(f"Skipped {skipped_existing} existing hourly summary rows")
        return 0
    except Exception as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

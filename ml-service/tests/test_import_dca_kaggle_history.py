import csv
from datetime import datetime

from import_dca_kaggle_history import build_hourly_summaries


def write_rows(path, rows):
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["Land", "Ride", "Wait Time", "Local Time", "Day of Week"])
        writer.writeheader()
        writer.writerows(rows)


def test_build_hourly_summaries_maps_aliases_and_aggregates(tmp_path):
    csv_path = tmp_path / "dca.csv"
    write_rows(
        csv_path,
        [
            {
                "Land": "Cars Land",
                "Ride": "Luigi's Honkin' Haul-O-Ween",
                "Wait Time": "10",
                "Local Time": "2024-10-12 18:15:00-07:00",
                "Day of Week": "Saturday",
            },
            {
                "Land": "Cars Land",
                "Ride": "Luigi's Rollickin' Roadsters",
                "Wait Time": "20",
                "Local Time": "2024-10-12 18:45:00-07:00",
                "Day of Week": "Saturday",
            },
        ],
    )

    summaries, stats = build_hourly_summaries(csv_path, excluded_ride_ids=set())

    assert stats.rows_read == 2
    assert stats.rows_importable == 2
    assert len(summaries) == 1
    assert summaries[0].ride_id == 13961
    assert summaries[0].ride_name == "Luigi's Rollickin' Roadsters"
    assert summaries[0].date == datetime(2024, 10, 12)
    assert summaries[0].hour == 18
    assert summaries[0].avg_wait == 15
    assert summaries[0].peak_wait == 20
    assert summaries[0].sample_count == 2


def test_build_hourly_summaries_skips_excluded_zero_and_unmapped(tmp_path):
    csv_path = tmp_path / "dca.csv"
    write_rows(
        csv_path,
        [
            {
                "Land": "Avengers Campus",
                "Ride": "WEB SLINGERS: A Spider-Man Adventure Single Rider",
                "Wait Time": "15",
                "Local Time": "2024-07-08 18:30:00-07:00",
                "Day of Week": "Monday",
            },
            {
                "Land": "Cars Land",
                "Ride": "Radiator Springs Racers",
                "Wait Time": "0",
                "Local Time": "2024-07-08 18:30:00-07:00",
                "Day of Week": "Monday",
            },
            {
                "Land": "Buena Vista Street",
                "Ride": "Red Car Trolley",
                "Wait Time": "5",
                "Local Time": "2024-07-08 18:30:00-07:00",
                "Day of Week": "Monday",
            },
            {
                "Land": "Cars Land",
                "Ride": "Radiator Springs Racers",
                "Wait Time": "60",
                "Local Time": "2024-07-08 18:30:00-07:00",
                "Day of Week": "Monday",
            },
        ],
    )

    summaries, stats = build_hourly_summaries(csv_path, excluded_ride_ids={10907})

    assert len(summaries) == 1
    assert summaries[0].ride_id == 295
    assert stats.rows_read == 4
    assert stats.rows_importable == 1
    assert stats.skipped_excluded == 1
    assert stats.skipped_zero_wait == 1
    assert stats.skipped_unmapped == 1

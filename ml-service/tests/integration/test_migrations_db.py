"""Prisma migrations applied as raw SQL, one at a time, with data in between.

`prisma migrate deploy` in CI proves the migrations apply to an empty database.
It cannot prove that a data-changing migration (a backfill) does the right
thing to rows that existed before it, which is what production actually has.
"""

import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

from common import JOBS

pytestmark = pytest.mark.integration

MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "prisma" / "migrations"


def _migration_sql(name: str) -> str:
    return (MIGRATIONS_DIR / name / "migration.sql").read_text()


def _migration_names() -> list[str]:
    return sorted(p.name for p in MIGRATIONS_DIR.iterdir() if (p / "migration.sql").is_file())


@pytest.fixture
def scratch_db(test_database_url):
    """A brand-new empty database, dropped afterwards."""
    name = f"migration_check_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(test_database_url, autocommit=True) as admin:
        admin.execute(f'CREATE DATABASE "{name}"')
    parts = urlsplit(test_database_url)
    url = urlunsplit(parts._replace(path=f"/{name}"))
    try:
        with psycopg.connect(url, autocommit=True) as conn:
            yield conn
    finally:
        with psycopg.connect(test_database_url, autocommit=True) as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def test_migrations_are_ordered_with_the_baseline_first():
    names = _migration_names()
    assert names[0] == "0_init"
    assert "20260913180000_collect_run_job" in names


def test_every_migration_is_plain_sql_without_captured_log_output():
    """0_init once started with two dotenv banner lines captured by a shell redirect."""
    for name in _migration_names():
        first_line = _migration_sql(name).lstrip().splitlines()[0]
        assert first_line.startswith("--"), f"{name} starts with {first_line!r}"


def test_collect_run_job_backfill_labels_only_successful_train_sized_runs(scratch_db):
    scratch_db.execute(_migration_sql("0_init"))
    before = [
        ("collect-ok", 55, True),
        ("collect-ok-max", 59, True),
        ("train-ok", 75120, True),
        ("train-ok-small", 65280, True),
        ("threshold", 1000, True),
        ("below-threshold", 999, True),
        ("failed-zero", 0, False),
        ("failed-large", 75120, False),
    ]
    for run_id, rows, success in before:
        scratch_db.execute(
            'INSERT INTO "CollectRun" (id, "rowsUpserted", success) VALUES (%s, %s, %s)', (run_id, rows, success)
        )

    scratch_db.execute(_migration_sql("20260913180000_collect_run_job"))

    jobs = dict(scratch_db.execute('SELECT id, job::text FROM "CollectRun"').fetchall())
    assert jobs == {
        "collect-ok": "collect",
        "collect-ok-max": "collect",
        "train-ok": "train",
        "train-ok-small": "train",
        "threshold": "train",
        "below-threshold": "collect",
        "failed-zero": "collect",
        "failed-large": "collect",
    }


def test_all_migrations_in_order_produce_the_jobkind_enum_python_expects(scratch_db):
    for name in _migration_names():
        scratch_db.execute(_migration_sql(name))

    values = scratch_db.execute(
        "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
        "WHERE t.typname = 'JobKind' ORDER BY e.enumsortorder"
    ).fetchall()
    assert tuple(v for (v,) in values) == JOBS

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


# ---------------------------------------------------------------------------
# 20260914020000_lock_down_data_api
# ---------------------------------------------------------------------------

LOCKDOWN = "20260914020000_lock_down_data_api"


@pytest.fixture
def supabase_like_db(scratch_db):
    """A scratch database with the grants Supabase gives its Data API roles.

    Roles are cluster-wide, so they are created if missing and left in place.
    """
    scratch_db.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        """
    )
    for name in _migration_names():
        if name == LOCKDOWN:
            break
        scratch_db.execute(_migration_sql(name))
    # Exactly what production showed on 2026-09-13 (pg_default_acl and table grants).
    scratch_db.execute("GRANT USAGE ON SCHEMA public TO anon, authenticated")
    scratch_db.execute("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated")
    scratch_db.execute("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated")
    scratch_db.execute(
        'INSERT INTO "WaitTimeRecord" (id, "rideId", "rideName", "landName", "waitTime", "isOpen", "windowedAt") '
        "VALUES ('w1', 1, 'R', 'L', 30, true, now())"
    )
    return scratch_db


def _as_role(conn, role, sql):
    conn.execute(f"SET ROLE {role}")
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.execute("RESET ROLE")


def test_the_fixture_reproduces_the_exposure_before_the_lockdown(supabase_like_db):
    assert _as_role(supabase_like_db, "anon", 'SELECT count(*) FROM "WaitTimeRecord"') == [(1,)]


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_lockdown_denies_every_data_api_statement(supabase_like_db, role):
    supabase_like_db.execute(_migration_sql(LOCKDOWN))

    for sql in (
        'SELECT count(*) FROM "WaitTimeRecord"',
        'SELECT count(*) FROM "CollectRun"',
        "INSERT INTO \"CollectRun\" (id, \"rowsUpserted\", success) VALUES ('x', 0, true) RETURNING id",
        'DELETE FROM "DailyForecast" RETURNING id',
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            _as_role(supabase_like_db, role, sql)


def test_lockdown_enables_rls_without_forcing_it_on_owners(supabase_like_db):
    supabase_like_db.execute(_migration_sql(LOCKDOWN))

    flags = supabase_like_db.execute(
        "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class c "
        "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'"
    ).fetchall()
    assert flags and all(rls and not forced for _, rls, forced in flags)


def test_a_non_superuser_table_owner_still_sees_every_row(supabase_like_db):
    """Production's postgres is not a superuser; owners bypass RLS unless it is FORCEd."""
    supabase_like_db.execute(_migration_sql(LOCKDOWN))
    supabase_like_db.execute(
        "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_test_owner') "
        "THEN CREATE ROLE rls_test_owner NOSUPERUSER NOBYPASSRLS NOLOGIN; END IF; END $$"
    )
    supabase_like_db.execute('ALTER TABLE "WaitTimeRecord" OWNER TO rls_test_owner')

    assert _as_role(supabase_like_db, "rls_test_owner", 'SELECT count(*) FROM "WaitTimeRecord"') == [(1,)]


def test_rls_still_hides_rows_if_a_grant_is_added_back(supabase_like_db):
    supabase_like_db.execute(_migration_sql(LOCKDOWN))
    supabase_like_db.execute('GRANT SELECT ON "WaitTimeRecord" TO anon')

    assert _as_role(supabase_like_db, "anon", 'SELECT count(*) FROM "WaitTimeRecord"') == [(0,)]


def test_tables_created_after_the_lockdown_are_not_granted_to_the_api(supabase_like_db):
    supabase_like_db.execute(_migration_sql(LOCKDOWN))
    supabase_like_db.execute('CREATE TABLE "FutureTable" (id text PRIMARY KEY)')

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        _as_role(supabase_like_db, "anon", 'SELECT count(*) FROM "FutureTable"')


def test_every_table_in_the_migrated_database_has_rls(pg):
    """Guards future migrations: a new table without RLS would be open to the Data API."""
    without_rls = pg.execute(
        "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity"
    ).fetchall()
    assert without_rls == [], f"enable row level security on {without_rls}"

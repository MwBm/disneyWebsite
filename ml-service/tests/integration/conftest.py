"""Fixtures for tests against a real Postgres.

Run locally against a disposable database with the Prisma migrations applied:

    docker run -d --rm --name disney-it-pg -e POSTGRES_PASSWORD=postgres \\
        -e POSTGRES_DB=disney_test -p 55432:5432 postgres:17
    DATABASE_URL=postgresql://postgres:postgres@localhost:55432/disney_test npx prisma migrate deploy
    TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/disney_test \\
        python -m pytest -m integration

Every test TRUNCATEs the application tables, so the URL must point at
localhost; anything else is refused before a connection is opened.
"""

import os
from urllib.parse import urlsplit

import psycopg
import pytest

APP_TABLES = ("WaitTimeRecord", "DailyForecast", "HourlyWaitSummary", "CollectRun", "Prediction", "DateContext")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


@pytest.fixture(scope="session")
def test_database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        if os.environ.get("REQUIRE_INTEGRATION_DB") == "1":
            pytest.fail("REQUIRE_INTEGRATION_DB=1 but TEST_DATABASE_URL is not set")
        pytest.skip("TEST_DATABASE_URL is not set")
    host = urlsplit(url).hostname
    if host not in LOCAL_HOSTS:
        pytest.fail(f"refusing to run destructive integration tests against host {host!r}; use a local database")
    return url


@pytest.fixture
def pg(test_database_url, monkeypatch):
    """An autocommit connection to a freshly truncated test database.

    DATABASE_URL points at the same database, so job entry points
    (collect.main, train.main, archive.main) run against it unmodified.
    """
    monkeypatch.setenv("DATABASE_URL", test_database_url)
    monkeypatch.delenv("DIRECT_URL", raising=False)
    with psycopg.connect(test_database_url, autocommit=True) as conn:
        conn.execute("TRUNCATE " + ", ".join(f'"{t}"' for t in APP_TABLES) + " CASCADE")
        yield conn

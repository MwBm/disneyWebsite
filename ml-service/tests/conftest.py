"""Shared test doubles for the database.

MagicMock accepts every call and records it in a shape that is awkward to
assert on — "did this job issue any SELECT, and against which table?" is hard
to answer from mock_calls. FakeConnection records exactly the SQL each cursor
ran, in order, alongside commit/rollback, and can be told to fail on a given
statement. The orchestration tests and the egress guard depend on that.
"""

from dataclasses import dataclass, field

import pytest

import common


def normalize_sql(sql: str) -> str:
    return " ".join(sql.split())


@dataclass
class Statement:
    sql: str
    params: object
    many: bool


class FakeCursor:
    def __init__(self, conn: "FakeConnection"):
        self._conn = conn
        self._rows: list[tuple] = []
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def execute(self, sql, params=None):
        self._rows = self._conn._run(Statement(normalize_sql(sql), params, many=False))
        self.rowcount = len(self._rows)

    def executemany(self, sql, params_seq):
        params = list(params_seq)
        self._conn._run(Statement(normalize_sql(sql), params, many=True))
        self.rowcount = len(params)

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None


@dataclass
class FakeConnection:
    autocommit: bool = False
    results: dict[str, list[tuple]] = field(default_factory=dict)
    fail_on: dict[str, Exception] = field(default_factory=dict)
    statements: list[Statement] = field(default_factory=list)
    events: list[str] = field(default_factory=list)
    closed: bool = False

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.events.append("commit")

    def rollback(self):
        self.events.append("rollback")

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.closed = True
        return False

    @property
    def sql(self) -> list[str]:
        return [s.sql for s in self.statements]

    def _run(self, statement: Statement) -> list[tuple]:
        """Record the statement, then fail or return rows by substring match."""
        self.statements.append(statement)
        self.events.append("execute")
        for fragment, error in self.fail_on.items():
            if fragment in statement.sql:
                raise error
        for fragment, rows in self.results.items():
            if fragment in statement.sql:
                return rows
        return []


class FakeDatabase:
    """Hands out a new FakeConnection per connect() call and keeps every one.

    run_logged_job opens one connection for the work and, on failure, a second
    autocommit connection for the failure log; tests inspect each separately.
    `results` and `fail_on` apply to every connection. `connect_failures` maps a
    0-based connect() attempt index to the exception that attempt raises.
    """

    def __init__(self):
        self.connections: list[FakeConnection] = []
        self.results: dict[str, list[tuple]] = {}
        self.fail_on: dict[str, Exception] = {}
        self.connect_failures: dict[int, Exception] = {}
        self.connect_attempts = 0

    def connect(self, db_url, *, autocommit=False):
        attempt = self.connect_attempts
        self.connect_attempts += 1
        if attempt in self.connect_failures:
            raise self.connect_failures[attempt]
        conn = FakeConnection(autocommit=autocommit, results=self.results, fail_on=self.fail_on)
        self.connections.append(conn)
        return conn

    @property
    def statements(self) -> list[Statement]:
        return [s for conn in self.connections for s in conn.statements]

    def collect_run_rows(self) -> list[tuple]:
        """Params of every CollectRun insert: (id, ranAt, rowsUpserted, success, errorMessage)."""
        return [s.params for s in self.statements if 'INSERT INTO "CollectRun"' in s.sql]


@pytest.fixture
def fake_db(monkeypatch) -> FakeDatabase:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
    monkeypatch.delenv("DIRECT_URL", raising=False)
    db = FakeDatabase()
    monkeypatch.setattr(common, "connect", db.connect)
    return db

"""The exclusion triggers in the migrations must match ride-config.json.

ride-config.json stops the website and the Python jobs from collecting an
excluded attraction. The database triggers stop anything that slips past them
(an older deploy, a backfill). The triggers can't read the JSON, so each
migration that (re)defines a trigger function hardcodes its own copy of the
list; these tests fail when the copies drift. Adding an exclusion therefore
means adding a migration that re-creates the trigger functions.

Each function is checked in its latest definition across all migrations.
Lists are compared as one set over both parks rather than per park block:
Queue-Times ride IDs are globally unique, and the newest DCA guard is
deliberately park-agnostic (see 20261108003000_purge_misclassified_dca_attractions).
"""

import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "prisma" / "migrations"
CONFIG_PATH = REPO_ROOT / "src" / "lib" / "ride-config.json"

ID_MARKER = 'NEW."rideId" IN '
NAME_MARKER = 'NEW."rideName" IN '


def _latest_function_body(name: str) -> str:
    """Body of the newest `CREATE OR REPLACE FUNCTION "<name>"` in any migration."""
    header = f'CREATE OR REPLACE FUNCTION "{name}"'
    body = None
    for path in sorted(MIGRATIONS_DIR.glob("*/migration.sql")):  # timestamp order
        sql = path.read_text()
        if header in sql:
            start = sql.index(header)
            body = sql[start : sql.index("$$ LANGUAGE", start)]
    assert body is not None, f"no migration defines {name}"
    return body


def _in_list(text: str, start: int) -> tuple[list[str], int]:
    """Items of the SQL `IN (...)` list opening at `start`, and the index after it.

    Walks the text so a ')' or ',' inside a quoted name never ends the list,
    and un-escapes doubled quotes ('').
    """
    assert text[start] == "(", text[start : start + 20]
    items, token, i, in_quote = [], "", start + 1, False
    while True:
        ch = text[i]
        if in_quote:
            if ch == "'" and text[i + 1 : i + 2] == "'":
                token += "'"
                i += 2
                continue
            if ch == "'":
                in_quote = False
            else:
                token += ch
        elif ch == "'":
            in_quote = True
        elif ch in ",)":
            if token.strip():
                items.append(token.strip())
            token = ""
            if ch == ")":
                return items, i + 1
        else:
            token += ch
        i += 1


def _all_items(body: str, marker: str) -> set[str]:
    """Union of every IN-list that follows `marker` in the function body."""
    items, pos = set(), 0
    while (found := body.find(marker, pos)) != -1:
        found_items, pos = _in_list(body, found + len(marker))
        items.update(found_items)
    return items


with CONFIG_PATH.open() as _f:
    PARKS = {park["id"]: park for park in json.load(_f)["parks"]}

CONFIG_IDS = {ride_id for park in PARKS.values() for ride_id in park["excludedRideIds"]}
CONFIG_NAMES = {name for park in PARKS.values() for name in park["excludedRideNames"]}


def test_config_covers_both_parks():
    assert set(PARKS) == {16, 17}
    assert CONFIG_IDS and CONFIG_NAMES


@pytest.mark.parametrize(
    "function",
    ["skip_excluded_named_attraction", "skip_excluded_unnamed_attraction", "skip_excluded_legacy_prediction"],
)
def test_trigger_ids_match_config(function):
    ids = {int(i) for i in _all_items(_latest_function_body(function), ID_MARKER)}

    assert sorted(ids - CONFIG_IDS) == [], "trigger excludes IDs ride-config.json does not"
    assert sorted(CONFIG_IDS - ids) == [], "ride-config.json excludes IDs the trigger does not"


def test_named_trigger_names_match_config():
    names = _all_items(_latest_function_body("skip_excluded_named_attraction"), NAME_MARKER)

    assert sorted(names - CONFIG_NAMES) == [], "trigger excludes names ride-config.json does not"
    assert sorted(CONFIG_NAMES - names) == [], "ride-config.json excludes names the trigger does not"


def test_legacy_trigger_names_are_all_configured_exclusions():
    # The legacy Prediction guard matches by name only for seasonal overlays
    # that reuse a normal ride's ID; every other attraction is caught by ID.
    names = _all_items(_latest_function_body("skip_excluded_legacy_prediction"), NAME_MARKER)

    assert names, "legacy trigger lost its seasonal-overlay names"
    assert sorted(names - CONFIG_NAMES) == [], "trigger excludes names ride-config.json does not"


def test_unnamed_trigger_never_matches_on_name():
    # It guards tables with no rideName column; a name check would fail at insert time.
    assert NAME_MARKER not in _latest_function_body("skip_excluded_unnamed_attraction")


def test_in_list_parser_handles_quotes_commas_and_parentheses():
    text = "('A, B', 'Pirate''s (Lair)', 'Walt Disney’s') tail"
    items, end = _in_list(text, 0)

    assert items == ["A, B", "Pirate's (Lair)", "Walt Disney’s"]
    assert text[end:] == " tail"

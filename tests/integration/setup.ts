/**
 * Points src/lib/db at the test database before any test module imports it.
 *
 * Every test truncates the application tables, so only a localhost URL is
 * accepted. Without TEST_DATABASE_URL the suites skip (see describeWithDatabase);
 * CI sets REQUIRE_INTEGRATION_DB=1 so a missing database fails instead.
 */
const url = process.env.TEST_DATABASE_URL;

if (!url) {
  if (process.env.REQUIRE_INTEGRATION_DB === "1") {
    throw new Error("REQUIRE_INTEGRATION_DB=1 but TEST_DATABASE_URL is not set");
  }
  // src/lib/db throws at import without a URL; the suites are skipped anyway.
  process.env.DATABASE_URL ??= "postgresql://skipped:skipped@localhost:1/skipped";
} else {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`refusing to run destructive integration tests against host ${host}; use a local database`);
  }
  process.env.DATABASE_URL = url;
}

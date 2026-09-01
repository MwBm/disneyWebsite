-- Functional index to speed up the weighted month+DOW historical fallback query
-- in getCrowdScoresForMonth (src/lib/forecast.ts).
--
-- Run once against the production database:
--   psql $DATABASE_URL -f prisma/indexes.sql
--
-- CONCURRENTLY means the DB stays fully writable during the build.
-- Safe to re-run; IF NOT EXISTS prevents errors on duplicate runs.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "HourlyWaitSummary_rideId_month_idx"
  ON "HourlyWaitSummary" ("rideId", (EXTRACT(MONTH FROM date)::int));

-- Functional index for the historical day-of-week fallback in
-- getHistoricalMeansForDate (src/lib/forecast.ts).
--
-- That query filters on EXTRACT(DOW FROM recordedAt AT TIME ZONE 'UTC'
-- AT TIME ZONE 'America/Los_Angeles'), which the plain "recordedAt" index
-- cannot serve, so it sequentially scanned the whole table on every request
-- that fell through to the historical path.
--
-- The expression must be written exactly as the query writes it, or the
-- planner will not match it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "WaitTimeRecord_park_dow_hour_idx"
  ON "WaitTimeRecord" (
    (EXTRACT(DOW  FROM ("recordedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'))),
    (EXTRACT(HOUR FROM ("recordedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'))),
    "rideId"
  )
  WHERE "isOpen" = true;

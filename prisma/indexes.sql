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

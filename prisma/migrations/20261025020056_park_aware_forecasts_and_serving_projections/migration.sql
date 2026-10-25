-- Make every observation and forecast explicitly park-scoped. Queue-Times
-- identifiers are currently globally unique, but park scope prevents the
-- model and public crowd score from accidentally combining Disneyland and
-- Disney California Adventure.

ALTER TABLE "WaitTimeRecord" ADD COLUMN "parkId" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "HourlyWaitSummary" ADD COLUMN "parkId" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "DailyForecast" ADD COLUMN "parkId" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "DateContext" ADD COLUMN "parkId" INTEGER NOT NULL DEFAULT 16;

-- The historical importer and collector both store a land. These are the DCA
-- lands used by the application before parkId existed. Unknown legacy lands
-- deliberately stay Disneyland, matching the old application fallback.
UPDATE "WaitTimeRecord" SET "parkId" = 17
WHERE "landName" IN (
  'Avengers Campus', 'Cars Land', 'Grizzly Peak', 'Hollywood Land',
  'Paradise Gardens Park', 'Pixar Pier', 'San Fransokyo Square'
);
UPDATE "HourlyWaitSummary" SET "parkId" = 17
WHERE "landName" IN (
  'Avengers Campus', 'Cars Land', 'Grizzly Peak', 'Hollywood Land',
  'Paradise Gardens Park', 'Pixar Pier', 'San Fransokyo Square'
);
UPDATE "DailyForecast" SET "parkId" = 17
WHERE "landName" IN (
  'Avengers Campus', 'Cars Land', 'Grizzly Peak', 'Hollywood Land',
  'Paradise Gardens Park', 'Pixar Pier', 'San Fransokyo Square'
);

-- DateContext rows before this migration were fetched only from Disneyland's
-- schedule, so their default parkId=16 is intentional.
DROP INDEX IF EXISTS "DateContext_date_key";
CREATE UNIQUE INDEX "DateContext_parkId_date_key" ON "DateContext"("parkId", date);

-- Preserve total collection coverage while making the training target an
-- average of open samples only. Existing buckets cannot be perfectly repaired
-- after their raw inputs were deleted, so record their best-known counts.
ALTER TABLE "HourlyWaitSummary" ADD COLUMN "observedSampleCount" INTEGER;
ALTER TABLE "HourlyWaitSummary" ADD COLUMN "openSampleCount" INTEGER;
UPDATE "HourlyWaitSummary"
SET
  "observedSampleCount" = "sampleCount",
  "openSampleCount" = CASE WHEN "isOpen" THEN "sampleCount" ELSE 0 END;
ALTER TABLE "HourlyWaitSummary" ALTER COLUMN "observedSampleCount" SET NOT NULL;
ALTER TABLE "HourlyWaitSummary" ALTER COLUMN "openSampleCount" SET NOT NULL;
ALTER TABLE "HourlyWaitSummary" ALTER COLUMN "observedSampleCount" SET DEFAULT 0;
ALTER TABLE "HourlyWaitSummary" ALTER COLUMN "openSampleCount" SET DEFAULT 0;

-- Compact, canonical ride metadata. Facts retain their existing names for a
-- backwards-compatible rollout, but new serving projections use this table.
CREATE TABLE "RideCatalog" (
  "parkId" INTEGER NOT NULL,
  "rideId" INTEGER NOT NULL,
  "rideName" TEXT NOT NULL,
  "landName" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RideCatalog_pkey" PRIMARY KEY ("parkId", "rideId")
);

INSERT INTO "RideCatalog" ("parkId", "rideId", "rideName", "landName")
SELECT DISTINCT ON ("parkId", "rideId") "parkId", "rideId", "rideName", "landName"
FROM (
  SELECT "parkId", "rideId", "rideName", "landName", "windowedAt" AS seen_at FROM "WaitTimeRecord"
  UNION ALL
  SELECT "parkId", "rideId", "rideName", "landName", date + make_interval(hours => hour) FROM "HourlyWaitSummary"
  UNION ALL
  SELECT "parkId", "rideId", "rideName", "landName", "forecastFor" FROM "DailyForecast"
) AS rides
ORDER BY "parkId", "rideId", seen_at DESC
ON CONFLICT ("parkId", "rideId") DO UPDATE SET
  "rideName" = EXCLUDED."rideName",
  "landName" = EXCLUDED."landName",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Small serving projections: the web app reads these instead of aggregating
-- every 30-minute prediction on a user request.
CREATE TABLE "ModelRun" (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  "featureVersion" TEXT NOT NULL,
  "trainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trainingCutoff" TIMESTAMP(3) NOT NULL,
  "metrics" JSONB,
  CONSTRAINT "ModelRun_pkey" PRIMARY KEY (id)
);

CREATE TABLE "ParkDayForecast" (
  id TEXT NOT NULL,
  "parkId" INTEGER NOT NULL,
  date TIMESTAMP(3) NOT NULL,
  "crowdScore" INTEGER NOT NULL,
  "modelRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParkDayForecast_pkey" PRIMARY KEY (id),
  CONSTRAINT "ParkDayForecast_parkId_date_key" UNIQUE ("parkId", date),
  CONSTRAINT "ParkDayForecast_modelRunId_fkey" FOREIGN KEY ("modelRunId") REFERENCES "ModelRun"(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "RideDayForecast" (
  id TEXT NOT NULL,
  "parkId" INTEGER NOT NULL,
  "rideId" INTEGER NOT NULL,
  date TIMESTAMP(3) NOT NULL,
  "avgWait" INTEGER NOT NULL,
  "peakWait" INTEGER NOT NULL,
  "mlConfidence" DOUBLE PRECISION NOT NULL,
  "modelRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RideDayForecast_pkey" PRIMARY KEY (id),
  CONSTRAINT "RideDayForecast_parkId_rideId_date_key" UNIQUE ("parkId", "rideId", date),
  CONSTRAINT "RideDayForecast_modelRunId_fkey" FOREIGN KEY ("modelRunId") REFERENCES "ModelRun"(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ForecastEvaluation" (
  id TEXT NOT NULL,
  "modelRunId" TEXT NOT NULL,
  "parkId" INTEGER NOT NULL,
  "rideId" INTEGER NOT NULL,
  "targetDate" TIMESTAMP(3) NOT NULL,
  "horizonBucket" TEXT NOT NULL,
  "predictedAvgWait" INTEGER NOT NULL,
  "actualAvgWait" INTEGER,
  mae DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForecastEvaluation_pkey" PRIMARY KEY (id),
  CONSTRAINT "ForecastEvaluation_modelRunId_fkey" FOREIGN KEY ("modelRunId") REFERENCES "ModelRun"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ForecastEvaluation_modelRunId_parkId_rideId_targetDate_key" UNIQUE ("modelRunId", "parkId", "rideId", "targetDate")
);

CREATE INDEX "WaitTimeRecord_parkId_windowedAt_idx" ON "WaitTimeRecord"("parkId", "windowedAt");
CREATE INDEX "DailyForecast_parkId_forecastFor_idx" ON "DailyForecast"("parkId", "forecastFor");
CREATE INDEX "HourlyWaitSummary_parkId_date_idx" ON "HourlyWaitSummary"("parkId", date);
CREATE INDEX "CollectRun_job_ranAt_idx" ON "CollectRun"(job, "ranAt" DESC);
CREATE INDEX "ParkDayForecast_date_idx" ON "ParkDayForecast"(date);
CREATE INDEX "RideDayForecast_parkId_date_idx" ON "RideDayForecast"("parkId", date);
CREATE INDEX "ForecastEvaluation_targetDate_idx" ON "ForecastEvaluation"("targetDate");

ALTER TABLE "RideCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ModelRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParkDayForecast" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RideDayForecast" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForecastEvaluation" ENABLE ROW LEVEL SECURITY;

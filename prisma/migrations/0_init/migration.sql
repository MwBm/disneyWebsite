-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "WaitTimeRecord" (
    "id" TEXT NOT NULL,
    "rideId" INTEGER NOT NULL,
    "rideName" TEXT NOT NULL,
    "landName" TEXT NOT NULL,
    "waitTime" INTEGER NOT NULL,
    "isOpen" BOOLEAN NOT NULL,
    "windowedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitTimeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyForecast" (
    "id" TEXT NOT NULL,
    "rideId" INTEGER NOT NULL,
    "rideName" TEXT NOT NULL,
    "landName" TEXT NOT NULL,
    "forecastFor" TIMESTAMP(3) NOT NULL,
    "predictedWait" INTEGER NOT NULL,
    "crowdScore" INTEGER NOT NULL,
    "mlConfidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DateContext" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "tier" INTEGER,
    "isHoliday" BOOLEAN NOT NULL DEFAULT false,
    "isSchoolBreak" BOOLEAN NOT NULL DEFAULT false,
    "specialEvent" TEXT,
    "tierFetchedAt" TIMESTAMP(3),
    "tierSource" TEXT,
    "groqDowEstimate" JSONB,
    "tempHigh" DOUBLE PRECISION,
    "tempLow" DOUBLE PRECISION,
    "precipMm" DOUBLE PRECISION,
    "isRainy" BOOLEAN,
    "weatherFetchedAt" TIMESTAMP(3),
    "groqAdjustment" DOUBLE PRECISION,
    "groqReasoning" TEXT,
    "groqAdjustedAt" TIMESTAMP(3),

    CONSTRAINT "DateContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "rideId" INTEGER NOT NULL,
    "rideName" TEXT NOT NULL,
    "predictedFor" TIMESTAMP(3) NOT NULL,
    "predictedWait" INTEGER NOT NULL,
    "actualWait" INTEGER,
    "dateContextId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectRun" (
    "id" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowsUpserted" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "CollectRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyWaitSummary" (
    "id" TEXT NOT NULL,
    "rideId" INTEGER NOT NULL,
    "rideName" TEXT NOT NULL,
    "landName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hour" INTEGER NOT NULL,
    "avgWait" DOUBLE PRECISION NOT NULL,
    "peakWait" INTEGER NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "isOpen" BOOLEAN NOT NULL,

    CONSTRAINT "HourlyWaitSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaitTimeRecord_rideId_recordedAt_idx" ON "WaitTimeRecord"("rideId", "recordedAt");

-- CreateIndex
CREATE INDEX "WaitTimeRecord_recordedAt_idx" ON "WaitTimeRecord"("recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitTimeRecord_rideId_windowedAt_key" ON "WaitTimeRecord"("rideId", "windowedAt");

-- CreateIndex
CREATE INDEX "DailyForecast_forecastFor_idx" ON "DailyForecast"("forecastFor");

-- CreateIndex
CREATE UNIQUE INDEX "DailyForecast_rideId_forecastFor_key" ON "DailyForecast"("rideId", "forecastFor");

-- CreateIndex
CREATE UNIQUE INDEX "DateContext_date_key" ON "DateContext"("date");

-- CreateIndex
CREATE INDEX "DateContext_date_idx" ON "DateContext"("date");

-- CreateIndex
CREATE INDEX "Prediction_rideId_predictedFor_idx" ON "Prediction"("rideId", "predictedFor");

-- CreateIndex
CREATE INDEX "Prediction_dateContextId_idx" ON "Prediction"("dateContextId");

-- CreateIndex
CREATE INDEX "HourlyWaitSummary_rideId_date_idx" ON "HourlyWaitSummary"("rideId", "date");

-- CreateIndex
CREATE INDEX "HourlyWaitSummary_date_idx" ON "HourlyWaitSummary"("date");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyWaitSummary_rideId_date_hour_key" ON "HourlyWaitSummary"("rideId", "date", "hour");

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_dateContextId_fkey" FOREIGN KEY ("dateContextId") REFERENCES "DateContext"("id") ON DELETE SET NULL ON UPDATE CASCADE;


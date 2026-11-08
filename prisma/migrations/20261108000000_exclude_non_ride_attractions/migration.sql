-- Permanently remove non-rides and seasonal overlays from every fact,
-- forecast, projection, catalogue, and legacy prediction table. Seasonal
-- names with IDs shared by a normal ride are intentionally matched by name,
-- so the normal ride is preserved.
CREATE TEMP TABLE "_excluded_attractions" (
  "parkId" INTEGER NOT NULL,
  "rideId" INTEGER,
  "rideName" TEXT
);

INSERT INTO "_excluded_attractions" ("parkId", "rideId", "rideName") VALUES
  (16, 12428, NULL), (16, 288, NULL), (16, 304, NULL), (16, 687, NULL),
  (16, 6711, NULL), (16, 679, NULL), (16, 456, NULL), (16, 328, NULL),
  (16, 331, NULL), (16, 674, NULL), (16, 690, NULL), (16, 686, NULL),
  (16, 691, NULL), (16, 14915, NULL), (16, 695, NULL), (16, 14923, NULL),
  (16, 13814, NULL), (16, 11980, NULL), (16, 709, NULL), (16, 327, NULL),
  (16, 684, NULL), (16, 274, NULL), (16, 16254, NULL), (16, 10903, NULL),
  (16, 14326, NULL), (16, 16627, NULL),
  (17, 321, NULL), (17, 6440, NULL), (17, 868, NULL), (17, 294, NULL),
  (17, 293, NULL), (17, 13959, NULL), (17, 13960, NULL), (17, 14742, NULL),
  (17, 10907, NULL), (17, 10904, NULL), (17, 10905, NULL), (17, 10906, NULL),
  (17, 866, NULL), (17, 869, NULL), (17, 4723, NULL), (17, 5146, NULL),
  (17, 7292, NULL), (17, 11528, NULL),
  (16, NULL, 'Haunted Mansion Holiday'),
  (17, NULL, 'Luigi''s Honkin'' Haul-O-Ween'),
  (17, NULL, 'Luigi''s Joy to the Whirl'),
  (17, NULL, 'Mater''s Graveyard JamBOOree'),
  (17, NULL, 'Mater''s Jingle Jamboree');

-- Serving projections and evaluations do not retain a display name. Capture
-- seasonal dates before deleting their source forecast rows.
CREATE TEMP TABLE "_seasonal_projection_dates" AS
SELECT DISTINCT
  forecast."parkId",
  forecast."rideId",
  (forecast."forecastFor" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date
FROM "DailyForecast" forecast
JOIN "_excluded_attractions" excluded
  ON excluded."parkId" = forecast."parkId"
  AND excluded."rideName" = forecast."rideName";

DELETE FROM "RideDayForecast" projection
USING "_excluded_attractions" excluded
WHERE excluded."rideId" IS NOT NULL
  AND projection."parkId" = excluded."parkId"
  AND projection."rideId" = excluded."rideId";

DELETE FROM "RideDayForecast" projection
USING "_seasonal_projection_dates" seasonal
WHERE projection."parkId" = seasonal."parkId"
  AND projection."rideId" = seasonal."rideId"
  AND projection.date::date = seasonal.date;

DELETE FROM "ForecastEvaluation" evaluation
USING "_excluded_attractions" excluded
WHERE excluded."rideId" IS NOT NULL
  AND evaluation."parkId" = excluded."parkId"
  AND evaluation."rideId" = excluded."rideId";

DELETE FROM "ForecastEvaluation" evaluation
USING "_seasonal_projection_dates" seasonal
WHERE evaluation."parkId" = seasonal."parkId"
  AND evaluation."rideId" = seasonal."rideId"
  AND evaluation."targetDate"::date = seasonal.date;

DELETE FROM "WaitTimeRecord" record
USING "_excluded_attractions" excluded
WHERE record."parkId" = excluded."parkId"
  AND (
    (excluded."rideId" IS NOT NULL AND record."rideId" = excluded."rideId")
    OR (excluded."rideName" IS NOT NULL AND record."rideName" = excluded."rideName")
  );

DELETE FROM "DailyForecast" forecast
USING "_excluded_attractions" excluded
WHERE forecast."parkId" = excluded."parkId"
  AND (
    (excluded."rideId" IS NOT NULL AND forecast."rideId" = excluded."rideId")
    OR (excluded."rideName" IS NOT NULL AND forecast."rideName" = excluded."rideName")
  );

DELETE FROM "HourlyWaitSummary" summary
USING "_excluded_attractions" excluded
WHERE summary."parkId" = excluded."parkId"
  AND (
    (excluded."rideId" IS NOT NULL AND summary."rideId" = excluded."rideId")
    OR (excluded."rideName" IS NOT NULL AND summary."rideName" = excluded."rideName")
  );

DELETE FROM "RideCatalog" catalog
USING "_excluded_attractions" excluded
WHERE catalog."parkId" = excluded."parkId"
  AND (
    (excluded."rideId" IS NOT NULL AND catalog."rideId" = excluded."rideId")
    OR (excluded."rideName" IS NOT NULL AND catalog."rideName" = excluded."rideName")
  );

DELETE FROM "Prediction" prediction
USING "_excluded_attractions" excluded
WHERE
  (excluded."rideId" IS NOT NULL AND prediction."rideId" = excluded."rideId")
  OR (excluded."rideName" IS NOT NULL AND prediction."rideName" = excluded."rideName");

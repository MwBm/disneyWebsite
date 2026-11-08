-- RideDayForecast and ForecastEvaluation do not retain a ride name. These
-- four Queue-Times IDs have been reused by seasonal overlays, so remove their
-- remaining projection/evaluation history rather than risk preserving a
-- seasonal value. The next training run rebuilds normal-ride projections from
-- the already-sanitised source history.
DELETE FROM "RideDayForecast"
WHERE ("parkId", "rideId") IN ((16, 325), (17, 315), (17, 2608), (17, 13961));

DELETE FROM "ForecastEvaluation"
WHERE ("parkId", "rideId") IN ((16, 325), (17, 315), (17, 2608), (17, 13961));

-- Keep an older collector, importer, or trainer from reintroducing removed
-- attractions before its updated application code is deployed. Returning NULL
-- from a BEFORE trigger skips only the excluded row and keeps the valid rows
-- in the same batch intact.
CREATE OR REPLACE FUNCTION "skip_excluded_named_attraction"()
RETURNS trigger AS $$
BEGIN
  IF
    (NEW."parkId" = 16 AND (
      NEW."rideId" IN (12428, 288, 304, 687, 6711, 679, 456, 328, 331, 674,
        690, 686, 691, 14915, 695, 14923, 13814, 11980, 709, 327, 684, 274,
        16254, 10903, 14326, 16627)
      OR NEW."rideName" IN (
        'Adventureland Treehouse inspired by Walt Disney’s Swiss Family Robinson',
        'Walt Disney''s Enchanted Tiki Room', 'Davy Crockett''s Explorer Canoes',
        'Meet Disney Princesses at Royal Hall', 'Sleeping Beauty Castle Walkthrough',
        'Frontierland Shootin'' Exposition', 'Mark Twain Riverboat',
        'Pirate''s Lair on Tom Sawyer Island', 'Sailing Ship Columbia',
        'Disneyland Railroad', 'Great Moments with Mr. Lincoln', 'Main Street Cinema',
        'Main Street Vehicles', 'Opera House - Walt Disney - A Magical Life',
        'The Disney Gallery', 'Walt Disney - A Magical Life', 'Donald''s Duck Pond',
        'Goofy''s How-to-Play Yard', 'Mickey''s House and Meet Mickey Mouse',
        'Minnie''s House', 'Haunted Mansion Holiday', 'Disneyland Monorail',
        'Pixar Short Film Spotlight'
      )
    ))
    OR
    (NEW."parkId" = 17 AND (
      NEW."rideId" IN (321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907,
        10904, 10905, 10906, 866, 869, 4723, 5146, 7292, 11528)
      OR NEW."rideName" IN (
        'Animation Academy', 'WEB SLINGERS: A Spider-Man Adventure Single Rider',
        'Luigi''s Honkin'' Haul-O-Ween', 'Luigi''s Joy to the Whirl',
        'Redwood Creek Challenge Trail', 'Mickey''s PhilharMagic',
        'Sorcerer''s Workshop', 'Turtle Talk with Crush', 'The Bakery Tour',
        'Games of Pixar Pier', 'Silly Symphony Swings Single Rider',
        'Radiator Springs Racers Single Rider', 'Incredicoaster Single Rider',
        'World of Color - Season of Light', 'World of Color – ONE',
        'Guardians of the Galaxy - Monsters After Dark', 'Mater''s Graveyard JamBOOree',
        'Mater''s Jingle Jamboree', 'Villains Grove at Oogie Boogie Bash'
      )
    ))
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "skip_excluded_wait_time_record"
BEFORE INSERT OR UPDATE ON "WaitTimeRecord"
FOR EACH ROW EXECUTE FUNCTION "skip_excluded_named_attraction"();

CREATE TRIGGER "skip_excluded_daily_forecast"
BEFORE INSERT OR UPDATE ON "DailyForecast"
FOR EACH ROW EXECUTE FUNCTION "skip_excluded_named_attraction"();

CREATE TRIGGER "skip_excluded_hourly_summary"
BEFORE INSERT OR UPDATE ON "HourlyWaitSummary"
FOR EACH ROW EXECUTE FUNCTION "skip_excluded_named_attraction"();

CREATE TRIGGER "skip_excluded_ride_catalog"
BEFORE INSERT OR UPDATE ON "RideCatalog"
FOR EACH ROW EXECUTE FUNCTION "skip_excluded_named_attraction"();

CREATE OR REPLACE FUNCTION "skip_excluded_unnamed_attraction"()
RETURNS trigger AS $$
BEGIN
  IF
    (NEW."parkId" = 16 AND NEW."rideId" IN (
      12428, 288, 304, 687, 6711, 679, 456, 328, 331, 674, 690, 686, 691,
      14915, 695, 14923, 13814, 11980, 709, 327, 684, 274, 16254, 10903,
      14326, 16627
    ))
    OR
    (NEW."parkId" = 17 AND NEW."rideId" IN (
      321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907, 10904, 10905,
      10906, 866, 869, 4723, 5146, 7292, 11528
    ))
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "skip_excluded_ride_day_forecast"
BEFORE INSERT OR UPDATE ON "RideDayForecast"
FOR EACH ROW EXECUTE FUNCTION "skip_excluded_unnamed_attraction"();

CREATE TRIGGER "skip_excluded_forecast_evaluation"
BEFORE INSERT OR UPDATE ON "ForecastEvaluation"
FOR EACH ROW EXECUTE FUNCTION "skip_excluded_unnamed_attraction"();

CREATE OR REPLACE FUNCTION "skip_excluded_legacy_prediction"()
RETURNS trigger AS $$
BEGIN
  IF
    NEW."rideId" IN (
      12428, 288, 304, 687, 6711, 679, 456, 328, 331, 674, 690, 686, 691,
      14915, 695, 14923, 13814, 11980, 709, 327, 684, 274, 16254, 10903,
      14326, 16627, 321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907,
      10904, 10905, 10906, 866, 869, 4723, 5146, 7292, 11528
    )
    OR NEW."rideName" IN (
      'Haunted Mansion Holiday', 'Luigi''s Honkin'' Haul-O-Ween',
      'Luigi''s Joy to the Whirl', 'Mater''s Graveyard JamBOOree',
      'Mater''s Jingle Jamboree'
    )
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "skip_excluded_prediction"
BEFORE INSERT OR UPDATE ON "Prediction"
FOR EACH ROW EXECUTE FUNCTION "skip_excluded_legacy_prediction"();

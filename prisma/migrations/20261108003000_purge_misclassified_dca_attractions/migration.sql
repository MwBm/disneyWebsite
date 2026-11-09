-- Some historic DCA records were stamped with parkId 16 before the park-aware
-- rollout knew all DCA lands. Queue-Times attraction IDs are globally unique,
-- so purge the DCA exclusion IDs regardless of that bad historic park value.
-- Seasonal overlays that reuse a normal ride ID are still removed by name.

DELETE FROM "WaitTimeRecord"
WHERE "rideId" IN (
  321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907, 10904, 10905,
  10906, 866, 869, 4723, 5146, 7292, 11528
)
OR "rideName" IN (
  'Animation Academy', 'WEB SLINGERS: A Spider-Man Adventure Single Rider',
  'Luigi''s Honkin'' Haul-O-Ween', 'Luigi''s Joy to the Whirl',
  'Redwood Creek Challenge Trail', 'Mickey''s PhilharMagic',
  'Sorcerer''s Workshop', 'Turtle Talk with Crush', 'The Bakery Tour',
  'Games of Pixar Pier', 'Silly Symphony Swings Single Rider',
  'Radiator Springs Racers Single Rider', 'Incredicoaster Single Rider',
  'World of Color - Season of Light', 'World of Color – ONE',
  'Guardians of the Galaxy - Monsters After Dark', 'Mater''s Graveyard JamBOOree',
  'Mater''s Jingle Jamboree', 'Villains Grove at Oogie Boogie Bash'
);

DELETE FROM "DailyForecast"
WHERE "rideId" IN (
  321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907, 10904, 10905,
  10906, 866, 869, 4723, 5146, 7292, 11528
)
OR "rideName" IN (
  'Animation Academy', 'WEB SLINGERS: A Spider-Man Adventure Single Rider',
  'Luigi''s Honkin'' Haul-O-Ween', 'Luigi''s Joy to the Whirl',
  'Redwood Creek Challenge Trail', 'Mickey''s PhilharMagic',
  'Sorcerer''s Workshop', 'Turtle Talk with Crush', 'The Bakery Tour',
  'Games of Pixar Pier', 'Silly Symphony Swings Single Rider',
  'Radiator Springs Racers Single Rider', 'Incredicoaster Single Rider',
  'World of Color - Season of Light', 'World of Color – ONE',
  'Guardians of the Galaxy - Monsters After Dark', 'Mater''s Graveyard JamBOOree',
  'Mater''s Jingle Jamboree', 'Villains Grove at Oogie Boogie Bash'
);

DELETE FROM "HourlyWaitSummary"
WHERE "rideId" IN (
  321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907, 10904, 10905,
  10906, 866, 869, 4723, 5146, 7292, 11528
)
OR "rideName" IN (
  'Animation Academy', 'WEB SLINGERS: A Spider-Man Adventure Single Rider',
  'Luigi''s Honkin'' Haul-O-Ween', 'Luigi''s Joy to the Whirl',
  'Redwood Creek Challenge Trail', 'Mickey''s PhilharMagic',
  'Sorcerer''s Workshop', 'Turtle Talk with Crush', 'The Bakery Tour',
  'Games of Pixar Pier', 'Silly Symphony Swings Single Rider',
  'Radiator Springs Racers Single Rider', 'Incredicoaster Single Rider',
  'World of Color - Season of Light', 'World of Color – ONE',
  'Guardians of the Galaxy - Monsters After Dark', 'Mater''s Graveyard JamBOOree',
  'Mater''s Jingle Jamboree', 'Villains Grove at Oogie Boogie Bash'
);

DELETE FROM "RideCatalog"
WHERE "rideId" IN (
  321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907, 10904, 10905,
  10906, 866, 869, 4723, 5146, 7292, 11528
)
OR "rideName" IN (
  'Animation Academy', 'WEB SLINGERS: A Spider-Man Adventure Single Rider',
  'Luigi''s Honkin'' Haul-O-Ween', 'Luigi''s Joy to the Whirl',
  'Redwood Creek Challenge Trail', 'Mickey''s PhilharMagic',
  'Sorcerer''s Workshop', 'Turtle Talk with Crush', 'The Bakery Tour',
  'Games of Pixar Pier', 'Silly Symphony Swings Single Rider',
  'Radiator Springs Racers Single Rider', 'Incredicoaster Single Rider',
  'World of Color - Season of Light', 'World of Color – ONE',
  'Guardians of the Galaxy - Monsters After Dark', 'Mater''s Graveyard JamBOOree',
  'Mater''s Jingle Jamboree', 'Villains Grove at Oogie Boogie Bash'
);

DELETE FROM "Prediction"
WHERE "rideId" IN (
  321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907, 10904, 10905,
  10906, 866, 869, 4723, 5146, 7292, 11528
)
OR "rideName" IN (
  'Luigi''s Honkin'' Haul-O-Ween', 'Luigi''s Joy to the Whirl',
  'World of Color - Season of Light', 'World of Color – ONE',
  'Guardians of the Galaxy - Monsters After Dark', 'Mater''s Graveyard JamBOOree',
  'Mater''s Jingle Jamboree', 'Villains Grove at Oogie Boogie Bash'
);

-- These projections have no display name, so only remove IDs that uniquely
-- identify an excluded attraction. Shared seasonal/base-ride IDs stay intact.
DELETE FROM "RideDayForecast"
WHERE "rideId" IN (
  321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907, 10904, 10905,
  10906, 866, 869, 4723, 5146, 7292, 11528
);

DELETE FROM "ForecastEvaluation"
WHERE "rideId" IN (
  321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907, 10904, 10905,
  10906, 866, 869, 4723, 5146, 7292, 11528
);

-- The original guard scoped DCA exclusions to park 17. Replace it with one
-- that also blocks any legacy/misclassified park value.
CREATE OR REPLACE FUNCTION "skip_excluded_named_attraction"()
RETURNS trigger AS $$
BEGIN
  IF
    NEW."rideId" IN (
      321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907, 10904, 10905,
      10906, 866, 869, 4723, 5146, 7292, 11528
    )
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
    OR (NEW."parkId" = 16 AND (
      NEW."rideId" IN (
        12428, 288, 304, 687, 6711, 679, 456, 328, 331, 674, 690, 686, 691,
        14915, 695, 14923, 13814, 11980, 709, 327, 684, 274, 16254, 10903,
        14326, 16627
      )
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
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "skip_excluded_unnamed_attraction"()
RETURNS trigger AS $$
BEGIN
  IF NEW."rideId" IN (
    321, 6440, 868, 294, 293, 13959, 13960, 14742, 10907, 10904, 10905,
    10906, 866, 869, 4723, 5146, 7292, 11528
  ) OR (NEW."parkId" = 16 AND NEW."rideId" IN (
    12428, 288, 304, 687, 6711, 679, 456, 328, 331, 674, 690, 686, 691,
    14915, 695, 14923, 13814, 11980, 709, 327, 684, 274, 16254, 10903,
    14326, 16627
  )) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The timezone an entry was written in.
--
-- Days are a local concept. Until now the calendar detectors had to say
-- "Thursdays (UTC)", because the server's calendar was the only one they had —
-- a claim about someone's week that was hedged precisely because it might be
-- about the wrong days.
--
-- NULL means unknown, and every row written before this migration is unknown.
-- Defaulting them to 'UTC' would turn "we never asked" into "they were in UTC",
-- which is a fact the database does not have. Detectors fall back to UTC for
-- these rows and keep saying so in the label.
ALTER TABLE observations
    ADD COLUMN timezone TEXT,
    ADD CONSTRAINT observations_timezone_not_blank
        CHECK (timezone IS NULL OR length(btrim(timezone)) > 0);

-- A conversation turn carries its own zone rather than the conversation's. The
-- turn is the moment that becomes an entry, and a conversation left open across
-- a flight would otherwise date its later turns from where it started.
ALTER TABLE conversation_turns
    ADD COLUMN timezone TEXT,
    ADD CONSTRAINT conversation_turns_timezone_not_blank
        CHECK (timezone IS NULL OR length(btrim(timezone)) > 0);

-- The calendar detectors are named for what they measure, not for whose
-- calendar they happened to have. Renamed in place rather than re-mined: for
-- entries with no timezone the new detectors compute exactly the same days and
-- the same labels, so this is the same claim under a truer name — and renaming
-- it in place is what keeps the person's verdict and its first-seen date
-- attached to it.
UPDATE patterns SET detector = 'weekday' WHERE detector = 'weekday-utc';
UPDATE patterns SET detector = 'lag' WHERE detector = 'lag-utc';

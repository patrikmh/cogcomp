-- Conversations: journaling by talking rather than typing.
--
-- The asymmetry here is deliberate and load-bearing. A conversation stores both
-- speakers' turns so the exchange makes sense when read back, but only the user's
-- turns ever become Observations. An inference must trace back to something the
-- person actually said — if the model's own phrasing could become evidence, the
-- explain screen would eventually be quoting the model to the user as though it
-- were their own thought.

CREATE TABLE conversations (
    id            UUID PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set when the user ends the conversation and its turns are converted into
    -- observations. A conversation with no closed_at is still in progress.
    closed_at     TIMESTAMPTZ,
    deleted_at    TIMESTAMPTZ,
    -- Name and version of the prompt and model that held up the other side, for
    -- the same reason inferences record their extractor.
    agent         TEXT NOT NULL,
    -- Set when the safety path fired, so a conversation that went somewhere
    -- serious is identifiable without re-reading it.
    flagged_at    TIMESTAMPTZ
);

CREATE INDEX conversations_user_idx ON conversations (user_id, started_at DESC);

CREATE TABLE conversation_turns (
    id               UUID PRIMARY KEY,
    conversation_id  UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    speaker          TEXT NOT NULL,
    content          TEXT NOT NULL,
    -- How this turn arrived. A spoken turn carries a transcription risk a typed
    -- one does not, and the explain screen should be able to say so.
    source           TEXT NOT NULL DEFAULT 'text',
    spoken_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The observation this turn produced, for user turns that were converted.
    -- NULL on assistant turns, always.
    observation_id   UUID REFERENCES observations (node_id) ON DELETE SET NULL,

    CONSTRAINT conversation_turns_speaker_known CHECK (speaker IN ('user', 'assistant')),
    CONSTRAINT conversation_turns_source_known CHECK (source IN ('text', 'voice')),
    CONSTRAINT conversation_turns_content_not_blank CHECK (length(btrim(content)) > 0),

    -- The rule the whole design rests on, enforced rather than remembered: an
    -- assistant turn can never point at an observation, so the model's words can
    -- never become evidence for an inference about the user.
    CONSTRAINT conversation_turns_only_user_turns_are_observed CHECK (
        speaker = 'user' OR observation_id IS NULL
    )
);

CREATE INDEX conversation_turns_conversation_idx
    ON conversation_turns (conversation_id, spoken_at);

CREATE INDEX conversation_turns_observation_idx
    ON conversation_turns (observation_id) WHERE observation_id IS NOT NULL;

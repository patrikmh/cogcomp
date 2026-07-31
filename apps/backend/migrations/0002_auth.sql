-- Authentication: passwords on users, tokens in their own table.
--
-- 0001 put a single `token_hash` column on `users`, which allowed exactly one live
-- session per person. A separate table lets a phone and a laptop hold independent
-- tokens, and lets one device be signed out without ending the other session.

ALTER TABLE users ADD COLUMN password_hash TEXT;

-- Nullable on purpose: a seeded or invited user can exist before choosing a
-- password. Such a user simply cannot authenticate by password until they set one.
COMMENT ON COLUMN users.password_hash IS
    'Argon2id hash. NULL means no password set; password login is refused.';

CREATE TABLE api_tokens (
    id            UUID PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- SHA-256 of the bearer token. The token itself is shown once, at issue, and
    -- is not recoverable from here.
    token_hash    TEXT NOT NULL UNIQUE,
    -- Which device this belongs to, so a person can tell their sessions apart when
    -- revoking one.
    label         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ
);

CREATE INDEX api_tokens_user_idx ON api_tokens (user_id) WHERE revoked_at IS NULL;

-- Carry existing sessions across rather than signing everyone out on deploy.
INSERT INTO api_tokens (id, user_id, token_hash, label)
SELECT gen_random_uuid(), id, token_hash, 'migrated from 0001'
FROM users
WHERE token_hash IS NOT NULL;

ALTER TABLE users DROP COLUMN token_hash;

-- Email is the login identifier, so it has to match case-insensitively. Storing it
-- normalized keeps the existing UNIQUE constraint doing that job, rather than
-- relying on every call site to remember to lowercase.
UPDATE users SET email = lower(btrim(email));

ALTER TABLE users ADD CONSTRAINT users_email_normalized
    CHECK (email = lower(btrim(email)));

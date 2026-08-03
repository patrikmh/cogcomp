-- Failed sign-in attempts, so brute force costs something.
--
-- Until now the only thing standing between a guessed password and an account
-- was Argon2id's cost. That is real, but it is a constant: an attacker with a
-- list of common passwords simply waits. This makes repeated failure against one
-- identity get slower.
--
-- The email is stored as a SHA-256 hash rather than plaintext. A login form
-- accepts any address at all, so a plaintext column here would become a log of
-- whatever addresses an attacker chose to type — including addresses belonging
-- to people who never signed up. The hash is enough to count failures against
-- one identity, which is all this table is for.
--
-- Deliberately not keyed to the user, and not a foreign key: attempts against
-- addresses that do not exist have to be counted too, or the lockout itself
-- becomes an account-existence oracle.
CREATE TABLE login_attempts (
    id           UUID PRIMARY KEY,
    email_hash   TEXT NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only query this table serves: how many failures for this identity since
-- some recent moment.
CREATE INDEX login_attempts_hash_time_idx ON login_attempts (email_hash, attempted_at DESC);

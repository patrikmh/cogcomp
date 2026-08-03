"""Making repeated password guesses cost something.

Argon2id already makes each guess expensive, but expensive is a constant — an
attacker with a list of common passwords just waits. This makes *repetition*
against one identity get slower.

Three decisions worth stating:

**Counted per identity, not per connection.** An address is what an attacker
iterates passwords against; an IP is trivially rotated and is shared by everyone
behind one office router. Locking by IP would punish a building for one person's
typo.

**Unknown addresses are counted too.** If only real accounts were rate limited,
the presence of a lockout would tell an attacker the account exists — the exact
thing the constant-time password check upstream is there to avoid.

**A lockout is a delay, not a ban.** The window rolls: after it passes the
attempts age out on their own, so someone who mistyped their password five times
is not locked out of their journal until an administrator intervenes. There is
nobody to intervene.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta
from uuid import uuid4

import asyncpg

#: Failures within the window before sign-in is refused. Generous: people mistype
#: passwords, and this is a journal someone may be reaching for at a bad moment.
MAX_FAILURES = 8

#: How far back failures count, and how long a lockout lasts.
WINDOW = timedelta(minutes=15)


def identity(email: str) -> str:
    """A stable key for an address, without storing the address.

    Normalised first so `Person@Example.com` and `person@example.com` are the
    same identity — otherwise changing the capitalisation resets the counter.
    """
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()


async def record_failure(pool: asyncpg.Pool, email: str) -> None:
    await pool.execute(
        "INSERT INTO login_attempts (id, email_hash) VALUES ($1, $2)",
        uuid4(),
        identity(email),
    )


async def recent_failures(pool: asyncpg.Pool, email: str) -> int:
    return await pool.fetchval(
        """
        SELECT count(*) FROM login_attempts
        WHERE email_hash = $1 AND attempted_at > now() - $2::interval
        """,
        identity(email),
        WINDOW,
    )


async def is_locked(pool: asyncpg.Pool, email: str) -> bool:
    return await recent_failures(pool, email) >= MAX_FAILURES


async def clear(pool: asyncpg.Pool, email: str) -> None:
    """Forget an identity's failures after a successful sign-in.

    Without this, someone who mistyped seven times and then got it right would
    still be one typo from a lockout for the rest of the window.
    """
    await pool.execute("DELETE FROM login_attempts WHERE email_hash = $1", identity(email))


async def prune(pool: asyncpg.Pool, older_than: timedelta = WINDOW) -> int:
    """Drop attempts that can no longer affect any decision.

    Nothing reads rows older than the window, so keeping them would turn this
    into a permanent record of every address anyone ever typed at the login form.
    """
    result = await pool.execute(
        "DELETE FROM login_attempts WHERE attempted_at < now() - $1::interval",
        older_than,
    )
    return int(result.split()[-1]) if result.startswith("DELETE") else 0

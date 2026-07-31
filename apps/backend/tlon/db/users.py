"""User accounts and API tokens."""

from __future__ import annotations

from uuid import UUID, uuid4

import asyncpg

from tlon.domain.credentials import hash_password, hash_token, normalize_email


class EmailTaken(Exception):
    pass


async def create(
    pool: asyncpg.Pool, email: str, password: str, label: str | None = None
) -> tuple[UUID, str]:
    """Create an account and issue its first token. Returns (user_id, raw token)."""
    from tlon.domain.credentials import generate_token

    email = normalize_email(email)
    # Hash before opening the transaction: Argon2 takes ~100ms, and holding a
    # connection for that is wasted pool capacity under load.
    password_hash = hash_password(password)
    user_id = uuid4()
    token = generate_token()

    async with pool.acquire() as conn, conn.transaction():
        try:
            await conn.execute(
                "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)",
                user_id,
                email,
                password_hash,
            )
        except asyncpg.UniqueViolationError as exc:
            raise EmailTaken(email) from exc

        await conn.execute(
            "INSERT INTO api_tokens (id, user_id, token_hash, label) VALUES ($1, $2, $3, $4)",
            uuid4(),
            user_id,
            hash_token(token),
            label,
        )

    return user_id, token


async def find_by_email(pool: asyncpg.Pool, email: str) -> asyncpg.Record | None:
    return await pool.fetchrow(
        """
        SELECT id, email, password_hash
        FROM users
        WHERE email = $1 AND deleted_at IS NULL
        """,
        normalize_email(email),
    )


async def issue_token(pool: asyncpg.Pool, user_id: UUID, label: str | None = None) -> str:
    from tlon.domain.credentials import generate_token

    token = generate_token()
    await pool.execute(
        "INSERT INTO api_tokens (id, user_id, token_hash, label) VALUES ($1, $2, $3, $4)",
        uuid4(),
        user_id,
        hash_token(token),
        label,
    )
    return token


async def update_password_hash(pool: asyncpg.Pool, user_id: UUID, password_hash: str) -> None:
    await pool.execute("UPDATE users SET password_hash = $1 WHERE id = $2", password_hash, user_id)


async def resolve_token(pool: asyncpg.Pool, token: str) -> UUID | None:
    """Return the owning user id for a live token, and record that it was used.

    `last_used_at` is what makes a stale session visible in the sessions list, so a
    person can tell which device to revoke.
    """
    row = await pool.fetchrow(
        """
        UPDATE api_tokens
        SET last_used_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING user_id
        """,
        hash_token(token),
    )
    if row is None:
        return None

    # A soft-deleted user's tokens stop working without having to revoke each one.
    active = await pool.fetchval(
        "SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL", row["user_id"]
    )
    return row["user_id"] if active else None


async def revoke_token(pool: asyncpg.Pool, token: str) -> bool:
    result = await pool.execute(
        "UPDATE api_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
        hash_token(token),
    )
    return result != "UPDATE 0"


async def revoke_all_tokens(pool: asyncpg.Pool, user_id: UUID) -> int:
    """Sign out everywhere. The response to a password change or a lost device."""
    result = await pool.execute(
        "UPDATE api_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        user_id,
    )
    return int(result.split()[-1])


async def list_sessions(pool: asyncpg.Pool, user_id: UUID) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT id, label, created_at, last_used_at
        FROM api_tokens
        WHERE user_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC
        """,
        user_id,
    )
    return [
        {
            "id": str(r["id"]),
            "label": r["label"],
            "created_at": r["created_at"],
            "last_used_at": r["last_used_at"],
        }
        for r in rows
    ]

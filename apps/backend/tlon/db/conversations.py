"""Persistence for conversations.

The rule this module exists to keep: only the user's turns ever become
observations. It is enforced three times over — by a CHECK constraint in the
schema, by this module never passing an assistant turn to the converter, and by a
test that asserts the constraint fires. The explain screen's promise depends on
it, so one layer of protection was not enough.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from uuid import UUID, uuid4

import asyncpg

from tlon.db import observations as observations_db
from tlon.domain.observation import NewObservation, Source


class ConversationClosedError(ValueError):
    """Raised when a turn loses the lifecycle race with conversation close."""


class ConversationFlaggedError(ValueError):
    """Raised when a turn loses the lifecycle race with a crisis flag."""


# Session advisory locks occupy a pool connection while waiting. Keep the number
# of possible turn waiters below the pool capacity, so a burst of retries cannot
# make every connection wait on another session's lock.
_turn_lock_gates: dict[int, asyncio.Semaphore] = {}
_close_lock_gates: dict[int, asyncio.Semaphore] = {}


def _pool_gate(gates: dict[int, asyncio.Semaphore], pool: asyncpg.Pool) -> asyncio.Semaphore:
    pool_key = id(pool)
    gate = gates.get(pool_key)
    if gate is None:
        # The application pool is configured with at least two connections. The
        # fallback keeps small test pools usable while still reserving a slot.
        max_size = getattr(pool, "_max_size", 2)
        gate = asyncio.Semaphore(max(1, max_size - 1))
        gates[pool_key] = gate
    return gate


def _turn_lock_gate(pool: asyncpg.Pool) -> asyncio.Semaphore:
    return _pool_gate(_turn_lock_gates, pool)


def _close_lock_gate(pool: asyncpg.Pool) -> asyncio.Semaphore:
    # Closing waits on every admitted turn lock while holding a connection. A
    # process-local single-admission gate keeps that wait independent of pool
    # sizing and leaves the rest of the pool available for ordinary requests.
    pool_key = id(pool)
    gate = _close_lock_gates.get(pool_key)
    if gate is None:
        gate = asyncio.Semaphore(1)
        _close_lock_gates[pool_key] = gate
    return gate


def _lifecycle_key(user_id: UUID, conversation_id: UUID) -> str:
    return f"lifecycle:{user_id}:{conversation_id}"


def _turn_key(user_id: UUID, conversation_id: UUID, client_turn_id: UUID) -> str:
    return f"turn:{user_id}:{conversation_id}:{client_turn_id}"


async def _acquire_advisory_lock(conn: asyncpg.Connection, key: str) -> None:
    """Acquire a session lock without losing it to cancellation."""
    task = asyncio.create_task(
        conn.execute("SELECT pg_advisory_lock(hashtextextended($1, 0))", key)
    )
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        # PostgreSQL may have granted the lock while cancellation was being
        # delivered. Finish observing the command before deciding whether to
        # unlock it, so the pooled connection never inherits the session lock.
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
        await _release_advisory_lock(conn, key)
        raise


async def _release_advisory_lock(conn: asyncpg.Connection, key: str) -> None:
    """Complete an unlock even when the caller is being cancelled."""
    task = asyncio.create_task(
        conn.execute("SELECT pg_advisory_unlock(hashtextextended($1, 0))", key)
    )
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise


@asynccontextmanager
async def turn_operation_lock(
    pool: asyncpg.Pool, user_id: UUID, conversation_id: UUID, client_turn_id: UUID
):
    """Serialize a conversation's full generation lifecycle.

    The client turn ID remains part of the API for retry idempotency, but the
    advisory lock is conversation-scoped so snapshot, generation, and assistant
    persistence cannot overlap with another turn.
    """
    gate = _turn_lock_gate(pool)
    async with gate, pool.acquire() as conn:
        key = _lifecycle_key(user_id, conversation_id)
        await _acquire_advisory_lock(conn, key)
        try:
            yield conn
        finally:
            await _release_advisory_lock(conn, key)


@asynccontextmanager
async def _lifecycle_lock(conn: asyncpg.Connection, user_id: UUID, conversation_id: UUID):
    """Hold the conversation lifecycle lock on the supplied connection."""
    key = _lifecycle_key(user_id, conversation_id)
    await _acquire_advisory_lock(conn, key)
    try:
        yield
    finally:
        await _release_advisory_lock(conn, key)


async def find_on_connection(
    conn: asyncpg.Connection, user_id: UUID, conversation_id: UUID
) -> dict | None:
    row = await conn.fetchrow(
        "SELECT id, started_at, closed_at, agent, flagged_at FROM conversations "
        "WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        conversation_id,
        user_id,
    )
    if row is None:
        return None
    turns = await conn.fetch(
        "SELECT id, speaker, content, source, spoken_at, timezone, observation_id "
        "FROM conversation_turns WHERE conversation_id = $1 AND user_id = $2 ORDER BY spoken_at, id",
        conversation_id,
        user_id,
    )
    return {
        "id": str(row["id"]),
        "started_at": row["started_at"],
        "closed_at": row["closed_at"],
        "agent": row["agent"],
        "flagged": row["flagged_at"] is not None,
        "turns": [
            {
                "id": str(t["id"]),
                "speaker": t["speaker"],
                "content": t["content"],
                "source": t["source"],
                "spoken_at": t["spoken_at"],
                "timezone": t["timezone"],
                "observation_id": str(t["observation_id"]) if t["observation_id"] else None,
            }
            for t in turns
        ],
    }


async def client_turn_status_on_connection(
    conn: asyncpg.Connection, user_id: UUID, conversation_id: UUID, client_turn_id: UUID
):
    row = await conn.fetchrow(
        "SELECT content FROM conversation_turns WHERE conversation_id = $1 AND user_id = $2 "
        "AND client_turn_id = $3 AND speaker = 'assistant'",
        conversation_id,
        user_id,
        client_turn_id,
    )
    if row:
        return ("assistant", row["content"])
    user = await conn.fetchval(
        "SELECT 1 FROM conversation_turns WHERE conversation_id = $1 AND user_id = $2 AND client_turn_id = $3 AND speaker = 'user'",
        conversation_id,
        user_id,
        client_turn_id,
    )
    return ("pending", None) if user else None


async def add_assistant_turn_on_connection(
    conn: asyncpg.Connection,
    user_id: UUID,
    conversation_id: UUID,
    content: str,
    client_turn_id: UUID,
    crisis: bool = False,
) -> None:
    async with conn.transaction():
        conversation = await conn.fetchrow(
            "SELECT closed_at, flagged_at FROM conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE",
            conversation_id,
            user_id,
        )
        if conversation is None:
            raise LookupError("conversation not found")
        if conversation["closed_at"] is not None:
            raise ConversationClosedError("conversation is already closed")
        # A crisis reply is allowed to set the first flag, but no assistant row
        # may be added after another turn has already flagged the conversation.
        if conversation["flagged_at"] is not None:
            raise ConversationFlaggedError("conversation is already flagged")
        await conn.execute(
            "INSERT INTO conversation_turns (id, conversation_id, user_id, speaker, content, client_turn_id) "
            "VALUES ($1, $2, $3, 'assistant', $4, $5)",
            uuid4(),
            conversation_id,
            user_id,
            content.strip(),
            client_turn_id,
        )
        if crisis:
            await conn.execute(
                "UPDATE conversations SET flagged_at = now() WHERE id = $1 AND flagged_at IS NULL",
                conversation_id,
            )


async def start(pool: asyncpg.Pool, user_id: UUID, agent: str) -> dict:
    conversation_id = uuid4()
    row = await pool.fetchrow(
        """
        INSERT INTO conversations (id, user_id, agent)
        VALUES ($1, $2, $3)
        RETURNING id, started_at, agent
        """,
        conversation_id,
        user_id,
        agent,
    )
    return {
        "id": str(row["id"]),
        "started_at": row["started_at"],
        "agent": row["agent"],
        "turns": [],
    }


async def find(pool: asyncpg.Pool, user_id: UUID, conversation_id: UUID) -> dict | None:
    row = await pool.fetchrow(
        """
        SELECT id, started_at, closed_at, agent, flagged_at
        FROM conversations
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        """,
        conversation_id,
        user_id,
    )
    if row is None:
        return None

    turns = await pool.fetch(
        """
        SELECT id, speaker, content, source, spoken_at, timezone, observation_id
        FROM conversation_turns
        WHERE conversation_id = $1 AND user_id = $2
        ORDER BY spoken_at, id
        """,
        conversation_id,
        user_id,
    )

    return {
        "id": str(row["id"]),
        "started_at": row["started_at"],
        "closed_at": row["closed_at"],
        "agent": row["agent"],
        "flagged": row["flagged_at"] is not None,
        "turns": [
            {
                "id": str(t["id"]),
                "speaker": t["speaker"],
                "content": t["content"],
                "source": t["source"],
                "spoken_at": t["spoken_at"],
                "timezone": t["timezone"],
                # Present only once the conversation is closed and this turn was
                # converted. Lets the client link a turn to its explain screen.
                "observation_id": str(t["observation_id"]) if t["observation_id"] else None,
            }
            for t in turns
        ],
    }


async def add_turn(
    pool: asyncpg.Pool,
    user_id: UUID,
    conversation_id: UUID,
    speaker: str,
    content: str,
    source: str = "text",
    timezone: str | None = None,
    client_turn_id: UUID | None = None,
) -> dict:
    turn_id = uuid4()
    async with (
        pool.acquire() as conn,
        _lifecycle_lock(conn, user_id, conversation_id),
        conn.transaction(),
    ):
        conversation = await conn.fetchrow(
            "SELECT id, closed_at, flagged_at FROM conversations "
            "WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE",
            conversation_id,
            user_id,
        )
        if conversation is None:
            raise LookupError("conversation not found")
        if conversation["closed_at"] is not None:
            raise ConversationClosedError("conversation is already closed")
        if conversation["flagged_at"] is not None:
            raise ConversationFlaggedError("conversation is already flagged")
        if client_turn_id is not None and speaker == "user":
            existing = await conn.fetchrow(
                "SELECT id, speaker, content, source, timezone, spoken_at "
                "FROM conversation_turns WHERE conversation_id = $1 AND user_id = $2 "
                "AND client_turn_id = $3 AND speaker = 'user'",
                conversation_id,
                user_id,
                client_turn_id,
            )
            if existing is not None:
                if (
                    existing["content"] != content.strip()
                    or existing["source"] != source
                    or existing["timezone"] != timezone
                ):
                    return {"duplicate": True, "payload_mismatch": True}
                later_user = await conn.fetchval(
                    "SELECT 1 FROM conversation_turns WHERE conversation_id = $1 "
                    "AND user_id = $2 AND speaker = 'user' AND "
                    "(spoken_at > $3 OR (spoken_at = $3 AND id > $4)) LIMIT 1",
                    conversation_id,
                    user_id,
                    existing["spoken_at"],
                    existing["id"],
                )
                if later_user:
                    return {"duplicate": True, "ambiguous": True}
                assistant = await conn.fetchrow(
                    "SELECT content FROM conversation_turns WHERE conversation_id = $1 "
                    "AND user_id = $2 AND client_turn_id = $3 AND speaker = 'assistant'",
                    conversation_id,
                    user_id,
                    client_turn_id,
                )
                return {
                    "id": str(existing["id"]),
                    "speaker": existing["speaker"],
                    "content": existing["content"],
                    "source": existing["source"],
                    "spoken_at": existing["spoken_at"],
                    "duplicate": True,
                    "pending": assistant is None,
                    "reconcile": assistant is None,
                    "assistant_reply": assistant["content"] if assistant else None,
                }
        row = await conn.fetchrow(
            "INSERT INTO conversation_turns "
            "(id, conversation_id, user_id, speaker, content, source, timezone, client_turn_id) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) "
            "RETURNING id, speaker, content, source, spoken_at",
            turn_id,
            conversation_id,
            user_id,
            speaker,
            content.strip(),
            source,
            timezone,
            client_turn_id,
        )
    return {
        "id": str(row["id"]),
        "speaker": row["speaker"],
        "content": row["content"],
        "source": row["source"],
        "spoken_at": row["spoken_at"],
    }


async def client_turn_is_ambiguous_on_connection(
    conn: asyncpg.Connection, user_id: UUID, conversation_id: UUID, client_turn_id: UUID
) -> bool:
    return bool(
        await conn.fetchval(
            """
        SELECT 1
        FROM conversation_turns AS original
        JOIN conversation_turns AS later
          ON later.conversation_id = original.conversation_id
         AND later.user_id = original.user_id
         AND later.speaker = 'user'
         AND (later.spoken_at > original.spoken_at
              OR (later.spoken_at = original.spoken_at AND later.id > original.id))
        WHERE original.conversation_id = $1 AND original.user_id = $2
          AND original.client_turn_id = $3 AND original.speaker = 'user'
        LIMIT 1
        """,
            conversation_id,
            user_id,
            client_turn_id,
        )
    )


async def client_turn_is_ambiguous(
    pool: asyncpg.Pool, user_id: UUID, conversation_id: UUID, client_turn_id: UUID
) -> bool:
    return bool(
        await pool.fetchval(
            """
        SELECT 1
        FROM conversation_turns AS original
        JOIN conversation_turns AS later
          ON later.conversation_id = original.conversation_id
         AND later.user_id = original.user_id
         AND later.speaker = 'user'
         AND (later.spoken_at > original.spoken_at
              OR (later.spoken_at = original.spoken_at AND later.id > original.id))
        WHERE original.conversation_id = $1 AND original.user_id = $2
          AND original.client_turn_id = $3 AND original.speaker = 'user'
        LIMIT 1
        """,
            conversation_id,
            user_id,
            client_turn_id,
        )
    )


async def client_turn_payload_matches(
    pool: asyncpg.Pool,
    user_id: UUID,
    conversation_id: UUID,
    client_turn_id: UUID,
    source: str,
    timezone: str | None,
    content: str | None = None,
) -> bool:
    """Check the request envelope against its user turn before replaying it."""
    row = await pool.fetchrow(
        """
        SELECT content, source, timezone
        FROM conversation_turns
        WHERE conversation_id = $1 AND user_id = $2
          AND client_turn_id = $3 AND speaker = 'user'
        """,
        conversation_id,
        user_id,
        client_turn_id,
    )
    if row is None or row["source"] != source or row["timezone"] != timezone:
        return False
    return content is None or row["content"] == content.strip()


async def client_turn_status(
    pool: asyncpg.Pool, user_id: UUID, conversation_id: UUID, client_turn_id: UUID
) -> tuple[str, str | None] | None:
    row = await pool.fetchrow(
        """
        SELECT content
        FROM conversation_turns
        WHERE conversation_id = $1 AND user_id = $2
          AND client_turn_id = $3 AND speaker = 'assistant'
        """,
        conversation_id,
        user_id,
        client_turn_id,
    )
    if row:
        return ("assistant", row["content"])
    user = await pool.fetchval(
        """
        SELECT 1 FROM conversation_turns
        WHERE conversation_id = $1 AND user_id = $2
          AND client_turn_id = $3 AND speaker = 'user'
        """,
        conversation_id,
        user_id,
        client_turn_id,
    )
    return ("pending", None) if user else None


async def flag(pool: asyncpg.Pool, conversation_id: UUID) -> None:
    await pool.execute(
        "UPDATE conversations SET flagged_at = now() WHERE id = $1 AND flagged_at IS NULL",
        conversation_id,
    )


async def flag_on_connection(conn: asyncpg.Connection, conversation_id: UUID) -> None:
    await conn.execute(
        "UPDATE conversations SET flagged_at = now() WHERE id = $1 AND flagged_at IS NULL",
        conversation_id,
    )


async def close(pool: asyncpg.Pool, user_id: UUID, conversation_id: UUID) -> dict:
    """Close a conversation after waiting for all turn generations."""
    async with _close_lock_gate(pool), pool.acquire() as conn:
        lifecycle = _lifecycle_key(user_id, conversation_id)
        await _acquire_advisory_lock(conn, lifecycle)
        lock_keys: list[str] = []
        try:
            # The lifecycle lock makes this snapshot stable: it has already
            # waited for admitted generations, and no later turn can be admitted.
            lock_rows = await conn.fetch(
                "SELECT client_turn_id FROM conversation_turns WHERE conversation_id = $1 "
                "AND user_id = $2 AND speaker = 'user' AND client_turn_id IS NOT NULL "
                "ORDER BY client_turn_id",
                conversation_id,
                user_id,
            )
            lock_keys = [
                _turn_key(user_id, conversation_id, r["client_turn_id"]) for r in lock_rows
            ]
            acquired_lock_keys: list[str] = []
            try:
                for key in lock_keys:
                    await _acquire_advisory_lock(conn, key)
                    acquired_lock_keys.append(key)
                async with conn.transaction():
                    row = await conn.fetchrow(
                        "SELECT id, closed_at FROM conversations WHERE id = $1 AND user_id = $2 "
                        "AND deleted_at IS NULL FOR UPDATE",
                        conversation_id,
                        user_id,
                    )
                    if row is None:
                        raise LookupError("conversation not found")
                    if row["closed_at"] is not None:
                        raise ValueError("conversation is already closed")
                    turns = await conn.fetch(
                        "SELECT id, speaker, content, source, spoken_at, timezone "
                        "FROM conversation_turns WHERE conversation_id = $1 AND user_id = $2 "
                        "ORDER BY spoken_at, id",
                        conversation_id,
                        user_id,
                    )
                    spoken = [turn for turn in turns if turn["speaker"] == "user"]
                    created: list[str] = []
                    if spoken:
                        first = spoken[0]
                        observation_id = uuid4()
                        new_entry = NewObservation(
                            id=observation_id,
                            content="\n\n".join(turn["content"] for turn in spoken),
                            source=Source(first["source"]),
                            captured_at=first["spoken_at"],
                            timezone=first["timezone"],
                        )
                        await observations_db.insert_on_connection(conn, user_id, new_entry)
                        for turn in spoken:
                            await conn.execute(
                                "UPDATE conversation_turns SET observation_id = $1 WHERE id = $2",
                                observation_id,
                                turn["id"],
                            )
                        created.append(str(observation_id))
                    await conn.execute(
                        "UPDATE conversations SET closed_at = now() WHERE id = $1", conversation_id
                    )
            finally:
                for key in reversed(acquired_lock_keys):
                    await _release_advisory_lock(conn, key)
        finally:
            await _release_advisory_lock(conn, lifecycle)
    return {
        "conversation_id": str(conversation_id),
        "observations": created,
        "turns_converted": len(spoken),
    }


async def list_for_user(
    pool: asyncpg.Pool, user_id: UUID, limit: int, before: datetime | None
) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT c.id, c.started_at, c.closed_at, c.agent, c.flagged_at,
               count(t.id) FILTER (WHERE t.speaker = 'user') AS user_turns
        FROM conversations c
        LEFT JOIN conversation_turns t ON t.conversation_id = c.id
        WHERE c.user_id = $1
          AND c.deleted_at IS NULL
          AND ($2::timestamptz IS NULL OR c.started_at < $2)
        GROUP BY c.id
        ORDER BY c.started_at DESC
        LIMIT $3
        """,
        user_id,
        before,
        limit,
    )
    return [
        {
            "id": str(r["id"]),
            "started_at": r["started_at"],
            "closed_at": r["closed_at"],
            "agent": r["agent"],
            "flagged": r["flagged_at"] is not None,
            "user_turns": r["user_turns"],
        }
        for r in rows
    ]

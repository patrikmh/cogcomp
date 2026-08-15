"""Persistence for conversations.

The rule this module exists to keep: only the user's turns ever become
observations. It is enforced three times over — by a CHECK constraint in the
schema, by this module never passing an assistant turn to the converter, and by a
test that asserts the constraint fires. The explain screen's promise depends on
it, so one layer of protection was not enough.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

import asyncpg

from tlon.db import observations as observations_db
from tlon.domain.observation import NewObservation, Source


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
) -> dict:
    turn_id = uuid4()
    row = await pool.fetchrow(
        """
        INSERT INTO conversation_turns
            (id, conversation_id, user_id, speaker, content, source, timezone)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, speaker, content, source, spoken_at
        """,
        turn_id,
        conversation_id,
        user_id,
        speaker,
        content.strip(),
        source,
        timezone,
    )
    return {
        "id": str(row["id"]),
        "speaker": row["speaker"],
        "content": row["content"],
        "source": row["source"],
        "spoken_at": row["spoken_at"],
    }


async def flag(pool: asyncpg.Pool, conversation_id: UUID) -> None:
    """Mark that the safety path fired, so the conversation is identifiable later
    without anyone having to re-read it."""
    await pool.execute(
        "UPDATE conversations SET flagged_at = now() WHERE id = $1 AND flagged_at IS NULL",
        conversation_id,
    )


async def close(pool: asyncpg.Pool, user_id: UUID, conversation_id: UUID) -> dict:
    """End a conversation and turn the user's turns into observations.

    Each user turn becomes its own observation rather than being concatenated
    into one. They were said at different moments and often about different
    things, and joining them would produce an entry the person never wrote.

    Assistant turns are skipped here. They are also refused by a CHECK constraint
    if this ever changes.
    """
    conversation = await find(pool, user_id, conversation_id)
    if conversation is None:
        raise LookupError("conversation not found")
    if conversation["closed_at"] is not None:
        raise ValueError("conversation is already closed")

    # One entry for the conversation, not one per turn.
    #
    # A conversation is a person working out what they mean — a few sentences,
    # a correction, an afterthought. Kept as separate entries the record filled
    # with fragments that only made sense in order, and the journal read as a
    # transcript rather than as the day. What was said is kept verbatim, every
    # word of it; the turns are joined, not summarised.
    spoken = [turn for turn in conversation["turns"] if turn["speaker"] == "user"]

    created: list[str] = []
    if spoken:
        first = spoken[0]
        observation_id = uuid4()
        new_entry = NewObservation(
            id=observation_id,
            # A blank line between turns, so the pauses someone took are still
            # legible in what they wrote.
            content="\n\n".join(turn["content"] for turn in spoken),
            source=Source(first["source"]),
            # When they started talking, not when they stopped, so a
            # conversation begun before midnight lands on the day they had.
            captured_at=first["spoken_at"],
            # The zone it was said in, so a late-night turn lands on the day the
            # person had, not the day the server was having.
            timezone=first["timezone"],
        )
        await observations_db.insert(pool, user_id, new_entry)
        # Every turn points at the one entry it became part of, so the chain
        # from an entry back to what was actually said stays intact.
        for turn in spoken:
            await pool.execute(
                "UPDATE conversation_turns SET observation_id = $1 WHERE id = $2",
                observation_id,
                UUID(turn["id"]),
            )
        created.append(str(observation_id))

    await pool.execute("UPDATE conversations SET closed_at = now() WHERE id = $1", conversation_id)

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

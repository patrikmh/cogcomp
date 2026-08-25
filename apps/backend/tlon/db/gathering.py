"""Storage support for gathering hints.

Read-only, like every view that does not create a claim. The only thing the
database owes this feature is the set of pattern keys already held, so a hint
never appears beside the finding it would double.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg


async def held_keys(pool: asyncpg.Pool, user_id: UUID) -> set[str]:
    """Every non-lapsed pattern key for a user, in `kind:normalised` form.

    Lapsed patterns are excluded on purpose: a finding whose evidence went quiet
    has been withdrawn from the present tense. If its words start coming back,
    that is genuinely forming again — the person deserves the hint, not a
    tombstone's shadow.
    """
    rows = await pool.fetch(
        """
        SELECT detector || ':' || split_part(pattern_key, ':', 2) AS key
        FROM patterns
        WHERE user_id = $1 AND lapsed_at IS NULL
        """,
        user_id,
    )
    return {row["key"] for row in rows}

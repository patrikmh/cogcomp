"""Letting someone answer back.

The schema has allowed `user_confirmed` and `user_rejected` since the first
migration, and until now nothing ever set them. Every inference stayed a
`hypothesis` forever, which made the word decorative: a hypothesis you cannot
reject is an assertion with better manners.

Three rules, and they are the whole design:

**Rejecting does not delete.** The node stays, with its provenance, marked
rejected. Deleting it would destroy the record that the system once believed
this — and that record is the only way anyone can later ask why it did, or notice
that it keeps making the same mistake.

**A judgement is about the claim, never the entry.** Observations carry no
epistemic status at all; the CHECK constraint refuses one. What you wrote is not
a proposition to agree with.

**Rejection has consequences.** A rejected reading stops feeding pattern mining
and temporal comparison. Without that, correcting the system would be a gesture:
the thing you said was wrong would keep turning up inside conclusions drawn from
it.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

#: Everything a person may say about a reading. `hypothesis` is included so a
#: judgement can be taken back — someone who confirmed something in a bad week
#: must be able to return it to undecided rather than being held to it.
JUDGEMENTS = frozenset({"hypothesis", "user_confirmed", "user_rejected"})


class UnknownJudgement(ValueError):
    pass


class NotJudgeable(ValueError):
    """Raised for observations, which are not claims."""


async def judge(pool: asyncpg.Pool, user_id: UUID, node_id: UUID, status: str) -> dict | None:
    """Record what the person thinks of a reading. None if it is not theirs."""
    if status not in JUDGEMENTS:
        raise UnknownJudgement(status)

    node = await pool.fetchrow(
        """
        SELECT id, kind, label, epistemic_status
        FROM graph_nodes
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        """,
        node_id,
        user_id,
    )
    if node is None:
        return None
    if node["kind"] == "Observation":
        # Not a refusal to be helpful: what someone wrote is not a proposition,
        # and the database would reject the write anyway.
        raise NotJudgeable(str(node_id))

    updated = await pool.fetchrow(
        """
        UPDATE graph_nodes SET epistemic_status = $3
        WHERE id = $1 AND user_id = $2
        RETURNING id, kind, label, confidence, epistemic_status, extractor
        """,
        node_id,
        user_id,
        status,
    )
    return dict(updated) if updated else None


async def counts(pool: asyncpg.Pool, user_id: UUID) -> dict[str, int]:
    """How much of the picture the person has actually weighed in on.

    Shown on the self-model so nobody mistakes an unreviewed portrait for an
    agreed one. A twin made entirely of unexamined guesses is a rumour.
    """
    rows = await pool.fetch(
        """
        SELECT epistemic_status, count(*) AS total
        FROM graph_nodes
        WHERE user_id = $1 AND deleted_at IS NULL AND kind <> 'Observation'
        GROUP BY epistemic_status
        """,
        user_id,
    )
    tally = {status: 0 for status in JUDGEMENTS}
    for row in rows:
        tally[row["epistemic_status"]] = row["total"]
    return tally

"""Themes: clustering a person's graph into the regions of their life.

Pattern mining says one thing recurs. Association mining says two things travel
together. This says something neither can: that a *group* of things forms one
area of someone's life — work and dread and the office and sleeping badly are not
four findings, they are one region with four things in it.

That is the finding a person is least able to reach on their own, and the one
with the most room to be wrong, so three constraints hold it down.

**Structure only, from adjacency only.** Communities are computed from
`CO_OCCURS_WITH` edges, which carry no direction and no causal claim. Clustering
over `TRIGGERED_BY` would take a pile of causal hypotheses and return something
that looks like an established region of a life.

**Three members minimum.** Two adjacent things are an association, and the graph
already says that with an edge. Calling a pair a theme would dress up a finding
the system already had in language that implies more.

**Named in the person's own words.** With no model configured a theme is labelled
by listing what is in it, not by inventing a phrase for it. An invented name is
an interpretation, and an interpretation presented as a heading is the hardest
kind to argue with. A model may later write a real summary; until one does, the
honest label is the membership.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import asyncpg
from graphiti_core import Graphiti
from graphiti_core.utils.maintenance.community_operations import get_community_clusters

from tlon.domain.inference import EpistemicStatus, derived_confidence
from tlon.graph.projection import graphiti_uuid, group_id

VERSION = "communities-v0.1"

#: Which method made the claim, mirroring the pattern and association detectors.
DETECTOR = "co-occurrence-community"

#: Below this it is an association, not a region. Mirrored by a CHECK constraint,
#: because a two-member theme would be a strictly weaker claim than the edge it
#: was built from.
MIN_MEMBERS = 3

#: How much two runs' communities must overlap to be considered the same theme.
#: Clustering is not stable to the last member — one new association can move a
#: node between neighbouring communities — so requiring exact membership would
#: retire and re-announce a theme every time the graph shifted slightly. Half is
#: strict enough that two genuinely different regions never match.
SAME_THEME_OVERLAP = 0.5


def _overlap(left: set[UUID], right: set[UUID]) -> float:
    """Jaccard: shared members over total distinct members."""
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def label_for(labels: list[str]) -> str:
    """A theme's name: what is in it, in the person's own words.

    Listed rather than summarised, and truncated with a count rather than an
    ellipsis so the heading never implies the theme is smaller than it is.
    """
    shown = labels[:3]
    remainder = len(labels) - len(shown)
    joined = ", ".join(shown)
    return f"{joined} and {remainder} more" if remainder else joined


async def cluster(graphiti: Graphiti, user_id: UUID, node_ids: list[UUID]) -> list[list[UUID]]:
    """Communities over the projected graph, as Tlön node ids.

    `node_ids` supplies the reverse mapping: Graphiti uuids are derived from Tlön
    ids by a one-way hash, so translating back requires knowing which ids were
    projected rather than trying to invert it.
    """
    by_graphiti_uuid = {graphiti_uuid(node_id): node_id for node_id in node_ids}

    clusters = await get_community_clusters(graphiti.driver, [group_id(user_id)])

    found: list[list[UUID]] = []
    for community in clusters:
        members = [
            by_graphiti_uuid[node.uuid] for node in community if node.uuid in by_graphiti_uuid
        ]
        if len(members) >= MIN_MEMBERS:
            found.append(sorted(members, key=str))
    return found


async def _existing(pool: asyncpg.Pool, user_id: UUID) -> dict[UUID, set[UUID]]:
    rows = await pool.fetch(
        """
        SELECT t.node_id, array_agg(m.node_id) AS members
        FROM themes t
        JOIN theme_members m ON m.theme_id = t.node_id
        WHERE t.user_id = $1 AND t.lapsed_at IS NULL
        GROUP BY t.node_id
        """,
        user_id,
    )
    return {row["node_id"]: set(row["members"]) for row in rows}


async def reconcile(pool: asyncpg.Pool, user_id: UUID, clusters: list[list[UUID]]) -> dict:
    """Match this run's communities against the standing themes and upsert.

    Matched by membership overlap rather than by identity, because a community has
    no identity of its own — it is whatever the clustering returned this time. The
    overlap is what lets a theme keep its id, its age, and any verdict the person
    passed on it while the region itself grows.
    """
    added: list[str] = []
    confirmed: list[str] = []

    async with pool.acquire() as conn, conn.transaction():
        standing = await _existing(conn, user_id)
        claimed: set[UUID] = set()

        for members in clusters:
            member_set = set(members)
            match = max(
                (
                    (theme_id, _overlap(member_set, existing))
                    for theme_id, existing in standing.items()
                    if theme_id not in claimed
                ),
                key=lambda pair: pair[1],
                default=(None, 0.0),
            )
            theme_id = match[0] if match[1] >= SAME_THEME_OVERLAP else None

            labels, confidence = await _member_details(conn, members)
            if theme_id is None:
                theme_id = await _insert(conn, user_id, members, labels, confidence)
                added.append(str(theme_id))
            else:
                await _confirm(conn, theme_id, members, labels, confidence)
                confirmed.append(str(theme_id))

            claimed.add(theme_id)
            await _set_members(conn, theme_id, members)

        await _lapse_absent(conn, user_id, claimed)

    return {"added": added, "confirmed": confirmed}


async def _member_details(conn: asyncpg.Connection, members: list[UUID]) -> tuple[list[str], float]:
    rows = await conn.fetch(
        """
        SELECT label, confidence FROM graph_nodes
        WHERE id = ANY($1::uuid[]) ORDER BY confidence DESC, label
        """,
        members,
    )
    labels = [row["label"] for row in rows]
    # A theme is a claim derived from several, so the usual rule applies: no
    # stronger than the weakest thing underneath it.
    confidence = derived_confidence([row["confidence"] for row in rows])
    return labels, confidence


async def _insert(
    conn: asyncpg.Connection,
    user_id: UUID,
    members: list[UUID],
    labels: list[str],
    confidence: float,
) -> UUID:
    theme_id = uuid4()
    await conn.execute(
        """
        INSERT INTO graph_nodes
            (id, user_id, kind, label, confidence, epistemic_status, extractor)
        VALUES ($1, $2, 'Theme', $3, $4, $5, $6)
        """,
        theme_id,
        user_id,
        label_for(labels),
        confidence,
        str(EpistemicStatus.HYPOTHESIS),
        VERSION,
    )
    await conn.execute(
        """
        INSERT INTO themes (node_id, user_id, detector, member_count)
        VALUES ($1, $2, $3, $4)
        """,
        theme_id,
        user_id,
        DETECTOR,
        len(members),
    )

    # Provenance: every entry any member rests on. A theme is a claim about a
    # region of someone's life and has to be traceable to the entries that built
    # it, like everything else here.
    await conn.execute(
        """
        INSERT INTO node_provenance (node_id, observation_id)
        SELECT $1, observation_id FROM node_provenance WHERE node_id = ANY($2::uuid[])
        ON CONFLICT DO NOTHING
        """,
        theme_id,
        members,
    )
    return theme_id


async def _confirm(
    conn: asyncpg.Connection,
    theme_id: UUID,
    members: list[UUID],
    labels: list[str],
    confidence: float,
) -> None:
    # `epistemic_status` is untouched: a theme the person rejected stays rejected
    # however the clustering shifts underneath it.
    await conn.execute(
        "UPDATE graph_nodes SET label = $2, confidence = $3, deleted_at = NULL WHERE id = $1",
        theme_id,
        label_for(labels),
        confidence,
    )
    await conn.execute(
        """
        UPDATE themes SET last_confirmed_at = now(), lapsed_at = NULL, member_count = $2
        WHERE node_id = $1
        """,
        theme_id,
        len(members),
    )
    await conn.execute(
        """
        INSERT INTO node_provenance (node_id, observation_id)
        SELECT $1, observation_id FROM node_provenance WHERE node_id = ANY($2::uuid[])
        ON CONFLICT DO NOTHING
        """,
        theme_id,
        members,
    )


async def _set_members(conn: asyncpg.Connection, theme_id: UUID, members: list[UUID]) -> None:
    """Membership is replaced wholesale — it is what the clustering just said."""
    await conn.execute("DELETE FROM theme_members WHERE theme_id = $1", theme_id)
    await conn.executemany(
        "INSERT INTO theme_members (theme_id, node_id) VALUES ($1, $2)",
        [(theme_id, node_id) for node_id in members],
    )


async def _lapse_absent(conn: asyncpg.Connection, user_id: UUID, held: set[UUID]) -> None:
    """Themes this run no longer found stop being claimed, but keep their history."""
    await conn.execute(
        """
        UPDATE themes SET lapsed_at = now()
        WHERE user_id = $1 AND lapsed_at IS NULL AND NOT (node_id = ANY($2::uuid[]))
        """,
        user_id,
        list(held),
    )
    await conn.execute(
        """
        UPDATE graph_nodes SET deleted_at = now()
        WHERE user_id = $1 AND kind = 'Theme' AND deleted_at IS NULL
          AND id IN (SELECT node_id FROM themes WHERE user_id = $1 AND lapsed_at IS NOT NULL)
        """,
        user_id,
    )


async def list_for_user(pool: asyncpg.Pool, user_id: UUID) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT n.id, n.label, n.confidence, n.epistemic_status, n.created_at,
               t.detector, t.first_seen_at, t.member_count,
               array_agg(m.label ORDER BY m.label) AS members
        FROM graph_nodes n
        JOIN themes t ON t.node_id = n.id
        JOIN theme_members tm ON tm.theme_id = n.id
        JOIN graph_nodes m ON m.id = tm.node_id
        WHERE n.user_id = $1 AND n.kind = 'Theme' AND n.deleted_at IS NULL
        GROUP BY n.id, t.detector, t.first_seen_at, t.member_count
        ORDER BY t.member_count DESC, n.confidence DESC, n.label
        """,
        user_id,
    )
    return [
        {
            "id": str(row["id"]),
            "label": row["label"],
            "members": row["members"],
            "member_count": row["member_count"],
            "confidence": row["confidence"],
            "epistemic_status": row["epistemic_status"],
            "detector": row["detector"],
            "first_seen_at": row["first_seen_at"],
            "tentative": row["confidence"] < 0.5,
            "created_at": row["created_at"],
        }
        for row in rows
    ]

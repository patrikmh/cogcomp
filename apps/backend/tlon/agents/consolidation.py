"""Memory consolidation: recognising that two records are the same thing.

Extraction runs once per entry and has no memory, so writing "I was tired" on
Monday and again on Thursday produces two separate `Emotion` nodes with the same
label. Left alone, the graph fills with near-duplicates and the explorer becomes
unreadable — and worse, a count of "how often does this come up" is wrong, because
the same thing is being counted as several different things.

Consolidation merges them. Two decisions make it defensible:

**It does not create a new claim.** Merging says "these two records were always
about the same thing", not "here is something new I concluded". So the surviving
node keeps the *strongest* confidence of the group rather than the weakest — the
usual "never exceed your weakest input" rule applies to deriving a *new* claim
from several, and this is not that. Two independent extractions each 0.7 sure of
the same thing are not evidence for a 0.7 claim; they are two records of one.

**Nothing is lost.** The merged node inherits every observation the duplicates
cited, and `node_merges` records what was absorbed — so "why does this say four
mentions when I remember two entries" has an answer.

Matching is exact on normalised labels, for the same reason pattern mining is:
deciding that "tired" and "worn out" are the same thing is an interpretation, and
an interpretation that merges two genuinely different feelings destroys the
distinction irreversibly. Under-merging leaves a slightly messy graph. Over-merging
rewrites what someone said.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import asyncpg

from tlon.agents.base import AgentResult
from tlon.patterns import normalise

VERSION = "consolidation-v0.1"

#: Observations are never merged. They are what the person actually wrote, and two
#: entries with identical text are still two entries — collapsing them would erase
#: the fact that they said it twice, which is the very thing patterns count.
MERGEABLE = "kind NOT IN ('Observation', 'Pattern')"


class ConsolidationAgent:
    """Collapses duplicate inferred nodes into one."""

    @property
    def name(self) -> str:
        return "consolidation"

    @property
    def version(self) -> str:
        return VERSION

    @property
    def cadence_seconds(self) -> int:
        # Hourly. Duplicates are not urgent, and merging is cheap but not free.
        return 3600

    async def should_run(self, pool: asyncpg.Pool, user_id: UUID) -> bool:
        """True only if a duplicate actually exists.

        Cheap enough to run on every scheduler tick: one grouped count, no
        analysis. Normalisation happens in SQL so this does not have to load the
        graph to find out there is nothing to do.
        """
        duplicate = await pool.fetchval(
            f"""
            SELECT 1 FROM graph_nodes
            WHERE user_id = $1 AND deleted_at IS NULL AND {MERGEABLE}
              AND NOT EXISTS (
                  SELECT 1 FROM identity_selections s
                  WHERE s.user_id = graph_nodes.user_id
                    AND s.node_id = graph_nodes.id AND s.status = 'selected'
              )
            GROUP BY kind, lower(btrim(label))
            HAVING count(*) > 1
            LIMIT 1
            """,
            user_id,
        )
        return duplicate is not None

    async def run(self, pool: asyncpg.Pool, user_id: UUID) -> AgentResult:
        groups = await self._duplicate_groups(pool, user_id)
        if not groups:
            return AgentResult(skipped=True, reason="nothing was duplicated")

        merged = 0
        for group in groups:
            merged += await self._merge(pool, user_id, group)

        return AgentResult(
            summary={"groups": len(groups), "nodes_merged": merged},
        )

    async def _duplicate_groups(
        self, pool: asyncpg.Pool, user_id: UUID
    ) -> list[list[asyncpg.Record]]:
        rows = await pool.fetch(
            f"""
            SELECT id, kind, label, confidence, created_at
            FROM graph_nodes
            WHERE user_id = $1 AND deleted_at IS NULL AND {MERGEABLE}
              AND NOT EXISTS (
                  SELECT 1 FROM identity_selections s
                  WHERE s.user_id = graph_nodes.user_id
                    AND s.node_id = graph_nodes.id AND s.status = 'selected'
              )
            ORDER BY created_at, id
            """,
            user_id,
        )

        grouped: dict[tuple[str, str], list[asyncpg.Record]] = {}
        for row in rows:
            key = (row["kind"], normalise(row["label"]))
            # Normalising in Python rather than trusting the SQL lower() to match:
            # `should_run` only has to be approximately right, but the merge has
            # to use exactly the same rule pattern mining does.
            if not key[1]:
                continue
            grouped.setdefault(key, []).append(row)

        return [group for group in grouped.values() if len(group) > 1]

    async def _merge(self, pool: asyncpg.Pool, user_id: UUID, group: list[asyncpg.Record]) -> int:
        # The oldest survives. Arbitrary but stable, and it means a node's id does
        # not change under someone who has already looked at it.
        keeper, *duplicates = group
        keeper_id = keeper["id"]
        strongest = max(row["confidence"] for row in group)

        async with pool.acquire() as conn, conn.transaction():
            # Selection and consolidation both lock graph nodes. Lock every node
            # in id order before checking selections so the check and rewrites are
            # serialized with a concurrent selection transaction. A selection that
            # wins the race is visible here; one that starts after these locks are
            # acquired waits until the merge commits and then sees a deleted node.
            node_ids = [keeper_id, *(duplicate["id"] for duplicate in duplicates)]
            await conn.fetch(
                """
                SELECT id FROM graph_nodes
                WHERE user_id = $1 AND id = ANY($2::uuid[])
                ORDER BY id
                FOR UPDATE
                """,
                user_id,
                node_ids,
            )

            # A concurrent consolidation may have discovered this same group
            # before us and soft-deleted it while we waited for these locks. Do
            # not write another audit row or count an already-completed merge.
            live_count = await conn.fetchval(
                """
                SELECT count(*) FROM graph_nodes
                WHERE user_id = $1 AND id = ANY($2::uuid[])
                  AND deleted_at IS NULL
                """,
                user_id,
                node_ids,
            )
            if live_count != len(node_ids):
                return 0

            # Recheck under the merge transaction: selection may have happened
            # after duplicate discovery. A selected node is never rewritten.
            protected = await conn.fetchval(
                """
                SELECT 1 FROM identity_selections
                WHERE user_id = $1 AND status = 'selected'
                  AND node_id = ANY($2::uuid[])
                LIMIT 1
                """,
                user_id,
                [keeper_id, *(duplicate["id"] for duplicate in duplicates)],
            )
            if protected:
                return 0

            for duplicate in duplicates:
                dup_id = duplicate["id"]

                # Provenance moves first. ON CONFLICT because both nodes may
                # already cite the same entry, which is not an error.
                await conn.execute(
                    """
                    INSERT INTO node_provenance (node_id, observation_id)
                    SELECT $1, observation_id FROM node_provenance WHERE node_id = $2
                    ON CONFLICT DO NOTHING
                    """,
                    keeper_id,
                    dup_id,
                )

                # Edges are repointed, except those that would become self-loops.
                # An edge from the duplicate to the keeper is not a relationship
                # once they are the same node — it is an artefact of them having
                # been two.
                await conn.execute(
                    "UPDATE graph_edges SET from_id = $1 WHERE from_id = $2 AND to_id <> $1",
                    keeper_id,
                    dup_id,
                )
                await conn.execute(
                    "UPDATE graph_edges SET to_id = $1 WHERE to_id = $2 AND from_id <> $1",
                    keeper_id,
                    dup_id,
                )
                # Whatever is left pointed at the duplicate is a self-loop in
                # waiting. Deleted rather than left dangling at a tombstone.
                await conn.execute(
                    "DELETE FROM graph_edges WHERE from_id = $1 OR to_id = $1", dup_id
                )

                await conn.execute(
                    """
                    INSERT INTO node_merges (id, user_id, kept_id, merged_id)
                    VALUES ($1, $2, $3, $4)
                    """,
                    uuid4(),
                    user_id,
                    keeper_id,
                    dup_id,
                )

                # Soft delete. The merge record references it, and a person asking
                # what happened to a node deserves better than a missing row.
                await conn.execute(
                    "UPDATE graph_nodes SET deleted_at = now() WHERE id = $1", dup_id
                )

            # Merging does not derive a new claim, so the survivor carries the
            # strongest evidence rather than the weakest. See the module docstring.
            await conn.execute(
                "UPDATE graph_nodes SET confidence = $1 WHERE id = $2",
                strongest,
                keeper_id,
            )

        return len(duplicates)

"""Theme clustering, on a schedule.

Runs last of all, and only ever after association mining: themes are communities
in the `CO_OCCURS_WITH` graph, so clustering before those edges are current would
describe the regions of a life as they were yesterday.

Each run rebuilds the projection before clustering. That is deliberate rather than
lazy — the projection is defined as disposable, and rebuilding it every time is
what keeps that true. An incremental sync would be faster and would also be a
second thing that can drift from Postgres, which is the failure this design exists
to make impossible.

The connection to FalkorDB is opened and closed per run. Background work that
holds a connection to a second datastore forever is a connection that is stale
exactly when it is finally needed.
"""

from __future__ import annotations

import logging
from uuid import UUID

import asyncpg

from tlon.agents.base import AgentResult
from tlon.config import get_settings
from tlon.graph import communities, graphiti_client, projection, summaries

logger = logging.getLogger(__name__)


class ThemesAgent:
    @property
    def name(self) -> str:
        return "themes"

    @property
    def version(self) -> str:
        return communities.VERSION

    @property
    def cadence_seconds(self) -> int:
        # Daily, matching association mining. A theme is the slowest-moving claim
        # the system makes — regions of a life do not reshuffle hourly — and it is
        # the most expensive to compute.
        return 24 * 3600

    async def should_run(self, pool: asyncpg.Pool, user_id: UUID) -> bool:
        """Only where there are associations to cluster.

        Checked in SQL rather than by projecting first: with no associations there
        is nothing for clustering to find, and standing up a FalkorDB connection to
        discover that is work with a guaranteed empty answer.
        """
        has_edges = await pool.fetchval(
            """
            SELECT 1 FROM graph_edges
            WHERE user_id = $1 AND kind = 'CO_OCCURS_WITH' AND deleted_at IS NULL
            LIMIT 1
            """,
            user_id,
        )
        return has_edges is not None

    async def run(self, pool: asyncpg.Pool, user_id: UUID) -> AgentResult:
        node_ids = [
            row["id"]
            for row in await pool.fetch(
                """
                SELECT id FROM graph_nodes
                WHERE user_id = $1 AND deleted_at IS NULL
                  AND kind NOT IN ('Observation', 'Pattern', 'Theme')
                """,
                user_id,
            )
        ]

        graphiti = graphiti_client.build()
        try:
            await graphiti.build_indices_and_constraints()
            projected = await projection.project(pool, user_id, graphiti)
            clusters = await communities.cluster(graphiti, user_id, node_ids)
        finally:
            await graphiti.close()

        if not clusters:
            # Distinct from "found nothing": the graph was looked at and simply
            # has no region big enough to be worth calling one.
            return AgentResult(
                skipped=True,
                reason="no group of things large enough to be a theme yet",
            )

        result = await communities.reconcile(pool, user_id, clusters)

        # One sentence per held theme, from member labels only (ADR-0007).
        # Skipped entirely without a real model — the membership label is the
        # honest state of every theme then, exactly as before summaries.
        summarised = 0
        settings = get_settings()
        if settings.uses_real_model:
            try:
                summarised = await summaries.summarise_themes(
                    pool,
                    user_id,
                    settings.openrouter_api_key,
                    settings.openrouter_model,
                )
            except Exception:
                logger.warning("theme summarisation failed", exc_info=True)

        return AgentResult(
            summary={
                "themes": len(result["added"]) + len(result["confirmed"]),
                "added": len(result["added"]),
                "confirmed": len(result["confirmed"]),
                "projected_nodes": projected["nodes"],
                "projected_edges": projected["edges"],
                "summarised": summarised,
            }
        )

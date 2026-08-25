"""Transactional persistence for experiment aggregates."""

from __future__ import annotations

import hashlib
import json
from uuid import UUID

from tlon.domain.experiment import ExperimentInput, transition


class Conflict(Exception):
    pass


class Missing(Exception):
    pass


_FIELDS = "id,user_id,title,hypothesis,action,success_criterion,start_date,duration_days,timezone,cadence,state,revision,created_at,updated_at,deleted_at"
ASSESSMENTS = ("met", "partly_met", "not_met", "unclear")


def _item(row):
    return dict(row) if row else None


def canonical_payload(data: ExperimentInput) -> str:
    """Compute the server-owned consistency fingerprint for a create payload."""
    payload = {
        "title": data.title,
        "hypothesis": data.hypothesis,
        "action": data.action,
        "success_criterion": data.success_criterion,
        "start_date": data.start_date.isoformat(),
        "duration_days": data.duration_days,
        "timezone": data.timezone,
        "cadence": data.cadence,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _same_payload(row, data: ExperimentInput) -> bool:
    return all(
        row[key] == getattr(data, key)
        for key in (
            "title",
            "hypothesis",
            "action",
            "success_criterion",
            "start_date",
            "duration_days",
            "timezone",
            "cadence",
        )
    )


async def create(
    pool, user_id: UUID, experiment_id: UUID, data: ExperimentInput, fingerprint: str | None = None
):
    computed_fingerprint = canonical_payload(data)
    if fingerprint is not None and fingerprint != computed_fingerprint:
        raise Conflict("request fingerprint does not match payload")
    async with pool.acquire() as conn, conn.transaction():
        existing = await conn.fetchrow(
            f"SELECT {_FIELDS},request_fingerprint FROM experiments WHERE user_id=$1 AND id=$2",
            user_id,
            experiment_id,
        )
        if existing:
            if existing["request_fingerprint"] != computed_fingerprint or not _same_payload(
                existing, data
            ):
                raise Conflict("experiment idempotency conflict")
            return _item(existing)
        row = await conn.fetchrow(
            f"INSERT INTO experiments (id,user_id,title,hypothesis,action,success_criterion,start_date,duration_days,timezone,cadence,request_fingerprint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING {_FIELDS}",
            experiment_id,
            user_id,
            data.title,
            data.hypothesis,
            data.action,
            data.success_criterion,
            data.start_date,
            data.duration_days,
            data.timezone,
            data.cadence,
            computed_fingerprint,
        )
    return _item(row)


async def list_for_user(pool, user_id, *, include_links=True):
    rows = await pool.fetch(
        f"SELECT {_FIELDS} FROM experiments WHERE user_id=$1 AND deleted_at IS NULL ORDER BY start_date DESC, created_at DESC, id",
        user_id,
    )
    # The readings each trial was set against, in one query rather than one per
    # experiment. The list screen names them — an experiment with nothing behind
    # it is a task, and which belief it tests is the whole point of running it.
    links = []
    if include_links:
        links = await pool.fetch(
            """
            SELECT l.experiment_id, l.node_id, n.kind, n.label,
                   (l.deleted_at IS NULL AND n.id IS NOT NULL AND n.deleted_at IS NULL) AS availability
            FROM experiment_links l
            LEFT JOIN graph_nodes n ON n.id=l.node_id AND n.user_id=l.user_id
            WHERE l.user_id=$1 AND l.deleted_at IS NULL
            ORDER BY l.created_at, l.node_id
            """,
            user_id,
        )
    by_experiment: dict = {}
    for link in links:
        row = dict(link)
        by_experiment.setdefault(row.pop("experiment_id"), []).append(row)

    items = []
    for row in rows:
        item = _item(row)
        if include_links:
            item["links"] = by_experiment.get(item["id"], [])
        items.append(item)
    return items


async def get(pool, user_id, experiment_id, *, conn=None, lock=False):
    query = f"SELECT {_FIELDS} FROM experiments WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL"
    if lock:
        query += " FOR UPDATE"
    row = await (conn or pool).fetchrow(query, user_id, experiment_id)
    return _item(row)


async def _detail_conn(conn, user_id, experiment_id, *, include_links=True):
    row = await get(conn, user_id, experiment_id, conn=conn)
    if not row:
        raise Missing()
    links = []
    if include_links:
        links = await conn.fetch(
            """
            SELECT l.node_id, n.kind, n.label,
                   (l.deleted_at IS NULL AND n.id IS NOT NULL AND n.deleted_at IS NULL) AS availability
            FROM experiment_links l
            LEFT JOIN graph_nodes n ON n.id=l.node_id AND n.user_id=l.user_id
            WHERE l.experiment_id=$1 AND l.user_id=$2
            ORDER BY l.created_at,l.node_id
            """,
            experiment_id,
            user_id,
        )
    checks = await conn.fetch(
        """
        SELECT o.node_id id,o.content,o.source,o.captured_at,n.created_at,
               (c.deleted_at IS NULL AND n.id IS NOT NULL AND n.deleted_at IS NULL) AS availability
        FROM experiment_checkins c
        LEFT JOIN observations o ON o.node_id=c.observation_id AND o.user_id=c.user_id
        LEFT JOIN graph_nodes n ON n.id=o.node_id AND n.user_id=o.user_id
        WHERE c.experiment_id=$1 AND c.user_id=$2
        ORDER BY o.captured_at,o.node_id
        """,
        experiment_id,
        user_id,
    )
    outcome = await conn.fetchrow(
        "SELECT assessment,note,final_checkin_observation_id,created_at FROM experiment_outcomes WHERE experiment_id=$1 AND user_id=$2",
        experiment_id,
        user_id,
    )
    if include_links:
        row["links"] = [dict(x) for x in links]
    row["checkins"] = [dict(x) for x in checks]
    row["outcome"] = dict(outcome) if outcome else None
    return row


async def detail(pool, user_id, experiment_id, *, include_links=True):
    async with pool.acquire() as conn, conn.transaction():
        return await _detail_conn(conn, user_id, experiment_id, include_links=include_links)


async def edit(pool, user_id, experiment_id, revision, data, include_links=True):
    async with pool.acquire() as conn, conn.transaction():
        row = await get(conn, user_id, experiment_id, conn=conn, lock=True)
        if not row:
            raise Missing()
        if row["revision"] != revision:
            raise Conflict("revision conflict")
        if row["state"] != "draft":
            raise Conflict("only drafts can be edited")
        row = await conn.fetchrow(
            f"UPDATE experiments SET title=$3,hypothesis=$4,action=$5,success_criterion=$6,start_date=$7,duration_days=$8,timezone=$9,cadence=$10,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING {_FIELDS}",
            user_id,
            experiment_id,
            data.title,
            data.hypothesis,
            data.action,
            data.success_criterion,
            data.start_date,
            data.duration_days,
            data.timezone,
            data.cadence,
        )
        return await _detail_conn(conn, user_id, experiment_id, include_links=include_links)


async def set_state(
    pool,
    user_id,
    experiment_id,
    revision,
    target,
    assessment=None,
    note=None,
    final_checkin_observation_id=None,
    include_links=True,
):
    async with pool.acquire() as conn, conn.transaction():
        row = await get(conn, user_id, experiment_id, conn=conn, lock=True)
        if not row:
            raise Missing()
        if row["state"] == target:
            return await _detail_conn(conn, user_id, experiment_id, include_links=include_links)
        if row["revision"] != revision:
            raise Conflict("revision conflict")
        try:
            transition(row["state"], target)
        except ValueError as exc:
            raise Conflict(str(exc)) from exc
        if target == "completed":
            if assessment not in ASSESSMENTS or not final_checkin_observation_id:
                raise Conflict("completion requires a final check-in and assessment")
            valid = await conn.fetchval(
                """SELECT 1 FROM experiment_checkins c
                JOIN observations o ON o.node_id=c.observation_id AND o.user_id=c.user_id
                JOIN graph_nodes n ON n.id=o.node_id AND n.user_id=o.user_id
                WHERE c.experiment_id=$1 AND c.user_id=$2 AND c.observation_id=$3
                  AND c.deleted_at IS NULL AND n.deleted_at IS NULL AND n.kind='Observation'""",
                experiment_id,
                user_id,
                final_checkin_observation_id,
            )
            if not valid:
                raise Missing()
            await conn.execute(
                """INSERT INTO experiment_outcomes(experiment_id,user_id,assessment,note,final_checkin_observation_id)
                VALUES($1,$2,$3,$4,$5)
                ON CONFLICT (experiment_id) DO UPDATE SET assessment=EXCLUDED.assessment,note=EXCLUDED.note,final_checkin_observation_id=EXCLUDED.final_checkin_observation_id""",
                experiment_id,
                user_id,
                assessment,
                note,
                final_checkin_observation_id,
            )
        await conn.execute(
            "UPDATE experiments SET state=$3,revision=revision+1,updated_at=now() WHERE id=$2 AND user_id=$1",
            user_id,
            experiment_id,
            target,
        )
        # The whole experiment, not the bare row. A mutation answers with the
        # same shape a read does, because the client writes this response into
        # the cache the screen renders from — a reply without `outcome`,
        # `links` or `checkins` does not omit them, it erases them.
        return await _detail_conn(conn, user_id, experiment_id, include_links=include_links)


async def soft_delete(pool, user_id, experiment_id, revision):
    async with pool.acquire() as conn, conn.transaction():
        row = await get(conn, user_id, experiment_id, conn=conn, lock=True)
        if not row:
            raise Missing()
        if row["revision"] != revision:
            raise Conflict("revision conflict")
        await conn.execute(
            "UPDATE experiments SET deleted_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 AND user_id=$2",
            experiment_id,
            user_id,
        )


async def link(pool, user_id, experiment_id, node_id, revision, include_links=True):
    async with pool.acquire() as conn, conn.transaction():
        row = await get(conn, user_id, experiment_id, conn=conn, lock=True)
        if not row:
            raise Missing()
        existing = await conn.fetchval(
            "SELECT 1 FROM experiment_links WHERE experiment_id=$1 AND node_id=$2 AND user_id=$3 AND deleted_at IS NULL",
            experiment_id,
            node_id,
            user_id,
        )
        if existing:
            return await _detail_conn(conn, user_id, experiment_id, include_links=include_links)
        if row["revision"] != revision:
            raise Conflict("revision conflict")
        if row["state"] != "draft":
            raise Conflict("only drafts can be linked")
        valid = await conn.fetchval(
            "SELECT 1 FROM graph_nodes n WHERE n.id=$1 AND n.user_id=$2 AND n.deleted_at IS NULL AND n.kind <> 'Observation' AND EXISTS (SELECT 1 FROM node_provenance p JOIN observations o ON o.node_id=p.observation_id WHERE p.node_id=n.id AND o.user_id=$2)",
            node_id,
            user_id,
        )
        if not valid:
            raise Missing()
        await conn.execute(
            "INSERT INTO experiment_links(experiment_id,node_id,user_id) VALUES($1,$2,$3) ON CONFLICT(experiment_id,node_id) DO UPDATE SET deleted_at=NULL",
            experiment_id,
            node_id,
            user_id,
        )
        await conn.execute(
            "UPDATE experiments SET revision=revision+1,updated_at=now() WHERE id=$1 AND user_id=$2",
            experiment_id,
            user_id,
        )
        return await _detail_conn(conn, user_id, experiment_id, include_links=include_links)


async def unlink(pool, user_id, experiment_id, node_id, revision, include_links=True):
    async with pool.acquire() as conn, conn.transaction():
        row = await get(conn, user_id, experiment_id, conn=conn, lock=True)
        if not row:
            raise Missing()
        if row["revision"] != revision:
            raise Conflict("revision conflict")
        if row["state"] != "draft":
            raise Conflict("only drafts can be unlinked")
        await conn.execute(
            "UPDATE experiment_links SET deleted_at=now() WHERE experiment_id=$1 AND node_id=$2 AND user_id=$3 AND deleted_at IS NULL",
            experiment_id,
            node_id,
            user_id,
        )
        await conn.execute(
            "UPDATE experiments SET revision=revision+1,updated_at=now() WHERE id=$1 AND user_id=$2",
            experiment_id,
            user_id,
        )
        return await _detail_conn(conn, user_id, experiment_id, include_links=include_links)


async def attach_checkin(
    pool, user_id, experiment_id, observation_id, revision, include_links=True
):
    async with pool.acquire() as conn, conn.transaction():
        row = await get(conn, user_id, experiment_id, conn=conn, lock=True)
        if not row:
            raise Missing()
        existing = await conn.fetchval(
            "SELECT 1 FROM experiment_checkins WHERE experiment_id=$1 AND observation_id=$2 AND user_id=$3 AND deleted_at IS NULL",
            experiment_id,
            observation_id,
            user_id,
        )
        if existing:
            return await _detail_conn(conn, user_id, experiment_id, include_links=include_links)
        if row["revision"] != revision:
            raise Conflict("revision conflict")
        if row["state"] != "active":
            raise Conflict("check-ins require an active experiment")
        valid = await conn.fetchval(
            "SELECT 1 FROM observations o JOIN graph_nodes n ON n.id=o.node_id AND n.user_id=o.user_id WHERE o.node_id=$1 AND o.user_id=$2 AND n.deleted_at IS NULL AND n.kind='Observation'",
            observation_id,
            user_id,
        )
        if not valid:
            raise Missing()
        await conn.execute(
            "INSERT INTO experiment_checkins(experiment_id,observation_id,user_id) VALUES($1,$2,$3) ON CONFLICT(experiment_id,observation_id) DO UPDATE SET deleted_at=NULL",
            experiment_id,
            observation_id,
            user_id,
        )
        await conn.execute(
            "UPDATE experiments SET revision=revision+1,updated_at=now() WHERE id=$1 AND user_id=$2",
            experiment_id,
            user_id,
        )
        return await _detail_conn(conn, user_id, experiment_id, include_links=include_links)

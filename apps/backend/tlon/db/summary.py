"""Read-only deterministic daily and weekly summaries assembled from the graph."""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from datetime import date as Date
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import asyncpg

from tlon.domain.inference import TENTATIVE_THRESHOLD
from tlon.domain.weekly import UnknownTimezone, local_date, week_bounds, week_dates
from tlon.graph.schema import NodeKind

ENTITY_KINDS = (NodeKind.PERSON, NodeKind.PLACE, NodeKind.ACTIVITY, NodeKind.EVENT)
MIN_RECURRENCE = 2


def day_bounds(day: Date, timezone: str) -> tuple[datetime, datetime]:
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise UnknownTimezone(f"unknown timezone: {timezone}") from exc
    return (
        datetime.combine(day, time.min, tzinfo=zone).astimezone(UTC),
        datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC),
    )


async def daily_summary(
    pool: asyncpg.Pool, user_id: UUID, day: Date, timezone: str = "UTC"
) -> dict:
    start, end = day_bounds(day, timezone)
    observations = await pool.fetch(
        """SELECT o.node_id, o.content, o.source, o.captured_at
        FROM observations o JOIN graph_nodes n ON n.id=o.node_id
        WHERE o.user_id=$1 AND n.deleted_at IS NULL AND o.captured_at >= $2 AND o.captured_at < $3
        ORDER BY o.captured_at""",
        user_id,
        start,
        end,
    )
    if not observations:
        return {
            "date": day.isoformat(),
            "timezone": timezone,
            "entry_count": 0,
            "observations": [],
            "inferred": [],
            "recurring": [],
        }
    ids = [r["node_id"] for r in observations]
    inferred = await pool.fetch(
        """SELECT n.id,n.kind,n.label,n.confidence,n.epistemic_status,n.extractor,
        count(DISTINCT p.observation_id) AS cites, array_agg(DISTINCT p.observation_id) AS source_ids
        FROM graph_nodes n JOIN node_provenance p ON p.node_id=n.id
        WHERE n.user_id=$1 AND n.deleted_at IS NULL AND n.kind <> 'Observation' AND p.observation_id=ANY($2::uuid[])
        GROUP BY n.id,n.kind,n.label,n.confidence,n.epistemic_status,n.extractor
        ORDER BY n.confidence DESC,n.label""",
        user_id,
        ids,
    )
    return _summary_payload(day, timezone, observations, inferred)


def _inference(row: asyncpg.Record) -> dict:
    confidence = row["confidence"]
    return {
        "id": str(row["id"]),
        "kind": row["kind"],
        "label": row["label"],
        "confidence": confidence,
        "epistemic_status": row["epistemic_status"],
        "extractor": row["extractor"],
        "tentative": confidence < TENTATIVE_THRESHOLD,
        "cites_entries": row["cites"],
    }


def _summary_payload(day, timezone, observations, inferred):
    items = [_inference(r) for r in inferred]
    recurring = [
        {"kind": x["kind"], "label": x["label"], "entries": x["cites_entries"]}
        for x in items
        if x["kind"] in ENTITY_KINDS and x["cites_entries"] >= MIN_RECURRENCE
    ]
    return {
        "date": day.isoformat(),
        "timezone": timezone,
        "entry_count": len(observations),
        "first_capture": observations[0]["captured_at"],
        "last_capture": observations[-1]["captured_at"],
        "observations": [
            {
                "id": str(r["node_id"]),
                "content": r["content"],
                "source": r["source"],
                "captured_at": r["captured_at"],
            }
            for r in observations
        ],
        "inferred": items,
        "recurring": recurring,
    }


async def weekly_summary(
    pool: asyncpg.Pool, user_id: UUID, week_start: Date, timezone: str = "UTC"
) -> dict:
    start, end = week_bounds(week_start, timezone)
    rows = await pool.fetch(
        """SELECT o.node_id,o.content,o.source,o.captured_at
        FROM observations o JOIN graph_nodes n ON n.id=o.node_id
        WHERE o.user_id=$1 AND n.deleted_at IS NULL AND o.captured_at >= $2 AND o.captured_at < $3
        ORDER BY o.captured_at,o.node_id""",
        user_id,
        start,
        end,
    )
    ids = [r["node_id"] for r in rows]
    inferred = []
    if ids:
        inferred = await pool.fetch(
            """SELECT n.id,n.kind,n.label,n.confidence,n.epistemic_status,n.extractor,
            count(DISTINCT p.observation_id) AS cites,
            array_agg(DISTINCT p.observation_id ORDER BY p.observation_id) AS source_ids
            FROM graph_nodes n JOIN node_provenance p ON p.node_id=n.id
            WHERE n.user_id=$1 AND n.deleted_at IS NULL AND n.kind <> 'Observation'
              AND p.observation_id=ANY($2::uuid[])
            GROUP BY n.id,n.kind,n.label,n.confidence,n.epistemic_status,n.extractor
            ORDER BY n.confidence DESC,n.label,n.id""",
            user_id,
            ids,
        )
    buckets = {d: [] for d in week_dates(week_start)}
    for row in rows:
        buckets[local_date(row["captured_at"], timezone)].append(row)
    day_items = []
    for day in week_dates(week_start):
        day_rows = buckets[day]
        day_items.append(
            {
                "date": day.isoformat(),
                "entry_count": len(day_rows),
                "observations": [
                    {
                        "id": str(r["node_id"]),
                        "content": r["content"],
                        "source": r["source"],
                        "captured_at": r["captured_at"],
                    }
                    for r in day_rows
                ],
            }
        )
    observation_days = {r["node_id"]: local_date(r["captured_at"], timezone) for r in rows}
    items = []
    for row in inferred:
        item = _inference(row)
        item["source_observation_ids"] = [str(value) for value in row["source_ids"]]
        item["cites_days"] = len({observation_days[value] for value in row["source_ids"]})
        items.append(item)

    occurrence_groups: dict[tuple[str, str], dict] = {}
    for item in items:
        if item["kind"] not in ENTITY_KINDS:
            continue
        key = (item["kind"], item["label"].strip().casefold())
        group = occurrence_groups.setdefault(
            key,
            {
                "kind": item["kind"],
                "label": item["label"],
                "observations": set(),
                "days": set(),
                "inference_ids": [],
            },
        )
        if (item["label"].casefold(), item["label"]) < (group["label"].casefold(), group["label"]):
            group["label"] = item["label"]
        group["observations"].update(item["source_observation_ids"])
        group["days"].update(
            observation_days[UUID(value)] for value in item["source_observation_ids"]
        )
        group["inference_ids"].append(item["id"])
    recurring = [
        {
            "kind": group["kind"],
            "label": group["label"],
            "entries": len(group["observations"]),
            "days": len(group["days"]),
            "inference_ids": sorted(group["inference_ids"]),
        }
        for group in occurrence_groups.values()
        if len(group["observations"]) >= MIN_RECURRENCE
    ]
    recurring.sort(
        key=lambda x: (-x["entries"], -x["days"], x["kind"], x["label"].casefold(), x["label"])
    )
    return {
        "week_start": week_start.isoformat(),
        "week_end": (week_start + timedelta(days=6)).isoformat(),
        "timezone": timezone,
        "entry_count": len(rows),
        "active_days": sum(bool(v) for v in buckets.values()),
        "days": day_items,
        "day_buckets": day_items,
        "observations": [
            {
                "id": str(r["node_id"]),
                "content": r["content"],
                "source": r["source"],
                "captured_at": r["captured_at"],
            }
            for r in rows
        ],
        "inferred": items,
        "recurring": recurring,
    }

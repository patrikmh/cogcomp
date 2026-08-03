"""Things that repeatedly appear in the same order on nearby writing days.

This detector measures precedence, never cause.  A finding says only that one
thing was written about a fixed number of UTC calendar days before another.
Missing journal days are unknown: a source day contributes to the denominator
only when the person also wrote on the comparison day.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import pairwise, permutations
from uuid import UUID

from tlon.domain.inference import derived_confidence
from tlon.graph.schema import NodeKind
from tlon.patterns import (
    MIN_CONFIDENCE,
    PATTERNABLE_KINDS,
    RECENCY_DAYS,
    Candidate,
    normalise,
)

DETECTOR = "lag-utc"
LAGS = (1, 2, 3)
MIN_MATCHES = 4
MIN_MATCH_WEEKS = 3
MIN_SOURCE_WEEKDAYS = 3
MIN_SOURCE_INTERVALS = 2
MIN_ELIGIBLE_DAY_PAIRS = 8
MIN_PRECISION = 0.75
MIN_LIFT = 2.0


@dataclass(frozen=True)
class LagMatch:
    source_observation_ids: tuple[UUID, ...]
    target_observation_ids: tuple[UUID, ...]
    source_day: date
    target_day: date


@dataclass(frozen=True)
class LagFinding:
    source_node_id: UUID
    target_node_id: UUID
    source_kind: NodeKind
    target_kind: NodeKind
    source_label: str
    target_label: str
    lag_days: int
    confidence: float
    pairs: tuple[LagMatch, ...]
    lift: float
    precision: float

    @property
    def matches(self) -> int:
        return len(self.pairs)

    @property
    def key(self) -> str:
        source = f"{self.source_kind}:{normalise(self.source_label)}"
        target = f"{self.target_kind}:{normalise(self.target_label)}"
        return f"{source}->{target}:lag:{self.lag_days}"


@dataclass(frozen=True)
class _Item:
    node_id: UUID
    kind: NodeKind
    label: str
    confidence: float
    by_day: dict[date, tuple[UUID, ...]]

    @property
    def days(self) -> frozenset[date]:
        return frozenset(self.by_day)


def _items(candidates: list[Candidate]) -> list[_Item]:
    grouped: dict[tuple[NodeKind, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        label = normalise(candidate.label)
        if candidate.kind in PATTERNABLE_KINDS and label:
            grouped[(candidate.kind, label)].append(candidate)

    items = []
    for (kind, _), members in grouped.items():
        by_day: dict[date, list[UUID]] = defaultdict(list)
        for member in members:
            by_day[member.observed_on].append(member.observation_id)
        newest = max(members, key=lambda member: member.observed_on)
        items.append(
            _Item(
                node_id=min(member.node_id for member in members),
                kind=kind,
                label=newest.label,
                confidence=min(member.confidence for member in members),
                by_day={
                    day: tuple(sorted(observation_ids)) for day, observation_ids in by_day.items()
                },
            )
        )
    return sorted(items, key=lambda item: (str(item.kind), normalise(item.label)))


def _candidate(
    source: _Item,
    target: _Item,
    lag_days: int,
    observed_days: set[date],
    cutoff: date,
) -> LagFinding | None:
    delta = timedelta(days=lag_days)
    eligible_sources = {day for day in observed_days if day + delta in observed_days}
    if len(eligible_sources) < MIN_ELIGIBLE_DAY_PAIRS:
        return None

    source_days = source.days & eligible_sources
    target_predecessors = {day - delta for day in target.days} & eligible_sources
    matched_source_days = source_days & target_predecessors
    if len(matched_source_days) < MIN_MATCHES:
        return None
    if len(source.days & target.days) >= MIN_MATCHES:
        # A strong same-day relationship belongs to co-occurrence. Repeated
        # entries can otherwise make its next cycle look directional.
        return None
    if len({day.isocalendar()[:2] for day in matched_source_days}) < MIN_MATCH_WEEKS:
        return None
    if len({day.weekday() for day in matched_source_days}) < MIN_SOURCE_WEEKDAYS:
        return None
    ordered_match_days = sorted(matched_source_days)
    intervals = {later - earlier for earlier, later in pairwise(ordered_match_days)}
    if len(intervals) < MIN_SOURCE_INTERVALS:
        # Fixed clocks can create perfect phase alignment without evidence that
        # the two things form an ordered sequence.
        return None
    if max(day + delta for day in matched_source_days) < cutoff:
        return None

    precision = len(matched_source_days) / len(source_days)
    if precision < MIN_PRECISION:
        return None

    target_days = len(target_predecessors)
    lift = len(matched_source_days) * len(eligible_sources) / (len(source_days) * target_days)
    if lift < MIN_LIFT:
        return None

    confidence = derived_confidence([source.confidence, target.confidence])
    if confidence < MIN_CONFIDENCE:
        return None

    pairs = tuple(
        LagMatch(
            source_observation_ids=source.by_day[day],
            target_observation_ids=target.by_day[day + delta],
            source_day=day,
            target_day=day + delta,
        )
        for day in ordered_match_days
    )
    return LagFinding(
        source_node_id=source.node_id,
        target_node_id=target.node_id,
        source_kind=source.kind,
        target_kind=target.kind,
        source_label=source.label,
        target_label=target.label,
        lag_days=lag_days,
        confidence=confidence,
        pairs=pairs,
        lift=lift,
        precision=precision,
    )


def mine(
    candidates: list[Candidate],
    observed_days: set[date],
    as_of: date | None = None,
) -> list[LagFinding]:
    """Return conservative ordered associations, strongest first."""
    if not candidates or not observed_days:
        return []
    if as_of is None:
        as_of = max(observed_days)
    cutoff = as_of - timedelta(days=RECENCY_DAYS)

    qualified = [
        finding
        for source, target in permutations(_items(candidates), 2)
        for lag_days in LAGS
        if (finding := _candidate(source, target, lag_days, observed_days, cutoff))
    ]

    ambiguous = {
        (finding.source_node_id, finding.target_node_id, finding.lag_days)
        for finding in qualified
        if any(
            other.source_node_id == finding.target_node_id
            and other.target_node_id == finding.source_node_id
            and other.lag_days == finding.lag_days
            for other in qualified
        )
    }
    unambiguous = [
        finding
        for finding in qualified
        if (finding.source_node_id, finding.target_node_id, finding.lag_days) not in ambiguous
    ]

    strongest: dict[tuple[UUID, UUID], LagFinding] = {}
    for finding in unambiguous:
        pair = (finding.source_node_id, finding.target_node_id)
        current = strongest.get(pair)
        score = (
            finding.matches,
            finding.lift,
            finding.precision,
            -finding.lag_days,
        )
        if current is None or score > (
            current.matches,
            current.lift,
            current.precision,
            -current.lag_days,
        ):
            strongest[pair] = finding

    return sorted(
        strongest.values(),
        key=lambda finding: (
            -finding.matches,
            -finding.lift,
            -finding.precision,
            finding.lag_days,
            finding.source_label,
            finding.target_label,
        ),
    )


def describe(finding: LagFinding) -> str:
    day = "day" if finding.lag_days == 1 else "days"
    times = "time" if finding.matches == 1 else "times"
    return (
        f"{finding.source_label} came up {finding.lag_days} {day} before "
        f"{finding.target_label} · {finding.matches} {times} (UTC)"
    )

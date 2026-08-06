"""Things that repeatedly happen in the same order within one day.

The lag detector works in whole days and refuses anything closer than one, which
leaves out the tightest loop a person has: the thing that comes in the morning
and the thing that follows it by evening. That loop is worth having — it is
short enough to act on, and short enough that nobody reconstructs it accurately
from memory, because a day feels like one undifferentiated lump in hindsight.

This is the same claim lag makes, at a finer grain, and it inherits the same
discipline.

**Order, never cause.** A finding says only that one thing was written down
before another, repeatedly, inside the same day.

**Not the same entry.** Two things in one entry are simultaneous as far as this
record is concerned; that is co-occurrence's finding and it already has one. A
match needs two *different* entries, separated by real time.

**Times are only as local as the entry.** The gap between two moments is
timezone-independent, but which day they fall on is not, so a finding built on
any entry that predates timezone capture still says so.

**Written at the time, or not counted.** This is the one detector whose claim is
about the shape of a day, and a day reconstructed days later is not evidence of
that shape — recall is pulled toward peaks and endings, and the order of two
moments is exactly what it distorts. An entry backfilled more than
`MAX_RECALL_DELAY` after the moment it describes is skipped here. It still
counts everywhere else: the day it belongs to is a fact the person can supply
long afterwards, but the hour is not.

**Silence is not evidence.** The denominator is days where both things were
written about at all. A day where only one appeared says nothing about order.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from itertools import permutations
from uuid import UUID

from tlon.domain.inference import derived_confidence
from tlon.graph.schema import NodeKind
from tlon.patterns import (
    MIN_CONFIDENCE,
    PATTERNABLE_KINDS,
    RECENCY_DAYS,
    Candidate,
    MinedPattern,
    normalise,
)

VERSION = "sameday-v0.1"

#: Which method made the claim. Distinct from `lag-utc`'s successor: a
#: within-day ordering and a three-day one are different propositions, and a
#: person may believe one and not the other.
DETECTOR = "same-day-order"

#: Days the pair must have appeared in that order. Four, matching the lag
#: detector: three is a coincidence often enough to be worth refusing.
MIN_MATCHES = 4

#: Across how many distinct calendar weeks, so a single intense fortnight cannot
#: produce a claim about someone's days in general.
MIN_MATCH_WEEKS = 3

#: Of the days both things were written about, how many must show this order.
#: Below this the pair is present together but not ordered, which is a finding
#: co-occurrence already makes.
MIN_PRECISION = 0.75

#: How far apart the two entries must be. Ten minutes rules out one sitting
#: split across two entries, which is a writing habit rather than a sequence.
MIN_SEPARATION = timedelta(minutes=10)

#: How long after the fact an entry may have been written and still say
#: something about the order of a day. Six hours: long enough to write up the
#: morning at lunchtime, short enough that the sequence is remembered rather
#: than reconstructed.
MAX_RECALL_DELAY = timedelta(hours=6)


@dataclass(frozen=True)
class SameDayMatch:
    """One day the pair appeared in this order, and the two moments."""

    source_observation_id: UUID
    target_observation_id: UUID
    day: date
    source_at: datetime
    target_at: datetime

    @property
    def separation(self) -> timedelta:
        return self.target_at - self.source_at


@dataclass(frozen=True)
class SameDayFinding:
    source_node_id: UUID
    target_node_id: UUID
    source_kind: NodeKind
    target_kind: NodeKind
    source_label: str
    target_label: str
    confidence: float
    matches: tuple[SameDayMatch, ...]
    #: Days both were written about, ordered or not — the denominator behind
    #: `precision`, kept so the claim can be checked rather than trusted.
    shared_days: int
    precision: float
    note: str

    @property
    def occasions(self) -> int:
        return len(self.matches)

    @property
    def typical_gap(self) -> timedelta:
        """The middle gap, not the mean: one very long day must not stretch it."""
        gaps = sorted(match.separation for match in self.matches)
        return gaps[len(gaps) // 2]

    @property
    def key(self) -> str:
        source = f"{self.source_kind}:{normalise(self.source_label)}"
        target = f"{self.target_kind}:{normalise(self.target_label)}"
        return f"{source}->{target}:sameday"


@dataclass(frozen=True)
class _Item:
    node_id: UUID
    kind: NodeKind
    label: str
    confidence: float
    #: The earliest moment it was written about on each day. Earliest rather
    #: than every moment: the claim is about when the thing entered the day.
    first_at: dict[date, tuple[datetime, UUID]]
    zoned: bool

    @property
    def days(self) -> frozenset[date]:
        return frozenset(self.first_at)


def _items(candidates: list[Candidate]) -> list[_Item]:
    grouped: dict[tuple[NodeKind, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        if candidate.kind not in PATTERNABLE_KINDS or candidate.observed_at is None:
            continue
        # Written long after the moment it describes, so its position within the
        # day is recall rather than record.
        if candidate.recall_delay is not None and candidate.recall_delay > MAX_RECALL_DELAY:
            continue
        label = normalise(candidate.label)
        if label:
            grouped[(candidate.kind, label)].append(candidate)

    items = []
    for (kind, _), members in grouped.items():
        first_at: dict[date, tuple[datetime, UUID]] = {}
        for member in members:
            assert member.observed_at is not None
            current = first_at.get(member.observed_on)
            if current is None or member.observed_at < current[0]:
                first_at[member.observed_on] = (member.observed_at, member.observation_id)
        newest = max(members, key=lambda member: member.observed_on)
        items.append(
            _Item(
                node_id=min(member.node_id for member in members),
                kind=kind,
                label=newest.label,
                confidence=min(member.confidence for member in members),
                first_at=first_at,
                zoned=all(member.zoned for member in members),
            )
        )
    return sorted(items, key=lambda item: (str(item.kind), normalise(item.label)))


def _candidate(source: _Item, target: _Item, cutoff: date) -> SameDayFinding | None:
    shared = source.days & target.days
    if len(shared) < MIN_MATCHES:
        return None

    matches = []
    for day in sorted(shared):
        source_at, source_observation = source.first_at[day]
        target_at, target_observation = target.first_at[day]
        # Different entries, far enough apart to be two moments rather than one
        # sitting. Same-entry pairs are co-occurrence's finding, not this one.
        if source_observation == target_observation:
            continue
        if target_at - source_at < MIN_SEPARATION:
            continue
        matches.append(
            SameDayMatch(
                source_observation_id=source_observation,
                target_observation_id=target_observation,
                day=day,
                source_at=source_at,
                target_at=target_at,
            )
        )

    if len(matches) < MIN_MATCHES:
        return None
    if len({match.day.isocalendar()[:2] for match in matches}) < MIN_MATCH_WEEKS:
        return None
    if max(match.day for match in matches) < cutoff:
        return None

    precision = len(matches) / len(shared)
    if precision < MIN_PRECISION:
        return None

    confidence = derived_confidence([source.confidence, target.confidence])
    if confidence < MIN_CONFIDENCE:
        return None

    return SameDayFinding(
        source_node_id=source.node_id,
        target_node_id=target.node_id,
        source_kind=source.kind,
        target_kind=target.kind,
        source_label=source.label,
        target_label=target.label,
        confidence=confidence,
        matches=tuple(matches),
        shared_days=len(shared),
        precision=precision,
        # An ordering within a day is only as local as its vaguer side.
        note="" if source.zoned and target.zoned else " (UTC)",
    )


def describe(finding: SameDayFinding) -> str:
    """Counts and a typical gap, phrased as sequence and nothing more.

    The denominator is stated, not just the hits. "4 times" invites the reader
    to supply their own denominator, and the one they supply is usually "always";
    "4 of the 5 days" is the same finding with its strength attached. Directed
    structure estimated from a handful of days is the least stable thing this
    system produces, so it is the last place to be reporting a bare numerator.
    """
    hours = finding.typical_gap.total_seconds() / 3600
    gap = f"{round(hours)} hours" if hours >= 1.5 else "under an hour"
    days = "day" if finding.shared_days == 1 else "days"
    return (
        f"{finding.source_label} came up earlier in the day than "
        f"{finding.target_label} · on {finding.occasions} of the "
        f"{finding.shared_days} {days} both came up, about {gap} apart{finding.note}"
    )


def to_pattern(finding: SameDayFinding) -> MinedPattern:
    observation_ids = {
        observation_id
        for match in finding.matches
        for observation_id in (match.source_observation_id, match.target_observation_id)
    }
    return MinedPattern(
        kind=NodeKind.PATTERN,
        label=describe(finding),
        confidence=finding.confidence,
        key=finding.key,
        observation_ids=tuple(sorted(observation_ids)),
        node_ids=tuple(sorted((finding.source_node_id, finding.target_node_id))),
        distinct_days=finding.occasions,
        occurrence_count=finding.occasions,
    )


def mine(
    candidates: list[Candidate],
    observed_days: set[date],
    as_of: date | None = None,
) -> list[SameDayFinding]:
    """Within-day orderings that still hold, strongest first."""
    if not candidates or not observed_days:
        return []
    if as_of is None:
        as_of = max(observed_days)
    cutoff = as_of - timedelta(days=RECENCY_DAYS)

    items = _items(candidates)
    qualified = [
        finding
        for source, target in permutations(items, 2)
        if (finding := _candidate(source, target, cutoff))
    ]

    # A pair that qualifies in both directions has no order worth reporting: the
    # thing arrives first about as often as it does not.
    ambiguous = {
        (finding.source_node_id, finding.target_node_id)
        for finding in qualified
        if any(
            other.source_node_id == finding.target_node_id
            and other.target_node_id == finding.source_node_id
            for other in qualified
        )
    }

    return sorted(
        (
            finding
            for finding in qualified
            if (finding.source_node_id, finding.target_node_id) not in ambiguous
        ),
        key=lambda finding: (
            -finding.occasions,
            -finding.precision,
            finding.source_label,
            finding.target_label,
        ),
    )

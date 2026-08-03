"""Calendar-shaped recurrence, without interpreting what it means.

Exact-label mining can count that ``drained`` came up repeatedly. This detector
can make the narrower claim that it only came up on Thursdays. The distinction
matters: one is frequency and the other is a shape in time, so each gets its own
detector identity and can be accepted or rejected independently.

The first version is deliberately strict. It only reports a weekday when the
same normalized label appears in four distinct weeks, every occurrence falls on
that weekday, and the person also wrote on other weekdays during the same span.
That last condition prevents a Thursday-only journalling habit from becoming a
claim that everything in the person's life happens on Thursdays.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

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

DETECTOR = "weekday"
VERSION = "periodicity-v0.1"

#: A calendar claim needs more evidence than generic recurrence. Four sightings
#: means the same weekday has survived three weekly intervals.
MIN_OCCURRENCES = 4
MIN_DISTINCT_WEEKS = 4

#: Evidence that the user wrote at other times during the pattern's span. Three
#: days across two weekdays is a small but explicit guard against mistaking app
#: usage cadence for life cadence.
MIN_COMPARISON_DAYS = 3
MIN_COMPARISON_WEEKDAYS = 2

WEEKDAYS = (
    "Mondays",
    "Tuesdays",
    "Wednesdays",
    "Thursdays",
    "Fridays",
    "Saturdays",
    "Sundays",
)


def mine_weekdays(
    candidates: list[Candidate],
    observed_days: set[date],
    as_of: date | None = None,
) -> list[MinedPattern]:
    """Find strict weekday recurrences that still hold.

    ``observed_days`` is every day the person journalled, including entries that
    produced no patternable inference. It supplies the comparison opportunities
    needed to distinguish a life rhythm from a writing rhythm.
    """
    if not candidates or not observed_days:
        return []
    if as_of is None:
        as_of = max(observed_days)
    cutoff = as_of - timedelta(days=RECENCY_DAYS)

    grouped: dict[tuple[NodeKind, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        if candidate.kind not in PATTERNABLE_KINDS:
            continue
        key = (candidate.kind, normalise(candidate.label))
        if key[1]:
            grouped[key].append(candidate)

    patterns: list[MinedPattern] = []
    for (kind, normalised), members in grouped.items():
        occurrence_days = {member.observation_id: member.observed_on for member in members}
        if len(occurrence_days) < MIN_OCCURRENCES:
            continue

        days = set(occurrence_days.values())
        weekdays = {day.weekday() for day in days}
        if len(weekdays) != 1:
            continue
        weekday = next(iter(weekdays))

        weeks = {day - timedelta(days=day.weekday()) for day in days}
        if len(weeks) < MIN_DISTINCT_WEEKS or max(days) < cutoff:
            continue

        comparison_days = {
            day
            for day in observed_days
            if min(days) <= day <= max(days) and day.weekday() != weekday
        }
        if len(comparison_days) < MIN_COMPARISON_DAYS:
            continue
        if len({day.weekday() for day in comparison_days}) < MIN_COMPARISON_WEEKDAYS:
            continue

        confidence = derived_confidence([member.confidence for member in members])
        if confidence < MIN_CONFIDENCE:
            continue

        latest = max(
            members,
            key=lambda member: (
                member.observed_on,
                member.label,
                member.node_id.hex,
            ),
        )
        display_label = latest.label.strip().rstrip(".!?") or normalised
        patterns.append(
            MinedPattern(
                kind=kind,
                label=f"{display_label} · {WEEKDAYS[weekday]}",
                confidence=confidence,
                key=f"{kind}:{normalised}:weekday:{weekday}",
                observation_ids=tuple(sorted(occurrence_days)),
                node_ids=tuple(sorted(member.node_id for member in members)),
                distinct_days=len(days),
            )
        )

    patterns.sort(key=lambda pattern: (-pattern.occurrences, pattern.label))
    return patterns

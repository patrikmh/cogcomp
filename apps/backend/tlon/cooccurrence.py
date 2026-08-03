"""Things that keep turning up together.

This is the first detector in the system that finds something a person could not
have found by reading their own entries. Recurrence is countable by hand — you
know you have been writing about dread. Which *other* thing is in the entry
almost every time you do is not something anyone tracks about themselves, and it
is exactly the kind of thing that is obvious in hindsight.

That makes it the most useful thing here and the most dangerous, for one reason:

**Co-occurrence is not cause, and the reader will hear cause anyway.** "Your
sister comes up in most entries where you mention dread" is a fact about the
record. Everything a person will do with that sentence — the explanation they
reach for, who they blame — is inference the data does not license. So this
module emits `CO_OCCURS_WITH` and never `TRIGGERED_BY`, has no vocabulary for
direction or precedence, and reports the arithmetic rather than a reading of it.
A later detector may look for lag and precedence; it will need its own name, its
own thresholds, and its own argument, because it is a different claim.

**Lift, not frequency.** Counting the commonest pairs surfaces the commonest
things, which the person already knows. Lift asks whether two things appear
together more than their individual rates would produce by chance, which is the
part that is not visible from the inside. Two labels in a third of all entries
each will share entries constantly and mean nothing by it.

**Support before strength.** Lift is wildly unstable on small counts: one shared
entry between two rare labels produces an enormous ratio and no information. The
support floors matter more than the lift threshold, and they are set where a
coincidence stops being a plausible explanation rather than where the findings
start looking interesting.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import combinations
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

VERSION = "cooccurrence-v0.1"

#: Which method made the claim, mirroring `patterns.DETECTOR`. A statistic and a
#: count are different kinds of statement and the client renders them apart.
DETECTOR = "co-occurrence"

#: Entries containing both. Three, for the same reason a pattern needs three: two
#: shared entries between two things that each come up often is unremarkable, and
#: a ratio computed from two data points is not a measurement.
MIN_PAIR_OBSERVATIONS = 3

#: And across how many distinct days. Two things written about in one long
#: evening are one sitting, not an association.
MIN_PAIR_DAYS = 2

#: How much more often than chance. At 2.0 the pair turns up together twice as
#: often as their individual rates predict — enough to be worth a person's
#: attention, and far enough above 1.0 that ordinary noise does not clear it.
MIN_LIFT = 2.0


@dataclass(frozen=True)
class CoOccurrence:
    """Two things that appear in the same entries more often than chance."""

    a_node_id: UUID
    b_node_id: UUID
    a_label: str
    b_label: str
    confidence: float
    #: Entries containing both, cited in full: the claim is falsifiable only if
    #: the person can go and read them.
    observation_ids: tuple[UUID, ...]
    #: How much more often than their individual rates would produce.
    lift: float
    distinct_days: int

    @property
    def together(self) -> int:
        return len(self.observation_ids)

    @property
    def key(self) -> str:
        """Stable and order-independent: a pair is one finding, not two."""
        return "|".join(sorted((str(self.a_node_id), str(self.b_node_id))))


@dataclass(frozen=True)
class _Item:
    """One distinct thing, and every entry it appeared in."""

    node_id: UUID
    label: str
    confidence: float
    observation_ids: frozenset[UUID]


def _items(candidates: list[Candidate]) -> dict[tuple[NodeKind, str], _Item]:
    """Fold candidates into one entry per distinct thing.

    Grouped on the same normalised label pattern mining uses, so the two
    detectors agree about what counts as the same thing. If they disagreed, a
    pattern and a co-occurrence about the same label would cite different nodes
    and the explain screen would contradict itself.
    """
    grouped: dict[tuple[NodeKind, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        if candidate.kind not in PATTERNABLE_KINDS:
            continue
        label = normalise(candidate.label)
        if not label:
            continue
        grouped[(candidate.kind, label)].append(candidate)

    items = {}
    for key, members in grouped.items():
        newest = max(members, key=lambda member: member.observed_on)
        items[key] = _Item(
            # The oldest node represents the group, matching consolidation's
            # choice of survivor, so edges land on the node that will still be
            # there after a merge.
            node_id=min(member.node_id for member in members),
            label=newest.label,
            confidence=min(member.confidence for member in members),
            observation_ids=frozenset(member.observation_id for member in members),
        )
    return items


def mine(candidates: list[Candidate], as_of: date | None = None) -> list[CoOccurrence]:
    """Find associations that still hold. Returns strongest-first.

    Pure and deterministic, like pattern mining, and subject to the same recency
    rule: an association that stopped happening is not a current fact about
    someone's life.
    """
    if not candidates:
        return []
    if as_of is None:
        as_of = max(candidate.observed_on for candidate in candidates)
    cutoff = as_of - timedelta(days=RECENCY_DAYS)

    day_of = {candidate.observation_id: candidate.observed_on for candidate in candidates}
    total_entries = len(day_of)
    if total_entries < MIN_PAIR_OBSERVATIONS:
        return []

    items = _items(candidates)

    found: list[CoOccurrence] = []
    for (_, a), (_, b) in combinations(sorted(items.items()), 2):
        shared = a.observation_ids & b.observation_ids
        if len(shared) < MIN_PAIR_OBSERVATIONS:
            continue

        days = {day_of[observation_id] for observation_id in shared}
        if len(days) < MIN_PAIR_DAYS or max(days) < cutoff:
            continue

        # P(A and B) / (P(A) * P(B)), with the entry count cancelled out.
        lift = (len(shared) * total_entries) / (len(a.observation_ids) * len(b.observation_ids))
        if lift < MIN_LIFT:
            continue

        confidence = derived_confidence([a.confidence, b.confidence])
        if confidence < MIN_CONFIDENCE:
            continue

        found.append(
            CoOccurrence(
                a_node_id=a.node_id,
                b_node_id=b.node_id,
                a_label=a.label,
                b_label=b.label,
                confidence=confidence,
                observation_ids=tuple(sorted(shared)),
                lift=lift,
                distinct_days=len(days),
            )
        )

    # Strongest association first, then best supported, then stable by label.
    found.sort(key=lambda pair: (-pair.lift, -pair.together, pair.a_label, pair.b_label))
    return found


def describe(pair: CoOccurrence) -> str:
    """A plain statement of what was counted, for the UI.

    Says what turned up together and how often, and stops. There is no phrasing
    here for why, because the arithmetic does not know why and the person reading
    it is the only one who might.
    """
    entries = "entry" if pair.together == 1 else "entries"
    return (
        f"Came up together in {pair.together} {entries} — "
        f"{pair.lift:.1f}× more often than either alone would suggest"
    )

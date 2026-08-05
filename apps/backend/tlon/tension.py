"""What someone names as mattering, and what their days actually contain.

Every other detector here looks for things that go *together*. This one looks
for two things that stay apart: something the person repeatedly names as a value
or a need, and something they repeatedly record doing, which almost never turn
up in the same entry despite many chances to.

That gap is the hardest thing in this system to see from the inside. Recurrence
you can count yourself. Co-occurrence you can sometimes feel. But nobody keeps a
tally of which parts of their life never appear next to the things they say
matter to them — the mind supplies a story of a coherent life and the record
does not corroborate it. That is the finding worth building, and it is also the
one most likely to be heard as an accusation, so four rules hold it down.

**It reports separation, never failure.** The label states two counts and the
number of shared entries. It never says *should*, never says *but*, and never
names one side as the thing being betrayed. "You value rest and you are not
resting" is a verdict on a person; "rest came up on 8 days, working late on 9,
never in the same entry" is a fact about a record they can go and check.

**Absence only counts where presence was likely.** Two things that each appear
once tell you nothing by not appearing together. A finding needs both sides to
be frequent, the person to have been writing steadily, and enough expected
overlap under independence that its absence is genuinely surprising.

**Not writing is not evidence.** The denominator is days the person actually
wrote. A quiet fortnight is silence, not a person abandoning their values, and
this detector must never turn the second into a claim.

**Direction is stated, not inferred.** The pair is always (something named,
something done), because the asymmetry is the point: a value is a claim about
what one wants, an activity is a record of what happened. Reversing them would
say something this data cannot support.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID

from tlon.domain.inference import derived_confidence
from tlon.graph.schema import NodeKind
from tlon.patterns import (
    MIN_CONFIDENCE,
    RECENCY_DAYS,
    Candidate,
    MinedPattern,
    normalise,
)

VERSION = "tension-v0.1"

#: Which method made the claim. Its own identity, like every detector, so a
#: person can reject this kind of finding without rejecting recurrence.
DETECTOR = "stated-vs-recorded"

#: Kinds that state something someone wants. Beliefs are excluded: "I am bad at
#: this" is not an intention, and reading it as one would turn a self-criticism
#: into a goal the person is failing.
STATED_KINDS = frozenset({NodeKind.VALUE, NodeKind.NEED})

#: Kinds that record something that happened.
RECORDED_KINDS = frozenset({NodeKind.ACTIVITY})

#: Days each side must appear on. Four, not three: this claim rests on an
#: absence, and an absence needs more evidence than a presence to mean anything.
MIN_DAYS_EACH = 4

#: Days the person must have written on at all. Below this the calendar is too
#: thin for "these never landed on the same day" to be about their life rather
#: than about how often they open the app.
MIN_OBSERVED_DAYS = 10

#: How many shared days independence would predict. Below three, observing none
#: is unremarkable — the two could miss each other by chance all year.
MIN_EXPECTED_TOGETHER = 3.0

#: How much of that expectation may actually have happened. A quarter keeps the
#: finding to pairs that are *strikingly* apart rather than merely uncorrelated.
MAX_OBSERVED_RATIO = 0.25


@dataclass(frozen=True)
class Tension:
    """Something named and something done that stay apart in the record."""

    stated_node_id: UUID
    recorded_node_id: UUID
    stated_kind: NodeKind
    recorded_kind: NodeKind
    stated_label: str
    recorded_label: str
    confidence: float
    #: Distinct days each side was written about.
    stated_days: int
    recorded_days: int
    #: Days both appeared. Usually zero, and never more than a quarter of what
    #: independence predicted.
    together_days: int
    #: What independence predicted, kept so the claim can be audited rather than
    #: taken on trust.
    expected_together: float
    #: Every entry behind either side, so the finding cites its evidence like
    #: every other inference here.
    observation_ids: tuple[UUID, ...]
    #: "" when every contributing entry recorded its timezone, " (UTC)" while any
    #: of them predates that.
    note: str

    @property
    def key(self) -> str:
        stated = f"{self.stated_kind}:{normalise(self.stated_label)}"
        recorded = f"{self.recorded_kind}:{normalise(self.recorded_label)}"
        return f"{stated}<->{recorded}:apart"


@dataclass(frozen=True)
class _Side:
    node_id: UUID
    kind: NodeKind
    label: str
    confidence: float
    days: frozenset[date]
    observation_ids: frozenset[UUID]
    zoned: bool


def _sides(candidates: list[Candidate], kinds: frozenset[NodeKind]) -> list[_Side]:
    grouped: dict[tuple[NodeKind, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        if candidate.kind not in kinds:
            continue
        label = normalise(candidate.label)
        if label:
            grouped[(candidate.kind, label)].append(candidate)

    sides = []
    for (kind, _), members in grouped.items():
        newest = max(members, key=lambda member: member.observed_on)
        sides.append(
            _Side(
                # The oldest node represents the group, matching what
                # consolidation keeps, so a later merge does not orphan this.
                node_id=min(member.node_id for member in members),
                kind=kind,
                label=newest.label,
                confidence=min(member.confidence for member in members),
                days=frozenset(member.observed_on for member in members),
                observation_ids=frozenset(member.observation_id for member in members),
                zoned=all(member.zoned for member in members),
            )
        )
    return sorted(sides, key=lambda side: (str(side.kind), normalise(side.label)))


def describe(finding: Tension) -> str:
    """The two counts and the overlap, and nothing else.

    Deliberately flat. Every word that could carry a judgement — *despite*,
    *even though*, *but*, *only* — has been kept out, because the person is
    reading a sentence about their own life and the arithmetic is enough.
    """
    stated_days = f"{finding.stated_days} days"
    recorded_days = f"{finding.recorded_days} days"
    if finding.together_days == 0:
        overlap = "never in the same entry"
    elif finding.together_days == 1:
        overlap = "in the same entry once"
    else:
        overlap = f"in the same entry {finding.together_days} times"
    return (
        f"{finding.stated_label} came up on {stated_days}, "
        f"{finding.recorded_label} on {recorded_days}, {overlap}{finding.note}"
    )


def to_pattern(finding: Tension) -> MinedPattern:
    """Adapt to the shared durable Pattern contract, like every other detector.

    `occurrences` counts the entries this rests on, as it does everywhere else —
    not the times the two coincided. The schema requires a pattern to have
    occurred at least once, and it is right to: a claim that happened zero times
    is not a pattern. What happened zero times here is the *overlap*, which is
    the finding's content rather than its weight, and it is stated in the label
    where a person will read it.
    """
    return MinedPattern(
        kind=NodeKind.PATTERN,
        label=describe(finding),
        confidence=finding.confidence,
        key=finding.key,
        observation_ids=finding.observation_ids,
        node_ids=tuple(sorted((finding.stated_node_id, finding.recorded_node_id))),
        # Days either side was written about, counted once.
        distinct_days=finding.stated_days + finding.recorded_days - finding.together_days,
    )


def mine(
    candidates: list[Candidate],
    observed_days: set[date],
    as_of: date | None = None,
) -> list[Tension]:
    """Pairs that stayed apart where the record gave them every chance not to.

    `observed_days` is every day the person wrote, including entries that
    produced nothing patternable. It is the denominator, and using anything else
    would let a gap in journalling masquerade as a gap in someone's life.
    """
    if not candidates or len(observed_days) < MIN_OBSERVED_DAYS:
        return []
    if as_of is None:
        as_of = max(observed_days)
    cutoff = as_of - timedelta(days=RECENCY_DAYS)
    total = len(observed_days)

    stated = [side for side in _sides(candidates, STATED_KINDS) if len(side.days) >= MIN_DAYS_EACH]
    recorded = [
        side for side in _sides(candidates, RECORDED_KINDS) if len(side.days) >= MIN_DAYS_EACH
    ]

    findings: list[Tension] = []
    for left in stated:
        for right in recorded:
            together = left.days & right.days
            expected = len(left.days) * len(right.days) / total
            if expected < MIN_EXPECTED_TOGETHER:
                continue
            if len(together) > expected * MAX_OBSERVED_RATIO:
                continue
            # Present tense, like every other claim here. A separation that
            # stopped being written about is not something to keep asserting.
            if max(max(left.days), max(right.days)) < cutoff:
                continue

            confidence = derived_confidence([left.confidence, right.confidence])
            if confidence < MIN_CONFIDENCE:
                continue

            findings.append(
                Tension(
                    stated_node_id=left.node_id,
                    recorded_node_id=right.node_id,
                    stated_kind=left.kind,
                    recorded_kind=right.kind,
                    stated_label=left.label,
                    recorded_label=right.label,
                    confidence=confidence,
                    stated_days=len(left.days),
                    recorded_days=len(right.days),
                    together_days=len(together),
                    expected_together=expected,
                    observation_ids=tuple(sorted(left.observation_ids | right.observation_ids)),
                    # A day count is only as local as its vaguer side.
                    note="" if left.zoned and right.zoned else " (UTC)",
                )
            )

    # Strongest first: the widest gap between what was expected and what
    # happened, then the most evidence behind it.
    return sorted(
        findings,
        key=lambda finding: (
            -(finding.expected_together - finding.together_days),
            -(finding.stated_days + finding.recorded_days),
            finding.stated_label,
            finding.recorded_label,
        ),
    )

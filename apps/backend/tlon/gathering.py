"""Words that are still gathering: almost, but not yet, findings.

Mining has floors on purpose: three distinct entries across separate days before
the word "pattern" is earned. But a floor that only speaks when it is crossed has
a silence problem — someone whose jaw tightened twice sees nothing at all, and
silence reads as "nothing is here", which is itself a false claim. The record
does contain something: a word that came back, not enough times to call a
pattern.

So this module reports the almost. It is deliberately narrower than mining's
inverse: only candidates sitting exactly one entry short of the recurrence floor,
already spread across the required distinct days, recent enough that the claim
would still be present tense if it crossed the floor tomorrow. Everything else
that fails mining fails for reasons a hint must not paper over — two mentions in
one sitting is an echo, not a pattern taking shape; five mentions from two months
ago is not "gathering", it is over.

Nothing here creates anything. No rows, no edges, no confidence numbers beyond
what the underlying readings already carry — the response says what was seen, how
many times, and what would still be needed. It is computed on request, like every
other view of the graph, and it can never turn into a pattern by being looked at.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from tlon.domain.inference import derived_confidence
from tlon.patterns import (
    MIN_CONFIDENCE,
    MIN_DISTINCT_DAYS,
    MIN_OBSERVATIONS,
    PATTERNABLE_KINDS,
    RECENCY_DAYS,
    Candidate,
    normalise,
)

#: A hint exists exactly one entry short of the real floor — close enough to be
#: worth noticing, far enough that nobody could mistake it for a claim.
GATHERING_OBSERVATIONS = MIN_OBSERVATIONS - 1

DETECTOR = "gathering"


@dataclass(frozen=True)
class GatheringCandidate:
    """A word coming back, one honest entry short of a finding."""

    kind: str
    #: The person's own most recent phrasing, as mining names things.
    label: str
    observations: int
    distinct_days: int
    #: What the real detector requires, so the gap is stated rather than hidden.
    observations_needed: int
    days_needed: int
    last_seen_on: date


def gathering(
    candidates: list[Candidate],
    held_keys: set[str] | None = None,
    as_of: date | None = None,
) -> list[GatheringCandidate]:
    """Candidates one entry short of a pattern, strongest-first.

    Pure and deterministic, like `mine`. `held_keys` carries the keys of
    patterns already stored (`kind:normalised`); a key that already earned a
    finding is never also hinted at. `as_of` defaults to the most recent entry —
    silence is not evidence, here as everywhere else.
    """
    if not candidates:
        return []
    if as_of is None:
        as_of = max(candidate.observed_on for candidate in candidates)
    cutoff = as_of - timedelta(days=RECENCY_DAYS)
    held = held_keys or set()

    grouped: dict[tuple[str, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        if candidate.kind not in PATTERNABLE_KINDS:
            continue
        key_label = normalise(candidate.label)
        if not key_label:
            continue
        grouped[(candidate.kind.value, key_label)].append(candidate)

    formed: list[GatheringCandidate] = []
    for (kind_value, _normalised), members in grouped.items():
        # Anything that already mined into a stored pattern keeps its own name;
        # a hint beside it would double-count the same fact.
        if f"{kind_value}:{_normalised}" in held:
            continue

        observation_ids = {member.observation_id for member in members}
        days = {member.observed_on for member in members}
        if len(observation_ids) != GATHERING_OBSERVATIONS:
            continue
        # Two mentions in one sitting is one thought said twice. Without the day
        # spread this would hint at echoes, which mining rightly refuses.
        if len(days) < MIN_DISTINCT_DAYS:
            continue
        # Recency uses the same window and the same default clock as mining: a
        # hint must be something that could still become true.
        if max(days) < cutoff:
            continue
        if derived_confidence([member.confidence for member in members]) < MIN_CONFIDENCE:
            continue

        label = max(members, key=lambda m: m.observed_on).label
        formed.append(
            GatheringCandidate(
                kind=kind_value,
                label=label,
                observations=len(observation_ids),
                distinct_days=len(days),
                observations_needed=MIN_OBSERVATIONS,
                days_needed=MIN_DISTINCT_DAYS,
                last_seen_on=max(days),
            )
        )

    # Deterministic for its own sake: most recent first, then most evidence,
    # then the label itself.
    formed.sort(key=lambda c: (-c.last_seen_on.toordinal(), -c.observations, c.label))
    return formed

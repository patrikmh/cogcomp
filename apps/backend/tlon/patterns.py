"""Pattern mining: what keeps coming back.

A `Pattern` is the first thing in this system that makes a claim about someone
across time rather than about one entry. "You said this once" is a fact; "this
keeps happening to you" is a judgement, and it is the kind of judgement people
take seriously about themselves. So the bar here is deliberately higher than
anywhere else in the pipeline.

**Matching is exact, on normalised labels.** Not embeddings, not an LLM grouping
pass. Semantic clustering would find more patterns and would also invent them:
deciding that "tired" and "hollowed out" and "flat" are the same thing is an
interpretation, and once it is wrong the person is looking at a recurring pattern
they never had. Exact matching under-reports, which is the right direction to be
wrong in. Better matching belongs behind an ADR and an embedding model, not
behind a similarity threshold picked by feel.

**Recurrence is counted in distinct entries and distinct days.** Saying the same
thing three times in one sitting is one thought, not a pattern. Requiring
separate days is what makes it a pattern rather than an echo.

**Confidence never exceeds its weakest input.** A pattern built from three
low-confidence guesses is a low-confidence pattern, however many times it
appears — the recurrence count does not launder the uncertainty underneath.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from tlon.domain.inference import derived_confidence
from tlon.graph.schema import NodeKind

PROMPT_VERSION = "patterns-v0.1"

#: Kinds worth looking for recurrence in. Thoughts and Events are excluded on
#: purpose: a Thought recurring verbatim is usually a phrasing coincidence, and
#: an Event is by definition a single occurrence.
PATTERNABLE_KINDS = frozenset(
    {
        NodeKind.EMOTION,
        NodeKind.NEED,
        NodeKind.VALUE,
        NodeKind.BELIEF,
        NodeKind.PERSON,
        NodeKind.PLACE,
        NodeKind.ACTIVITY,
    }
)

#: How many distinct entries a thing must appear in. Three, not two: two is a
#: coincidence often enough that calling it a pattern would cheapen the word.
MIN_OBSERVATIONS = 3

#: And across how many distinct days. Three mentions in one evening is one mood,
#: not a pattern.
MIN_DISTINCT_DAYS = 2


@dataclass(frozen=True)
class Candidate:
    """One inferred node that might contribute to a pattern."""

    node_id: UUID
    kind: NodeKind
    label: str
    confidence: float
    observation_id: UUID
    observed_on: date


@dataclass(frozen=True)
class MinedPattern:
    kind: NodeKind
    label: str
    confidence: float
    #: Every observation this pattern rests on. The explain screen shows all of
    #: them, which is the whole point: a pattern is only meaningful alongside the
    #: entries that produced it.
    observation_ids: tuple[UUID, ...]
    #: The inferred nodes that recurred, so SUPPORTS edges can be drawn.
    node_ids: tuple[UUID, ...]
    distinct_days: int

    @property
    def occurrences(self) -> int:
        return len(self.observation_ids)


def normalise(label: str) -> str:
    """Fold trivial differences that are not differences.

    Case and surrounding punctuation only. Deliberately not stemming or synonym
    handling — those are interpretation, and this function's job is to avoid
    treating "Tired" and "tired." as two separate things, not to decide what
    words mean.
    """
    return re.sub(r"[^\w\s]", "", label.strip().lower())


def mine(candidates: list[Candidate]) -> list[MinedPattern]:
    """Find recurrences. Returns patterns strongest-first.

    Pure and deterministic: the same graph always yields the same patterns, which
    matters because a pattern that appears and disappears between runs is worse
    than no pattern at all.
    """
    grouped: dict[tuple[NodeKind, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        if candidate.kind not in PATTERNABLE_KINDS:
            continue
        key = (candidate.kind, normalise(candidate.label))
        if not key[1]:
            continue
        grouped[key].append(candidate)

    patterns: list[MinedPattern] = []
    for (kind, _), members in grouped.items():
        observation_ids = {member.observation_id for member in members}
        days = {member.observed_on for member in members}

        if len(observation_ids) < MIN_OBSERVATIONS or len(days) < MIN_DISTINCT_DAYS:
            continue

        # The user's own most recent phrasing, rather than a normalised or
        # invented label. The record should read in their words.
        label = max(members, key=lambda m: m.observed_on).label

        patterns.append(
            MinedPattern(
                kind=kind,
                label=label,
                # Never stronger than the weakest thing it rests on. Recurrence
                # does not launder the uncertainty underneath it.
                confidence=derived_confidence([m.confidence for m in members]),
                observation_ids=tuple(sorted(observation_ids)),
                node_ids=tuple(sorted(member.node_id for member in members)),
                distinct_days=len(days),
            )
        )

    # Most-recurring first, then most confident, then label — fully determined,
    # so the ordering never shifts between identical runs.
    patterns.sort(key=lambda p: (-p.occurrences, -p.confidence, p.label))
    return patterns


def describe(pattern: MinedPattern) -> str:
    """A plain statement of what was counted, for the UI.

    States the count and leaves the meaning alone. "Came up in 4 entries across
    3 days" is a fact about the graph; what it means is the person's to decide.
    """
    entries = "entry" if pattern.occurrences == 1 else "entries"
    days = "day" if pattern.distinct_days == 1 else "days"
    return f"Came up in {pattern.occurrences} {entries} across {pattern.distinct_days} {days}"

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
appears — the recurrence count does not launder the uncertainty underneath. Below
`MIN_CONFIDENCE` it is not reported at all: a claim nobody should act on is not
improved by being made repeatedly.

**A pattern is present tense, so it can end.** Counting all of history without a
recency rule meant evidence never aged out, and something that had not come up in
two months was still reported as recurring. Strength still comes from the whole
record; being *current* comes from the last `RECENCY_DAYS`. A pattern that stops
coming up goes dormant rather than being deleted — "this used to keep happening"
is worth being able to say, and it is only sayable if the claim was withdrawn
honestly when it stopped.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from uuid import UUID

from tlon.domain.inference import derived_confidence
from tlon.graph.schema import NodeKind

PROMPT_VERSION = "patterns-v0.1"

#: Which method made the claim. Recorded on every pattern so that later detectors
#: — co-occurrence, periodicity, semantic clustering — can coexist with this one
#: without their findings being read as the same kind of statement. This one
#: counts identical labels, which is the weakest claim available and therefore
#: the one that needs the least trust from the reader.
DETECTOR = "exact-label"

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

#: Below this, a recurrence is not reported at all. Recurrence must not launder
#: weak evidence: five hesitant readings at 0.2 are not one confident finding,
#: they are five hesitant readings, and presenting their repetition as a pattern
#: about someone attaches a claim to material that never supported one. The
#: derived confidence already stays low — this is the separate decision not to
#: raise the subject.
MIN_CONFIDENCE = 0.35

#: How long a pattern goes unmentioned before it stops being claimed.
#:
#: A pattern is present tense. "This keeps happening to you" is a statement about
#: someone's life now, and until this existed the system could not withdraw one:
#: mining counted all of history, so evidence never aged out and a thing that had
#: not come up in two months was still being reported as recurring. That is the
#: failure mode with the longest half-life, because it gets worse the longer
#: someone uses the product.
#:
#: Four weeks is long enough that an ordinary quiet fortnight does not retire
#: something real, and short enough that a finished chapter closes.
RECENCY_DAYS = 28


@dataclass(frozen=True)
class Candidate:
    """One inferred node that might contribute to a pattern."""

    node_id: UUID
    kind: NodeKind
    label: str
    confidence: float
    observation_id: UUID
    #: The day this belongs to in the writer's own calendar where that is known,
    #: and in UTC where it is not.
    observed_on: date
    #: Whether `observed_on` came from a timezone the person actually recorded.
    #: False for everything written before entries carried one, which is why the
    #: calendar detectors still hedge their labels on that evidence.
    zoned: bool = False
    #: The moment it was written, in the same calendar as `observed_on`. Every
    #: detector above the day level ignores it; the within-day one cannot exist
    #: without it. Optional so a detector that only needs days can build a
    #: Candidate without inventing a time.
    observed_at: datetime | None = None


def calendar_note(members: Iterable[Candidate]) -> str:
    """The hedge a calendar claim owes its reader.

    A weekday or a gap between days is only a fact about the person's week if
    the days were counted in their own timezone. While any of the evidence
    predates timezone capture, the claim says so; once all of it carries a zone,
    the hedge disappears rather than being repeated out of habit.
    """
    return "" if all(member.zoned for member in members) else " (UTC)"


@dataclass(frozen=True)
class MinedPattern:
    kind: NodeKind
    label: str
    confidence: float
    #: Stable across runs. Built from the normalised label rather than the
    #: displayed one, so re-phrasing the same recurring thing keeps it the same
    #: pattern instead of retiring one claim and announcing a new one.
    key: str
    #: Every observation this pattern rests on. The explain screen shows all of
    #: them, which is the whole point: a pattern is only meaningful alongside the
    #: entries that produced it.
    observation_ids: tuple[UUID, ...]
    #: The inferred nodes that recurred, so SUPPORTS edges can be drawn.
    node_ids: tuple[UUID, ...]
    distinct_days: int
    occurrence_count: int | None = None

    @property
    def occurrences(self) -> int:
        if self.occurrence_count is not None:
            return self.occurrence_count
        return len(self.observation_ids)


def normalise(label: str) -> str:
    """Fold trivial differences that are not differences.

    Case and surrounding punctuation only. Deliberately not stemming or synonym
    handling — those are interpretation, and this function's job is to avoid
    treating "Tired" and "tired." as two separate things, not to decide what
    words mean.
    """
    return re.sub(r"[^\w\s]", "", label.strip().lower())


def mine(candidates: list[Candidate], as_of: date | None = None) -> list[MinedPattern]:
    """Find recurrences that still hold. Returns patterns strongest-first.

    Pure and deterministic: the same graph and the same `as_of` always yield the
    same patterns, which matters because a pattern that appears and disappears
    between runs is worse than no pattern at all.

    `as_of` defaults to the most recent entry rather than today, and that is a
    deliberate reading of silence. Someone who has not written for three months
    has not stopped feeling things — they have stopped writing. Dating recency
    from the last entry means a pattern goes dormant when the person keeps writing
    and this stops coming up, not when they put the app down. Silence is not
    evidence, here as everywhere else in the system.
    """
    if not candidates:
        return []
    if as_of is None:
        as_of = max(candidate.observed_on for candidate in candidates)
    cutoff = as_of - timedelta(days=RECENCY_DAYS)

    grouped: dict[tuple[NodeKind, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        if candidate.kind not in PATTERNABLE_KINDS:
            continue
        key = (candidate.kind, normalise(candidate.label))
        if not key[1]:
            continue
        grouped[key].append(candidate)

    patterns: list[MinedPattern] = []
    for (kind, normalised), members in grouped.items():
        observation_ids = {member.observation_id for member in members}
        days = {member.observed_on for member in members}

        if len(observation_ids) < MIN_OBSERVATIONS or len(days) < MIN_DISTINCT_DAYS:
            continue

        # Still going, or finished? The whole history is counted — a pattern's
        # strength is everything it ever rested on — but it has to have come up
        # recently to still be claimed in the present tense.
        if max(days) < cutoff:
            continue

        confidence = derived_confidence([member.confidence for member in members])
        if confidence < MIN_CONFIDENCE:
            continue

        # The user's own most recent phrasing, rather than a normalised or
        # invented label. The record should read in their words.
        label = max(members, key=lambda m: m.observed_on).label

        patterns.append(
            MinedPattern(
                kind=kind,
                label=label,
                # Kind-qualified: the same word can recur as an Emotion and as an
                # Activity, and those are two findings, not one.
                key=f"{kind}:{normalised}",
                # Never stronger than the weakest thing it rests on. Recurrence
                # does not launder the uncertainty underneath it.
                confidence=confidence,
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

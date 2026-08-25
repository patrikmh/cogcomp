"""Findings that rest on the same thing, shown as one thread.

The detectors each make one narrow claim: this recurs, it recurs on Thursdays,
it comes before that, these two stay apart. The Patterns screen shows each
finding on its own row, which is right for checking a claim and wrong for seeing
a life — five rows that all rest on the same word read as five unrelated facts,
when they are one subject seen from several directions at once.

This module groups them. It is deliberately the least ambitious thing in the
pipeline, because it makes **no claim at all**. Nothing is inferred, nothing is
mined, no new finding is created. Two findings sit in the same thread when the
nodes they cite include the same normalised label — the same rule
`patterns.normalise` already uses to decide that "Tired" and "tired." are one
thing. If the grouping is wrong, it is wrong in the direction of splitting, never
merging: nothing was claimed that a person cannot undo by reading one row.

**A thread is named by its subjects, not summarised.** A group of findings could
be given a heading — "work stress", say — but an invented phrase is an
interpretation wearing a title, and this system does not do that anywhere it can
avoid it. What can be stated is which words connect the members, in the forms
the person's own record actually uses. That is what a thread's subjects are.

**Threads may chain.** One finding citing both "dread" and "sleep" joins the
dread thread and the sleep thread, and through it those two threads are one.
Both subjects are then named, because hiding the bridge would make the group
look simpler than the arithmetic that produced it. A reader who finds a thread
surprising can walk every member and see exactly which shared word put each of
them there.

**Two members minimum.** A single finding is already on the screen, once. Calling
it a thread would add a word without adding a fact.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from tlon.patterns import normalise

VERSION = "threads-v0.1"

#: Below this a group of findings is just the list the screen already shows.
MIN_MEMBERS = 2


@dataclass(frozen=True)
class Link:
    """One (finding, supporting label) pair, straight from the stored graph."""

    pattern_id: UUID
    detector: str
    #: The finding's own displayed label, in the person's words.
    label: str
    confidence: float
    tentative: bool
    occurrences: int
    #: A raw supporting-node label. This is the only thing the grouping reads.
    subject_label: str
    #: Carried through to the member card, which reads the same counts the
    #: flat list does — a thread member should not be quieter about its
    #: arithmetic than the same finding shown alone.
    distinct_days: int = 3


@dataclass(frozen=True)
class ThreadMember:
    pattern_id: UUID
    detector: str
    label: str
    confidence: float
    tentative: bool
    occurrences: int
    distinct_days: int


@dataclass(frozen=True)
class Thread:
    #: The words that connect the members, most-used phrasing first.
    subjects: tuple[str, ...]
    members: tuple[ThreadMember, ...]


def _display_forms(subjects: dict[str, list[str]]) -> list[str]:
    """For each normalised subject, the raw phrasing the record itself uses."""
    forms = []
    for normalised in sorted(subjects):
        # Most frequent raw form wins; ties go to the alphabetically first so
        # the same evidence always names a thread the same way.
        counts: dict[str, int] = {}
        for raw in subjects[normalised]:
            counts[raw.strip()] = counts.get(raw.strip(), 0) + 1
        best = min(counts.items(), key=lambda item: (-item[1], item[0]))
        forms.append(best[0])
    return forms


def threads(links: list[Link]) -> list[Thread]:
    """Group findings by the labels their evidence shares.

    Pure and deterministic: the same links always yield the same threads in the
    same order, for the same reason mining is — a navigation aid that reshuffles
    between looks teaches people not to trust it.
    """
    # Union-find over findings. Two findings join when some normalised label
    # appears among both of their supporting nodes.
    parent: dict[UUID, UUID] = {}

    def find(x: UUID) -> UUID:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a: UUID, b: UUID) -> None:
        parent.setdefault(a, a)
        parent.setdefault(b, b)
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    by_pattern: dict[UUID, Link] = {}
    by_subject: dict[str, set[UUID]] = {}
    for link in links:
        parent.setdefault(link.pattern_id, link.pattern_id)
        by_pattern[link.pattern_id] = link
        subject = normalise(link.subject_label)
        if not subject:
            continue
        group = by_subject.setdefault(subject, set())
        for other in group:
            union(link.pattern_id, other)
        group.add(link.pattern_id)

    # Subjects that actually connect: a label resting under only one finding
    # did not group anything, and naming it would dress a member up as a bridge.
    components: dict[UUID, list[Link]] = {}
    connecting: dict[UUID, dict[str, list[str]]] = {}
    for subject, pattern_ids in by_subject.items():
        if len(pattern_ids) < MIN_MEMBERS:
            continue
        root = find(next(iter(pattern_ids)))
        connecting.setdefault(root, {})[subject] = [
            link.subject_label for link in links if link.pattern_id in pattern_ids
        ]

    for pattern_id, pattern_links in by_pattern.items():
        components.setdefault(find(pattern_id), []).append(pattern_links)

    result: list[Thread] = []
    for root, members in components.items():
        if len(members) < MIN_MEMBERS or root not in connecting:
            continue
        ordered = sorted(
            members,
            key=lambda m: (-m.occurrences, -m.confidence, m.label),
        )
        result.append(
            Thread(
                subjects=tuple(_display_forms(connecting[root])),
                members=tuple(
                    ThreadMember(
                        pattern_id=m.pattern_id,
                        detector=m.detector,
                        label=m.label,
                        confidence=m.confidence,
                        tentative=m.tentative,
                        occurrences=m.occurrences,
                        distinct_days=m.distinct_days,
                    )
                    for m in ordered
                ),
            )
        )

    result.sort(key=lambda t: (-len(t.members), t.subjects))
    return result

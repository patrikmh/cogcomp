"""Temporal reasoning: what changed, and nothing more.

The graph already knows what you wrote and what was drawn from it. This is the
first thing that compares two stretches of time and says they differ. That is a
genuinely new kind of claim, and it is the one most likely to be misread — so the
constraints here are tighter than anywhere else in the system.

**It reports counts, never direction.** "Came up on 4 of the last 7 days, and on
1 of the 7 before" is a fact about the record. "You're getting worse" and "that's
improving" are diagnoses, and the vocabulary to express either does not exist in
this module. `Shift` has `MORE`, `LESS`, `NEW` and `ABSENT` — arithmetic words —
because a person is the only one who knows whether feeling something more often
is a bad sign or the point of the exercise.

**Windows are adjacent and equal.** The recent window is compared against the one
immediately before it, of the same length. Comparing an arbitrary recent stretch
against "everything before" is how you manufacture a trend: a longer baseline
dilutes the earlier rate and makes anything recent look like a spike.

**Silence is not evidence.** A window with no entries in it is not a window in
which nothing was felt — it is a window in which nobody wrote. Comparing against
one produces a confident-looking claim resting on a person having been too busy
to open the app, so it is refused outright.

**Nothing is claimed from thin material.** Below `MIN_OCCURRENCES` across both
windows there is no comparison to make, only noise to dress up.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from enum import StrEnum

from tlon.graph.schema import NodeKind
from tlon.patterns import PATTERNABLE_KINDS, normalise

VERSION = "temporal-v0.1"

#: Length of each comparison window, in days. A week against the week before:
#: long enough to survive one quiet day, short enough that "lately" still means
#: lately.
WINDOW_DAYS = 7

#: Total occurrences across both windows before anything is said at all.
MIN_OCCURRENCES = 3

#: Days that must carry at least one entry, in *each* window, before the two are
#: comparable. Without this, a week containing a single entry becomes a baseline.
MIN_ACTIVE_DAYS = 2

#: How much the rate must move to be worth reporting, as a fraction. Below this
#: the difference is a rounding artefact of when someone happened to write.
MIN_DELTA = 0.34


class Shift(StrEnum):
    """How a thing's frequency moved between two windows.

    Deliberately arithmetic. There is no `IMPROVED` or `WORSENED` here and there
    should never be — the same change means opposite things to different people,
    and this module has no way to know which.
    """

    NEW = "new"
    MORE = "more"
    LESS = "less"
    ABSENT = "absent"
    STEADY = "steady"


@dataclass(frozen=True)
class Occurrence:
    """One inferred node, on the day of the entry that produced it."""

    kind: NodeKind
    label: str
    on: date
    confidence: float


@dataclass(frozen=True)
class Change:
    kind: NodeKind
    #: The person's own most recent wording.
    label: str
    shift: Shift
    recent_days: int
    earlier_days: int
    #: Weakest confidence among the occurrences this rests on. A change built from
    #: shaky readings is a shaky change, however clean the arithmetic looks.
    confidence: float

    @property
    def occurrences(self) -> int:
        return self.recent_days + self.earlier_days

    def describe(self) -> str:
        """The count, in words, with no verdict attached.

        Reads the same whether the thing is welcome or not, because this module
        cannot tell and should not guess.
        """
        recent = f"{self.recent_days} of the last {WINDOW_DAYS} days"
        earlier = f"{self.earlier_days} of the {WINDOW_DAYS} before"
        if self.shift is Shift.NEW:
            return f"Came up on {recent}. Not in {earlier}."
        if self.shift is Shift.ABSENT:
            return f"Not in {recent}. Came up on {earlier}."
        return f"Came up on {recent}, and on {earlier}."


@dataclass(frozen=True)
class Window:
    start: date
    end: date

    def holds(self, day: date) -> bool:
        return self.start <= day <= self.end


def windows(today: date, length: int = WINDOW_DAYS) -> tuple[Window, Window]:
    """The recent window and the equal one immediately before it."""
    recent_start = today - timedelta(days=length - 1)
    earlier_end = recent_start - timedelta(days=1)
    return (
        Window(recent_start, today),
        Window(earlier_end - timedelta(days=length - 1), earlier_end),
    )


def _active_days(days: set[date], window: Window) -> int:
    return sum(1 for day in days if window.holds(day))


def comparable(active_days: set[date], today: date, length: int = WINDOW_DAYS) -> bool:
    """Whether the two windows hold enough writing to be compared at all.

    Exported because callers need to tell "we could not look" from "we looked and
    nothing moved" — an empty result means both, and only one of them says
    anything about the person. Asked here rather than re-derived by each caller,
    so the rule exists in exactly one place.
    """
    recent, earlier = windows(today, length)
    return (
        _active_days(active_days, recent) >= MIN_ACTIVE_DAYS
        and _active_days(active_days, earlier) >= MIN_ACTIVE_DAYS
    )


def compare(
    occurrences: list[Occurrence],
    active_days: set[date],
    today: date,
    length: int = WINDOW_DAYS,
) -> list[Change]:
    """What moved between the two windows.

    `active_days` is every day the person wrote anything at all — supplied
    separately because it is the only way to tell "did not feel it" from "did not
    write". Returns nothing at all when either window is too quiet to compare.
    """
    recent, earlier = windows(today, length)

    # Refused rather than reported: a claim resting on a week nobody wrote in is
    # a claim about the person's schedule, not about them.
    if not comparable(active_days, today, length):
        return []

    grouped: dict[tuple[NodeKind, str], list[Occurrence]] = defaultdict(list)
    for occurrence in occurrences:
        if occurrence.kind not in PATTERNABLE_KINDS:
            continue
        key = (occurrence.kind, normalise(occurrence.label))
        if not key[1]:
            continue
        if recent.holds(occurrence.on) or earlier.holds(occurrence.on):
            grouped[key].append(occurrence)

    changes: list[Change] = []
    for (kind, _), members in grouped.items():
        recent_days = {m.on for m in members if recent.holds(m.on)}
        earlier_days = {m.on for m in members if earlier.holds(m.on)}
        total = len(recent_days) + len(earlier_days)
        if total < MIN_OCCURRENCES:
            continue

        shift = _classify(len(recent_days), len(earlier_days), length)
        if shift is Shift.STEADY:
            continue

        changes.append(
            Change(
                kind=kind,
                # Their own most recent wording, not a normalised form.
                label=max(members, key=lambda m: m.on).label,
                shift=shift,
                recent_days=len(recent_days),
                earlier_days=len(earlier_days),
                # Never stronger than the weakest reading underneath it.
                confidence=min(m.confidence for m in members),
            )
        )

    # Biggest movement first, then most evidence, then label — fully determined,
    # so the same graph always produces the same order.
    changes.sort(key=lambda c: (-abs(c.recent_days - c.earlier_days), -c.occurrences, c.label))
    return changes


def _classify(recent: int, earlier: int, length: int) -> Shift:
    if earlier == 0:
        return Shift.NEW if recent > 0 else Shift.STEADY
    if recent == 0:
        return Shift.ABSENT
    # Compared as a fraction of the window, so the threshold means the same thing
    # regardless of how long the window is.
    delta = (recent - earlier) / length
    if delta >= MIN_DELTA:
        return Shift.MORE
    if delta <= -MIN_DELTA:
        return Shift.LESS
    return Shift.STEADY

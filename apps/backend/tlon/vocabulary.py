"""How many different words someone has for how they feel, week by week.

Every other reading in this system is about *content* — this keeps happening,
these things travel together, that came before this. This one is about
*capacity*, and it is the only thing here that can honestly be shown going up.

The construct is emotion granularity: the degree to which someone distinguishes
between emotional states rather than reporting undifferentiated good and bad. It
is a measured individual difference with a real literature behind it, it is
extractable from text, and — the part that matters for a journal — it improves
with practice. Repeatedly putting words to states raises emotional clarity on
its own, independent of how often anyone is asked.

Three rules keep this a count rather than a verdict.

**It reports words, never a level.** "Fourteen different words across nine
entries" is a fact about a week. "Your emotional granularity is low" is a claim
about a person, made on a measure that was never validated for individual
diagnosis, and this module must never produce a sentence like it.

**A quiet week is a quiet week.** Fewer words in a week with two entries is
arithmetic, not decline. The entry count travels with the vocabulary count
everywhere it is shown, so the two can never be read apart.

**New words are named, not scored.** A word used for the first time is concrete
and checkable — the person can go and read the entry. A trend line over weeks
would be the same information turned into a performance.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from tlon.graph.schema import NodeKind

#: Kinds that count as a word for a state. Emotions and needs are how people
#: name what they are feeling and wanting; beliefs and thoughts are what they
#: are thinking *about*, which is a different vocabulary and a different claim.
FELT_KINDS = frozenset({NodeKind.EMOTION, NodeKind.NEED})


@dataclass(frozen=True)
class Mention:
    """One label, on one day, from one entry."""

    kind: NodeKind
    label: str
    day: date
    observation_id: object


@dataclass(frozen=True)
class Week:
    """One week's vocabulary, with the material it came from beside it."""

    start: date
    entries: int
    #: Distinct labels used this week.
    words: tuple[str, ...]
    #: Of those, the ones never used in any earlier week in this window.
    first_time: tuple[str, ...]

    @property
    def distinct(self) -> int:
        return len(self.words)


def weeks_of(mentions: list[Mention], starts: list[date], entries: dict[date, int]) -> list[Week]:
    """Vocabulary per week, oldest first.

    `starts` are the Monday dates to report, and `entries` how many entries each
    of those weeks holds — supplied rather than derived, because a week with no
    emotional vocabulary at all still has to report its entry count. Otherwise a
    fortnight of writing about work would look like a fortnight of not writing.
    """
    by_week: dict[date, set[str]] = {start: set() for start in starts}
    for mention in mentions:
        start = _monday(mention.day)
        if start in by_week:
            by_week[start].add(mention.label)

    seen: set[str] = set()
    weeks = []
    for start in sorted(starts):
        words = sorted(by_week[start])
        # First time *within this window*, and the caller is told the window, so
        # the claim stays checkable. A word first used two years ago and again
        # last week is not new, and this will not say it is — provided the window
        # reaches back that far.
        first_time = tuple(word for word in words if word not in seen)
        seen.update(words)
        weeks.append(
            Week(
                start=start,
                entries=entries.get(start, 0),
                words=tuple(words),
                first_time=first_time,
            )
        )
    return weeks


def _monday(day: date) -> date:
    return day.fromordinal(day.toordinal() - day.weekday())


def describe(week: Week) -> str:
    """One sentence of arithmetic, or a plain statement that there is none.

    Deliberately flat, and deliberately paired: the word count never appears
    without the entry count that produced it.
    """
    if week.entries == 0:
        return "Nothing written this week."
    if week.distinct == 0:
        entries = "1 entry" if week.entries == 1 else f"{week.entries} entries"
        return f"{entries}, none of them naming a feeling."

    words = "1 word" if week.distinct == 1 else f"{week.distinct} different words"
    entries = "1 entry" if week.entries == 1 else f"{week.entries} entries"
    sentence = f"{words} for how you felt, across {entries}"
    if week.first_time:
        new = "1 of them" if len(week.first_time) == 1 else f"{len(week.first_time)} of them"
        sentence += f" · {new} for the first time"
    return sentence

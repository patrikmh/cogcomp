"""Temporal reasoning. Pure logic, no database.

This module makes the first claim in the system that compares two stretches of
time, which makes it the one most likely to be misread. Most of these tests are
therefore about what it refuses to say.
"""

from datetime import date, timedelta

from tlon.graph.schema import NodeKind
from tlon.temporal import (
    MIN_ACTIVE_DAYS,
    MIN_OCCURRENCES,
    WINDOW_DAYS,
    Change,
    Occurrence,
    Shift,
    compare,
    windows,
)

TODAY = date(2026, 8, 3)


def day(offset: int) -> date:
    """`offset` days before today. 0 is today, 7 is the first earlier-window day."""
    return TODAY - timedelta(days=offset)


def occurrence(
    offset: int,
    label: str = "dread",
    *,
    kind: NodeKind = NodeKind.EMOTION,
    confidence: float = 0.8,
) -> Occurrence:
    return Occurrence(kind=kind, label=label, on=day(offset), confidence=confidence)


def wrote_every_day() -> set[date]:
    """Someone who wrote on all fourteen days, so windows are always comparable."""
    return {day(i) for i in range(WINDOW_DAYS * 2)}


class TestWindows:
    def test_the_two_windows_are_adjacent(self):
        recent, earlier = windows(TODAY)
        assert earlier.end == recent.start - timedelta(days=1)

    def test_they_are_the_same_length(self):
        # Comparing a recent stretch against "everything before" is how you
        # manufacture a trend — a longer baseline dilutes the earlier rate.
        recent, earlier = windows(TODAY)
        span = lambda w: (w.end - w.start).days
        assert span(recent) == span(earlier) == WINDOW_DAYS - 1

    def test_the_recent_window_ends_today(self):
        recent, _ = windows(TODAY)
        assert recent.end == TODAY

    def test_a_day_belongs_to_exactly_one_window(self):
        recent, earlier = windows(TODAY)
        for offset in range(WINDOW_DAYS * 2):
            assert recent.holds(day(offset)) != earlier.holds(day(offset))


class TestWhatItRefusesToSay:
    def test_a_quiet_earlier_window_produces_nothing(self):
        # A week nobody wrote in is not a week in which nothing was felt. Any
        # claim resting on it is a claim about the person's schedule.
        active = {day(i) for i in range(WINDOW_DAYS)}
        occurrences = [occurrence(i) for i in range(WINDOW_DAYS)]
        assert compare(occurrences, active, TODAY) == []

    def test_a_quiet_recent_window_produces_nothing(self):
        active = {day(i) for i in range(WINDOW_DAYS, WINDOW_DAYS * 2)}
        occurrences = [occurrence(i) for i in range(WINDOW_DAYS, WINDOW_DAYS * 2)]
        assert compare(occurrences, active, TODAY) == []

    def test_one_active_day_is_not_a_baseline(self):
        active = {day(0), day(1), day(WINDOW_DAYS)}
        assert len(compare([occurrence(0), occurrence(1)], active, TODAY)) == 0

    def test_too_little_material_says_nothing(self):
        # Below the threshold there is no comparison to make, only noise.
        occurrences = [occurrence(0), occurrence(WINDOW_DAYS)]
        assert len(occurrences) < MIN_OCCURRENCES
        assert compare(occurrences, wrote_every_day(), TODAY) == []

    def test_a_steady_thing_is_not_reported(self):
        # Only movement is worth saying. Reporting everything every week is how a
        # report becomes wallpaper.
        occurrences = [occurrence(0), occurrence(1), occurrence(7), occurrence(8)]
        assert compare(occurrences, wrote_every_day(), TODAY) == []

    def test_nothing_outside_the_two_windows_counts(self):
        old = [occurrence(WINDOW_DAYS * 2 + i) for i in range(5)]
        assert compare([*old, occurrence(0)], wrote_every_day(), TODAY) == []

    def test_unpatternable_kinds_are_ignored(self):
        # A Thought recurring verbatim is a phrasing coincidence, and an Event is
        # by definition a single occurrence.
        for kind in (NodeKind.THOUGHT, NodeKind.EVENT):
            occurrences = [occurrence(i, kind=kind) for i in (0, 1, 2, 7, 8)]
            assert compare(occurrences, wrote_every_day(), TODAY) == [], kind

    def test_a_blank_label_is_ignored(self):
        occurrences = [occurrence(i, "   ") for i in (0, 1, 2, 7)]
        assert compare(occurrences, wrote_every_day(), TODAY) == []

    def test_no_occurrences_at_all(self):
        assert compare([], wrote_every_day(), TODAY) == []


class TestWhatItDoesSay:
    def test_something_new_is_marked_new(self):
        occurrences = [occurrence(0), occurrence(1), occurrence(2)]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        assert change.shift is Shift.NEW
        assert change.recent_days == 3
        assert change.earlier_days == 0

    def test_something_gone_is_marked_absent(self):
        occurrences = [occurrence(7), occurrence(8), occurrence(9)]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        assert change.shift is Shift.ABSENT

    def test_more_often_is_marked_more(self):
        occurrences = [occurrence(i) for i in (0, 1, 2, 3, 4)] + [occurrence(7)]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        assert change.shift is Shift.MORE

    def test_less_often_is_marked_less(self):
        occurrences = [occurrence(0)] + [occurrence(i) for i in (7, 8, 9, 10, 11)]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        assert change.shift is Shift.LESS

    def test_repeats_on_one_day_count_once(self):
        # Saying the same thing three times in one sitting is one day's worth of
        # evidence, not three.
        occurrences = [occurrence(0), occurrence(0), occurrence(0), occurrence(7)]
        assert compare(occurrences, wrote_every_day(), TODAY) == []

    def test_the_label_is_the_persons_most_recent_wording(self):
        # Variants that normalise together are one thing, labelled in the wording
        # they used last — not a normalised form they never typed.
        occurrences = [
            Occurrence(NodeKind.EMOTION, "Dread.", day(7), 0.8),
            Occurrence(NodeKind.EMOTION, "dread", day(3), 0.8),
            Occurrence(NodeKind.EMOTION, "  DREAD  ", day(2), 0.8),
            Occurrence(NodeKind.EMOTION, "dread!", day(1), 0.8),
            Occurrence(NodeKind.EMOTION, "Dread", day(0), 0.8),
        ]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        assert change.label == "Dread"

    def test_confidence_never_exceeds_the_weakest_reading(self):
        # Clean arithmetic over shaky readings is still shaky.
        occurrences = [
            occurrence(0, confidence=0.9),
            occurrence(1, confidence=0.3),
            occurrence(2, confidence=0.9),
        ]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        assert change.confidence == 0.3


class TestVocabulary:
    def test_there_is_no_word_for_better_or_worse(self):
        # The same change means opposite things to different people, and this
        # module has no way to know which. Guarding the enum itself, because a
        # future contributor adding IMPROVED is the failure mode.
        words = {shift.value for shift in Shift}
        assert words == {"new", "more", "less", "absent", "steady"}

    def test_the_description_states_counts_and_stops(self):
        occurrences = [occurrence(i) for i in (0, 1, 2, 3)] + [occurrence(7)]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        text = change.describe().lower()
        for verdict in (
            "better",
            "worse",
            "improve",
            "decline",
            "progress",
            "should",
            "keep it up",
            "well done",
        ):
            assert verdict not in text

    def test_the_description_carries_both_windows(self):
        # A count without its comparison is not a change, it is a number.
        occurrences = [occurrence(i) for i in (0, 1, 2, 3)] + [occurrence(7)]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        assert "4 of the last 7 days" in change.describe()
        assert "1 of the 7 before" in change.describe()

    def test_a_new_thing_says_it_was_not_there_before(self):
        occurrences = [occurrence(i) for i in (0, 1, 2)]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        assert "Not in" in change.describe()


class TestOrdering:
    def test_biggest_movement_first(self):
        occurrences = [
            *[occurrence(i, "dread") for i in (0, 1, 2, 3, 4)],
            *[occurrence(i, "restless") for i in (0, 1, 2, 3)],
            occurrence(7, "restless"),
        ]
        changes = compare(occurrences, wrote_every_day(), TODAY)
        assert [c.label for c in changes] == ["dread", "restless"]

    def test_the_same_input_always_orders_the_same(self):
        # A report whose order shifts between runs looks like new information.
        occurrences = [
            *[occurrence(i, "dread") for i in (0, 1, 2)],
            *[occurrence(i, "restless") for i in (0, 1, 2)],
        ]
        first = [c.label for c in compare(occurrences, wrote_every_day(), TODAY)]
        second = [c.label for c in compare(list(reversed(occurrences)), wrote_every_day(), TODAY)]
        assert first == second

    def test_different_kinds_with_one_label_stay_separate(self):
        occurrences = [
            *[occurrence(i, "rest", kind=NodeKind.NEED) for i in (0, 1, 2)],
            *[occurrence(i, "rest", kind=NodeKind.ACTIVITY) for i in (0, 1, 2)],
        ]
        changes = compare(occurrences, wrote_every_day(), TODAY)
        assert {c.kind for c in changes} == {NodeKind.NEED, NodeKind.ACTIVITY}


class TestHowMuchMovementCounts:
    """The threshold is strict on purpose, so record what it actually permits."""

    def test_a_two_day_swing_is_not_reported(self):
        # Three days versus one, in a seven-day window, is within the range that
        # a single busy week can produce. Reporting it would manufacture a trend
        # out of when someone happened to have time to write.
        occurrences = [*[occurrence(i) for i in (0, 1, 2)], occurrence(7)]
        assert compare(occurrences, wrote_every_day(), TODAY) == []

    def test_a_three_day_swing_is_reported(self):
        occurrences = [*[occurrence(i) for i in (0, 1, 2, 3)], occurrence(7)]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        assert change.shift is Shift.MORE

    def test_the_threshold_is_symmetric(self):
        # Something receding has to clear the same bar as something arriving.
        rising = [*[occurrence(i) for i in (0, 1, 2, 3)], occurrence(7)]
        falling = [occurrence(0), *[occurrence(i) for i in (7, 8, 9, 10)]]
        assert compare(rising, wrote_every_day(), TODAY)[0].shift is Shift.MORE
        assert compare(falling, wrote_every_day(), TODAY)[0].shift is Shift.LESS


class TestThresholds:
    def test_the_constants_match_the_behaviour(self):
        # Guards against a constant drifting away from what the code does.
        active = {day(0), day(WINDOW_DAYS)}
        assert len(active) < MIN_ACTIVE_DAYS * 2
        assert compare([occurrence(0), occurrence(7)], active, TODAY) == []

    def test_a_change_reports_its_own_evidence_count(self):
        occurrences = [occurrence(i) for i in (0, 1, 2, 3)] + [occurrence(7)]
        [change] = compare(occurrences, wrote_every_day(), TODAY)
        assert change.occurrences == 5
        assert isinstance(change, Change)

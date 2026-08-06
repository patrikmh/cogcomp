"""Vocabulary counts. Pure logic, no database.

The risk here is not a wrong number, it is a number that reads as a verdict. So
most of these are about what the sentence is allowed to say, and about a quiet
week never being reported as a decline.
"""

from datetime import date, timedelta
from uuid import uuid4

from tlon.graph.schema import NodeKind
from tlon.vocabulary import Mention, Week, describe, weeks_of

MONDAY = date(2026, 3, 2)
WEEKS = [MONDAY, MONDAY + timedelta(days=7), MONDAY + timedelta(days=14)]


def mention(label: str, week: int = 0, day_offset: int = 0, kind=NodeKind.EMOTION) -> Mention:
    return Mention(
        kind=kind,
        label=label,
        day=MONDAY + timedelta(days=week * 7 + day_offset),
        observation_id=uuid4(),
    )


class TestCountingWords:
    def test_distinct_words_are_counted_per_week(self):
        mentions = [mention("wired"), mention("flat"), mention("wired", day_offset=2)]

        weeks = weeks_of(mentions, WEEKS, {MONDAY: 3})

        assert weeks[0].distinct == 2
        assert weeks[0].words == ("flat", "wired")

    def test_a_word_used_again_later_is_not_new_again(self):
        mentions = [mention("wired", week=0), mention("wired", week=1)]

        weeks = weeks_of(mentions, WEEKS, {MONDAY: 1, WEEKS[1]: 1})

        assert weeks[0].first_time == ("wired",)
        assert weeks[1].first_time == ()

    def test_weeks_come_back_oldest_first(self):
        weeks = weeks_of([], WEEKS, {})

        assert [week.start for week in weeks] == WEEKS

    def test_a_week_with_entries_but_no_feeling_words_still_reports_its_entries(self):
        # A fortnight of writing about work is not a fortnight of not writing,
        # and the entry count is what keeps those apart.
        weeks = weeks_of([], WEEKS, {MONDAY: 4})

        assert weeks[0].entries == 4
        assert weeks[0].distinct == 0


class TestWhatItIsAllowedToSay:
    def test_it_states_words_and_the_entries_they_came_from(self):
        week = Week(start=MONDAY, entries=9, words=("flat", "wired"), first_time=("wired",))

        assert describe(week) == (
            "2 different words for how you felt, across 9 entries · 1 of them for the first time"
        )

    def test_it_never_grades_the_person(self):
        for week in (
            Week(start=MONDAY, entries=9, words=("flat", "wired"), first_time=()),
            Week(start=MONDAY, entries=1, words=("flat",), first_time=("flat",)),
            Week(start=MONDAY, entries=0, words=(), first_time=()),
        ):
            text = describe(week).lower()
            for verdict in (
                "low",
                "high",
                "poor",
                "rich",
                "better",
                "worse",
                "improv",
                "declin",
                "should",
                "only",
                "score",
                "level",
            ):
                assert verdict not in text

    def test_a_quiet_week_is_reported_as_quiet_not_as_decline(self):
        week = Week(start=MONDAY, entries=0, words=(), first_time=())

        assert describe(week) == "Nothing written this week."

    def test_entries_without_feeling_words_are_stated_plainly(self):
        week = Week(start=MONDAY, entries=3, words=(), first_time=())

        assert describe(week) == "3 entries, none of them naming a feeling."

    def test_singulars_read_like_english(self):
        week = Week(start=MONDAY, entries=1, words=("flat",), first_time=("flat",))

        assert describe(week) == (
            "1 word for how you felt, across 1 entry · 1 of them for the first time"
        )


class TestWhatCounts:
    def test_needs_count_as_words_for_a_state(self):
        mentions = [mention("rest", kind=NodeKind.NEED), mention("wired")]

        assert weeks_of(mentions, WEEKS, {MONDAY: 2})[0].distinct == 2

    def test_days_outside_the_window_are_ignored(self):
        mentions = [mention("wired", week=-4)]

        assert weeks_of(mentions, WEEKS, {MONDAY: 0})[0].distinct == 0

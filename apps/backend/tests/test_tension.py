"""Stated-vs-recorded separation. Pure logic, no database.

Most of these exist to stop the detector saying more than it knows. It rests on
an absence, and an absence is the easiest thing in this system to over-read — so
the tests are mostly about when it must stay quiet, and about the words it is
allowed to use when it does not.
"""

from datetime import date, timedelta
from uuid import UUID, uuid4

from tlon.graph.schema import NodeKind
from tlon.patterns import Candidate
from tlon.tension import MIN_DAYS_EACH, MIN_OBSERVED_DAYS, describe, mine, to_pattern

START = date(2026, 3, 2)  # Monday


class Journal:
    """A month of writing, built a day at a time."""

    def __init__(self) -> None:
        self.candidates: list[Candidate] = []
        self.observed_days: set[date] = set()
        self._nodes: dict[tuple[NodeKind, str], UUID] = {}

    def write(
        self,
        day: int,
        kind: NodeKind,
        label: str,
        confidence: float = 0.8,
        zoned: bool = False,
    ) -> None:
        observed_on = START + timedelta(days=day)
        self.observed_days.add(observed_on)
        self.candidates.append(
            Candidate(
                node_id=self._nodes.setdefault((kind, label), uuid4()),
                kind=kind,
                label=label,
                confidence=confidence,
                observation_id=uuid4(),
                observed_on=observed_on,
                zoned=zoned,
            )
        )

    def blank(self, *days: int) -> None:
        self.observed_days.update(START + timedelta(days=day) for day in days)


#: Nine days each across twenty-four is what it takes to clear the floor: the
#: detector wants three expected shared days before it treats none as
#: surprising, and 9 * 9 / 24 is 3.4. That is the point of the threshold — a
#: separation is only news where the record gave it many chances to be otherwise.
def apart(
    stated_days=(0, 2, 4, 6, 8, 10, 12, 14, 16),
    recorded_days=(1, 3, 5, 7, 9, 11, 13, 15, 17),
    span=24,
    **kwargs,
) -> Journal:
    """Something named and something done that never land on the same day."""
    journal = Journal()
    for day in stated_days:
        journal.write(day, NodeKind.VALUE, "rest", **kwargs)
    for day in recorded_days:
        journal.write(day, NodeKind.ACTIVITY, "working late", **kwargs)
    journal.blank(*range(span))
    return journal


class TestWhatCountsAsSeparation:
    def test_two_things_that_never_share_a_day_are_found(self):
        journal = apart()

        findings = mine(journal.candidates, journal.observed_days)

        assert len(findings) == 1
        assert findings[0].stated_label == "rest"
        assert findings[0].recorded_label == "working late"
        assert findings[0].together_days == 0

    def test_the_direction_is_named_thing_first(self):
        # A value is a claim about what someone wants; an activity is a record of
        # what happened. The pair is not symmetric and the finding says so.
        finding = mine(*_of(apart()))[0]

        assert finding.stated_kind is NodeKind.VALUE
        assert finding.recorded_kind is NodeKind.ACTIVITY

    def test_a_need_counts_as_something_named(self):
        journal = Journal()
        for day in (0, 2, 4, 6, 8, 10, 12, 14, 16):
            journal.write(day, NodeKind.NEED, "time alone")
        for day in (1, 3, 5, 7, 9, 11, 13, 15, 17):
            journal.write(day, NodeKind.ACTIVITY, "hosting people")
        journal.blank(*range(24))

        assert len(mine(*_of(journal))) == 1

    def test_a_belief_is_not_something_named(self):
        # "I am bad at resting" is a self-criticism, not an intention. Reading it
        # as one would turn something someone already feels badly about into a
        # goal the system reports them failing.
        journal = Journal()
        for day in (0, 2, 4, 6, 8, 10, 12, 14, 16):
            journal.write(day, NodeKind.BELIEF, "I am bad at resting")
        for day in (1, 3, 5, 7, 9, 11, 13, 15, 17):
            journal.write(day, NodeKind.ACTIVITY, "working late")
        journal.blank(*range(24))

        assert mine(*_of(journal)) == []


class TestWhenItMustStayQuiet:
    def test_a_thin_calendar_says_nothing(self):
        # Below the floor, "these never landed on the same day" is a fact about
        # how often the app was opened.
        journal = apart(
            stated_days=(0, 2, 4, 6),
            recorded_days=(1, 3, 5, 7),
            span=MIN_OBSERVED_DAYS - 1,
        )

        assert len(journal.observed_days) < MIN_OBSERVED_DAYS
        assert mine(*_of(journal)) == []

    def test_something_named_only_a_few_times_says_nothing(self):
        journal = apart(stated_days=tuple(range(MIN_DAYS_EACH - 1)))

        assert mine(*_of(journal)) == []

    def test_two_infrequent_things_missing_each_other_says_nothing(self):
        # Each side clears its own floor, but across a long enough record chance
        # alone would keep them apart, so the absence carries no information.
        journal = apart(
            stated_days=(0, 10, 20, 30),
            recorded_days=(5, 15, 25, 35),
            span=60,
        )

        assert mine(*_of(journal)) == []

    def test_things_that_do_share_days_say_nothing(self):
        journal = apart(recorded_days=(0, 2, 4, 6, 8, 10, 12, 14, 16))

        assert mine(*_of(journal)) == []

    def test_a_separation_nobody_writes_about_any_more_lapses(self):
        # Present tense, like every other claim here.
        journal = apart()
        much_later = START + timedelta(days=200)
        journal.blank(much_later.toordinal() - START.toordinal())

        assert mine(*_of(journal)) == []

    def test_weak_readings_do_not_become_a_claim_by_staying_apart(self):
        journal = apart(confidence=0.2)

        assert mine(*_of(journal)) == []

    def test_silence_never_enlarges_the_claim(self):
        # Days nobody wrote are not days a value went unhonoured. They enter the
        # denominator, which lowers what independence predicts, which can only
        # make the detector quieter — never louder.
        journal = apart()
        before = mine(*_of(journal))[0]

        journal.blank(30, 31)
        after = mine(*_of(journal))[0]

        assert (after.stated_days, after.recorded_days, after.together_days) == (
            before.stated_days,
            before.recorded_days,
            before.together_days,
        )
        assert after.expected_together < before.expected_together

    def test_a_long_silence_retires_the_claim_rather_than_strengthening_it(self):
        journal = apart()
        assert mine(*_of(journal))

        journal.blank(*range(24, 44))

        assert mine(*_of(journal)) == []


class TestWhatItIsAllowedToSay:
    def test_the_description_is_two_counts_and_an_overlap(self):
        text = describe(mine(*_of(apart(zoned=True)))[0])

        assert text == "rest came up on 9 days, working late on 9 days, never in the same entry"

    def test_the_description_never_judges(self):
        text = describe(mine(*_of(apart()))[0]).lower()

        for word in (
            "should",
            "but",
            "despite",
            "even though",
            "fail",
            "instead",
            "neglect",
            "ignore",
            "avoid",
            "only",
        ):
            assert word not in text

    def test_the_description_states_a_shared_entry_when_there_was_one(self):
        journal = apart(
            stated_days=(0, 2, 4, 6, 8, 10, 12, 14, 16, 18),
            recorded_days=(1, 3, 5, 7, 9, 11, 13, 15, 17, 18),
            span=24,
        )

        text = describe(mine(*_of(journal))[0])

        assert "in the same entry once" in text

    def test_days_are_hedged_until_every_entry_knows_its_timezone(self):
        assert describe(mine(*_of(apart()))[0]).endswith("(UTC)")
        assert not describe(mine(*_of(apart(zoned=True)))[0]).endswith("(UTC)")


class TestTheSharedPatternContract:
    def test_it_cites_every_entry_behind_both_sides(self):
        journal = apart()
        finding = mine(*_of(journal))[0]

        pattern = to_pattern(finding)

        assert pattern.kind is NodeKind.PATTERN
        assert pattern.label == describe(finding)
        assert pattern.key == finding.key
        assert set(pattern.observation_ids) == {
            candidate.observation_id for candidate in journal.candidates
        }
        assert set(pattern.node_ids) == {finding.stated_node_id, finding.recorded_node_id}

    def test_the_key_survives_rephrasing(self):
        first = mine(*_of(apart()))[0]
        second = mine(*_of(apart()))[0]

        assert first.key == second.key
        assert first.key == "Value:rest<->Activity:working late:apart"

    def test_input_order_does_not_change_the_claim(self):
        journal = apart()
        forwards = mine(journal.candidates, journal.observed_days)
        backwards = mine(list(reversed(journal.candidates)), journal.observed_days)

        assert [f.key for f in forwards] == [f.key for f in backwards]


def _of(journal: Journal):
    return journal.candidates, journal.observed_days

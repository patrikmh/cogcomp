"""Weekday periodicity. Pure logic, no database.

The detector is allowed to say when something recurs, not why. Most tests are
there to stop a person's journalling rhythm from being mistaken for a rhythm in
their life.
"""

from datetime import date, timedelta
from uuid import uuid4

from tlon.graph.schema import NodeKind
from tlon.patterns import Candidate
from tlon.periodicity import (
    MIN_COMPARISON_DAYS,
    MIN_OCCURRENCES,
    mine_weekdays,
)

START = date(2026, 3, 2)  # Monday


def candidate(
    label: str,
    offset: int,
    *,
    kind: NodeKind = NodeKind.EMOTION,
    confidence: float = 0.8,
) -> Candidate:
    return Candidate(
        node_id=uuid4(),
        kind=kind,
        label=label,
        confidence=confidence,
        observation_id=uuid4(),
        observed_on=START + timedelta(days=offset),
    )


def thursdays(label: str = "drained", count: int = MIN_OCCURRENCES) -> list[Candidate]:
    return [candidate(label, 3 + week * 7) for week in range(count)]


def writing_days(*offsets: int) -> set[date]:
    return {START + timedelta(days=offset) for offset in offsets}


def comparison_days() -> set[date]:
    return writing_days(*(4 + offset for offset in range(MIN_COMPARISON_DAYS)))


class TestWhatCountsAsWeekdayPeriodicity:
    def test_the_same_thing_on_four_thursdays_is_periodic(self):
        members = thursdays()
        patterns = mine_weekdays(
            members,
            {member.observed_on for member in members} | comparison_days(),
        )

        assert len(patterns) == 1
        assert patterns[0].key == "Emotion:drained:weekday:3"
        assert patterns[0].label == "drained · Thursdays (UTC)"

    def test_three_matching_weekdays_are_not_enough(self):
        members = thursdays(count=MIN_OCCURRENCES - 1)
        assert (
            mine_weekdays(
                members,
                {member.observed_on for member in members} | comparison_days(),
            )
            == []
        )

    def test_an_off_weekday_occurrence_breaks_the_strict_shape(self):
        members = [*thursdays(), candidate("drained", 4)]
        assert (
            mine_weekdays(
                members,
                {member.observed_on for member in members} | comparison_days(),
            )
            == []
        )

    def test_several_entries_on_one_thursday_are_not_several_weeks(self):
        members = [candidate("drained", 3) for _ in range(MIN_OCCURRENCES)]
        assert mine_weekdays(members, comparison_days() | {members[0].observed_on}) == []


class TestJournalCadenceIsNotAClaim:
    def test_a_thursday_only_writer_does_not_have_thursday_patterns(self):
        members = thursdays()
        assert mine_weekdays(members, {member.observed_on for member in members}) == []

    def test_comparison_writing_must_fall_inside_the_patterns_span(self):
        members = thursdays()
        before_the_pattern = writing_days(-10, -9, -8, -7)
        assert (
            mine_weekdays(
                members,
                {member.observed_on for member in members} | before_the_pattern,
            )
            == []
        )


class TestConfidenceAndScope:
    def test_repetition_does_not_launder_weak_readings(self):
        members = [
            candidate("drained", 3 + week * 7, confidence=0.2) for week in range(MIN_OCCURRENCES)
        ]
        assert (
            mine_weekdays(
                members,
                {member.observed_on for member in members} | comparison_days(),
            )
            == []
        )

    def test_events_and_thoughts_are_not_patterned(self):
        for kind in (NodeKind.EVENT, NodeKind.THOUGHT):
            members = thursdays()
            members = [
                Candidate(
                    node_id=member.node_id,
                    kind=kind,
                    label=member.label,
                    confidence=member.confidence,
                    observation_id=member.observation_id,
                    observed_on=member.observed_on,
                )
                for member in members
            ]
            assert (
                mine_weekdays(
                    members,
                    {member.observed_on for member in members} | comparison_days(),
                )
                == []
            )


class TestEvidenceAndTime:
    def test_every_contributing_entry_and_node_is_retained(self):
        members = thursdays()
        pattern = mine_weekdays(
            members,
            {member.observed_on for member in members} | comparison_days(),
        )[0]

        assert set(pattern.observation_ids) == {member.observation_id for member in members}
        assert set(pattern.node_ids) == {member.node_id for member in members}
        assert pattern.distinct_days == MIN_OCCURRENCES

    def test_continued_writing_can_retire_a_periodicity(self):
        members = thursdays()
        much_later = START + timedelta(days=90)
        observed_days = (
            {member.observed_on for member in members} | comparison_days() | {much_later}
        )

        assert mine_weekdays(members, observed_days) == []

    def test_not_writing_is_not_evidence_that_a_periodicity_ended(self):
        members = thursdays()
        assert mine_weekdays(
            members,
            {member.observed_on for member in members} | comparison_days(),
        )

    def test_input_order_does_not_change_the_claim(self):
        members = thursdays()
        observed_days = {member.observed_on for member in members} | comparison_days()

        first = mine_weekdays(members, observed_days)
        second = mine_weekdays(list(reversed(members)), observed_days)

        assert [(pattern.key, pattern.label, pattern.occurrences) for pattern in first] == [
            (pattern.key, pattern.label, pattern.occurrences) for pattern in second
        ]
